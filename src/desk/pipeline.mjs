/**
 * The research pipeline.
 *
 *   PLAN -> INGEST -> EXTRACT -> VERIFY -> SCORE -> PRESENT
 *
 * One call, `runTask()`, takes a trader's natural-language question and returns
 * a ranked, verified, evidence-backed set of signal cards plus a full audit
 * trace of every tool call, document read and scoring decision that produced
 * them. The trace is streamed so the LUI can show the work as it happens.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { initHub } from '../ingest/index.mjs';
import { INTENTS } from '../ingest/bitget-market.mjs';
import { Extractor } from '../extract/index.mjs';
import { EvidenceLedger } from '../verify/ledger.mjs';
import { scoreCard, rankCards, explainScore } from '../score/rubric.mjs';
import { CHANNEL_IDS, CHANNELS, validateCard, cardSummary } from '../schema.mjs';
import { sessionState, toDateStr, addDays, parseDate } from '../util/time.mjs';
import { round } from '../util/num.mjs';
import { SignalBoard } from './board.mjs';
import { renderBrief } from './brief.mjs';

const log = logger('pipeline');

const TICKER_RE = /\b([A-Z][A-Z0-9.\-]{0,9})\b/g;

/** Index and ETF proxies - useful for macro context, wrong targets for issuer-level data. */
const INDEX_AND_ETF = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'TLT', 'XLK', 'XLE', 'XLF', 'XLY', 'XLP', 'SMH', 'SOXX', 'IVV', 'VOO']);
/**
 * Phrases that mean "open the whole spectrum" on purpose.
 *
 * planQuestion() also opens the whole spectrum when NOTHING matched, and the two
 * cases produce an identical channel list. They are not the same claim: one is
 * the trader asking for a sweep, the other is the desk failing to parse the
 * question. Conflating them lets a gibberish prompt come back as a confident
 * seven-channel brief - the exact failure mode this desk exists to refuse. So
 * sweep intent is detected explicitly and the fallback stays labelled as a
 * fallback (`widened` below, surfaced by renderBrief and the trace).
 */
const SWEEP_TERMS = ['desk sweep', 'full sweep', 'sweep', 'every channel', 'all channels', 'all seven channels', 'whole spectrum', 'entire spectrum', 'everything', '全频道', '全部频道', '所有频道', '七个频道', '全面扫描', '扫描一遍', '全扫'];

const STOPWORDS = new Set(['THE', 'AND', 'FOR', 'WITH', 'WHAT', 'WHY', 'HOW', 'IS', 'ARE', 'CAN', 'SHOULD', 'WOULD', 'THIS', 'THAT', 'FROM', 'INTO', 'AFTER', 'BEFORE', 'ABOUT', 'GIVE', 'SHOW', 'ME', 'MY', 'YOU', 'ALL', 'ANY', 'NOT', 'BUT', 'NOW', 'TODAY', 'WEEK', 'MONTH', 'YEAR', 'EPS', 'CPI', 'FOMC', 'GDP', 'NFP', 'PMI', 'IPO', 'ETF', 'AI', 'US', 'USA', 'VS', 'PER', 'ITS', 'THEIR', 'OUR', 'HAS', 'HAVE', 'HAD', 'BEEN', 'BEING', 'WAS', 'WERE', 'WILL', 'DID', 'DOES', 'MACRO', 'STOCK', 'STOCKS', 'SHARE', 'SHARES', 'PRICE', 'PRICES', 'NEWS', 'CALL', 'GUIDE', 'RATES', 'RATE']);

/**
 * Deterministic normalisation of common misspellings before keyword routing.
 *
 * Not fuzzy matching - that would trade the auditable routing this desk is built
 * on for guesswork. This is a small, explicit, test-pinned map of the typos a
 * trader actually makes (transposed / dropped / doubled letters), applied on
 * word boundaries. It can only ADD a correct route, never silently remove one,
 * and the substitution is visible in the plan trace.
 */
const TYPO_ALIASES = {
  earinngs: 'earnings', earningss: 'earnings', ernings: 'earnings', earings: 'earnings',
  earnigns: 'earnings', earnngs: 'earnings', guidnace: 'guidance', guidane: 'guidance',
  iflation: 'inflation', inflatoin: 'inflation', inflationn: 'inflation', inflaton: 'inflation',
  inflaction: 'inflation',
  recesion: 'recession', ressesion: 'recession', recesison: 'recession',
  payrol: 'payroll', payrroll: 'payroll',
  insder: 'insider', insiider: 'insider',
  wekeend: 'weekend', weekdend: 'weekend', weekand: 'weekend', weekened: 'weekend',
  rtokne: 'rtoken', rtoke: 'rtoken',
  concensus: 'consensus', consenus: 'consensus', consensous: 'consensus',
  fommc: 'fomc',
};
/** Explicit Chinese substitutions. Same rule as the English map: listed, not fuzzy. */
const ZH_TYPOS = [['才报', '财报'], ['休事', '休市'], ['通涨', '通胀'], ['非衣', '非农']];
function normalizeAsk(q) {
  let text = String(q || '');
  for (const [bad, good] of ZH_TYPOS) text = text.split(bad).join(good);
  const lower = text.toLowerCase();
  return lower.replace(/[a-z][a-z'-]{3,}/g, (word) => TYPO_ALIASES[word] || word);
}

/**
 * Which bitget-signal skills each channel needs, and why.
 *
 * This map is the single source of truth for BOTH the ingest loop below and
 * /api/capabilities, so the desk can never advertise a skill it does not call.
 *
 * `closed-window` triggers the crypto-side skills alongside `cross-asset`, and
 * that is not padding: the entire argument of the closed-window channel is that
 * an rToken keeps pricing a US macro print on crypto rails while the cash market
 * is shut, which makes crypto-side regime data primary evidence for it. Gating
 * those skills on `cross-asset` alone meant a question like "周末休市时 rToken
 * 怎么定价" - the core S2 scenario - ran with no crypto-side data at all.
 */
export const SKILL_TRIGGERS = [
  { skill: 'sentiment-analyst', channels: ['cross-asset', 'closed-window'], why: 'Fear & Greed / funding / long-short ratio decide who is awake to trade the rToken outside cash hours' },
  { skill: 'macro-analyst', channels: ['macro-transmission', 'cross-asset', 'closed-window'], why: 'A CPI or FOMC question is a macro-transmission question. Cut odds, the curve and BTC-vs-Nasdaq/DXY correlation are the bridge into an rToken, so the skill has to run on that channel and not only when the trader also says "crypto"' },
  { skill: 'market-intel', channels: ['flow-footprint'], why: 'Spot ETF flows, stablecoin supply and whale flow are the cross-market footprint behind position changes' },
  { skill: 'technical-analysis', channels: ['risk-flag'], why: 'RSI, distance from the 200-DMA and support/resistance flag a stretched tape as a risk, independent of the narrative' },
  { skill: 'news-briefing', channels: ['narrative-shift'], why: 'Trending boards and narrative synthesis detect when the story is turning before fundamentals confirm it' },
];

/** Skills the plan should invoke for a set of channels. De-duplicated, order-stable. */
export function skillsForChannels(channels = []) {
  const out = [];
  for (const trigger of SKILL_TRIGGERS) {
    const wantedBy = trigger.channels.filter((c) => channels.includes(c));
    if (wantedBy.length && !out.some((o) => o.skill === trigger.skill)) out.push({ ...trigger, wantedBy });
  }
  return out;
}

/**
 * Question -> { tickers, channels, indicators, intents, intent, session }.
 *
 * @param {string} question
 * @param {{asOf?: string|Date|null}} [opts] the desk clock to read the session
 *   off. Omit it and the session is read off now, which is right for a live
 *   question and wrong for every frozen-clock run.
 */
export function planQuestion(question, { asOf = null } = {}) {
  const q = String(question || '');
  const upper = q.toUpperCase();
  // These are CANDIDATES. Uppercase words in a question look exactly like
  // tickers ("Full desk sweep" yields FULL, DESK, SWEEP), so runTask() filters
  // them against the symbols the desk actually has data for before use.
  const tickerCandidates = [...new Set([...upper.matchAll(TICKER_RE)].map((m) => m[1]).filter((t) => !STOPWORDS.has(t) && t.length <= 6))];
  const lower = normalizeAsk(q);
  // English matching is on word tokens, not substrings. "disclosed" used to open
  // the closed-window channel, "print" turned every CPI question into an earnings
  // question, "gaps" turned the expectation-gap thesis into an overnight-gap
  // question, and "something" / "methodology" opened cross-asset via "eth".
  // Chinese has no spaces, so those terms stay as explicit substrings.
  const tokens = new Set(lower.match(/[a-z0-9]+/g) || []);
  const channels = new Set();
  const intents = new Set();
  const indicators = new Set();
  const has = (...terms) => terms.some((t) => {
    if (/[\u4e00-\u9fff]/.test(t) || /[\s/-]/.test(t)) return lower.includes(t);
    return tokens.has(t);
  });

  if (has('earnings', 'eps', 'quarter', 'quarterly', 'revenue', 'guidance', 'consensus', '电话会', '财报', '财报季', '业绩', '指引', '一致预期', '超预期', '预期差')) {
    channels.add('earnings-gap');
    intents.add('earningsCalendar'); intents.add('analystEstimates'); intents.add('incomeStatement');
  }
  if (has('cpi', 'inflation', '通胀', 'fomc', 'fed', 'rate', 'nfp', 'payroll', 'nonfarm', 'jobs', 'pmi', 'pce', 'macro', '宏观', 'yield', 'treasury', '非农', '美联储', '降息', '加息', '议息', '传导', '就业')) {
    channels.add('macro-transmission');
    intents.add('sentiment');
    if (has('cpi', '通胀', 'inflation')) indicators.add('cpi');
    if (has('nfp', 'payroll', 'nonfarm', 'jobs', '就业', '非农')) indicators.add('nfp');
    if (has('fomc', 'fed', 'rate', '美联储', '降息', '加息', '议息', '利率')) indicators.add('fomc');
    if (has('pmi', 'ism', 'activity')) indicators.add('pmi');
  }
  if (has('weekend', 'overnight', 'closed', 'rth', 'rtoken', 'r-token', 'tokenized', 'tokenised', '7x24', '24/7', '休市', '周末', '盘前', '盘后', 'gap', '跳空', '隔夜', '代币化')) {
    channels.add('closed-window');
    intents.add('quote');
  }
  if (has('insider', '13f', 'institutional', 'etf flow', 'flows', '内部人', '机构', '资金', '减持', '增持', '持仓')) {
    channels.add('flow-footprint');
    intents.add('insiderTrades'); intents.add('institutionalHoldings');
  }
  if (has('news', 'narrative', 'sentiment', 'story', 'rumor', 'rumour', '新闻', '叙事', '情绪', '传闻', 'twitter', 'reddit')) {
    channels.add('narrative-shift');
    intents.add('news'); intents.add('sentiment');
  }
  if (has('crypto', 'btc', 'bitcoin', 'eth', 'funding', 'fear', 'greed', 'on-chain', 'onchain', '链上', '加密', '比特币', '资金费率', '恐惧', '贪婪')) {
    channels.add('cross-asset');
  }
  if (has('risk', 'short', 'bear', 'fraud', 'red flag', 'accounting', 'concern', '风险', '做空', '暴雷', '超买', '均线', '技术面', 'rsi')) {
    channels.add('risk-flag');
    intents.add('ratios'); intents.add('balanceSheet'); intents.add('cashFlow');
  }
  if (has('valuation', 'multiple', 'p/e', 'pe ratio', 'cheap', 'expensive', '估值')) {
    intents.add('valuation'); intents.add('ratios');
  }
  if (has('price', 'quote', 'chart', 'level', '行情', '价格')) intents.add('quote');
  if (has('dividend', '分红')) intents.add('dividends');
  if (has('analyst', 'target', 'upgrade', 'downgrade', '分析师', '目标价')) intents.add('analystTargetPrice');
  if (has('profile', 'business', 'company', '公司')) intents.add('profile');

  // Captured BEFORE the fallback below: which channels the question actually
  // named. Everything after this point can widen the set, so this is the only
  // place the original parse result still exists.
  const matched = CHANNEL_IDS.filter((c) => channels.has(c));
  const sweepRequested = SWEEP_TERMS.some((t) => lower.includes(t));

  if (!channels.size) {
    // Nothing matched - open the whole spectrum and let the corpus decide.
    for (const c of CHANNEL_IDS) channels.add(c);
  }
  if (!intents.size) { intents.add('quote'); intents.add('news'); }

  // The session belongs to the task's clock, not to the machine's. rules.mjs
  // already reads it this way; the planner did not, so a scenario pinned to
  // Saturday reported "pre-market, Wed" - the exact opposite of the closed
  // window the scenario exists to demonstrate - and nyMinutes leaked wall-clock
  // time into the exported demo bundle.
  const session = sessionState(asOf ?? new Date());
  return {
    question: q,
    tickers: tickerCandidates,
    tickerCandidates,
    channels: CHANNEL_IDS.filter((c) => channels.has(c)),
    matched,
    sweepRequested,
    /** True when the spectrum was opened because nothing matched, not because it was asked for. */
    widened: matched.length === 0 && !sweepRequested,
    /**
     * True when nothing matched AND no ticker was named - i.e. the input reads
     * off-domain (gibberish, small talk, an unrelated question), not a thinly
     * specified research ask. The desk says so out loud and offers concrete
     * things to ask rather than passing the seven-channel scan off as an answer.
     */
    offDomain: (matched.length === 0 && !sweepRequested) && tickerCandidates.length === 0,
    intents: INTENTS.filter((i) => intents.has(i)),
    indicators: [...indicators],
    session,
    docKinds: deriveKinds(channels),
    limit: 12,
  };
}

function deriveKinds(channels) {
  const kinds = new Set();
  if (channels.has('earnings-gap') || channels.has('risk-flag')) { kinds.add('earnings-release'); kinds.add('earnings-call'); kinds.add('guidance'); kinds.add('filing'); }
  if (channels.has('macro-transmission')) { kinds.add('macro-print'); kinds.add('fomc-statement'); }
  if (channels.has('narrative-shift') || channels.has('closed-window')) { kinds.add('news'); kinds.add('analyst-note'); kinds.add('social'); }
  if (channels.has('cross-asset')) kinds.add('news');
  return [...kinds];
}

export class Pipeline {
  constructor({ hub, board, extractor, ledger, llm } = {}) {
    this.hub = hub ?? null;
    this.board = board ?? new SignalBoard();
    this.ledger = ledger ?? null;
    this._extractor = extractor ?? null;
    this._llm = llm ?? null;
    this.runs = [];
  }

  async ready() {
    if (!this.hub) this.hub = await initHub();
    if (!this.ledger) this.ledger = new EvidenceLedger({ hub: this.hub });
    if (!this._extractor) this._extractor = new Extractor({ hub: this.hub, llm: this._llm ?? undefined });
    return this;
  }

  /**
   * Run one complete research task.
   * @param {object} p
   * @param {string} p.question
   * @param {(evt:object)=>void} [p.onEvent] streaming callback for the LUI
   */
  async runTask({ question, asOf = new Date(), channels = null, tickers = null, limit = 12, onEvent = null, persist = true }) {
    await this.ready();
    const started = Date.now();
    const emit = (stage, detail) => {
      const evt = { stage, at: new Date().toISOString(), ...detail };
      if (onEvent) onEvent(evt);
      return evt;
    };

    // ---- PLAN -------------------------------------------------------------
    const plan = planQuestion(question, { asOf });
    if (channels?.length) plan.channels = CHANNEL_IDS.filter((c) => channels.includes(c));
    if (tickers?.length) plan.tickers = [...new Set([...plan.tickerCandidates, ...tickers.map((t) => t.toUpperCase())])];

    // Resolve candidates against symbols the desk can actually price or read.
    const known = this.knownSymbols();
    const resolved = plan.tickers.filter((t) => known.has(t));
    const rejected = plan.tickers.filter((t) => !known.has(t));
    plan.tickersResolved = resolved;
    plan.tickersRejected = rejected;
    // Refine off-domain now that candidates have been tested against symbols the
    // desk can actually price. planQuestion can only see letter shapes, so an
    // uppercase nonsense word ("HELLO", "ASDKJH") looks like a ticker until this
    // resolution rejects it. A genuinely off-domain input is one where the
    // planner fell back AND not one named symbol resolved. Explicit channel
    // selection (recorded scenarios) is never off-domain by construction.
    const explicitChannels = channels?.length > 0;
    plan.offDomain = !explicitChannels && plan.widened && resolved.length === 0;
    let dataTickers = resolved;
    emit('plan', {
      plan: { ...plan, session: plan.session },
      message: describePlan(plan),
      resolvedTickers: resolved,
      rejectedTickers: rejected,
    });
    if (plan.widened) {
      // Said out loud, in the trace, before any card is shown. A question the
      // planner could not parse must not come back wearing the same confident
      // seven-channel brief as one the trader explicitly asked for.
      emit('plan:widened', {
        matched: plan.matched,
        channels: plan.channels,
        message: 'No channel keyword matched this question. All seven channels were opened and the corpus decided - read the result as a scan of what is in scope, not as an answer to a specific ask.',
      });
    }

    // ---- INGEST -----------------------------------------------------------
    const documents = this.hub.gather(question, {
      limit,
      tickers: dataTickers,
      kinds: plan.docKinds,
    });
    emit('ingest:corpus', { count: documents.length, ids: documents.map((d) => d.id), kinds: [...new Set(documents.map((d) => d.kind))] });

    // If the question named no resolvable ticker, pull data for the issuers the
    // desk is actually reading about. A flow question with no ticker should still
    // produce flow cards rather than silently producing nothing.
    if (!dataTickers.length) {
      dataTickers = [...new Set(documents.flatMap((d) => d.tickers || []))]
        .map((t) => String(t).toUpperCase())
        .filter((t) => known.has(t))
        .slice(0, 6);
      if (dataTickers.length) emit('plan:ticker-fallback', { tickers: dataTickers, message: `No ticker resolved from the question; using issuers in scope: ${dataTickers.join(', ')}` });
    }

    // Issuer-level intents should target actual companies. Index/ETF proxies are
    // great macro context but asking for "insider trades in SPY" is meaningless,
    // so they are filtered out here and the issuers in the retrieved documents
    // are folded in instead.
    // If the trader named a ticker, focus on it. Only when the question named
    // nothing resolvable do we widen to the issuers the documents are about.
    const namedCompanies = dataTickers.filter((t) => !INDEX_AND_ETF.has(t));
    const nameTickers = (namedCompanies.length
      ? namedCompanies
      : [...new Set(documents.flatMap((d) => d.tickers || []))].map((t) => String(t).toUpperCase()).filter((t) => !INDEX_AND_ETF.has(t) && known.has(t))
    ).slice(0, 6);

    /** Intents that are market-wide and take no symbol argument. */
    const NO_TICKER = new Set(['sentiment', 'marketMovers', 'news']);
    /** Intents that only make sense against a single issuer. */
    const PER_NAME = new Set(['insiderTrades', 'institutionalHoldings', 'earningsCalendar', 'incomeStatement', 'balanceSheet', 'cashFlow', 'ratios', 'valuation', 'dividends', 'analystEstimates', 'analystTargetPrice', 'profile', 'etfHoldings']);

    const snapshots = [];
    /**
     * Every market intent the plan asked for, and what actually came back.
     *
     * A failed or unbacked fetch used to disappear silently: the trace only ever
     * listed intents that returned data, so `risk-flag` could ask for
     * balanceSheet and cashFlow, get neither offline, and still report a clean
     * ingest. For a desk whose whole pitch is "show what you could not ground",
     * an unreported gap is the same defect as an unreported hallucination.
     */
    const intentRequests = [];
    for (const intent of plan.intents.slice(0, 10)) {
      const targets = NO_TICKER.has(intent)
        ? [null]
        : (PER_NAME.has(intent) ? nameTickers : (dataTickers.length ? dataTickers.slice(0, 4) : []));
      const usable = targets.filter((t) => t || NO_TICKER.has(intent));
      if (!usable.length) {
        intentRequests.push({ intent, calls: 0, served: 0, reason: 'no symbol in scope takes this intent' });
        continue;
      }
      let calls = 0;
      let served = 0;
      let lastReason = null;
      for (const t of usable) {
        calls += 1;
        try {
          const snap = await this.hub.market.fetch(intent, t ? { ticker: t } : {});
          if (snap.value !== null && snap.value !== undefined) {
            snapshots.push(snap);
            served += 1;
          } else {
            lastReason = snap.error || `no live tool resolved and no offline fixture for '${intent}'`;
          }
        } catch (err) {
          lastReason = err.message;
          log.debug(`${intent}(${t}) failed: ${err.message}`);
        }
      }
      intentRequests.push({ intent, calls, served, reason: served ? null : (lastReason || 'provider returned no value') });
    }

    // bitget-signal skills, driven by SKILL_TRIGGERS so the capabilities endpoint
    // and the ingest loop can never disagree about what is wired.
    const skillCalls = [];
    for (const trigger of skillsForChannels(plan.channels)) {
      const base = { skill: trigger.skill, wantedBy: trigger.wantedBy, why: trigger.why };
      try {
        const r = await this.hub.signal.invoke(trigger.skill, { query: question });
        if (r.value !== null && r.value !== undefined) {
          snapshots.push({
            intent: `signal:${trigger.skill}`,
            skill: trigger.skill,
            channels: trigger.wantedBy,
            args: { query: question },
            value: r.value,
            origin: r.origin,
          });
          skillCalls.push({ ...base, served: true, origin: r.origin });
        } else {
          skillCalls.push({ ...base, served: false, reason: `no live tool resolved and no offline fixture for '${trigger.skill}'` });
        }
      } catch (err) {
        log.debug(`signal ${trigger.skill} failed: ${err.message}`);
        skillCalls.push({ ...base, served: false, reason: err.message });
      }
    }

    const servedIntents = intentRequests.filter((r) => r.served).map((r) => r.intent);
    const missing = intentRequests.filter((r) => !r.served).map((r) => ({ intent: r.intent, reason: r.reason }));
    const skillsServed = skillCalls.filter((s) => s.served).map((s) => s.skill);
    const skillsMissing = skillCalls.filter((s) => !s.served).map((s) => ({ skill: s.skill, reason: s.reason }));
    /**
     * Chainbase AgentKey - the optional external partner source.
     *
     * Queried only when it actually connected. With no CHAINBASE_AGENT_KEY the
     * provider reports state 'disabled', this block is inert, and the offline
     * demo is bit-for-bit what it would be without the provider existing - which
     * is the point of gating on observed state rather than on config.
     */
    const agentKeyCalls = [];
    if (this.hub.chainbase?.state === 'live') {
      const want = new Set();
      if (plan.intents.includes('news')) want.add('news');
      if (plan.intents.includes('sentiment')) want.add('social');
      if (plan.intents.includes('quote')) want.add('marketData');
      // An rToken IS an on-chain object, so the channels that reason about one
      // are the ones that should ask AgentKey for on-chain behaviour.
      if (plan.channels.includes('cross-asset') || plan.channels.includes('closed-window')) want.add('onchain');
      for (const akIntent of [...want].slice(0, 4)) {
        const snap = await this.hub.chainbase.fetch(akIntent, dataTickers.length ? { symbol: dataTickers[0] } : {});
        if (snap.value !== null && snap.value !== undefined) {
          // Prefixed intent, so an AgentKey snapshot can never be mistaken for a
          // bitget-mcp-server one by the ledger or by the card builders.
          snapshots.push({ intent: `agentkey:${akIntent}`, args: snap.args, value: snap.value, origin: snap.origin });
          agentKeyCalls.push({ intent: akIntent, served: true, origin: snap.origin });
        } else {
          agentKeyCalls.push({ intent: akIntent, served: false, reason: snap.error });
        }
      }
    } else if (this.hub.chainbase?.configured) {
      agentKeyCalls.push({ intent: '*', served: false, reason: this.hub.chainbase.reason || this.hub.chainbase.error || 'not connected' });
    }

    emit('ingest:data', {
      snapshots: snapshots.length,
      origins: [...new Set(snapshots.map((s) => s.origin))],
      intents: [...new Set(snapshots.map((s) => s.intent))],
      requested: intentRequests.map((r) => r.intent),
      served: servedIntents,
      missing,
      skills: skillCalls,
      agentKey: agentKeyCalls,
      message: [
        `${snapshots.length} snapshots; market intents ${servedIntents.length}/${intentRequests.length} served`,
        missing.length ? `NOT served: ${missing.map((m) => m.intent).join(', ')}` : null,
        skillCalls.length ? `bitget-signal: ${skillsServed.join(', ') || 'none served'}` : null,
        skillsMissing.length ? `skills NOT served: ${skillsMissing.map((m) => m.skill).join(', ')}` : null,
        agentKeyCalls.length ? `agentkey: ${agentKeyCalls.filter((c) => c.served).map((c) => c.intent).join(', ') || 'configured but not connected'}` : null,
      ].filter(Boolean).join(' | '),
    });
    // ---- EXTRACT ----------------------------------------------------------
    const extraction = await this._extractor.run({
      question,
      documents,
      snapshots,
      channels: plan.channels,
      asOf,
    });
    emit('extract', {
      mode: extraction.mode,
      cards: extraction.cards.length,
      trace: extraction.trace,
      researchNotes: extraction.llmNotes,
    });

    // ---- VERIFY -----------------------------------------------------------
    const verification = [];
    for (const card of extraction.cards) {
      const report = this.ledger.verifyCard(card, { documents, snapshots });
      verification.push({ cardId: card.id, ...report, items: undefined });
      emit('verify', { cardId: card.id, title: card.title, pass: report.pass, fail: report.fail, unverifiable: report.unverifiable, quarantined: report.quarantine });
    }
    emit('verify:summary', this.ledger.summary());

    // ---- SCORE ------------------------------------------------------------
    for (const card of extraction.cards) {
      scoreCard(card, { at: asOf });
      const v = validateCard(card);
      card.validation = v;
      if (!v.ok && card.status !== 'quarantined') card.status = 'draft';
      if (card.status === 'draft' && v.ok && card.score.publishable) card.status = 'active';
      emit('score', { cardId: card.id, title: card.title, total: card.score.total, grade: card.score.grade, publishable: card.score.publishable, breakdown: card.scoreBreakdown });
    }

    // ---- PRESENT ----------------------------------------------------------
    const ranked = rankCards(extraction.cards, { at: asOf });
    const published = ranked.filter((c) => c.status === 'active');
    const quarantined = ranked.filter((c) => c.status === 'quarantined');
    const belowThreshold = ranked.filter((c) => c.status === 'draft');

    if (persist) this.board.ingest(ranked, { asOf });

    // Say so explicitly when a name the trader asked about produced nothing.
    // Silence is information, and hiding it makes the desk look omniscient.
    const covered = new Set(ranked.flatMap((c) => c.tickers || []));
    const asked = [...new Set([...(plan.tickersResolved || []), ...namedCompanies])];
    const coverage = {
      asked,
      answered: asked.filter((t) => covered.has(t)),
      silent: asked.filter((t) => !covered.has(t)),
    };

    const context = {
      asOf: asOf instanceof Date ? asOf.toISOString() : asOf,
      session: plan.session,
      question,
      dataMode: this.hub.market.state,
      llm: this._extractor.llm.stats(),
      plan: {
        matched: plan.matched,
        channels: plan.channels,
        sweepRequested: plan.sweepRequested,
        widened: plan.widened,
        offDomain: plan.offDomain,
        intentsRequested: plan.intents,
        intentsServed: snapshots.filter((s) => !s.skill).map((s) => s.intent).filter((v, i, a) => a.indexOf(v) === i),
        intentsMissing: intentRequests.filter((r) => !r.served).map((r) => ({ intent: r.intent, reason: r.reason })),
        skills: skillCalls,
        agentKey: agentKeyCalls,
      },
    };
    const brief = renderBrief({ cards: published, quarantined, belowThreshold, context, ledger: this.ledger.summary(), coverage });

    const run = {
      id: `RUN-${Date.now().toString(36).toUpperCase()}`,
      question,
      asOf: context.asOf,
      plan,
      coverage,
      documentsUsed: documents.map((d) => ({ id: d.id, kind: d.kind, title: d.title, tickers: d.tickers, publishedAt: d.publishedAt })),
      snapshotsUsed: snapshots.map((s) => ({ intent: s.intent, args: s.args, origin: s.origin })),
      mode: extraction.mode,
      trace: extraction.trace,
      cards: ranked,
      published: published.map(cardSummary),
      quarantined: quarantined.map(cardSummary),
      belowThreshold: belowThreshold.map(cardSummary),
      verification,
      ledger: this.ledger.summary(),
      brief,
      ms: Date.now() - started,
    };
    this.runs.push(run);
    if (this.runs.length > 50) this.runs.shift();

    emit('present', {
      runId: run.id,
      published: published.length,
      quarantined: quarantined.length,
      belowThreshold: belowThreshold.length,
      ms: run.ms,
      top: published.slice(0, 5).map(cardSummary),
    });
    return run;
  }

  /** Convenience: run a task and return only the brief text. */
  async ask(question, opts = {}) {
    const run = await this.runTask({ question, ...opts });
    return run.brief.markdown;
  }

  lastRun() {
    return this.runs[this.runs.length - 1] ?? null;
  }

  /**
   * Symbols the desk can actually act on: everything in the bundled price book,
   * every ticker that appears in the corpus, and the default ranking universe.
   * Used to stop free-text words from being treated as tickers.
   */
  knownSymbols() {
    const set = new Set();
    for (const s of this.hub.prices.symbols()) set.add(s.toUpperCase());
    for (const d of this.hub.corpus.all()) for (const t of d.tickers || []) set.add(String(t).toUpperCase());
    for (const s of this._extractor?.rules?.universe || []) set.add(String(s).toUpperCase());
    return set;
  }

  status() {
    return {
      hub: this.hub ? this.hub.status() : null,
      extractor: this._extractor ? { mode: this._extractor.mode, stats: this._extractor.stats, llm: this._extractor.llm.stats() } : null,
      ledger: this.ledger ? this.ledger.summary() : null,
      board: this.board ? this.board.status() : null,
      runs: this.runs.length,
    };
  }
}

function describePlan(plan) {
  const bits = [];
  if (plan.widened) bits.push('no channel keyword matched - spectrum widened to all seven (this is a scan, not a parsed ask)');
  else if (plan.sweepRequested && !plan.matched.length) bits.push('full sweep requested - all seven channels');
  else bits.push(`matched ${plan.matched.length}/7 channels`);
  if (plan.tickers.length) bits.push(`tickers ${plan.tickers.join(', ')}`);
  bits.push(`channels ${plan.channels.map((c) => CHANNELS[c].zh || c).join(' / ')}`);
  if (plan.indicators.length) bits.push(`macro indicators ${plan.indicators.join(', ')}`);
  bits.push(`data intents ${plan.intents.join(', ')}`);
  bits.push(`US cash session ${plan.session.state}`);
  return `Plan: ${bits.join(' | ')}`;
}

export { scoreCard, rankCards, explainScore, cardSummary };
export default Pipeline;