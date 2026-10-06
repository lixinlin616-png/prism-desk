/**
 * PriceBook - local reader for the bundled daily OHLCV dataset.
 *
 * The dataset under data/prices/*.csv is real end-of-day US equity/ETF data
 * (see scripts/fetch-prices.mjs for provenance and refresh instructions).
 * It exists so that the verify ledger can cross-check price claims and so the
 * research studies are reproducible without any network access.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../util/csv.mjs';
import { logger } from '../util/log.mjs';
import { mean, stdev, pearson } from '../util/stats.mjs';
import { toNum } from '../util/num.mjs';

const log = logger('prices');

export const BENCHMARKS = { spx: 'SPY', ndx: 'QQQ' };

export class PriceBook {
  constructor(dir) {
    this.dir = dir;
    this.series = new Map(); // SYMBOL -> [{date,open,high,low,close,volume}]
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    if (!existsSync(this.dir)) { log.warn(`price dir missing: ${this.dir}`); return this; }
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.csv'))) {
      const symbol = file.replace(/\.csv$/i, '').toUpperCase();
      try {
        const rows = parseCsv(readFileSync(join(this.dir, file), 'utf8'));
        const bars = rows
          .map((r) => ({
            date: r.date || r.Date,
            open: toNum(r.open ?? r.Open),
            high: toNum(r.high ?? r.High),
            low: toNum(r.low ?? r.Low),
            close: toNum(r.close ?? r.Close),
            volume: toNum(r.volume ?? r.Volume),
          }))
          .filter((b) => b.date && Number.isFinite(b.close))
          .sort((a, b) => a.date.localeCompare(b.date));
        if (bars.length) this.series.set(symbol, bars);
      } catch (err) {
        log.warn(`failed to read ${file}: ${err.message}`);
      }
    }
    log.debug(`price book loaded: ${this.series.size} symbols`);
    return this;
  }

  symbols() { this.load(); return [...this.series.keys()].sort(); }

  has(symbol) { this.load(); return this.series.has(String(symbol).toUpperCase()); }

  bars(symbol) { this.load(); return this.series.get(String(symbol).toUpperCase()) ?? []; }

  count(symbol) { return this.bars(symbol).length; }

  range(symbol) {
    const b = this.bars(symbol);
    return b.length ? { from: b[0].date, to: b[b.length - 1].date, bars: b.length } : null;
  }

  indexOfDate(symbol, date, { exact = false } = {}) {
    const b = this.bars(symbol);
    const i = b.findIndex((x) => x.date === date);
    if (i !== -1) return i;
    if (exact) return -1;
    // Nearest trading day on or before `date`.
    for (let k = b.length - 1; k >= 0; k -= 1) if (b[k].date <= date) return k;
    return -1;
  }

  closeOn(symbol, date) {
    const i = this.indexOfDate(symbol, date);
    return i === -1 ? null : this.bars(symbol)[i].close;
  }

  barOn(symbol, date) {
    const i = this.indexOfDate(symbol, date);
    return i === -1 ? null : this.bars(symbol)[i];
  }

  /** Simple return over `n` trading days starting at `date` (inclusive of date's close). */
  forwardReturn(symbol, date, n = 5) {
    const b = this.bars(symbol);
    const i = this.indexOfDate(symbol, date);
    if (i === -1 || i + n >= b.length) return null;
    const p0 = b[i].close;
    const p1 = b[i + n].close;
    if (!p0) return null;
    return { pct: ((p1 - p0) / p0) * 100, from: b[i].date, to: b[i + n].date, p0, p1 };
  }

  /** Return realised on the event date itself (close vs previous close). */
  eventDayReturn(symbol, date) {
    const b = this.bars(symbol);
    const i = this.indexOfDate(symbol, date, { exact: true });
    const idx = i !== -1 ? i : this.indexOfDate(symbol, date);
    if (idx <= 0) return null;
    const p0 = b[idx - 1].close;
    const p1 = b[idx].close;
    if (!p0) return null;
    return { pct: ((p1 - p0) / p0) * 100, date: b[idx].date, p0, p1, exact: i !== -1 };
  }

  /**
   * Overnight gap: today's open vs yesterday's close.
   * This is the quantity the `closed-window` channel trades - while the native
   * share is shut, the rToken is the only venue left to price exactly this.
   */
  overnightGap(symbol, date) {
    const b = this.bars(symbol);
    const i = this.indexOfDate(symbol, date, { exact: true });
    const idx = i !== -1 ? i : this.indexOfDate(symbol, date);
    if (idx <= 0) return null;
    const prevClose = b[idx - 1].close;
    const open = b[idx].open;
    if (!prevClose || !open) return null;
    return { pct: ((open - prevClose) / prevClose) * 100, date: b[idx].date, prevClose, open };
  }

  /** Gap fill: does price close back toward the prior close, or extend? */
  gapResolution(symbol, date) {
    const gap = this.overnightGap(symbol, date);
    if (!gap) return null;
    const b = this.bars(symbol);
    const idx = this.indexOfDate(symbol, gap.date, { exact: true });
    const bar = b[idx];
    const intraday = ((bar.close - gap.open) / gap.open) * 100;
    const total = ((bar.close - gap.prevClose) / gap.prevClose) * 100;
    const dir = Math.sign(gap.pct);
    return {
      ...gap,
      close: bar.close,
      intradayPct: intraday,
      totalDayPct: total,
      /** >0 means the gap direction was extended intraday; <0 means it faded. */
      continuation: intraday * dir,
      outcome: Math.abs(intraday) < 0.15 ? 'flat' : intraday * dir > 0 ? 'continued' : 'reverted',
    };
  }

  dailyReturns(symbol, { from = null, to = null } = {}) {
    const b = this.bars(symbol).filter((x) => (!from || x.date >= from) && (!to || x.date <= to));
    const out = [];
    for (let i = 1; i < b.length; i += 1) {
      if (b[i - 1].close) out.push({ date: b[i].date, pct: ((b[i].close - b[i - 1].close) / b[i - 1].close) * 100 });
    }
    return out;
  }

  /** Realised annualised volatility from daily returns. */
  realisedVol(symbol, { window = 60, at = null } = {}) {
    const b = this.bars(symbol);
    const end = at ? this.indexOfDate(symbol, at) + 1 : b.length;
    const slice = b.slice(Math.max(1, end - window), end);
    const rets = [];
    for (let i = 1; i < slice.length; i += 1) if (slice[i - 1].close) rets.push((slice[i].close - slice[i - 1].close) / slice[i - 1].close);
    const sd = stdev(rets);
    return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
  }

  /** OLS beta of `symbol` vs `benchmark` over `window` daily returns. */
  beta(symbol, benchmark = 'SPY', { window = 250, at = null } = {}) {
    const xs = this.dailyReturns(benchmark, at ? windowSlice(this, benchmark, at, window) : {});
    const ys = this.dailyReturns(symbol, at ? windowSlice(this, symbol, at, window) : {});
    const map = new Map(xs.map((r) => [r.date, r.pct]));
    const paired = ys.map((r) => [map.get(r.date), r.pct]).filter(([a, b2]) => Number.isFinite(a) && Number.isFinite(b2));
    if (paired.length < 30) return null;
    const X = paired.map((p) => p[0]);
    const Y = paired.map((p) => p[1]);
    const mx = mean(X);
    const my = mean(Y);
    let num = 0;
    let den = 0;
    for (let i = 0; i < X.length; i += 1) { num += (X[i] - mx) * (Y[i] - my); den += (X[i] - mx) ** 2; }
    return den === 0 ? null : num / den;
  }

  correlation(a, b, { window = 120, at = null } = {}) {
    const ra = this.dailyReturns(a, at ? windowSlice(this, a, at, window) : {});
    const rb = this.dailyReturns(b, at ? windowSlice(this, b, at, window) : {});
    const map = new Map(ra.map((r) => [r.date, r.pct]));
    const paired = rb.map((r) => [map.get(r.date), r.pct]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (paired.length < 20) return null;
    return pearson(paired.map((p) => p[0]), paired.map((p) => p[1]));
  }

  /** Volume z-score vs the trailing 20 sessions - part of "is this a real information day?". */
  volumeZ(symbol, date, { window = 20 } = {}) {
    const b = this.bars(symbol);
    const idx = this.indexOfDate(symbol, date, { exact: true });
    if (idx < window) return null;
    const prior = b.slice(idx - window, idx).map((x) => x.volume).filter((v) => Number.isFinite(v));
    const m = mean(prior);
    const sd = stdev(prior);
    const v = b[idx].volume;
    if (!Number.isFinite(m) || !sd || !Number.isFinite(v)) return null;
    return (v - m) / sd;
  }

  stats() {
    this.load();
    const syms = this.symbols();
    let bars = 0;
    let from = '9999';
    let to = '0000';
    for (const s of syms) {
      const b = this.bars(s);
      bars += b.length;
      if (b[0].date < from) from = b[0].date;
      if (b[b.length - 1].date > to) to = b[b.length - 1].date;
    }
    return { symbols: syms.length, bars, from, to, list: syms };
  }
}

function windowSlice(book, symbol, at, window) {
  const idx = book.indexOfDate(symbol, at);
  const b = book.bars(symbol);
  if (idx <= 0) return {};
  const start = b[Math.max(0, idx - window)].date;
  return { from: start, to: b[idx].date };
}

export default PriceBook;