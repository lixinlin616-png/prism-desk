/**
 * Overnight-gap study.
 *
 * The whole S2 thesis is that tokenized US equities trade 7x24 while the native
 * share only prices information for 6.5 hours a day. The rToken is therefore
 * the ONLY venue that can price information arriving while the cash market is
 * shut - and the native open has to catch up.
 *
 * This study measures the catch-up process on real data:
 *   - how often an overnight gap CONTINUES into the session vs REVERTS
 *   - whether the answer depends on gap size (bigger gap = more information)
 *   - whether it depends on how long the market was shut (weekend gaps have had
 *     ~64 hours of information accumulate vs ~17 hours for a weekday overnight)
 *
 * The outputs are used directly by the `closed-window` channel: they set the
 * default horizon, the continuation prior quoted on the card, and the sizing
 * guidance. Nothing here is asserted - it is all measured and re-runnable.
 */

import { logger } from '../util/log.mjs';
import { mean, median, stdev, quantile } from '../util/stats.mjs';
import { round } from '../util/num.mjs';

const log = logger('gap-study');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayOfWeek(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Collect every overnight gap for a symbol above `minAbsPct`. */
export function collectGaps(book, symbol, { minAbsPct = 0.75, from = null, to = null } = {}) {
  const bars = book.bars(symbol);
  const out = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prev = bars[i - 1];
    const bar = bars[i];
    if (from && bar.date < from) continue;
    if (to && bar.date > to) continue;
    if (!prev.close || !bar.open) continue;
    const gapPct = ((bar.open - prev.close) / prev.close) * 100;
    if (Math.abs(gapPct) < minAbsPct) continue;
    const intradayPct = ((bar.close - bar.open) / bar.open) * 100;
    const dayPct = ((bar.close - prev.close) / prev.close) * 100;
    const dir = Math.sign(gapPct);
    const continuation = intradayPct * dir;
    out.push({
      symbol,
      date: bar.date,
      weekday: dayOfWeek(bar.date),
      gapPct: round(gapPct, 3),
      absGapPct: round(Math.abs(gapPct), 3),
      direction: dir > 0 ? 'up' : 'down',
      intradayPct: round(intradayPct, 3),
      dayPct: round(dayPct, 3),
      continuation: round(continuation, 3),
      outcome: continuation > 0.1 ? 'continued' : continuation < -0.1 ? 'reverted' : 'flat',
      fwd1: fwd(bars, i, 1),
      fwd5: fwd(bars, i, 5),
      fwd10: fwd(bars, i, 10),
    });
  }
  return out;
}

/** Forward close-to-close return in % from bar `i` to bar `i + n`. */
function fwd(bars, i, n) {
  if (i + n >= bars.length || !bars[i]?.close || !bars[i + n]?.close) return null;
  return round(((bars[i + n].close - bars[i].close) / bars[i].close) * 100, 3);
}

function bucketOf(absGap) {
  if (absGap < 1) return '0.75-1%';
  if (absGap < 2) return '1-2%';
  if (absGap < 4) return '2-4%';
  return '>=4%';
}

function summarise(rows) {
  if (!rows.length) return { n: 0 };
  const continued = rows.filter((r) => r.outcome === 'continued').length;
  const reverted = rows.filter((r) => r.outcome === 'reverted').length;
  const flat = rows.filter((r) => r.outcome === 'flat').length;
  const up = rows.filter((r) => r.direction === 'up');
  const down = rows.filter((r) => r.direction === 'down');
  const rate = (sub) => (sub.length ? round((sub.filter((r) => r.outcome === 'continued').length / sub.length) * 100, 1) : null);
  const fwdMean = (key) => {
    const v = rows.map((r) => r[key]).filter((x) => Number.isFinite(x));
    return v.length ? round(mean(v), 3) : null;
  };
  /** Mean excess return and its t-statistic. */
  const excess = (key) => {
    const v = rows.map((r) => r[key]).filter((x) => Number.isFinite(x));
    if (v.length < 3) return { mean: null, t: null, n: v.length };
    const m = mean(v);
    const sd = stdev(v);
    return { mean: round(m, 3), t: sd ? round(m / (sd / Math.sqrt(v.length)), 2) : null, n: v.length, winPct: round((v.filter((x) => x > 0).length / v.length) * 100, 1) };
  };
  /**
   * Date-clustered t-statistic.
   *
   * The naive t-stat above treats every symbol-day as independent. It is not:
   * on a big macro day twenty names gap together, so the observations are
   * heavily cross-correlated and the naive t is badly overstated. Averaging to
   * one observation per calendar date removes that dependence and gives an
   * honest significance figure.
   */
  const clustered = (key) => {
    const byDate = new Map();
    for (const r of rows) {
      const v = r[key];
      if (!Number.isFinite(v)) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(v);
    }
    const daily = [...byDate.values()].map(mean);
    if (daily.length < 4) return { mean: null, t: null, dates: daily.length };
    const m = mean(daily);
    const sd = stdev(daily);
    return { mean: round(m, 3), t: sd ? round(m / (sd / Math.sqrt(daily.length)), 2) : null, dates: daily.length };
  };
  return {
    n: rows.length,
    continuedPct: round((continued / rows.length) * 100, 1),
    revertedPct: round((reverted / rows.length) * 100, 1),
    flatPct: round((flat / rows.length) * 100, 1),
    medianAbsGapPct: round(median(rows.map((r) => r.absGapPct)), 2),
    meanContinuationPct: round(mean(rows.map((r) => r.continuation)), 3),
    medianContinuationPct: round(median(rows.map((r) => r.continuation)), 3),
    continuationSdPct: round(stdev(rows.map((r) => r.continuation)), 3),
    upGaps: { n: up.length, continuedPct: rate(up) },
    downGaps: { n: down.length, continuedPct: rate(down) },
    meanFwd1Pct: fwdMean('fwd1'),
    meanFwd5Pct: fwdMean('fwd5'),
    meanFwd10Pct: fwdMean('fwd10'),
    excessVsBenchmark: { fwd1: excess('excessFwd1'), fwd5: excess('excessFwd5'), fwd10: excess('excessFwd10') },
    excessDateClustered: { fwd1: clustered('excessFwd1'), fwd5: clustered('excessFwd5'), fwd10: clustered('excessFwd10') },
    p25Continuation: round(quantile(rows.map((r) => r.continuation), 0.25), 3),
    p75Continuation: round(quantile(rows.map((r) => r.continuation), 0.75), 3),
  };
}

/**
 * @param {object} opts
 * @param {string[]} [opts.symbols]  defaults to every symbol in the book
 * @param {number}   [opts.minAbsPct]
 */
/**
 * Benchmark-excess forward returns.
 *
 * Raw forward returns after a gap are positive simply because equities drift
 * upward. Subtracting the benchmark over the identical window is what turns
 * "gaps are followed by gains" into a claim that can actually be traded.
 */
function addExcess(book, rows, benchmark) {
  if (!book.has(benchmark)) return rows;
  const bBars = book.bars(benchmark);
  const idxByDate = new Map(bBars.map((b, i) => [b.date, i]));
  for (const r of rows) {
    const i = idxByDate.get(r.date);
    if (i === undefined) continue;
    for (const [key, n] of [['excessFwd1', 1], ['excessFwd5', 5], ['excessFwd10', 10]]) {
      const own = r[`fwd${n}`];
      const bench = fwd(bBars, i, n);
      r[key] = Number.isFinite(own) && Number.isFinite(bench) ? round(own - bench, 3) : null;
    }
  }
  return rows;
}

export function runGapStudy(book, { symbols = null, minAbsPct = 0.75, from = null, to = null, benchmark = 'SPY' } = {}) {
  const list = symbols || book.symbols();
  const all = [];
  const perSymbol = {};
  for (const s of list) {
    const rows = collectGaps(book, s, { minAbsPct, from, to });
    all.push(...rows);
    if (rows.length) perSymbol[s] = summarise(rows);
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  addExcess(book, all, benchmark);
  for (const s of list) {
    const rows = all.filter((r) => r.symbol === s);
    if (rows.length) perSymbol[s] = summarise(rows);
  }

  const byBucket = {};
  for (const b of ['0.75-1%', '1-2%', '2-4%', '>=4%']) {
    const rows = all.filter((r) => bucketOf(r.absGapPct) === b);
    if (rows.length) byBucket[b] = summarise(rows);
  }

  // Weekend gaps = the market was shut for ~64h, so more information had to be
  // priced at the open. This is the closest native-market analogue to the rToken
  // situation the hackathon is about.
  const weekendRows = all.filter((r) => r.weekday === 'Mon');
  const weekdayRows = all.filter((r) => r.weekday !== 'Mon');

  const summary = {
    symbols: list.length,
    minAbsPct,
    from: from ?? (all[0]?.date ?? null),
    to: to ?? (all[all.length - 1]?.date ?? null),
    gaps: all.length,
    benchmark,
    overall: summarise(all),
    bySizeBucket: byBucket,
    mondayGaps: { label: 'Monday open (~64h of accumulated information)', ...summarise(weekendRows) },
    otherWeekdayGaps: { label: 'Tue-Fri open (~17h overnight)', ...summarise(weekdayRows) },
    generatedAt: new Date().toISOString(),
  };

  log.info(`gap study: ${all.length} gaps across ${list.length} symbols; continued ${summary.overall.continuedPct}% / reverted ${summary.overall.revertedPct}%; Monday continuation ${summary.mondayGaps.continuedPct}% vs weekday ${summary.otherWeekdayGaps.continuedPct}%`);
  return { summary, perSymbol, rows: all };
}

export default runGapStudy;