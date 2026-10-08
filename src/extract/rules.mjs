/**
 * Deterministic rule extractor.
 *
 * This is the offline half of Prism's extraction layer. It exists for three
 * reasons:
 *   1. The demo, the tests and CI must run with no API key and no network.
 *   2. Reproducibility - the same document always yields the same card, so a
 *      reviewer can audit the reasoning end to end.
 *   3. It is the baseline the LLM extractor is scored against. If the model
 *      cannot beat the rules on the eval set, we keep the rules.
 *
 * Every card produced here is grounded in a located quote or a numeric field
 * that came with the document, so the verify ledger can clear it.
 */

import { emptyCard, evidence } from '../schema.mjs';
import { round, pctChange, fmtPct } from '../util/num.mjs';
import { sessionState, toDateStr, addDays } from '../util/time.mjs';
import {
  toneScore, classifyGuidance, classifyPolicy, riskLanguageHits,
  TRANSMISSION, MACRO_KINDS, RISK_RATIO_CHECKS, SENTIMENT,
} from './lexicon.mjs';
import { rankBy, factorForTag } from '../research/factors.mjs';

/** Per-indicator scale used to turn a raw surprise into a comparable sigma. */
const SURPRISE_SCALE = {
  cpi: { unit: '%', sigma: 0.15, large: 0.3 },
  'core-cpi': { unit: '%', sigma: 0.15, large: 0.25 },
  pce: { unit: '%', sigma: 0.12, large: 0.25 },
  nfp: { unit: 'k', sigma: 60, large: 120 },
  claims: { unit: 'k', sigma: 20, large: 45 },
  fomc: { unit: 'bps', sigma: 12, large: 25 },
  pmi: { unit: 'pts', sigma: 1.0, large: 2.0 },
  retail: { unit: '%', sigma: 0.3, large: 0.6 },
};

/** How wide an earnings surprise has to be before it is tradeable. */
const EARNINGS_BANDS = [
  { min: 15, label: 'very large', conviction: 78 },
  { min: 8, label: 'large', conviction: 68 },
  { min: 4, label: 'meaningful', conviction: 58 },
  { min: 2, label: 'modest', conviction: 48 },
  { min: 0, label: 'in line', conviction: 30 },
];

function bandFor(deltaPct) {
  const a = Math.abs(deltaPct ?? 0);
  return EARNINGS_BANDS.find((b) => a >= b.min) || EARNINGS_BANDS[EARNINGS_BANDS.length - 1];
}

/** Locate a sentence in the body that contains any of `terms`. */
export function findSentence(body, terms, { maxLen = 300 } = {}) {
  const text = String(body || '');
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'$])/);
  let offset = 0;
  for (const s of sentences) {
    const idx = text.indexOf(s, offset);
    if (idx !== -1) offset = idx;
    const low = s.toLowerCase();
    const hit = terms.find((t) => t && low.includes(String(t).toLowerCase()));
    if (hit && s.trim().length > 12) {
      const quote = s.trim().slice(0, maxLen);
      return { quote, locator: `chars ${offset}-${offset + quote.length} (matched "${hit}")`, term: hit };
    }
  }
  return null;
}

/** Pull the first number near a keyword, used when meta is absent. */
export function scrapeNumber(body, keyword) {
  const re = new RegExp(`${keyword}[^0-9\\-+]{0,40}([-+]?\\d[\\d,]*(?:\\.\\d+)?)`, 'i');
  const m = String(body || '').match(re);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export class RuleExtractor {
  /**
   * @param {object} opts
   * @param {import('../ingest/index.mjs').DataHub} opts.hub
   * @param {string[]} [opts.universe] tickers used for cross-sectional ranking
   */
  constructor({ hub, universe = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX', 'JPM', 'XOM', 'PLTR', 'COIN', 'WMT', 'PFE', 'CAT'] } = {}) {
    this.hub = hub;
    this.universe = universe;
  }

  /** Dispatch a document to the right channel handlers. Returns draft cards. */
  extractFromDocument(doc, { asOf = doc.publishedAt, question = '' } = {}) {
    const cards = [];
    const kind = doc.kind;
    if (kind === 'earnings-release' || kind === 'earnings-call' || kind === 'guidance') {
      cards.push(...this.fromEarnings(doc, asOf));
    }
    if (kind === 'macro-print' || kind === 'fomc-statement') {
      cards.push(...this.fromMacro(doc, asOf));
    }
    if (kind === 'news' || kind === 'analyst-note' || kind === 'social') {
      cards.push(...this.fromNews(doc, asOf));
    }
    if (kind === 'filing' || kind === 'earnings-call' || kind === 'earnings-release') {
      cards.push(...this.fromRisk(doc, asOf));
    }
    return cards.filter(Boolean);
  }

  extractFromDocuments(docs, opts = {}) {
    const out = [];
    for (const d of docs) out.push(...this.extractFromDocument(d, opts));
    out.push(...this.fromSessionContext(opts.asOf));
    return out;
  }

  // ---------------------------------------------------------------- earnings

  fromEarnings(doc, asOf) {
    const meta = doc.meta || {};
    const ticker = (doc.tickers || [])[0];
    if (!ticker) return [];

    const metric = meta.metric || 'EPS';
    const actual = meta.actual ?? scrapeNumber(doc.body, metric);
    const consensus = meta.consensus ?? null;
    const deltaPct = actual !== null && consensus ? pctChange(consensus, actual) : null;

    const guidance = classifyGuidance(doc.body);
    const tone = toneScore(doc.body);
    const beat = deltaPct !== null && deltaPct > 0;
    const miss = deltaPct !== null && deltaPct < 0;

    const ev = [];
    if (actual !== null) {
      ev.push(evidence({
        id: 'E1', type: 'metric', source: doc.id, locator: 'meta.actual',
        quote: `${metric} reported: ${actual}${meta.unit === '%' ? '%' : ''}`,
        value: actual, unit: meta.unit || null, headline: true,
      }));
    }
    if (consensus !== null) {
      ev.push(evidence({
        id: 'E2', type: 'estimate', source: meta.consensusSource || doc.id, locator: 'meta.consensus',
        quote: `${metric} consensus: ${consensus}`, value: consensus, unit: meta.unit || null, headline: true,
      }));
    }
    const quoteHit = findSentence(doc.body, [metric.toLowerCase(), 'guidance', 'outlook', 'revenue', 'eps', 'expect']);
    if (quoteHit) {
      ev.push(evidence({ id: `E${ev.length + 1}`, type: 'quote', source: doc.id, locator: quoteHit.locator, quote: quoteHit.quote }));
    }
    if (guidance.stance !== 'unclear' && guidance.matched?.length) {
      const g = findSentence(doc.body, guidance.matched) || { quote: guidance.matched.join(', '), locator: 'guidance lexicon match' };
      ev.push(evidence({ id: `E${ev.length + 1}`, type: 'quote', source: doc.id, locator: g.locator, quote: g.quote, note: `guidance stance: ${guidance.stance}` }));
    }
    if (!ev.length) return [];

    const band = bandFor(deltaPct);
    let direction = 'neutral';
    if (beat && (guidance.stance === 'raise' || tone.tone > 0.15)) direction = 'long';
    else if (miss && (guidance.stance === 'lower' || guidance.stance === 'withdraw' || tone.tone < -0.15)) direction = 'short';
    else if (beat && guidance.stance === 'lower') direction = 'hedge';
    else if (deltaPct !== null && Math.abs(deltaPct) < 2) direction = 'avoid';

    const guidanceAdj = { raise: 8, lower: -10, withdraw: -14, reiterate: 0, unclear: 0 }[guidance.stance] || 0;
    const conviction = Math.max(5, Math.min(92, band.conviction + guidanceAdj + Math.round(tone.tone * 8)));

    // Demo documents about fictional issuers carry an explicit `priceProxy` so
    // trade levels can still be computed. The proxy is always disclosed on the
    // card - Prism never implies a price it did not observe.
    const pxSymbol = meta.priceProxy || ticker;
    const last = this.hub?.prices?.closeOn(pxSymbol, toDateStr(asOf)) ?? null;
    const claimParts = [`${ticker} ${metric} ${actual ?? 'n/a'} vs ${consensus ?? 'n/a'} consensus`];
    if (deltaPct !== null) claimParts.push(`(${fmtPct(deltaPct, 1)} surprise, ${band.label})`);
    if (guidance.stance !== 'unclear') claimParts.push(`guidance ${guidance.stance}`);

    return [emptyCard({
      channel: 'earnings-gap',
      title: `${ticker}: ${metric} ${beat ? 'beat' : miss ? 'miss' : 'in line'}${guidance.stance !== 'unclear' ? `, guide ${guidance.stance}` : ''}`,
      claim: `${claimParts.join(' ')} - the expectation gap, not the headline, is what reprices the name.`,
      direction,
      horizon: deltaPct !== null && Math.abs(deltaPct) >= 8 ? 'days' : 'intraday',
      instruments: ['native-equity', 'rtoken'],
      tickers: [ticker],
      conviction,
      expectationGap: {
        metric, consensus, actual, unit: meta.unit || null,
        deltaPct: deltaPct === null ? null : round(deltaPct, 2),
        source: meta.consensusSource || doc.id,
        confidence: consensus !== null && actual !== null ? 0.9 : 0.4,
        band: band.label,
        guidanceStance: guidance.stance,
        tone: round(tone.tone, 3),
      },
      evidence: ev,
      invalidation: {
        condition: beat
          ? `Post-print follow-through fails: ${ticker} gives back the gap and closes below the prior close, or management walks back the guide on the next appearance.`
          : `${ticker} reclaims the pre-print close within two sessions and holds, showing the miss was already discounted.`,
        level: last ? round(last, 2) : 'prior close',
        recheckAt: addDays(asOf, 2),
      },
      tradeSketch: last ? {
        entryZone: [round(last * (beat ? 1.0 : 0.995), 2), round(last * (beat ? 1.015 : 1.005), 2)],
        stop: round(last * (beat ? 0.965 : 1.035), 2),
        target: round(last * (beat ? 1.07 : 0.93), 2),
        riskPctOfPortfolio: round(Math.max(0.25, conviction / 200), 2),
        venue: 'native-equity',
        rtokenNote: `${ticker} rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).`,
        sizing: 'Scale in thirds; full size only if the gap holds into the second session.',
        pricingProxy: meta.priceProxy ? `${pxSymbol} (declared demo proxy - ${ticker} is a fictional issuer with no listed price)` : null,
      } : null,
      risks: [
        beat ? 'A beat already discounted shows up as a sell-the-news reaction regardless of the number.' : 'A miss into an oversold tape often rallies - direction is not the same as timing.',
        `Guidance lexicon classified the stance as "${guidance.stance}" from ${Object.values(guidance.scores).reduce((a, b) => a + b, 0)} term hits; a single ambiguous sentence can flip this.`,
        'Consensus provenance is the document meta; a stale consensus makes the gap illusory.',
      ],
      catalysts: meta.nextEvent ? [{ date: meta.nextEvent, event: meta.nextEventLabel || 'Next scheduled catalyst' }] : [],
      provenance: { extractor: 'rules', llmModel: null, documents: [doc.id], tools: ['corpus', 'prices'] },
    })];
  }
  // ------------------------------------------------------------------- macro

  fromMacro(doc, asOf) {
    const meta = doc.meta || {};
    const raw = String(meta.indicator || doc.kind || '').toLowerCase();
    const indicator = MACRO_KINDS.find((k) => raw.includes(k)) || (raw.includes('fomc') || doc.kind === 'fomc-statement' ? 'fomc' : null);
    if (!indicator) return [];

    const scale = SURPRISE_SCALE[indicator] || { unit: meta.unit || '', sigma: 1, large: 2 };
    const actual = meta.actual ?? null;
    const consensus = meta.consensus ?? null;
    const surprise = actual !== null && consensus !== null ? actual - consensus : (meta.surprise ?? null);
    const sigma = surprise !== null ? surprise / scale.sigma : null;

    const policy = doc.kind === 'fomc-statement' ? classifyPolicy(doc.body) : null;
    let side = null;
    if (policy && policy.stance !== 'neutral') side = policy.stance === 'hawkish' ? 'hot' : 'cool';
    if (!side && surprise !== null) side = surprise > 0 ? 'hot' : 'cool';
    if (!side) return [];

    const map = TRANSMISSION[indicator]?.[side];
    if (!map) return [];

    const ev = [];
    if (actual !== null) {
      ev.push(evidence({
        id: 'E1', type: 'metric', source: doc.id, locator: 'meta.actual',
        quote: `${(meta.label || indicator).toUpperCase()} actual ${actual}${scale.unit === '%' ? '%' : ''} vs consensus ${consensus ?? 'n/a'}`,
        value: actual, unit: scale.unit, headline: true,
      }));
    }
    const q = findSentence(doc.body, ['inflation', 'policy', 'rate', 'employment', 'activity', 'committee', 'percent'])
      || { quote: String(doc.body).slice(0, 240), locator: 'opening paragraph' };
    // When there is no numeric print to cite - an FOMC statement, for example -
    // the policy quote IS the headline evidence. Otherwise the number is, and the
    // quote is supporting colour. A card with no headline evidence can never be
    // adjudicated by the ledger, so one is always flagged.
    ev.push(evidence({
      id: `E${ev.length + 1}`, type: 'quote', source: doc.id, locator: q.locator, quote: q.quote,
      headline: actual === null,
      note: policy ? `policy stance: ${policy.stance} (hawkish ${policy.hawkish} / dovish ${policy.dovish} term hits)` : '',
    }));

    // Cross-sectional ranking from MEASURED exposures, not asserted ones.
    const chain = [];
    const ranked = {};
    for (const leg of [...map.hits, ...map.beneficiaries]) {
      const factor = factorForTag(leg.betaTag);
      const order = rankBy(this.hub.prices, this.universe, factor, { descending: leg.direction < 0 });
      ranked[leg.betaTag] = order.slice(0, 6);
      chain.push({
        from: `${(meta.label || indicator)} ${side === 'hot' ? 'surprise to the upside' : 'surprise to the downside'}`,
        to: leg.betaTag,
        mechanism: leg.mechanism,
        confidence: sigma === null ? 0.5 : Math.max(0.35, Math.min(0.9, 0.45 + Math.abs(sigma) * 0.12)),
        measuredBy: `${factor} (OLS beta, trailing 252 sessions)`,
        topExposed: order.slice(0, 5).map((r) => `${r.symbol} ${r.value}`),
        expectedSign: leg.direction,
      });
    }

    const mostHurt = ranked[map.hits[0]?.betaTag] || [];
    const mostHelped = ranked[map.beneficiaries[0]?.betaTag] || [];
    const tickers = [...new Set([...mostHurt.slice(0, 3).map((r) => r.symbol), ...mostHelped.slice(0, 3).map((r) => r.symbol)])];
    const conviction = Math.max(20, Math.min(88, 45 + (sigma === null ? 0 : Math.abs(sigma) * 11)));
    const dateStr = toDateStr(asOf);

    return [emptyCard({
      channel: 'macro-transmission',
      title: `${(meta.label || indicator).toUpperCase()} ${side === 'hot' ? 'hot' : 'cool'}: ${map.narrative.split(',')[0]}`,
      claim: `${(meta.label || indicator)} printed ${actual ?? 'n/a'} vs ${consensus ?? 'n/a'} consensus (${sigma === null ? 'surprise n/a' : `${round(sigma, 2)} sigma`}). ${map.narrative} Measured exposure ranking puts ${mostHurt.slice(0, 3).map((r) => r.symbol).join(', ') || 'n/a'} most exposed and ${mostHelped.slice(0, 3).map((r) => r.symbol).join(', ') || 'n/a'} best positioned.`,
      direction: mostHurt.length && mostHelped.length ? 'pair' : 'hedge',
      horizon: 'days',
      instruments: ['native-equity', 'etf', 'rtoken'],
      tickers: tickers.length ? tickers : ['SPY', 'QQQ'],
      conviction: round(conviction, 0),
      expectationGap: {
        metric: meta.label || indicator, consensus, actual, unit: scale.unit,
        deltaPct: consensus ? round(pctChange(consensus, actual), 2) : null,
        sigma: sigma === null ? null : round(sigma, 2),
        side, source: doc.id,
        confidence: sigma === null ? 0.4 : Math.min(0.95, 0.5 + Math.abs(sigma) * 0.1),
      },
      transmissionChain: chain,
      evidence: ev,
      invalidation: {
        condition: `The transmission does not show up cross-sectionally: within two sessions the long leg does not beat the short leg by 50bp, meaning the print was already priced or the channel is inactive in this regime.`,
        level: 'pair spread < 50bp after 2 sessions',
        test: mostHurt[0] && mostHelped[0] ? {
          kind: 'pair-spread',
          long: mostHelped[0].symbol,
          short: mostHurt[0].symbol,
          minSpreadBp: 50,
          sessions: 2,
        } : null,
        recheckAt: addDays(asOf, 2),
      },
      tradeSketch: mostHurt[0] && mostHelped[0] ? {
        pair: { long: mostHelped[0].symbol, short: mostHurt[0].symbol },
        entryZone: null, stop: null, target: null,
        riskPctOfPortfolio: 0.5,
        venue: 'native-equity',
        rtokenNote: 'If the print lands while the cash market is shut, the rToken leg prices it first - see the closed-window card generated for the same event.',
        sizing: 'Dollar-neutral pair; size to the spread, not to either leg.',
      } : null,
      risks: [
        'Single macro prints have a poor signal-to-noise ratio; one observation is not a regime.',
        `Exposures are trailing-252 OLS betas and rotate. A name that was duration-sensitive last quarter may not be now (asOf ${dateStr}).`,
        'Positioning matters: if everyone is already positioned for this transmission, the trade is crowded and the realised move inverts.',
      ],
      catalysts: meta.nextRelease ? [{ date: meta.nextRelease, event: `${(meta.label || indicator)} next release` }] : [],
      provenance: { extractor: 'rules', llmModel: null, documents: [doc.id], tools: ['corpus', 'prices', 'factors'] },
    })];
  }

  // -------------------------------------------------------------------- news

  fromNews(doc, asOf) {
    const tone = toneScore(doc.body);
    if (tone.hits < 2) return [];
    const tickers = doc.tickers || [];
    if (!tickers.length) return [];
    const strength = Math.abs(tone.tone);
    if (strength < 0.25) return [];

    const terms = tone.tone > 0 ? SENTIMENT.positive : SENTIMENT.negative;
    const q = findSentence(doc.body, terms) || { quote: String(doc.body).slice(0, 240), locator: 'opening paragraph' };

    const related = this.hub?.corpus
      ? this.hub.corpus.search(`${tickers[0]} ${q.term || ''}`, { limit: 6, ticker: tickers[0] }).filter((d) => d.id !== doc.id)
      : [];
    const agreeing = related.filter((d) => Math.sign(toneScore(d.body).tone) === Math.sign(tone.tone));
    const conviction = Math.max(15, Math.min(80, Math.round(28 + strength * 40 + Math.min(agreeing.length, 3) * 6)));

    return [emptyCard({
      channel: 'narrative-shift',
      title: `${tickers[0]}: narrative turning ${tone.tone > 0 ? 'constructive' : 'negative'}`,
      claim: `${doc.source} coverage of ${tickers.join(', ')} scores ${round(tone.tone, 2)} on the desk tone scale from ${tone.hits} weighted term hits (${tone.positives} positive / ${tone.negatives} negative), with ${agreeing.length} of ${related.length} adjacent documents agreeing.`,
      direction: tone.tone > 0 ? 'long' : 'short',
      horizon: 'weeks',
      instruments: ['native-equity', 'rtoken'],
      tickers,
      conviction,
      expectationGap: null,
      evidence: [
        evidence({ id: 'E1', type: 'news', source: doc.id, locator: q.locator, quote: q.quote, headline: true }),
        ...agreeing.slice(0, 3).map((d, i) => evidence({
          id: `E${i + 2}`, type: 'news', source: d.id, locator: 'corroborating document',
          quote: String(d.title).slice(0, 200), note: `tone ${round(toneScore(d.body).tone, 2)}`,
        })),
      ],
      invalidation: {
        condition: `Two or more subsequent documents on ${tickers[0]} score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions.`,
        level: 'tone sign flip on >= 2 documents',
        recheckAt: addDays(asOf, 5),
      },
      risks: [
        'Narrative is the slowest channel and the easiest to over-fit to a single article.',
        'Lexicon tone is not sentiment: sarcasm, negation and quoted speech all read as plain terms.',
        'If the narrative is already consensus, the shift is priced and the card has no edge.',
      ],
      provenance: { extractor: 'rules', llmModel: null, documents: [doc.id, ...agreeing.slice(0, 3).map((d) => d.id)], tools: ['corpus'] },
    })];
  }
  // ------------------------------------------------------------------- risk

  fromRisk(doc, asOf) {
    const hits = riskLanguageHits(doc.body);
    const ratioFlags = (doc.meta?.ratioChecks || []).filter((f) => RISK_RATIO_CHECKS.some((c) => c.id === f));
    if (!hits.length && !ratioFlags.length) return [];
    const tickers = doc.tickers || [];
    if (!tickers.length) return [];

    const ev = [];
    if (hits.length) {
      const q = findSentence(doc.body, hits) || { quote: hits.join(', '), locator: 'risk lexicon match' };
      ev.push(evidence({ id: 'E1', type: 'filing', source: doc.id, locator: q.locator, quote: q.quote, headline: true, note: `risk terms: ${hits.join(', ')}` }));
    }
    for (const f of ratioFlags) {
      const check = RISK_RATIO_CHECKS.find((c) => c.id === f);
      ev.push(evidence({ id: `E${ev.length + 1}`, type: 'fundamental', source: doc.id, locator: 'meta.ratioChecks', quote: check.label, headline: !hits.length }));
    }

    const conviction = Math.max(20, Math.min(75, 25 + hits.length * 9 + ratioFlags.length * 10));

    return [emptyCard({
      channel: 'risk-flag',
      title: `${tickers[0]}: ${hits.length + ratioFlags.length} contrarian risk flag(s)`,
      claim: `${tickers[0]} carries ${hits.length} adverse-language flag(s) (${hits.slice(0, 4).join(', ') || 'none'}) and ${ratioFlags.length} accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.`,
      direction: 'avoid',
      horizon: 'weeks',
      instruments: ['native-equity'],
      tickers,
      conviction,
      evidence: ev,
      invalidation: {
        condition: 'The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters.',
        level: 'flags -> 0 for 2 quarters',
        recheckAt: addDays(asOf, 90),
      },
      risks: [
        'Risk language is often boilerplate; a single 10-K can carry 20 of these terms with nothing behind them.',
        'Ratio flags need at least two periods of context - one quarter of divergence is noise.',
      ],
      provenance: { extractor: 'rules', llmModel: null, documents: [doc.id], tools: ['corpus'] },
    })];
  }

  // ---------------------------------------------------------- closed window

  /**
   * The channel this whole hackathon edition is about: tokenized equities trade
   * 7x24, the native share does not. When information lands outside RTH the
   * rToken is the only price discovery venue, and the cash open has to catch up.
   */
  fromSessionContext(asOf = new Date()) {
    const session = sessionState(asOf);
    if (session.state === 'open') return [];
    const cards = [];
    const pending = this.hub?.corpus?.between(addDays(asOf, -2), toDateStr(asOf)) || [];
    const offSessionDocs = pending.filter((d) => d.meta?.releasedOutsideRth || ['macro-print', 'fomc-statement', 'earnings-release'].includes(d.kind));

    for (const doc of offSessionDocs.slice(0, 3)) {
      const tickers = doc.tickers?.length ? doc.tickers : ['SPY'];
      const t = tickers[0];
      const gapHist = this.measureGapBehaviour(t, asOf);
      const gapPrior = gapHist.n
        ? `Across ${gapHist.n} comparable historical gaps in ${t}, the gap direction continued ${gapHist.continuedPct}% of the time and reverted ${gapHist.revertedPct}% of the time; the median |gap| was ${gapHist.medianAbsPct}%.`
        : `No comparable historical gap in ${t} is recorded in the bundled price book, so there is no empirical prior for this name; read the closed-window argument as structural rather than statistical.`;
      cards.push(emptyCard({
        channel: 'closed-window',
        title: `${session.state} window: ${t} has no cash price discovery`,
        claim: `The US cash session is ${session.state} (${session.reason || session.weekday}) but the ${t} rToken still trades. Information from "${doc.title}" can only be priced on the rToken until the next open. ${gapPrior}`,
        direction: 'neutral',
        horizon: 'intraday',
        instruments: ['rtoken'],
        tickers: [t],
        conviction: 55,
        evidence: [
          evidence({ id: 'E1', type: 'calendar', source: 'session-clock', locator: 'computed', quote: `US cash session state at ${new Date(asOf).toISOString()}: ${session.state}`, headline: true, value: session.state }),
          evidence({ id: 'E2', type: 'news', source: doc.id, locator: 'document', quote: String(doc.title).slice(0, 240) }),
          evidence({
            id: 'E3', type: 'computed', source: 'price-book', locator: `gap study on ${t}`,
            quote: gapHist.n
              ? `${gapHist.n} historical overnight gaps: continued ${gapHist.continuedPct}%, reverted ${gapHist.revertedPct}%, median |gap| ${gapHist.medianAbsPct}%`
              : `0 comparable historical overnight gaps for ${t} in the bundled price book; no empirical prior available for this name.`,
            value: gapHist.continuedPct, unit: '%',
            recipe: 'gap-study', symbol: t,
          }),
        ],
        invalidation: {
          condition: 'The rToken premium/dislocation to the last cash close collapses before the open, meaning the information was already fully priced by the token market.',
          level: 'rToken vs last cash close within 0.3%',
          recheckAt: 'at the next cash open',
        },
        tradeSketch: {
          entryZone: null, stop: null, target: null,
          riskPctOfPortfolio: 0.25,
          venue: 'rtoken',
          rtokenNote: 'Only the rToken trades. Size for the fact that you cannot exit into a cash market and that rToken liquidity is materially thinner than the native share.',
          sizing: 'Half the size you would take in the native share; the exit is the constraint, not the entry.',
        },
        risks: [
          'rToken liquidity is thin; the observable price may be a stale print rather than a real clearing level.',
          'Mint/redeem arbitrage can compress the dislocation faster than the information warrants.',
          gapHist.n
            ? `Historical gap behaviour on the NATIVE share is not the same process as rToken pricing; ${gapHist.n} observations is a prior, not a law.`
            : `No gap prior exists for ${t} in the bundled data, so the likely dislocation size is unanchored; halve the size again or stand aside.`,
        ],
        provenance: { extractor: 'rules', llmModel: null, documents: [doc.id], tools: ['session-clock', 'price-book'] },
      }));
    }
    return cards;
  }

  /** Empirical overnight-gap behaviour for a symbol, from real bundled data. */
  measureGapBehaviour(symbol, asOf, { minAbsGap = 1.0, lookbackBars = 500 } = {}) {
    const book = this.hub?.prices;
    if (!book?.has(symbol)) return { n: 0, continuedPct: null, revertedPct: null, medianAbsPct: null };
    const bars = book.bars(symbol);
    const endIdx = asOf ? book.indexOfDate(symbol, toDateStr(asOf)) + 1 : bars.length;
    const slice = bars.slice(Math.max(1, endIdx - lookbackBars), endIdx);
    const outcomes = [];
    for (let i = 1; i < slice.length; i += 1) {
      const prevClose = slice[i - 1].close;
      const open = slice[i].open;
      if (!prevClose || !open) continue;
      const gapPct = ((open - prevClose) / prevClose) * 100;
      if (Math.abs(gapPct) < minAbsGap) continue;
      const intraday = ((slice[i].close - open) / open) * 100;
      outcomes.push({ gapPct, continuation: intraday * Math.sign(gapPct), absGap: Math.abs(gapPct) });
    }
    if (!outcomes.length) return { n: 0, continuedPct: null, revertedPct: null, medianAbsPct: null };
    const continued = outcomes.filter((o) => o.continuation > 0.1).length;
    const reverted = outcomes.filter((o) => o.continuation < -0.1).length;
    const sorted = outcomes.map((o) => o.absGap).sort((a, b) => a - b);
    return {
      n: outcomes.length,
      continuedPct: round((continued / outcomes.length) * 100, 1),
      revertedPct: round((reverted / outcomes.length) * 100, 1),
      medianAbsPct: round(sorted[Math.floor(sorted.length / 2)], 2),
      meanContinuationPct: round(outcomes.reduce((a, o) => a + o.continuation, 0) / outcomes.length, 2),
    };
  }
  // ------------------------------------------------------------- data-driven

  /** Cards built purely from provider data (no document) - flow and cross-asset. */
  async fromDataSnapshots(snapshots = [], asOf = new Date()) {
    const cards = [];
    for (const snap of snapshots) {
      if (!snap) continue;
      if (snap.intent === 'insiderTrades') cards.push(...this.fromInsider(snap, asOf));
      if (snap.intent === 'institutionalHoldings') cards.push(...this.fromInstitutional(snap, asOf));
      if (snap.skill === 'market-intel' || snap.intent === 'signal:market-intel') {
        cards.push(...this.fromMarketIntel(snap, asOf));
      } else if (snap.skill === 'technical-analysis' || snap.intent === 'signal:technical-analysis') {
        cards.push(...this.fromTechnicalAnalysis(snap, asOf));
      } else if (snap.skill === 'news-briefing' || snap.intent === 'signal:news-briefing') {
        cards.push(...this.fromNewsBriefing(snap, asOf));
      } else if (snap.skill === 'macro-analyst' || snap.intent === 'signal:macro-analyst') {
        cards.push(...this.fromMacroAnalyst(snap, asOf));
      } else if (String(snap.intent || '').startsWith('signal:') || snap.skill) {
        cards.push(...this.fromCryptoSignal(snap, asOf));
      }
    }
    return cards;
  }

  fromInsider(snap, asOf) {
    const rows = Array.isArray(snap.value) ? snap.value : (snap.value?.rows || snap.value?.data || []);
    if (!Array.isArray(rows) || !rows.length) return [];
    const byTicker = {};
    for (const r of rows) {
      const side = String(r.transactionType || r.type || r.side || '').toLowerCase();
      const val = Number(r.value ?? r.transactionValue ?? 0) || 0;
      const t = String(r.ticker || r.symbol || snap.args?.ticker || '').toUpperCase();
      if (!t) continue;
      byTicker[t] = byTicker[t] || { buys: 0, sells: 0, sellValue: 0 };
      if (side.includes('buy') || side === 'p') byTicker[t].buys += 1;
      else if (side.includes('sell') || side === 's') { byTicker[t].sells += 1; byTicker[t].sellValue += val; }
    }
    const entries = Object.entries(byTicker);
    if (!entries.length) return [];
    const [ticker, agg] = entries.sort((a, b) => b[1].sells - a[1].sells)[0];
    if (agg.sells < 2) return [];
    return [emptyCard({
      channel: 'flow-footprint',
      title: `${ticker}: ${agg.sells} insider sale(s) vs ${agg.buys} purchase(s)`,
      claim: `Insider activity in ${ticker} shows ${agg.sells} dispositions against ${agg.buys} acquisitions in the reported window. Clustered selling is a weak but persistent negative; isolated selling is usually tax planning.`,
      direction: agg.sells >= 3 && agg.buys === 0 ? 'hedge' : 'neutral',
      horizon: 'weeks',
      instruments: ['native-equity'],
      tickers: [ticker],
      conviction: Math.min(65, 30 + agg.sells * 7),
      evidence: [evidence({
        id: 'E1', type: 'computed', source: snap.origin, locator: `insiderTrades(${ticker})`,
        quote: `${agg.sells} sells / ${agg.buys} buys, aggregate disposition value ${Math.round(agg.sellValue).toLocaleString('en-US')}`,
        value: agg.sells, headline: true,
        recipe: 'insider-sell-count', snapshotIntent: 'insiderTrades', symbol: ticker,
      })],
      invalidation: {
        condition: 'A cluster of open-market purchases by two or more officers, or disclosure that the sales were executed under a pre-existing 10b5-1 plan adopted before the information event.',
        level: '>= 2 open-market buys',
        recheckAt: addDays(asOf, 45),
      },
      risks: ['10b5-1 plans make scheduled selling look like informed selling.', 'Insider data lags the transaction by up to two business days (and 45 days for some filers).'],
      provenance: { extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin] },
    })];
  }

  fromInstitutional(snap, asOf) {
    const rows = Array.isArray(snap.value) ? snap.value : (snap.value?.holders || snap.value?.rows || []);
    if (!Array.isArray(rows) || !rows.length) return [];
    // Prefer the ticker carried by the DATA over the one we asked for: under the
    // fixture fallback the requested symbol and the returned rows can differ, and
    // labelling a card with the wrong issuer is worse than having no card.
    const ticker = String(rows[0].ticker || snap.args?.ticker || '').toUpperCase();
    if (!ticker) return [];
    const num = (r) => Number(r.changePct ?? r.pctChange ?? r.change ?? 0) || 0;
    const increased = rows.filter((r) => num(r) > 5).length;
    const decreased = rows.filter((r) => num(r) < -5).length;
    if (!increased && !decreased) return [];
    return [emptyCard({
      channel: 'flow-footprint',
      title: `${ticker}: 13F shows ${increased} builder(s) vs ${decreased} trimmer(s)`,
      claim: `Of ${rows.length} reporting 13F holders of ${ticker}, ${increased} increased by more than 5% and ${decreased} trimmed by more than 5%. 13F is a 45-day-lagged snapshot, so this confirms a thesis rather than starting one.`,
      direction: increased > decreased * 1.5 ? 'long' : decreased > increased * 1.5 ? 'hedge' : 'neutral',
      horizon: 'weeks',
      instruments: ['native-equity'],
      tickers: [ticker],
      conviction: Math.min(60, 25 + Math.abs(increased - decreased) * 5),
      evidence: [evidence({
        id: 'E1', type: 'computed', source: snap.origin, locator: `institutionalHoldings(${ticker})`,
        quote: `${increased} increased / ${decreased} decreased out of ${rows.length} filers`,
        value: increased - decreased, headline: true,
        recipe: 'institutional-delta-count', snapshotIntent: 'institutionalHoldings', symbol: ticker,
      })],
      invalidation: { condition: 'The next 13F cycle reverses the direction of the majority of the top-10 holders.', level: 'sign flip', recheckAt: addDays(asOf, 45) },
      risks: ['13F omits shorts, non-US holdings and everything filed confidentially.', 'The data is up to 45 days stale on the day it lands.'],
      provenance: { extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin] },
    })];
  }

  fromCryptoSignal(snap, asOf) {
    const v = snap.value;
    if (!v || typeof v !== 'object') return [];
    const fgRaw = v.fearGreed ?? v.fear_greed ?? null;
    const fgVal = fgRaw && typeof fgRaw === 'object' ? (fgRaw.value ?? null) : fgRaw;
    const funding = v.fundingRate ?? v.funding ?? null;
    const etf = v.etfFlowUsd ?? v.etfFlow ?? null;
    const bits = [];
    if (fgVal !== null) bits.push(`Fear & Greed ${fgVal}${fgRaw?.classification ? ` (${fgRaw.classification})` : ''}`);
    if (funding !== null) bits.push(`BTC funding ${funding}`);
    if (etf !== null) bits.push(`US spot BTC ETF flow ${etf}`);
    if (!bits.length) return [];
    const extreme = fgVal !== null && (fgVal <= 20 || fgVal >= 80);
    return [emptyCard({
      channel: 'cross-asset',
      title: `Crypto regime: ${bits.join(' | ')}`,
      claim: `Crypto-side positioning reads ${bits.join(', ')}. Because tokenized US equities settle on crypto rails, an ${extreme ? 'extreme' : 'unremarkable'} crypto regime changes who is awake to trade the rToken when US macro lands outside cash hours.`,
      direction: extreme ? 'hedge' : 'neutral',
      horizon: 'intraday',
      instruments: ['rtoken', 'crypto'],
      tickers: ['BTC', 'ETH'],
      conviction: extreme ? 52 : 28,
      evidence: [evidence({
        id: 'E1', type: 'sentiment', source: snap.origin, locator: snap.skill || 'signal',
        quote: bits.join('; '), value: fgVal, headline: true,
      })],
      invalidation: { condition: 'Fear & Greed returns inside the 35-65 band and funding normalises, i.e. the crypto complex stops driving marginal rToken liquidity.', level: 'F&G in [35,65]', recheckAt: addDays(asOf, 1) },
      risks: ['Crypto sentiment is a liquidity proxy, not an equity fundamental.', 'The correlation between crypto regime and rToken mispricing is stable in stress and absent in calm.'],
      provenance: { extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin] },
    })];
  }

  /**
   * macro-analyst -> the bridge a US print uses to reach an rToken.
   *
   * The skill used to be fetched and then dropped: fromCryptoSignal only reads
   * Fear & Greed / funding / ETF flow, and this payload has none of those, so a
   * CPI question produced zero cards from the one skill that is about the print.
   * The card is context, direction neutral, and it does not invent a consensus
   * the skill did not return. Channel follows whichever channel actually asked.
   */
  fromMacroAnalyst(snap, asOf) {
    const v = snap.value;
    if (!v || typeof v !== 'object') return [];
    const cut = Number(v.nextMeetingCutProbabilityPct);
    const curve = Number(v.curve2s10sBp);
    const corrNq = Number(v.btcVsNasdaqCorr90d);
    const corrDxy = Number(v.btcVsDxyCorr90d);
    const policy = Number(v.policyRateUpperPct);
    if (!Number.isFinite(cut) && !Number.isFinite(corrNq)) return [];
    const wanted = Array.isArray(snap.channels) ? snap.channels : [];
    const channel = wanted.includes('macro-transmission')
      ? 'macro-transmission'
      : wanted.includes('cross-asset') ? 'cross-asset' : 'closed-window';
    const bits = [];
    if (Number.isFinite(policy)) bits.push(`policy upper bound ${policy}%`);
    if (Number.isFinite(cut)) bits.push(`next-meeting cut odds ${cut}%`);
    if (Number.isFinite(curve)) bits.push(`2s10s ${curve > 0 ? '+' : ''}${curve}bp`);
    if (Number.isFinite(corrNq)) bits.push(`BTC/Nasdaq 90d corr ${corrNq}`);
    if (Number.isFinite(corrDxy)) bits.push(`BTC/DXY 90d corr ${corrDxy}`);
    return [emptyCard({
      channel,
      title: `Macro bridge, not a trade: cut odds ${Number.isFinite(cut) ? `${cut}%` : 'n/a'}, BTC/Nasdaq ${Number.isFinite(corrNq) ? corrNq : 'n/a'}`,
      claim: `bitget-signal macro-analyst reads ${bits.join(', ')}. That correlation is the bridge a US macro print uses to reach an rToken while cash is shut. It is regime context for the transmission cards, not a directional call, and it does not invent a consensus the skill did not return.`,
      direction: 'neutral',
      horizon: 'days',
      instruments: ['etf', 'rtoken'],
      tickers: ['QQQ'],
      conviction: 36,
      evidence: [evidence({
        id: 'E1', type: 'sentiment', source: snap.origin, locator: 'macro-analyst',
        quote: bits.join('; '), value: Number.isFinite(cut) ? cut : corrNq, headline: true,
        snapshotIntent: 'signal:macro-analyst',
      })],
      invalidation: {
        condition: 'BTC/Nasdaq 90-day correlation falls through 0.20, or the priced probability of a cut drops by 25 points or more, before the next cash open - the bridge this card describes is no longer the one the rToken is trading.',
        level: 'BTC/Nasdaq 90d corr < 0.20 or cut odds -25pt',
        recheckAt: addDays(asOf, 2),
      },
      risks: [
        'A correlation is not a forecast. 0.44 leaves most of the rToken move unexplained.',
        'Cut odds are already in the cash index whenever the cash market is open.',
        'This card is context for the transmission chain. It is not a position.',
      ],
      provenance: {
        extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin || 'bitget-signal:macro-analyst'],
        informationAt: v.asOf || null,
      },
    })];
  }

  /** market-intel skill -> flow-footprint: the cross-market flow footprint. */
  fromMarketIntel(snap, asOf) {
    const v = snap.value;
    if (!v || typeof v !== 'object') return [];
    const fmtUsd = (n) => {
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
      return `${sign}$${abs.toFixed(0)}`;
    };
    const bits = [];
    if (v.spotBtcEtfFlowUsd !== undefined) bits.push(`spot BTC ETF ${fmtUsd(v.spotBtcEtfFlowUsd)}`);
    if (v.spotEthEtfFlowUsd !== undefined) bits.push(`spot ETH ETF ${fmtUsd(v.spotEthEtfFlowUsd)}`);
    if (v.stablecoinChange24hUsd !== undefined) bits.push(`stablecoin supply 24h ${fmtUsd(v.stablecoinChange24hUsd)}`);
    if (v.whaleNetFlowUsd !== undefined) bits.push(`whale net ${fmtUsd(v.whaleNetFlowUsd)}`);
    if (!bits.length) return [];
    // A one-day flow print is context (a footprint), not a directional claim.
    return [emptyCard({
      channel: 'flow-footprint',
      title: `Cross-market flow footprint: ${bits.slice(0, 2).join(' | ')}`,
      claim: `The cross-market flow footprint reads ${bits.join(', ')}. ETF and stablecoin flows show where marginal capital is moving; a single print confirms or questions a footprint but is too noisy to trade on its own.`,
      direction: 'neutral',
      horizon: 'days',
      instruments: ['crypto', 'rtoken'],
      tickers: ['BTC', 'ETH'],
      conviction: 30,
      evidence: [evidence({
        id: 'E1', type: 'sentiment', source: snap.origin, locator: 'market-intel',
        quote: bits.join('; '), value: v.spotBtcEtfFlowUsd ?? null, headline: true,
        snapshotIntent: 'signal:market-intel',
      })],
      invalidation: {
        condition: 'ETF flows reverse for two consecutive sessions and stablecoin supply contracts, i.e. the footprint flips from mixed/defensive to risk-off (or risk-on) rather than a one-day print.',
        level: '2-session flow reversal', recheckAt: addDays(asOf, 3),
      },
      risks: ['ETF flow and whale-flow series are noisy and partly time-zone shifted.', 'Stablecoin supply growth is not the same as equity buying.'],
      provenance: { extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin] },
    })];
  }

  /** technical-analysis skill -> risk-flag: a stretched-tape risk watch. */
  fromTechnicalAnalysis(snap, asOf) {
    const v = snap.value;
    if (!v || typeof v !== 'object') return [];
    const symbol = String(v.symbol || snap.args?.query || '').toUpperCase();
    const rsi = Number(v.rsi14);
    const stretch = Number(v.priceVs200DmaPct);
    if (!Number.isFinite(rsi) && !Number.isFinite(stretch)) return [];
    const extended = rsi >= 70 || stretch >= 25;
    const bits = [];
    if (Number.isFinite(rsi)) bits.push(`RSI(14) ${rsi}`);
    if (Number.isFinite(stretch)) bits.push(`${stretch > 0 ? '+' : ''}${stretch}% vs 200-DMA`);
    if (v.nearestSupport !== undefined) bits.push(`support ${v.nearestSupport}`);
    if (v.nearestResistance !== undefined) bits.push(`resistance ${v.nearestResistance}`);
    return [emptyCard({
      channel: 'risk-flag',
      title: `${symbol}: stretched tape (${bits.slice(0, 2).join(', ')})`,
      claim: `Technical read for ${symbol}: ${bits.join(', ')}. ${extended ? 'The tape is stretched versus both momentum and trend, which raises mean-reversion risk even while the fundamental story is intact - a risk to an entry, not a reason to short.' : 'The technical picture is elevated but not yet extreme.'}`,
      direction: 'neutral',
      horizon: 'days',
      instruments: ['native-equity'],
      tickers: [symbol],
      conviction: extended ? 46 : 26,
      evidence: [evidence({
        id: 'E1', type: 'technical', source: snap.origin, locator: `technical-analysis(${symbol})`,
        quote: bits.join('; '), value: Number.isFinite(rsi) ? rsi : stretch, headline: true,
        snapshotIntent: 'signal:technical-analysis', symbol,
      })],
      invalidation: {
        condition: 'RSI(14) works back below 70 and the price consolidates toward the 50-DMA without a lower high, i.e. the stretch unwinds through time rather than through a drawdown.',
        level: 'RSI < 70 and price re-tests 50-DMA', recheckAt: addDays(asOf, 10),
      },
      risks: ['Momentum can stay overbought far longer than mean reversion expects.', 'Daily technical indicators lag the intraday exit a risk plan would actually use.'],
      provenance: { extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin] },
    })];
  }

  /** news-briefing skill -> narrative-shift: the trending narrative temperature. */
  fromNewsBriefing(snap, asOf) {
    const v = snap.value;
    if (!v || typeof v !== 'object') return [];
    const trending = Array.isArray(v.trending) ? v.trending : [];
    if (!trending.length) return [];
    const top = trending.slice(0, 3).map((t) => t.topic);
    const avgSent = trending.reduce((a, t) => a + (Number(t.sentiment) || 0), 0) / trending.length;
    return [emptyCard({
      channel: 'narrative-shift',
      title: `Trending narrative: ${top[0]}`,
      claim: `The trending board reads ${top.join('; ')}. Narrative temperature is ${avgSent >= 0.1 ? 'tilted constructive' : avgSent <= -0.1 ? 'tilted cautious' : 'mixed'}; a shift in which topics dominate often leads the fundamentals, but the signal is a change of tone, not a directional forecast.`,
      direction: 'neutral',
      horizon: 'days',
      instruments: ['crypto', 'rtoken'],
      tickers: ['BTC', 'ETH'],
      conviction: 32,
      evidence: [evidence({
        id: 'E1', type: 'sentiment', source: snap.origin, locator: 'news-briefing',
        quote: top.join(' | '), value: round(Number(trending[0].sentiment) || 0, 2), headline: true,
        snapshotIntent: 'signal:news-briefing',
      })],
      invalidation: {
        condition: 'The top three trending topics roll off within two sessions and are replaced by a coherent opposing theme, i.e. the narrative regime actually changes rather than the news cycle simply rotating.',
        level: 'top-3 topic turnover with opposing sentiment', recheckAt: addDays(asOf, 3),
      },
      risks: ['Trending boards over-weight the loudest voices, not the largest positions.', 'Narrative sentiment is contrarian at extremes and uninformative in the middle.'],
      provenance: { extractor: 'rules', llmModel: null, documents: [], tools: [snap.origin] },
    })];
  }
}

export default RuleExtractor;