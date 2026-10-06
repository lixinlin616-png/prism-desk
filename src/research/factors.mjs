/**
 * Measured factor exposures.
 *
 * The macro-transmission channel has to answer "who is most exposed?" - and the
 * honest answer is measured, not asserted. Every exposure below is an OLS beta
 * estimated from the real bundled daily OHLCV dataset over a trailing window.
 *
 *   rateBeta    - beta vs TLT.  A HIGH positive rateBeta means the name trades
 *                 bond-like / defensive: it rallies when bonds rally. Those are
 *                 the names a hawkish shock (TLT down) hurts most.
 *   mktBeta     - beta vs SPY.
 *   growthBeta  - beta vs QQQ. Long-dated-cash-flow (duration) proxy.
 *   semiBeta    - beta vs SMH (AI-capex complex).
 *   energyBeta  - beta vs XLE (inflation / commodity hedge).
 *   smallBeta   - beta vs IWM (domestic-demand & credit sensitivity).
 *   residualVol - idiosyncratic vol after removing the market factor.
 */

import { mean, stdev } from '../util/stats.mjs';

export const FACTOR_PROXIES = {
  rateBeta: 'TLT',
  mktBeta: 'SPY',
  growthBeta: 'QQQ',
  semiBeta: 'SMH',
  energyBeta: 'XLE',
  smallBeta: 'IWM',
};

export const FACTOR_IDS = Object.keys(FACTOR_PROXIES);

function olsBeta(pairs) {
  if (pairs.length < 40) return null;
  const X = pairs.map((p) => p[0]);
  const Y = pairs.map((p) => p[1]);
  const mx = mean(X);
  const my = mean(Y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < X.length; i += 1) {
    const dx = X[i] - mx;
    num += dx * (Y[i] - my);
    den += dx * dx;
  }
  return den === 0 ? null : num / den;
}

function residualVol(pairs, beta) {
  if (beta === null || pairs.length < 40) return null;
  const X = pairs.map((p) => p[0]);
  const Y = pairs.map((p) => p[1]);
  const mx = mean(X);
  const my = mean(Y);
  const alpha = my - beta * mx;
  const resid = X.map((x, i) => Y[i] - (alpha + beta * x));
  const sd = stdev(resid);
  // pairs are already expressed in percent, so only the sqrt(252) annualisation applies.
  return Number.isFinite(sd) ? sd * Math.sqrt(252) : null;
}

/** Align two return series on common dates. */
function align(aRets, bRets) {
  const map = new Map(aRets.map((r) => [r.date, r.pct]));
  const out = [];
  for (const r of bRets) {
    const x = map.get(r.date);
    if (Number.isFinite(x) && Number.isFinite(r.pct)) out.push([x, r.pct]);
  }
  return out;
}

/**
 * Compute the full exposure vector for one symbol.
 * @param {import('../ingest/prices.mjs').PriceBook} book
 */
export function exposures(book, symbol, { window = 252, at = null } = {}) {
  const bars = book.bars(symbol);
  if (!bars.length) return null;
  const endIdx = at ? book.indexOfDate(symbol, at) + 1 : bars.length;
  const startIdx = Math.max(1, endIdx - window);
  const slice = bars.slice(startIdx, endIdx);
  const rets = [];
  for (let i = 1; i < slice.length; i += 1) {
    if (slice[i - 1].close) rets.push({ date: slice[i].date, pct: ((slice[i].close - slice[i - 1].close) / slice[i - 1].close) * 100 });
  }
  if (rets.length < 40) return null;

  const out = { symbol, asOf: slice[slice.length - 1].date, window, observations: rets.length };
  for (const [factor, proxy] of Object.entries(FACTOR_PROXIES)) {
    if (proxy === symbol) { out[factor] = 1; continue; }
    const pBars = book.bars(proxy);
    if (!pBars.length) { out[factor] = null; continue; }
    const pEnd = at ? book.indexOfDate(proxy, at) + 1 : pBars.length;
    const pSlice = pBars.slice(Math.max(1, pEnd - window - 1), pEnd);
    const pRets = [];
    for (let i = 1; i < pSlice.length; i += 1) {
      if (pSlice[i - 1].close) pRets.push({ date: pSlice[i].date, pct: ((pSlice[i].close - pSlice[i - 1].close) / pSlice[i - 1].close) * 100 });
    }
    const pairs = align(pRets, rets);
    const beta = olsBeta(pairs);
    out[factor] = beta === null ? null : Number(beta.toFixed(3));
    if (factor === 'mktBeta') {
      const rv = residualVol(pairs, beta);
      out.residualVol = rv === null ? null : Number(rv.toFixed(2));
    }
  }
  return out;
}

/** Exposure table for a whole universe, with nulls dropped. */
export function exposureTable(book, symbols, opts = {}) {
  const rows = [];
  for (const s of symbols) {
    const e = exposures(book, s, opts);
    if (e) rows.push(e);
  }
  return rows;
}

/** Rank a universe by one measured exposure. Returns [{symbol, value, rank}]. */
export function rankBy(book, symbols, factor, { descending = true, window = 252, at = null } = {}) {
  const table = exposureTable(book, symbols, { window, at });
  const vals = table
    .map((r) => ({ symbol: r.symbol, value: r[factor] }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
  return vals.map((v, i) => ({ ...v, rank: i + 1, factor }));
}

/**
 * Map a TRANSMISSION betaTag onto a measured exposure factor.
 * `duration` and `rateBeta` are both genuine interest-rate sensitivities; the
 * others fall back to the closest measurable proxy.
 */
export const BETA_TAG_MAP = {
  duration: 'growthBeta',
  rateBeta: 'rateBeta',
  leverage: 'smallBeta',
  cyclical: 'mktBeta',
  energyWeight: 'energyBeta',
  cashRich: 'rateBeta',
  growth: 'growthBeta',
};

export function factorForTag(tag) {
  return BETA_TAG_MAP[tag] || 'mktBeta';
}