/** Small, dependency-free statistics kit used by the scoring rubric and the research studies. */

export function mean(xs) {
  const v = xs.filter((n) => Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

export function sum(xs) {
  return xs.filter((n) => Number.isFinite(n)).reduce((a, b) => a + b, 0);
}

export function variance(xs, sample = true) {
  const v = xs.filter((n) => Number.isFinite(n));
  if (v.length < 2) return NaN;
  const m = mean(v);
  const ss = v.reduce((a, b) => a + (b - m) ** 2, 0);
  return ss / (v.length - (sample ? 1 : 0));
}

export function stdev(xs, sample = true) {
  const v = variance(xs, sample);
  return Number.isFinite(v) ? Math.sqrt(v) : NaN;
}

export function quantile(xs, q) {
  const v = xs.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function median(xs) {
  return quantile(xs, 0.5);
}

export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

function ranks(xs) {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k].i] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation - the metric used to validate transmission-chain ordering. */
export function spearman(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}

/** Two-sided p-value for a correlation, via t-distribution approximation. */
export function corrPValue(r, n) {
  if (!Number.isFinite(r) || n < 4) return NaN;
  const rc = Math.min(0.999999, Math.abs(r));
  const t = rc * Math.sqrt((n - 2) / (1 - rc * rc));
  return 2 * (1 - studentTCdf(Math.abs(t), n - 2));
}

/** Regularised incomplete beta via continued fraction (Lentz) - enough for p-values. */
function betacf(a, b, x) {
  const MAXIT = 200;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function lnGamma(x) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function ibeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function studentTCdf(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * ibeta(df / 2, 0.5, x);
}

export function hitRate(pairs) {
  const ok = pairs.filter((p) => Number.isFinite(p.predicted) && Number.isFinite(p.actual));
  if (!ok.length) return { n: 0, rate: NaN };
  const hits = ok.filter((p) => Math.sign(p.predicted) === Math.sign(p.actual) && p.predicted !== 0).length;
  return { n: ok.length, rate: (hits / ok.length) * 100, hits };
}

export function sharpe(returns, periodsPerYear = 252) {
  const v = returns.filter((n) => Number.isFinite(n));
  if (v.length < 3) return NaN;
  const sd = stdev(v);
  if (!sd) return NaN;
  return (mean(v) / sd) * Math.sqrt(periodsPerYear);
}

export function maxDrawdown(equity) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of equity) {
    if (!Number.isFinite(v)) continue;
    peak = Math.max(peak, v);
    if (peak > 0) mdd = Math.min(mdd, (v - peak) / peak);
  }
  return mdd * 100;
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Returns the [low, high] bounds as fractions in [0, 1].
 *
 * Why Wilson and not the Wald interval p ± z sqrt(p(1-p)/n): the Wald interval
 * assumes a symmetric normal approximation and is known to undercover badly for
 * small n or proportions away from 0.5 - exactly the regime a small event study
 * lives in. The Wilson interval inverts the score test instead, stays within
 * [0, 1], and keeps close to nominal coverage even at the sample sizes here. It
 * is the standard recommended interval for binomial proportions (Brown, Cai &
 * DasGupta, 2001).
 *
 * @param {number} k successes
 * @param {number} n trials
 * @param {number} [z=1.959964] critical value (default ~95%)
 * @returns {[number, number]}
 */
export function wilsonCi(k, n, z = 1.959964) {
  if (!(n > 0)) return [NaN, NaN];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n)))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Invert the regularized incomplete beta (the beta CDF) by bisection. */
function betaQuantile(p, a, b) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (ibeta(a, b, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Exact Clopper-Pearson interval for a binomial proportion, in fractions.
 *
 * Conservative (it guarantees at least (1-alpha) coverage) and wider than
 * Wilson. Kept alongside wilsonCi so a report can show both and a reader can see
 * the headline does not hinge on one interval choice.
 */
export function clopperPearsonCi(k, n, alpha = 0.05) {
  if (!(n > 0)) return [NaN, NaN];
  const lo = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const hi = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return [lo, hi];
}