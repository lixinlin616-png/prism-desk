/**
 * The Signal Card is Prism's canonical artifact.
 *
 * Design rule: a card is not an opinion, it is a *falsifiable claim* plus the
 * evidence that supports it plus the condition that would prove it wrong.
 * Anything the LLM cannot ground in a source is marked `unverified` and can
 * never carry a card's headline.
 */

import { expiryFor } from './util/time.mjs';

export const CHANNELS = {
  'earnings-gap': {
    id: 'earnings-gap',
    name: 'Earnings Expectation Gap',
    zh: '财报预期差',
    colour: '#5eead4',
    question: 'What did the print/call actually say versus what was priced in?',
    inputs: ['earnings-release', 'earnings-call', 'consensus-estimates', 'guidance'],
    halfLifeHours: 24 * 10,
  },
  'macro-transmission': {
    id: 'macro-transmission',
    name: 'Macro Transmission Chain',
    zh: '宏观传导链路',
    colour: '#a78bfa',
    question: 'A macro print moved - which discount rate / cash flow channel does it hit, and who is most exposed?',
    inputs: ['cpi', 'ppi', 'nfp', 'fomc', 'retail-sales', 'yields'],
    halfLifeHours: 24 * 5,
  },
  'narrative-shift': {
    id: 'narrative-shift',
    name: 'Narrative Shift',
    zh: '叙事转向',
    colour: '#fbbf24',
    question: 'Is the story the market tells about this name changing, and has sentiment turned with it?',
    inputs: ['news', 'social', 'sentiment'],
    halfLifeHours: 24 * 7,
  },
  'flow-footprint': {
    id: 'flow-footprint',
    name: 'Flow Footprint',
    zh: '资金足迹',
    colour: '#60a5fa',
    question: 'What are insiders, institutions and ETF creations doing with real money?',
    inputs: ['13f', 'insider-trading', 'etf-flows', 'institutional-holdings'],
    halfLifeHours: 24 * 30,
  },
  'closed-window': {
    id: 'closed-window',
    name: 'Closed-Window Pricing',
    zh: '休市窗口定价',
    colour: '#f472b6',
    question: 'Native equity is closed, information is not - how should the rToken price the gap before the cash open?',
    inputs: ['session-state', 'overnight-news', 'rtoken-quote', 'native-last-close'],
    halfLifeHours: 16,
  },
  'cross-asset': {
    id: 'cross-asset',
    name: 'Cross-Asset Linkage',
    zh: '跨资产联动',
    colour: '#34d399',
    question: 'Is a crypto-side regime shift (funding, ETF flow, fear/greed) leaking into the equity complex, or vice versa?',
    inputs: ['crypto-sentiment', 'etf-flows', 'funding-rates', 'equity-vol'],
    halfLifeHours: 24 * 4,
  },
  'risk-flag': {
    id: 'risk-flag',
    name: 'Contrarian Risk Flag',
    zh: '反向风险旗',
    colour: '#fb7185',
    question: 'What is the bear case the consensus is not pricing? Where is the language softening?',
    inputs: ['earnings-call', 'filings', 'insider-selling', 'accounting-ratios'],
    halfLifeHours: 24 * 21,
  },
};

export const CHANNEL_IDS = Object.keys(CHANNELS);

export const DIRECTIONS = ['long', 'short', 'pair', 'hedge', 'avoid', 'neutral'];
export const HORIZONS = ['intraday', 'days', 'weeks', 'event'];
export const INSTRUMENTS = ['native-equity', 'rtoken', 'etf', 'option', 'crypto', 'cash'];
export const VERIFY_STATUS = ['pass', 'fail', 'unverifiable', 'pending'];
export const CARD_STATUS = ['draft', 'active', 'quarantined', 'expired', 'invalidated', 'realized'];

export const EVIDENCE_TYPES = [
  'quote', 'metric', 'price', 'fundamental', 'estimate', 'filing',
  'news', 'sentiment', 'onchain', 'technical', 'calendar', 'computed',
];

export const SCORE_FACTORS = ['surprise', 'corroboration', 'tradability', 'asymmetry', 'freshness'];

let seq = 0;

const idStamp = (at) => {
  const when = at === null || at === undefined ? new Date() : new Date(at);
  const ms = Number.isFinite(when.getTime()) ? when.getTime() : Date.now();
  return ms.toString(36).toUpperCase();
};

/**
 * Card identity follows the DESK clock, not the wall clock.
 *
 * `--as-of` exists so a run can be replayed exactly, and an id stamped from
 * Date.now() quietly broke that promise: the same replay on a different day
 * produced different ids, so the committed board fixture behind
 * docs/reports/review.md could not be rebuilt and diffed. `seq` keeps ids
 * unique within one process, where two runs share a clock but not an identity.
 */
export function nextCardId(prefix = 'SIG', at = null) {
  seq += 1;
  return `${prefix}-${idStamp(at)}-${String(seq).padStart(3, '0')}`;
}

/**
 * Re-mint an existing id against a different clock, keeping prefix and sequence.
 *
 * The extractor mints ids before `stampTime` applies the run clock, so the id
 * would otherwise keep a wall-clock stamp even though `createdAt` beside it is
 * correctly frozen. Uniqueness survives because the sequence suffix is untouched.
 */
export function rebaseCardId(id, at) {
  const parts = String(id ?? '').split('-');
  if (parts.length < 3) return id;
  const suffix = parts.pop(); // sequence - kept, so uniqueness is untouched
  parts.pop();                // the old stamp - this is what gets replaced
  return `${parts.join('-')}-${idStamp(at)}-${suffix}`;
}

/** A blank-but-valid card. Every field the UI renders exists here, so no undefined-prop crashes. */
export function emptyCard(overrides = {}) {
  const base = {
    id: nextCardId('SIG', overrides.createdAt),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    /** When the underlying information was published. Freshness decays against this, not against createdAt. */
    informationAt: null,
    channel: 'earnings-gap',
    status: 'draft',
    title: '',
    claim: '',
    direction: 'neutral',
    horizon: 'days',
    instruments: ['native-equity'],
    tickers: [],
    universe: 'us-equity',
    conviction: 0,
    score: null,
    scoreBreakdown: Object.fromEntries(SCORE_FACTORS.map((f) => [f, { score: 0, weight: 0, reason: '' }])),
    expectationGap: null,
    transmissionChain: [],
    evidence: [],
    invalidation: null,
    tradeSketch: null,
    risks: [],
    catalysts: [],
    conflicts: [],
    expiresAt: null,
    provenance: { extractor: 'unknown', llmModel: null, documents: [], tools: [] },
    notes: '',
  };
  const merged = { ...base, ...overrides };
  if (!merged.expiresAt) merged.expiresAt = expiryFor(merged.horizon, merged.createdAt);
  return merged;
}

/** Evidence item factory. `verified` defaults to `pending` - the ledger must clear it. */
/**
 * Evidence item factory. `verified` defaults to `pending` - the ledger clears it.
 *
 * `recipe` + `snapshotIntent` make a COMPUTED claim re-executable: instead of
 * trusting the aggregate a card asserts ("4 insider sells"), the ledger finds
 * the raw snapshot and recomputes it. `symbol` / `date` scope that lookup.
 */
export function evidence({ id, type = 'quote', source = '', locator = '', quote = '', value = null, unit = null, headline = false, verified = 'pending', checkedAgainst = null, note = '', recipe = null, snapshotIntent = null, symbol = null, date = null }) {
  return { id, type, source, locator, quote, value, unit, headline, verified, checkedAgainst, note, recipe, snapshotIntent, symbol, date };
}

const REQUIRED = ['id', 'channel', 'claim', 'direction', 'horizon', 'tickers', 'evidence', 'invalidation'];

/**
 * Structural + semantic validation. Returns { ok, errors[], warnings[] }.
 * The pipeline refuses to publish a card that is not ok.
 */
export function validateCard(card) {
  const errors = [];
  const warnings = [];
  if (!card || typeof card !== 'object') return { ok: false, errors: ['card is not an object'], warnings };

  for (const f of REQUIRED) {
    if (card[f] === undefined || card[f] === null || card[f] === '') errors.push(`missing required field: ${f}`);
  }
  if (card.channel && !CHANNEL_IDS.includes(card.channel)) errors.push(`unknown channel: ${card.channel}`);
  if (card.direction && !DIRECTIONS.includes(card.direction)) errors.push(`unknown direction: ${card.direction}`);
  if (card.horizon && !HORIZONS.includes(card.horizon)) errors.push(`unknown horizon: ${card.horizon}`);
  if (Array.isArray(card.tickers)) {
    for (const t of card.tickers) {
      if (typeof t !== 'string' || !/^[A-Z0-9.\-]{1,12}$/i.test(t)) errors.push(`malformed ticker: ${String(t)}`);
    }
  }
  if (Array.isArray(card.instruments)) {
    for (const i of card.instruments) if (!INSTRUMENTS.includes(i)) errors.push(`unknown instrument: ${i}`);
  }

  const ev = Array.isArray(card.evidence) ? card.evidence : [];
  if (!ev.length) errors.push('card has no evidence - a claim without evidence is not a signal');
  const headline = ev.filter((e) => e.headline);
  if (!headline.length) warnings.push('no headline evidence flagged');
  for (const h of headline) {
    if (h.verified === 'fail') errors.push(`headline evidence ${h.id} FAILED verification - card must be quarantined`);
    if (h.verified !== 'pass') warnings.push(`headline evidence ${h.id} is ${h.verified}`);
  }
  for (const e of ev) {
    if (!e.id) errors.push('evidence item without id');
    if (e.type && !EVIDENCE_TYPES.includes(e.type)) errors.push(`unknown evidence type: ${e.type}`);
    if (e.verified && !VERIFY_STATUS.includes(e.verified)) errors.push(`unknown verify status: ${e.verified}`);
    if (!e.source) warnings.push(`evidence ${e.id} has no source`);
    if (e.type === 'quote' && !e.quote) warnings.push(`quote evidence ${e.id} is empty`);
  }

  if (!card.invalidation || !card.invalidation.condition) {
    errors.push('card has no invalidation condition - unfalsifiable claims are rejected');
  }

  if (card.claim && card.claim.length < 20) warnings.push('claim is suspiciously short');
  if (card.claim && !/\d/.test(card.claim) && card.channel !== 'narrative-shift') {
    warnings.push('claim contains no magnitude or level - prefer quantified claims');
  }
  if (Array.isArray(card.transmissionChain) && card.transmissionChain.length) {
    for (const hop of card.transmissionChain) {
      if (!hop.from || !hop.to || !hop.mechanism) errors.push('transmission hop missing from/to/mechanism');
      if (hop.confidence !== undefined && (hop.confidence < 0 || hop.confidence > 1)) {
        errors.push('transmission hop confidence must be within [0,1]');
      }
    }
  }
  if (card.tradeSketch) {
    const ts = card.tradeSketch;
    if (ts.stop !== null && ts.stop !== undefined && ts.entryZone && ts.target !== null && ts.target !== undefined) {
      const entry = Array.isArray(ts.entryZone) ? ts.entryZone[0] : ts.entryZone;
      if (ts.direction === 'long' || card.direction === 'long') {
        if (ts.stop >= entry) warnings.push('long trade sketch has stop above entry');
        if (ts.target <= entry) warnings.push('long trade sketch has target below entry');
      }
    }
    if (ts.riskPctOfPortfolio !== undefined && (ts.riskPctOfPortfolio < 0 || ts.riskPctOfPortfolio > 5)) {
      warnings.push('riskPctOfPortfolio outside sane 0-5% band');
    }
  }
  if (card.conviction !== undefined && (card.conviction < 0 || card.conviction > 100)) {
    errors.push('conviction must be within [0,100]');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Strip a card down to what the LUI needs for a list view. */
export function cardSummary(card) {
  return {
    id: card.id,
    channel: card.channel,
    channelName: CHANNELS[card.channel]?.name ?? card.channel,
    title: card.title || card.claim?.slice(0, 90),
    claim: card.claim,
    direction: card.direction,
    horizon: card.horizon,
    tickers: card.tickers,
    conviction: card.conviction,
    score: card.score?.total ?? null,
    status: card.status,
    createdAt: card.createdAt,
    expiresAt: card.expiresAt,
    verifiedRatio: card.evidence?.length
      ? card.evidence.filter((e) => e.verified === 'pass').length / card.evidence.length
      : 0,
    hasInvalidation: Boolean(card.invalidation?.condition),
  };
}