/** Numeric parsing / formatting helpers. Handles the messy formats real feeds emit. */

const STRIP = /[$,\s%\u00a0]|USD/gi;

/** Parse "1,234.56", "$12.3", "12.3%", "-4.5" -> number | null */
export function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).replace(STRIP, '');
  if (!s || s === '-' || s === 'N/A' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse a percent-ish value. "12.5%" -> 12.5 ; 0.125 with {fraction:true} -> 12.5 */
export function toPct(v, opts = {}) {
  const n = toNum(v);
  if (n === null) return null;
  return opts.fraction ? n * 100 : n;
}

export function round(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function fmtNum(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPct(n, dp = 2, signed = true) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const s = n > 0 && signed ? '+' : '';
  return `${s}${n.toFixed(dp)}%`;
}

export function fmtUsd(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return `$${fmtNum(n, dp)}`;
}

export function fmtCompact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function pctChange(from, to) {
  const a = toNum(from);
  const b = toNum(to);
  if (a === null || b === null || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function zScore(x, mean, sd) {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !sd) return 0;
  return (x - mean) / sd;
}