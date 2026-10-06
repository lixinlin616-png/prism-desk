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
const STOPWORDS = new Set(['THE', 'AND', 'FOR', 'WITH', 'WHAT', 'WHY', 'HOW', 'IS', 'ARE', 'CAN', 'SHOULD', 'WOULD', 'THIS', 'THAT', 'FROM', 'INTO', 'AFTER', 'BEFORE', 'ABOUT', 'GIVE', 'SHOW', 'ME', 'MY', 'YOU', 'ALL', 'ANY', 'NOT', 'BUT', 'NOW', 'TODAY', 'WEEK', 'MONTH', 'YEAR', 'EPS', 'CPI', 'FOMC', 'GDP', 'NFP', 'PMI', 'IPO', 'ETF', 'AI', 'US', 'USA', 'VS', 'PER', 'ITS', 'THEIR', 'OUR', 'HAS', 'HAVE', 'HAD', 'BEEN', 'BEING', 'WAS', 'WERE', 'WILL', 'DID', 'DOES', 'MACRO', 'STOCK', 'STOCKS', 'SHARE', 'SHARES', 'PRICE', 'PRICES', 'NEWS', 'CALL', 'GUIDE', 'RATES', 'RATE']);

/** Question -> { tickers, channels, indicators, intents, intent }. */
export function planQuestion(question) {
  const q = String(question || '');
  const upper = q.toUpperCase();
  // These are CANDIDATES. Uppercase words in a question look exactly like
  // tickers ("Full desk sweep" yields FULL, DESK, SWEEP), so runTask() filters
  // them against the symbols the desk actually has data for before use.
  const tickerCandidates = [...new Set([...upper.matchAll(TICKER_RE)].map((m) => m[1]).filter((t) => !STOPWORDS.has(t) && t.length <= 6))];
  const lower = q.toLowerCase();

  const channels = new Set();
  const intents = new Set();
  const indicators = new Set();

  const has = (...terms) => terms.some((t) => lower.includes(t));

  if (has('earnings', 'eps', 'report', 'quarter', 'print', 'revenue', 'guidance', '电话会', '财报', '业绩')) {
    channels.add('earnings-gap');
    intents.add('earningsCalendar'); intents.add('analystEstimates'); intents.add('incomeStatement');
  }
  if (has('cpi', 'inflation', '通胀', 'fomc', 'fed', 'rate', 'nfp', 'payroll', 'jobs', 'pmi', 'pce', 'macro', '宏观', 'yield', 'treasury')) {
    channels.add('macro-transmission');
    intents.add('sentiment');
    if (has('cpi', '通胀', 'inflation')) indicators.add('cpi');
    if (has('nfp', 'payroll', 'jobs', '就业')) indicators.add('nfp');
    if (has('fomc', 'fed ', 'rate', '利率')) indicators.add('fomc');
    if (has('pmi', 'ism', 'activity')) indicators.add('pmi');
  }
  if (has('weekend', 'overnight', 'closed', 'rth', 'rtoken', 'r-token', 'tokenized', 'tokenised', '7x24', '24/7', '休市', '周末', '盘前', '盘后', 'gap')) {
    channels.add('closed-window');
    intents.add('quote');
  }
  if (has('insider', '13f', 'institutional', 'etf flow', 'flows', '内部人', '机构', '资金')) {
    channels.add('flow-footprint');
    intents.add('insiderTrades'); intents.add('institutionalHoldings');
  }
  if (has('news', 'narrative', 'sentiment', 'story', 'rumor', 'rumour', '新闻', '叙事', '情绪', 'x ', 'twitter', 'reddit')) {
    channels.add('narrative-shift');
    intents.add('news'); intents.add('sentiment');
  }
  if (has('crypto', 'btc', 'bitcoin', 'eth', 'funding', 'fear', 'greed', 'on-chain', 'onchain', '链上', '加密')) {
    channels.add('cross-asset');
  }
  if (has('risk', 'short', 'bear', 'fraud', 'red flag', 'accounting', 'concern', '风险', '做空', '暴雷')) {
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

  if (!channels.size) {
    // Nothing matched - open the whole spectrum and let the corpus decide.
    for (const c of CHANNEL_IDS) channels.add(c);
  }
  if (!intents.size) { intents.add('quote'); intents.add('news'); }

  const session = sessionState();
  return {
    question: q,
    tickers: tickerCandidates,
    tickerCandidates,
    channels: CHANNEL_IDS.filter((c) => channels.has(c)),
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
    const plan = planQuestion(question);
    if (channels?.length) plan.channels = CHANNEL_IDS.filter((c) => channels.includes(c));
    if (tickers?.length) plan.tickers = [...new Set([...plan.tickerCandidates, ...tickers.map((t) => t.toUpperCase())])];

    // Resolve candidates against symbols the desk can actually price or read.
    const known = this.knownSymbols();
    const resolved = plan.tickers.filter((t) => known.has(t));
    const rejected = plan.tickers.filter((t) => !known.has(t));
    plan.tickersResolved = resolved;
    plan.tickersRejected = rejected;
    let dataTickers = resolved;
    emit('plan', {
      plan: { ...plan, session: plan.session },
      message: describePlan(plan),
      resolvedTickers: resolved,
      rejectedTickers: rejected,
    });

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
    for (const intent of plan.intents.slice(0, 10)) {
      const targets = NO_TICKER.has(intent)
        ? [null]
        : (PER_NAME.has(intent) ? nameTickers : (dataTickers.length ? dataTickers.slice(0, 4) : []));
      for (const t of targets) {
        if (!t && !NO_TICKER.has(intent)) continue;
        try {
          const snap = await this.hub.market.fetch(intent, t ? { ticker: t } : {});
          if (snap.value !== null && snap.value !== undefined) snapshots.push(snap);
        } catch (err) {
          log.debug(`${intent}(${t}) failed: ${err.message}`);
        }
      }
    }
    if (plan.channels.includes('cross-asset')) {
      for (const skill of ['sentiment-analyst', 'macro-analyst']) {
        try {
          const r = await this.hub.signal.invoke(skill, { query: question });
          if (r.value !== null) snapshots.push({ intent: `signal:${skill}`, skill, args: { query: question }, value: r.value, origin: r.origin });
        } catch (err) {
          log.debug(`signal ${skill} failed: ${err.message}`);
        }
      }
    }
    emit('ingest:data', {
      snapshots: snapshots.length,
      origins: [...new Set(snapshots.map((s) => s.origin))],
      intents: [...new Set(snapshots.map((s) => s.intent))],
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
  if (plan.tickers.length) bits.push(`tickers ${plan.tickers.join(', ')}`);
  bits.push(`channels ${plan.channels.map((c) => CHANNELS[c].zh || c).join(' / ')}`);
  if (plan.indicators.length) bits.push(`macro indicators ${plan.indicators.join(', ')}`);
  bits.push(`data intents ${plan.intents.join(', ')}`);
  bits.push(`US cash session ${plan.session.state}`);
  return `Plan: ${bits.join(' | ')}`;
}

export { scoreCard, rankCards, explainScore, cardSummary };
export default Pipeline;