/**
 * The scoring rubric.
 *
 * Five factors, explicit weights, and every factor returns a human-readable
 * reason string. A trader should be able to look at a card and understand in
 * ten seconds WHY it scored 71 and not 55 - and disagree with the weighting
 * without having to read the code.
 *
 * Scores are 0-100. The rubric is deliberately conservative: an unverified
 * headline caps the score, and a card with no executable trade sketch loses
 * its asymmetry component entirely.
 */

import { config } from '../config.mjs';
import { CHANNELS } from '../schema.mjs';
import { clamp, round } from '../util/num.mjs';
import { decayWeight, parseDate } from '../util/time.mjs';

export const WEIGHTS = config.scoring.weights;

/** Instruments ranked by how easy they are to actually get on and off. */
const LIQUIDITY = {
  'native-equity': 1.0,
  etf: 0.95,
  option: 0.7,
  rtoken: 0.45,
  crypto: 0.6,
  cash: 1.0,
};

/** Large-cap names get full tradability credit; everything else is discounted. */
const MEGA_CAPS = new Set(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'SPY', 'QQQ', 'JPM', 'WMT', 'XOM', 'NFLX', 'AMD']);

export function scoreSurprise(card) {
  const gap = card.expectationGap;
  if (!gap) {
    // Channels without a numeric consensus still need a magnitude story.
    if (card.channel === 'risk-flag') {
      const flags = (card.evidence || []).filter((e) => e.type === 'filing' || e.type === 'fundamental').length;
      return { score: clamp(28 + flags * 12, 0, 80), reason: `No consensus gap (risk channel); ${flags} adverse flag(s) counted.` };
    }
    if (card.channel === 'narrative-shift') {
      const c = clamp(card.conviction || 0, 0, 100);
      return { score: c * 0.8, reason: 'Narrative channel has no consensus series; scaled from lexicon tone strength and corroboration.' };
    }
    if (card.channel === 'closed-window' || card.channel === 'cross-asset') {
      return { score: 52, reason: 'Structural channel - the surprise is the session/liquidity regime itself, not a data print.' };
    }
    if (card.channel === 'flow-footprint') {
      // Flow has no consensus series to surprise against. Magnitude is the number
      // of transactions pointing the same way - one insider sale is tax planning,
      // a cluster is information.
      const n = (card.evidence || []).reduce((a, e) => a + (typeof e.value === 'number' ? Math.abs(e.value) : 0), 0);
      return { score: clamp(26 + n * 5, 0, 72), reason: `Flow channel has no consensus series; scaled from ${n} net transaction(s) pointing the same way.` };
    }
    return { score: 20, reason: 'No expectation gap quantified. A signal without a surprise magnitude is weak by construction.' };
  }
  const sigma = gap.sigma;
  const delta = gap.deltaPct;
  let score = 20;
  const parts = [];
  if (Number.isFinite(sigma)) {
    score = clamp(30 + Math.abs(sigma) * 26, 0, 100);
    parts.push(`${round(sigma, 2)} sigma surprise -> base ${round(score, 0)}`);
  } else if (Number.isFinite(delta)) {
    score = clamp(24 + Math.abs(delta) * 3.4, 0, 100);
    parts.push(`${round(delta, 1)}% consensus gap -> base ${round(score, 0)}`);
  } else {
    parts.push('gap present but neither sigma nor delta is numeric -> floor 20');
  }
  if (gap.confidence !== undefined && gap.confidence !== null) {
    const adj = (gap.confidence - 0.6) * 25;
    score = clamp(score + adj, 0, 100);
    parts.push(`consensus confidence ${gap.confidence} adjusts ${adj >= 0 ? '+' : ''}${round(adj, 1)}`);
  }
  if (gap.guidanceStance && gap.guidanceStance !== 'unclear') {
    const agrees = (delta > 0 && gap.guidanceStance === 'raise') || (delta < 0 && ['lower', 'withdraw'].includes(gap.guidanceStance));
    score = clamp(score + (agrees ? 8 : -10), 0, 100);
    parts.push(`guidance "${gap.guidanceStance}" ${agrees ? 'confirms' : 'contradicts'} the print (${agrees ? '+8' : '-10'})`);
  }
  return { score: round(score, 1), reason: parts.join('; ') };
}

export function scoreCorroboration(card) {
  const ev = card.evidence || [];
  if (!ev.length) return { score: 0, reason: 'No evidence attached.' };
  const pass = ev.filter((e) => e.verified === 'pass').length;
  const fail = ev.filter((e) => e.verified === 'fail').length;
  const unver = ev.filter((e) => e.verified === 'unverifiable').length;
  const sources = new Set(ev.map((e) => e.source).filter(Boolean));
  const types = new Set(ev.map((e) => e.type).filter(Boolean));
  const headline = ev.find((e) => e.headline);

  let score = (pass / ev.length) * 62;
  const parts = [`${pass}/${ev.length} items verified (${round((pass / ev.length) * 100, 0)}%) -> ${round(score, 0)}`];

  if (sources.size >= 2) { score += 14; parts.push(`+14 independent sources (${sources.size})`); }
  else parts.push('single source: no independent corroboration (+0)');

  if (types.size >= 3) { score += 12; parts.push(`+12 multi-modal evidence (${[...types].join('/')})`); }
  else if (types.size === 2) { score += 6; parts.push('+6 two evidence modalities'); }

  if (headline?.verified === 'pass') { score += 8; parts.push('+8 headline evidence cleared the ledger'); }
  if (fail) { score -= fail * 22; parts.push(`-${fail * 22} for ${fail} FAILED item(s)`); }
  if (unver) { score -= unver * 5; parts.push(`-${unver * 5} for ${unver} unverifiable item(s)`); }
  if (card.transmissionChain?.length) {
    const conf = card.transmissionChain.reduce((a, h) => a + (h.confidence ?? 0.5), 0) / card.transmissionChain.length;
    score += conf * 8;
    parts.push(`+${round(conf * 8, 1)} transmission chain (mean hop confidence ${round(conf, 2)})`);
  }
  return { score: round(clamp(score, 0, 100), 1), reason: parts.join('; ') };
}

export function scoreTradability(card) {
  const instruments = card.instruments?.length ? card.instruments : ['native-equity'];
  const best = Math.max(...instruments.map((i) => LIQUIDITY[i] ?? 0.4));
  const tickers = card.tickers || [];
  const mega = tickers.filter((t) => MEGA_CAPS.has(String(t).toUpperCase())).length;
  const capFactor = tickers.length ? 0.55 + 0.45 * (mega / tickers.length) : 0.6;

  let score = best * 70 * capFactor;
  const parts = [`best instrument ${instruments[0]} (liquidity ${best}) x large-cap coverage ${round(capFactor, 2)} -> ${round(score, 0)}`];

  if (card.tradeSketch) {
    const ts = card.tradeSketch;
    const hasLevels = ts.entryZone || ts.pair || (ts.stop !== null && ts.stop !== undefined);
    if (hasLevels) { score += 16; parts.push('+16 executable levels supplied'); }
    if (ts.riskPctOfPortfolio > 0 && ts.riskPctOfPortfolio <= 2) { score += 8; parts.push(`+8 sized at ${ts.riskPctOfPortfolio}% portfolio risk`); }
    else if (ts.riskPctOfPortfolio > 2) { score -= 10; parts.push(`-10 oversized at ${ts.riskPctOfPortfolio}% portfolio risk`); }
  } else {
    parts.push('no trade sketch: the trader has to build the execution plan from scratch (+0)');
  }

  if (instruments.includes('rtoken') && !instruments.includes('native-equity')) {
    score -= 8;
    parts.push('-8 rToken-only: thinner book, and mint/redeem arb can close the gap without you');
  }
  if (card.horizon === 'intraday') { score -= 4; parts.push('-4 intraday horizon demands fast execution'); }

  return { score: round(clamp(score, 0, 100), 1), reason: parts.join('; ') };
}

export function scoreAsymmetry(card) {
  const ts = card.tradeSketch;
  if (!ts) return { score: 30, reason: 'No trade sketch - asymmetry unknown, floored at 30 rather than rewarded.' };
  if (ts.pair) return { score: 62, reason: `Market-neutral pair ${ts.pair.long}/${ts.pair.short}: asymmetry comes from spread convergence, capped at 62 because the legs can diverge indefinitely.` };

  const entry = Array.isArray(ts.entryZone) ? (ts.entryZone[0] + (ts.entryZone[1] ?? ts.entryZone[0])) / 2 : ts.entryZone;
  if (!Number.isFinite(entry) || !Number.isFinite(ts.stop) || !Number.isFinite(ts.target)) {
    return { score: 35, reason: 'Trade sketch is missing at least one of entry / stop / target.' };
  }
  const risk = Math.abs(entry - ts.stop);
  const reward = Math.abs(ts.target - entry);
  if (risk === 0) return { score: 20, reason: 'Zero risk distance - the stop is on the entry, which is not a stop.' };
  const rr = reward / risk;
  let score = clamp(20 + rr * 20, 0, 100);
  const parts = [`reward/risk ${round(rr, 2)}:1 -> ${round(score, 0)}`];
  if (rr < 1) { score = clamp(score - 15, 0, 100); parts.push('-15 sub-1:1 payoff'); }
  if (rr >= 3) { score = clamp(score + 8, 0, 100); parts.push('+8 payoff >= 3:1'); }
  if (card.invalidation?.level) { score += 6; parts.push('+6 invalidation has an observable level, not just a vibe'); }
  return { score: round(clamp(score, 0, 100), 1), reason: parts.join('; ') };
}

/**
 * Freshness decays against the age of the INFORMATION, not the age of the card.
 *
 * A card the desk wrote one second ago out of a ten-day-old release is still
 * carrying ten-day-old information, and its channel's half-life should say so.
 * `informationAt` is stamped by the extractor from the newest source document;
 * `createdAt` (the run's as-of) is only the fallback.
 */
export function scoreFreshness(card, at = new Date()) {
  const halfLife = CHANNELS[card.channel]?.halfLifeHours ?? 72;
  const basis = card.informationAt || card.createdAt;
  const atIso = at instanceof Date ? at.toISOString() : at;
  const w = decayWeight(basis, atIso, halfLife);
  const ageHrs = (parseDate(atIso) - parseDate(basis)) / 3600000;
  const expired = card.expiresAt && parseDate(card.expiresAt) < parseDate(atIso);
  if (expired) return { score: 0, reason: `Card expired at ${card.expiresAt}. Time-boxed signals are not renewable.` };
  return {
    score: round(w * 100, 1),
    reason: `underlying information is ${round(ageHrs, 1)}h old (source stamped ${String(basis).slice(0, 16)}) against a ${halfLife}h half-life for ${card.channel} -> decay weight ${round(w, 3)}`,
  };
}

const FACTOR_FN = {
  surprise: scoreSurprise,
  corroboration: scoreCorroboration,
  tradability: scoreTradability,
  asymmetry: scoreAsymmetry,
  freshness: scoreFreshness,
};

/**
 * Score a card. Mutates card.score and card.scoreBreakdown, returns the score block.
 */
export function scoreCard(card, { at = new Date(), weights = WEIGHTS } = {}) {
  const breakdown = {};
  let total = 0;
  for (const [factor, weight] of Object.entries(weights)) {
    const fn = FACTOR_FN[factor];
    const res = fn ? fn(card, at) : { score: 0, reason: 'unimplemented factor' };
    breakdown[factor] = { score: round(res.score, 1), weight, contribution: round(res.score * weight, 2), reason: res.reason };
    total += res.score * weight;
  }

  const penalties = [];
  const headlineFail = (card.evidence || []).some((e) => e.headline && e.verified === 'fail');
  if (headlineFail) { penalties.push({ id: 'headline-unverified', amount: 35, reason: 'Headline evidence failed the ledger - the number driving the trade could not be confirmed.' }); }
  if (!card.invalidation?.condition) { penalties.push({ id: 'no-invalidation', amount: 25, reason: 'No invalidation condition - the claim is unfalsifiable.' }); }
  if (!card.risks?.length) { penalties.push({ id: 'no-bear-case', amount: 8, reason: 'No stated bear case.' }); }

  const penaltyTotal = penalties.reduce((a, p) => a + p.amount, 0);
  const final = round(clamp(total - penaltyTotal, 0, 100), 1);
  const grade = final >= 75 ? 'A' : final >= 62 ? 'B' : final >= 48 ? 'C' : final >= 35 ? 'D' : 'F';

  card.score = { total: final, raw: round(total, 1), penalties, grade, publishable: final >= config.scoring.minScoreToPublish && !headlineFail, weights: { ...weights }, scoredAt: new Date(at).toISOString() };
  card.scoreBreakdown = breakdown;
  return card.score;
}

/** Rank a set of cards the way the board displays them. */
export function rankCards(cards, { at = new Date() } = {}) {
  return cards
    .map((c) => (c.score ? c : (scoreCard(c, { at }), c)))
    .slice()
    .sort((a, b) => {
      const ap = a.status === 'quarantined' ? 1 : 0;
      const bp = b.status === 'quarantined' ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (b.score?.total ?? 0) - (a.score?.total ?? 0);
    });
}

export function explainScore(card) {
  if (!card.score) return 'not scored';
  const lines = [`Total ${card.score.total}/100 (grade ${card.score.grade}) - raw ${card.score.raw} before penalties`];
  for (const [factor, b] of Object.entries(card.scoreBreakdown || {})) {
    lines.push(`  ${factor.padEnd(14)} ${String(b.score).padStart(5)} x ${b.weight} = ${String(b.contribution).padStart(5)}  ${b.reason}`);
  }
  for (const p of card.score.penalties || []) lines.push(`  PENALTY -${p.amount}  ${p.reason}`);
  return lines.join('\n');
}