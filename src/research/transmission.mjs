/**
 * Transmission study.
 *
 * Question: when Prism says "a hot CPI print hurts duration and helps energy",
 * is that actually true in the cross-section, or is it a story we tell?
 *
 * Method, with no look-ahead:
 *   1. For each real macro release, compute the surprise = actual - consensus.
 *      The SIDE (hot/cool) is derived mechanically from the sign of that
 *      surprise. It is never hand-labelled, so the study cannot be tuned to
 *      its own answer.
 *   2. Estimate every name's factor exposures from the trailing 252 sessions
 *      ENDING THE DAY BEFORE the release.
 *   3. Build the predicted relative return as the exposure-weighted sum of the
 *      TRANSMISSION legs the engine would have used that day.
 *   4. Compare against the realised event-day return minus the benchmark.
 *   5. Score with Spearman rank correlation (does the ORDERING hold?) and with
 *      a long-top-3 / short-bottom-3 basket spread (is it tradeable?).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { TRANSMISSION, MACRO_KINDS } from '../extract/lexicon.mjs';

/** Sigma scale per indicator, so a 0.3pt CPI miss and a 60k payroll miss are comparable. */
const SIGMA_SCALE = {
  cpi: 0.15, 'core-cpi': 0.15, pce: 0.12, nfp: 60, claims: 20, fomc: 12, 'fomc-cuts': 1, pmi: 1.0, retail: 0.3,
};

/**
 * Directional polarity of a metric. +1 means a HIGHER number is a HOTTER
 * surprise (CPI, payrolls, bps of tightening). -1 means a HIGHER number is
 * COOLER (projected rate cuts). Declared from the metric definition, never
 * fitted to the result.
 */
export function polarityOf(event) {
  const p = Number(event.polarity);
  return Number.isFinite(p) && p !== 0 ? Math.sign(p) : 1;
}

export function surpriseSigma(event) {
  const scale = SIGMA_SCALE[String(event.indicator).toLowerCase()];
  const surprise = event.actual - event.consensus;
  if (!scale || !Number.isFinite(surprise)) return null;
  return (surprise * polarityOf(event)) / scale;
}
import { exposures, factorForTag } from './factors.mjs';
import { spearman, mean, stdev, corrPValue, pearson } from '../util/stats.mjs';
import { round } from '../util/num.mjs';

const log = logger('transmission');

export function loadEvents(file = join(config.paths.events, 'macro-events.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Previous trading day strictly before `date` for `symbol`. */
function priorTradingDay(book, symbol, date) {
  const bars = book.bars(symbol);
  let prior = null;
  for (const b of bars) {
    if (b.date >= date) break;
    prior = b.date;
  }
  return prior;
}

function zScores(values) {
  const nums = values.map((v) => v.value).filter((v) => Number.isFinite(v));
  if (nums.length < 4) return new Map();
  const m = mean(nums);
  const sd = stdev(nums);
  if (!sd) return new Map();
  return new Map(values.filter((v) => Number.isFinite(v.value)).map((v) => [v.symbol, (v.value - m) / sd]));
}

/**
 * Predicted cross-sectional relative return for one event, using only
 * information available before the release.
 */
export function predictCrossSection(book, event, universe, { window = 252 } = {}) {
  const indicator = MACRO_KINDS.find((k) => String(event.indicator).toLowerCase().includes(k)) || null;
  if (!indicator) return { ok: false, reason: `indicator "${event.indicator}" has no transmission map`, predicted: [] };

  const surprise = event.actual - event.consensus;
  const oriented = surprise * polarityOf(event);
  const side = oriented > 0 ? 'hot' : oriented < 0 ? 'cool' : null;
  if (!side) return { ok: false, reason: 'surprise is exactly zero - no directional transmission to test', predicted: [], surprise: 0 };

  // `fomc-cuts` shares the FOMC leg set; the polarity flip already handled direction.
  const legKey = indicator === 'fomc-cuts' ? 'fomc' : indicator;
  const map = TRANSMISSION[legKey]?.[side];
  if (!map) return { ok: false, reason: `no ${side} leg set for ${indicator}`, predicted: [] };

  const asOf = priorTradingDay(book, event.benchmarkSymbol || 'SPY', event.date) || event.date;

  // Measure exposures once per factor, as of the day before the release.
  const table = new Map();
  for (const sym of universe) {
    const e = exposures(book, sym, { window, at: asOf });
    if (e) table.set(sym, e);
  }
  if (table.size < 6) return { ok: false, reason: `only ${table.size} names had enough history at ${asOf}`, predicted: [] };

  // Cross-sectional z-score per factor, then weight by the leg direction.
  const legs = [...(map.hits || []), ...(map.beneficiaries || [])];
  const zByFactor = new Map();
  for (const leg of legs) {
    const factor = factorForTag(leg.betaTag);
    if (zByFactor.has(factor)) continue;
    const vals = [...table.entries()].map(([symbol, row]) => ({ symbol, value: row[factor] }));
    zByFactor.set(factor, { z: zScores(vals), leg });
  }

  const predicted = [];
  for (const [symbol, row] of table) {
    let score = 0;
    const contributions = [];
    for (const leg of legs) {
      const factor = factorForTag(leg.betaTag);
      const z = zByFactor.get(factor)?.z.get(symbol);
      if (!Number.isFinite(z)) continue;
      const term = leg.direction * z;
      score += term;
      contributions.push({ betaTag: leg.betaTag, factor, z: round(z, 3), direction: leg.direction, term: round(term, 3) });
    }
    predicted.push({ symbol, predicted: score, contributions, exposures: row });
  }
  predicted.sort((a, b) => b.predicted - a.predicted);
  return { ok: true, indicator, legKey, side, surprise, orientedSurprise: oriented, asOf, legs, predicted, narrative: map.narrative };
}

/** Realised event-day return relative to the benchmark. */
export function realisedCrossSection(book, event, universe, benchmark = 'SPY') {
  const bench = book.eventDayReturn(benchmark, event.date);
  if (!bench) return null;
  const out = [];
  for (const sym of universe) {
    if (sym === benchmark) continue;
    const r = book.eventDayReturn(sym, event.date);
    if (!r) continue;
    out.push({ symbol: sym, pct: r.pct, relative: r.pct - bench.pct, date: r.date });
  }
  return { benchmark, benchmarkPct: bench.pct, date: bench.date, rows: out };
}

/** Full per-event evaluation. */
export function studyEvent(book, event, universe, benchmark = 'SPY', opts = {}) {
  const pred = predictCrossSection(book, { ...event, benchmarkSymbol: benchmark }, universe, opts);
  if (!pred.ok) return { date: event.date, label: event.label, skipped: true, reason: pred.reason };
  const real = realisedCrossSection(book, event, universe, benchmark);
  if (!real || !real.rows.length) return { date: event.date, label: event.label, skipped: true, reason: 'no realised prices on the event date' };

  const realBySym = new Map(real.rows.map((r) => [r.symbol, r.relative]));
  const paired = pred.predicted
    .filter((p) => realBySym.has(p.symbol))
    .map((p) => ({ symbol: p.symbol, predicted: p.predicted, realised: realBySym.get(p.symbol), contributions: p.contributions }));
  if (paired.length < 6) return { date: event.date, label: event.label, skipped: true, reason: `only ${paired.length} paired observations` };

  const rho = spearman(paired.map((p) => p.predicted), paired.map((p) => p.realised));
  const r = pearson(paired.map((p) => p.predicted), paired.map((p) => p.realised));

  const sorted = paired.slice().sort((a, b) => b.predicted - a.predicted);
  const k = Math.max(2, Math.round(sorted.length * 0.2));
  const top = sorted.slice(0, k);
  const bottom = sorted.slice(-k);
  const topAvg = mean(top.map((p) => p.realised));
  const bottomAvg = mean(bottom.map((p) => p.realised));

  return {
    date: event.date,
    label: event.label,
    indicator: pred.indicator,
    side: pred.side,
    surprise: round(pred.surprise, 3),
    sigma: round(surpriseSigma({ ...event, indicator: pred.indicator }) ?? NaN, 2),
    unit: event.unit,
    exposuresAsOf: pred.asOf,
    n: paired.length,
    benchmarkPct: round(real.benchmarkPct, 2),
    spearman: Number.isFinite(rho) ? round(rho, 3) : null,
    pearson: Number.isFinite(r) ? round(r, 3) : null,
    pValue: Number.isFinite(corrPValue(rho, paired.length)) ? round(corrPValue(rho, paired.length), 4) : null,
    topBasket: { size: k, symbols: top.map((p) => p.symbol), avgRelativePct: round(topAvg, 2) },
    bottomBasket: { size: k, symbols: bottom.map((p) => p.symbol), avgRelativePct: round(bottomAvg, 2) },
    spreadPct: round(topAvg - bottomAvg, 2),
    spreadDirectionCorrect: (topAvg - bottomAvg) > 0,
    rows: paired.map((p) => ({ symbol: p.symbol, predicted: round(p.predicted, 3), realisedPct: round(p.realised, 2) })),
    narrative: pred.narrative,
  };
}

/** Run the study over every event in the table. */
export function runTransmissionStudy(book, { file, universe, benchmark = 'SPY', window = 252 } = {}) {
  const table = file ? JSON.parse(readFileSync(file, 'utf8')) : loadEvents();
  const univ = universe || table.universe;
  const bench = benchmark || table.benchmark || 'SPY';
  const events = table.events || [];
  const results = [];
  for (const ev of events) results.push(studyEvent(book, ev, univ, bench, { window }));
  const scored = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  const rhos = scored.map((r) => r.spearman).filter((x) => Number.isFinite(x));
  const spreads = scored.map((r) => r.spreadPct).filter((x) => Number.isFinite(x));
  const correct = spreads.filter((s) => s > 0).length;
  const sdRho = stdev(rhos);

  // Condition on surprise magnitude. The rubric weights surprise at 30% because
  // a transmission channel only shows up cross-sectionally when the shock is
  // big enough to force a repricing; small prints get swamped by idiosyncratic
  // noise. This breakdown is where that claim is actually tested.
  const buckets = [
    { id: 'large', label: '|surprise| >= 1.5 sigma', test: (r) => Number.isFinite(r.sigma) && Math.abs(r.sigma) >= 1.5 },
    { id: 'medium', label: '0.5 <= |surprise| < 1.5 sigma', test: (r) => Number.isFinite(r.sigma) && Math.abs(r.sigma) >= 0.5 && Math.abs(r.sigma) < 1.5 },
    { id: 'small', label: '|surprise| < 0.5 sigma', test: (r) => Number.isFinite(r.sigma) && Math.abs(r.sigma) < 0.5 },
  ];
  const bySurpriseSize = {};
  for (const bkt of buckets) {
    const rows = scored.filter(bkt.test);
    const rr = rows.map((r) => r.spearman).filter((x) => Number.isFinite(x));
    const sp = rows.map((r) => r.spreadPct).filter((x) => Number.isFinite(x));
    bySurpriseSize[bkt.id] = {
      label: bkt.label,
      n: rows.length,
      dates: rows.map((r) => r.date),
      meanSpearman: rr.length ? round(mean(rr), 3) : null,
      positiveRhoPct: rr.length ? round((rr.filter((x) => x > 0).length / rr.length) * 100, 1) : null,
      meanSpreadPct: sp.length ? round(mean(sp), 2) : null,
      spreadHitRatePct: sp.length ? round((sp.filter((s) => s > 0).length / sp.length) * 100, 1) : null,
    };
  }

  const summary = {
    events: events.length,
    scored: scored.length,
    bySurpriseSize,
    skipped: skipped.length,
    skipReasons: skipped.map((s) => `${s.date}: ${s.reason}`),
    meanSpearman: rhos.length ? round(mean(rhos), 3) : null,
    medianSpearman: rhos.length ? round(rhos.slice().sort((a, b) => a - b)[Math.floor(rhos.length / 2)], 3) : null,
    stdevSpearman: rhos.length ? round(sdRho, 3) : null,
    tStat: rhos.length > 2 && sdRho ? round(mean(rhos) / (sdRho / Math.sqrt(rhos.length)), 2) : null,
    positiveRhoEvents: rhos.filter((x) => x > 0).length,
    positiveRhoPct: rhos.length ? round((rhos.filter((x) => x > 0).length / rhos.length) * 100, 1) : null,
    meanSpreadPct: spreads.length ? round(mean(spreads), 2) : null,
    spreadHitRatePct: spreads.length ? round((correct / spreads.length) * 100, 1) : null,
    benchmark: bench,
    universe: univ,
    window,
  };

  log.info(`transmission study: ${summary.scored}/${summary.events} events scored, mean rho ${summary.meanSpearman}, spread hit rate ${summary.spreadHitRatePct}%`);
  return { summary, results, generatedAt: new Date().toISOString() };
}

export default runTransmissionStudy;