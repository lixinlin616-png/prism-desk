/**
 * Post-hoc adjudication - the half of the loop that turns the board into evidence.
 *
 * Every card Prism publishes is a falsifiable claim with an `invalidation`
 * condition, an observable `level`, a `recheckAt` time and (usually) a
 * `tradeSketch` carrying a stop and a target. While the card is active those
 * fields are a promise. Once the window closes they become a *test*, and that
 * test can be scored against the real price book.
 *
 * This module runs the test. For each card it answers three separate questions
 * and refuses to collapse them into one:
 *
 *   1. FALSIFICATION - did the price close through the level the card itself
 *                      named as "this is where I am wrong"?
 *   2. RISK PATH     - was the tradeSketch stop or target touched en route?
 *   3. REALISED      - signed, benchmark-excess return over the card's window.
 *
 * The verdict comes from (1) when it fired, otherwise from (3), with a
 * materiality band so an uneventful window is reported `inconclusive` rather
 * than being forced into a win/loss column. (2) is always reported and never
 * decides anything: "would this trade have hurt" is not "was the claim right",
 * and merging the two is how a stopped-out-but-correct call becomes a fake loss.
 *
 * Design rules, each of which exists because the flattering alternative was
 * available and would have been easier to ship:
 *
 *   - Benchmark-excess, never raw. Equities drift up; a long card that made
 *     money in a rising tape proved nothing.
 *   - If one daily bar touches both the stop and the target, OHLC cannot say
 *     which came first. We assume the STOP (`pessimisticTieBreak`).
 *   - A card whose name has no price series is `unmeasurable`, not a win and
 *     not a loss. Fictional demo issuers are measured through the price proxy
 *     they explicitly declare, and the substitution is recorded on the row.
 *   - Neutral / hedge cards assert no direction, so they are excluded from the
 *     hit-rate denominator rather than counted as half a win.
 *   - Small samples are labelled small. Nothing here is a backtest of
 *     profitability; see docs/reports/review.md.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { round } from '../util/num.mjs';
import { toDateStr, parseDate } from '../util/time.mjs';
import { mean, median, stdev, spearman } from '../util/stats.mjs';
import { diffDays } from '../util/time.mjs';

const log = logger('review');

/** Mirrors the grade bands in src/score/rubric.mjs. */
export const GRADE_BANDS = [
  { grade: 'A', min: 75, max: Infinity },
  { grade: 'B', min: 62, max: 75 },
  { grade: 'C', min: 48, max: 62 },
  { grade: 'D', min: 35, max: 48 },
  { grade: 'F', min: -Infinity, max: 35 },
];

/**
 * How a card's `direction` maps onto a signed payoff.
 *
 * `avoid` is a negative stance - the desk told you not to own it, so the call
 * was right if the name underperformed. `pair` is handled separately because
 * its payoff is a spread, not a level. `neutral` and `hedge` assert no
 * direction and are therefore not scored.
 */
const DIRECTION_SIGN = { long: 1, short: -1, avoid: -1 };
const NON_DIRECTIONAL = new Set(['neutral', 'hedge']);

export function gradeOf(score) {
  // Number(null) is 0, which would silently grade an unscored card as F. An
  // unscored card is unknown, not failing.
  if (score === null || score === undefined || score === '') return null;
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  const band = GRADE_BANDS.find((b) => s >= b.min && s < b.max);
  return band ? band.grade : null;
}

/** ticker -> declared price proxy, from the corpus documents that describe it. */
export function buildProxyIndex(corpus) {
  const idx = new Map();
  if (!corpus || typeof corpus.all !== 'function') return idx;
  for (const doc of corpus.all()) {
    const proxy = doc?.meta?.priceProxy;
    if (!proxy) continue;
    for (const t of doc.tickers || []) {
      const key = String(t).toUpperCase();
      if (!idx.has(key)) idx.set(key, String(proxy).toUpperCase());
    }
  }
  return idx;
}

/**
 * Resolve a ticker to something the price book can actually measure.
 * Returns null when there is no series at all (e.g. BTC/ETH in an equity book).
 */
export function resolveSymbol(ticker, { book, proxies }) {
  const t = String(ticker || '').toUpperCase();
  if (!t) return null;
  if (book.has(t)) return { symbol: t, viaProxy: false, requested: t };
  const proxy = proxies.get(t);
  if (proxy && book.has(proxy)) return { symbol: proxy, viaProxy: true, requested: t };
  return null;
}

/**
 * Decide what instrument the card is actually a claim about.
 *
 *   pair    - tradeSketch.pair gives an explicit long/short spread
 *   single  - exactly one measurable name
 *   basket  - several measurable names, equal weighted, all carrying the card's direction
 *   none    - nothing measurable; reported unmeasurable rather than guessed at
 */
export function resolveInstrument(card, ctx) {
  const pair = card?.tradeSketch?.pair;
  if (pair && (pair.long || pair.short)) {
    const long = pair.long ? resolveSymbol(pair.long, ctx) : null;
    const short = pair.short ? resolveSymbol(pair.short, ctx) : null;
    if (long && short) {
      return {
        kind: 'pair',
        legs: [{ ...long, sign: 1, weight: 0.5 }, { ...short, sign: -1, weight: 0.5 }],
        note: `dollar-neutral pair ${long.symbol} / ${short.symbol}`,
      };
    }
    return {
      kind: 'none',
      legs: [],
      note: `pair is only half measurable (${pair.long} / ${pair.short}) - refusing to score one leg of a spread`,
    };
  }

  const resolved = [];
  const unresolved = [];
  for (const t of card?.tickers || []) {
    const r = resolveSymbol(t, ctx);
    if (r) resolved.push(r);
    else unresolved.push(String(t).toUpperCase());
  }
  if (!resolved.length) {
    return {
      kind: 'none',
      legs: [],
      note: unresolved.length
        ? `no price series for ${unresolved.join(', ')} in the bundled book`
        : 'card names no ticker',
    };
  }
  const sign = DIRECTION_SIGN[card.direction] ?? 1;
  const weight = round(1 / resolved.length, 6);
  const legs = resolved.map((r) => ({ ...r, sign, weight }));
  // Say what was dropped, even when only one name survives. A card that names
  // two tickers and gets measured on one is not the same claim, and the report
  // has to show that.
  const exclusions = unresolved.length ? `, ${unresolved.length} unmeasurable (${unresolved.join(', ')}) excluded` : '';
  const note = resolved.length === 1
    ? `${resolved[0].symbol}${resolved[0].viaProxy ? ` (declared proxy for ${resolved[0].requested})` : ''}${exclusions}`
    : `equal-weighted basket of ${resolved.length} measurable names${exclusions}`;
  return { kind: resolved.length === 1 ? 'single' : 'basket', legs, note };
}

/**
 * The measurement window: the last close at or before the card was ISSUED,
 * through the last close at or before it expired.
 *
 * Anchoring on issuance rather than on `informationAt` is not a style choice.
 * Every level the card carries - entry zone, stop, target, and the numeric
 * invalidation level - is struck off the price at `createdAt`. Measuring from
 * the information date instead puts the card's own reference price outside its
 * measurement window, which is exactly how a card ends up "invalidated" against
 * a level it was never struck at. `informationAt` still matters: it is what
 * freshness decays against, and it is reported alongside.
 *
 * Anchoring on the close (rather than the next open) also puts any post-print
 * gap INSIDE the measured move - the harsher choice, and the right one for an
 * out-of-hours release, since it credits the desk with nothing it could not
 * actually have traded.
 */
export function measurementWindow(book, symbol, card) {
  const infoRaw = card.createdAt || card.informationAt;
  const endRaw = card.expiresAt || card.invalidation?.recheckAt;
  if (!infoRaw || !endRaw) return { ok: false, reason: 'card has neither informationAt nor expiresAt' };
  const fromDate = toDateStr(infoRaw);
  const toDate = toDateStr(endRaw);
  const bars = book.bars(symbol);
  if (!bars.length) return { ok: false, reason: `no bars for ${symbol}` };
  const refIdx = book.indexOfDate(symbol, fromDate);
  if (refIdx === -1) return { ok: false, reason: `${symbol} has no bar on or before ${fromDate}` };
  const endIdx = book.indexOfDate(symbol, toDate);
  if (endIdx <= refIdx) return { ok: false, reason: `no forward sessions between ${bars[refIdx].date} and ${toDate}` };
  const lastBar = bars[bars.length - 1];
  // Compare calendar dates, not instants. An expiry later in the same UTC day
  // as the final bar is still fully covered by that bar; treating it as
  // truncated would mislabel almost every card, since expiries carry a time.
  const truncated = toDateStr(endRaw) > lastBar.date;
  const finalIdx = truncated ? bars.length - 1 : endIdx;
  return {
    ok: true,
    refIdx,
    endIdx: finalIdx,
    refDate: bars[refIdx].date,
    endDate: bars[finalIdx].date,
    sessions: finalIdx - refIdx,
    truncated,
  };
}

/**
 * Did the card's OWN falsification condition fire?
 *
 * `invalidation.level` is the level the card itself named as "this is where I am
 * wrong". Where it is numeric it can be tested directly - and it is tested on
 * CLOSES, not on intraday touches, because the conditions the desk writes are
 * close-based ("gives back the gap and CLOSES BELOW the prior close", "RECLAIMS
 * the pre-print close and HOLDS").
 *
 * Where the level is prose ("tone sign flip on >= 2 documents", "F&G in
 * [35,65]") it is not machine-readable and this returns null. That is recorded
 * honestly rather than approximated.
 */
export function walkInvalidation(book, symbol, win, { level, sign, recheckAt = null, fallbackSessions = null }) {
  if (!Number.isFinite(level)) {
    return {
      triggered: null,
      detail: typeof level === 'string' && level
        ? `invalidation level is prose ("${level}") - not machine-testable at daily resolution`
        : 'card states no numeric invalidation level',
    };
  }
  const bars = book.bars(symbol);

  /**
   * The conditions the desk writes are time-boxed and require the breach to
   * persist - "RECLAIMS the pre-print close WITHIN TWO SESSIONS AND HOLDS".
   * Testing "did any close ever cross the level, at any point up to expiry"
   * would fire on almost every card and is not what the card claimed. So the
   * test window ends at `recheckAt`, and a crossing only counts if the price is
   * STILL beyond the level at that recheck point.
   */
  const fallback = Number.isFinite(fallbackSessions) ? fallbackSessions : config.review.invalidationFallbackSessions;
  let checkIdx = -1;
  if (recheckAt) {
    const d = parseDate(recheckAt);
    if (!Number.isNaN(d.getTime())) checkIdx = book.indexOfDate(symbol, toDateStr(recheckAt));
  }
  // A recheck time that lands on a weekend or before the first forward session
  // gives no testable window at all; fall back to a fixed short horizon.
  if (checkIdx <= win.refIdx) checkIdx = Math.min(win.refIdx + fallback, win.endIdx);
  if (checkIdx <= win.refIdx) {
    return { triggered: null, detail: `invalidation recheck point leaves no testable session before ${win.endDate}` };
  }

  let crossedAt = null;
  for (let i = win.refIdx + 1; i <= checkIdx; i += 1) {
    const b = bars[i];
    if (!b || !Number.isFinite(b.close)) continue;
    if (sign > 0 ? b.close <= level : b.close >= level) { crossedAt = b.date; break; }
  }
  if (!crossedAt) {
    return { triggered: false, detail: `no close crossed the stated invalidation level ${level} by the recheck date ${bars[checkIdx].date}` };
  }
  const atCheck = bars[checkIdx];
  const stillBeyond = sign > 0 ? atCheck.close <= level : atCheck.close >= level;
  if (!stillBeyond) {
    return {
      triggered: false,
      detail: `close crossed ${level} on ${crossedAt} but had recovered to ${atCheck.close} by the recheck date ${atCheck.date} - the card requires the breach to HOLD, so it did not fire`,
    };
  }
  return { triggered: true, at: crossedAt, detail: `close ${atCheck.close} was beyond the stated invalidation level ${level} at the recheck date ${atCheck.date} (first crossed ${crossedAt})` };
}

/**
 * Walk the path against the card's RISK levels (tradeSketch stop / target).
 *
 * This answers a different question from `walkInvalidation`: not "was the thesis
 * wrong" but "would the trade as sketched have been hurt". Returns the FIRST
 * touch, because that is what a resting order would have experienced. The two
 * are reported side by side and deliberately never merged - conflating them is
 * how a card that was stopped out and then proved right gets recorded as a loss.
 */
export function walkRiskLevels(book, symbol, win, { stop, target, sign }) {
  const hasStop = Number.isFinite(stop);
  const hasTarget = Number.isFinite(target);
  if (!hasStop && !hasTarget) return { touch: 'n/a', detail: 'card carries no numeric stop/target' };
  const bars = book.bars(symbol);
  let stopAt = null;
  let targetAt = null;
  for (let i = win.refIdx + 1; i <= win.endIdx; i += 1) {
    const b = bars[i];
    if (!b) continue;
    const stopHit = hasStop && (sign > 0 ? b.low <= stop : b.high >= stop);
    const targetHit = hasTarget && (sign > 0 ? b.high >= target : b.low <= target);
    if (stopHit && !stopAt) stopAt = b.date;
    if (targetHit && !targetAt) targetAt = b.date;
    if (stopAt || targetAt) break;
  }
  if (stopAt && targetAt) {
    if (stopAt === targetAt) {
      return config.review.pessimisticTieBreak
        ? { touch: 'stop', detail: `one bar (${stopAt}) touched both levels; assumed the STOP (pessimistic tie-break)`, ambiguous: true }
        : { touch: 'ambiguous', detail: `one bar (${stopAt}) touched both levels`, ambiguous: true };
    }
    return { touch: stopAt < targetAt ? 'stop' : 'target', detail: `stop ${stopAt} before target ${targetAt}` };
  }
  if (stopAt) return { touch: 'stop', detail: `stop touched ${stopAt}` };
  if (targetAt) return { touch: 'target', detail: `target touched ${targetAt}` };
  return { touch: 'neither', detail: `neither risk level touched in ${win.sessions} sessions` };
}

/** Benchmark-excess close-to-close return over an explicit date pair. */
function excessOver(book, benchmark, symbol, fromDate, toDate) {
  const p0 = book.closeOn(symbol, fromDate);
  const p1 = book.closeOn(symbol, toDate);
  if (!p0 || p1 === null || p1 === undefined) return null;
  const own = ((p1 - p0) / p0) * 100;
  if (!benchmark || !book.has(benchmark)) return { pct: round(own, 3), rawPct: round(own, 3), benchmarkPct: null, adjusted: false };
  const b0 = book.closeOn(benchmark, fromDate);
  const b1 = book.closeOn(benchmark, toDate);
  if (!b0 || b1 === null || b1 === undefined) return { pct: round(own, 3), rawPct: round(own, 3), benchmarkPct: null, adjusted: false };
  const bench = ((b1 - b0) / b0) * 100;
  return { pct: round(own - bench, 3), rawPct: round(own, 3), benchmarkPct: round(bench, 3), adjusted: true };
}

/**
 * Adjudicate one card. Never throws: an unmeasurable card is a legitimate
 * result and must be reported as such rather than quietly dropped.
 */
export function adjudicateCard(card, ctx) {
  const row = adjudicate(card, ctx);
  // Tag every row, including the early-return ones, so a caller can group by
  // claim without having to remember to run dedupeClaims first.
  row.claimKey = claimKey(row);
  return row;
}

function adjudicate(card, ctx) {
  const { book } = ctx;
  const benchmark = ctx.benchmark;
  const materialityPct = ctx.materialityPct;

  const row = {
    id: card.id,
    channel: card.channel,
    title: card.title || card.claim?.slice(0, 80) || '(untitled)',
    direction: card.direction,
    horizon: card.horizon,
    status: card.status,
    score: card.score?.total ?? null,
    grade: card.score?.grade ?? gradeOf(card.score?.total),
    published: Boolean(card.score?.publishable),
    informationAt: card.informationAt || card.createdAt || null,
    issuedAt: card.createdAt || null,
    expiresAt: card.expiresAt || null,
    invalidationLevel: card.invalidation?.level ?? null,
    tickers: [...(card.tickers || [])],
    outcome: 'unmeasurable',
    riskTouch: 'n/a',
    invalidationTriggered: null,
    excessVerdict: 'n/a',
    signedExcessPct: null,
    basis: '',
  };

  const inst = resolveInstrument(card, ctx);
  row.instrument = inst.kind;
  row.instrumentNote = inst.note;
  row.symbols = inst.legs.map((l) => l.symbol);
  row.viaProxy = inst.legs.some((l) => l.viaProxy);

  if (inst.kind === 'none') { row.basis = inst.note; return row; }
  if (NON_DIRECTIONAL.has(card.direction)) {
    row.outcome = 'not-directional';
    row.basis = `direction "${card.direction}" asserts no payoff, so there is nothing to score`;
    return row;
  }

  const win = measurementWindow(book, inst.legs[0].symbol, card);
  if (!win.ok) { row.basis = win.reason; return row; }
  row.window = { from: win.refDate, to: win.endDate, sessions: win.sessions, truncated: win.truncated };

  // Signed benchmark-excess payoff across every leg. For a pair the benchmark
  // cancels by construction, so pair legs are measured in raw terms.
  const perLeg = [];
  for (const leg of inst.legs) {
    const w = measurementWindow(book, leg.symbol, card);
    if (!w.ok) continue;
    const ex = excessOver(book, inst.kind === 'pair' ? null : benchmark, leg.symbol, w.refDate, w.endDate);
    if (!ex) continue;
    perLeg.push({ ...leg, excessPct: ex.pct, rawPct: ex.rawPct, signedPct: round(ex.pct * leg.sign * leg.weight, 4) });
  }
  if (!perLeg.length) {
    row.basis = 'no leg produced a usable close-to-close return';
    return row;
  }
  row.legs = perLeg;
  row.signedExcessPct = round(perLeg.reduce((a, l) => a + l.signedPct, 0), 3);
  row.benchmarkAdjusted = inst.kind === 'pair' ? false : perLeg.some((l) => Number.isFinite(l.excessPct) && l.excessPct !== l.rawPct);

  const ts = card.tradeSketch || {};
  const primarySign = perLeg[0].sign;
  const single = inst.kind === 'single';

  // --- axis 1: the card's OWN falsification condition --------------------
  // Authoritative when it is machine-testable, because it is the level the
  // card named as "this is where I am wrong".
  const inv = single
    ? walkInvalidation(book, inst.legs[0].symbol, win, {
      level: typeof card.invalidation?.level === 'number' ? card.invalidation.level : NaN,
      sign: primarySign,
      recheckAt: card.invalidation?.recheckAt ?? null,
    })
    : { triggered: null, detail: `${inst.kind} cards state their invalidation in prose, not as a single-name level` };
  row.invalidationTriggered = inv.triggered;
  row.invalidationDetail = inv.detail;

  // --- axis 2: the RISK path (stop / target actually touched) ------------
  // Reported, never used as the verdict: "would this trade have hurt" is not
  // the same question as "was the claim right".
  const risk = single
    ? walkRiskLevels(book, inst.legs[0].symbol, win, { stop: ts.stop ?? NaN, target: ts.target ?? NaN, sign: primarySign })
    : { touch: 'n/a', detail: `${inst.kind} cards carry no single-name stop/target` };
  row.riskTouch = risk.touch;
  row.riskDetail = risk.detail;
  row.riskAmbiguous = Boolean(risk.ambiguous);

  // --- axis 3: realised signed benchmark-excess --------------------------
  const x = row.signedExcessPct;
  row.excessVerdict = x >= materialityPct ? 'confirmed' : x <= -materialityPct ? 'refuted' : 'immaterial';
  row.excessDetail = `signed benchmark-excess ${x}% over ${win.sessions} sessions (materiality +/-${materialityPct}%)`;

  // --- verdict -----------------------------------------------------------
  // The card's own falsification condition wins when it fired. Otherwise the
  // realised excess decides, and a window that closed inside the materiality
  // band is reported inconclusive rather than forced into a column.
  if (inv.triggered === true) row.outcome = 'invalidated';
  else if (row.excessVerdict === 'confirmed') row.outcome = 'realized';
  else if (row.excessVerdict === 'refuted') row.outcome = 'invalidated';
  else row.outcome = 'inconclusive';

  const parts = [];
  parts.push(`falsification: ${inv.detail}`);
  parts.push(row.excessDetail);
  if (risk.touch !== 'n/a') parts.push(`risk path: ${risk.detail}`);
  parts.push(`instrument: ${inst.note}`);
  if (win.truncated) parts.push(`window truncated - card expires after the last bar in the price book (${win.endDate})`);
  if (row.viaProxy) parts.push('measured through a declared demo price proxy, not a listed price for this issuer');
  row.basis = parts.join(' | ');
  return row;
}

/** Win / loss / inconclusive tallies over a set of rows. */
export function summariseRows(rows) {
  const scored = rows.filter((r) => r.outcome === 'realized' || r.outcome === 'invalidated' || r.outcome === 'inconclusive');
  const decided = scored.filter((r) => r.outcome !== 'inconclusive');
  const hits = decided.filter((r) => r.outcome === 'realized');
  const excess = scored.map((r) => r.signedExcessPct).filter((v) => Number.isFinite(v));
  const n = decided.length;
  return {
    rows: rows.length,
    scored: scored.length,
    decided: n,
    hits: hits.length,
    misses: n - hits.length,
    inconclusive: scored.length - n,
    unmeasurable: rows.filter((r) => r.outcome === 'unmeasurable').length,
    notDirectional: rows.filter((r) => r.outcome === 'not-directional').length,
    stoppedOut: rows.filter((r) => r.riskTouch === 'stop').length,
    targetTouched: rows.filter((r) => r.riskTouch === 'target').length,
    ambiguousTieBreaks: rows.filter((r) => r.riskAmbiguous).length,
    invalidationFired: rows.filter((r) => r.invalidationTriggered === true).length,
    invalidationUntestable: rows.filter((r) => r.invalidationTriggered === null && r.outcome !== 'unmeasurable' && r.outcome !== 'not-directional').length,
    viaProxy: rows.filter((r) => r.viaProxy).length,
    hitPct: n ? round((hits.length / n) * 100, 1) : null,
    meanSignedExcessPct: excess.length ? round(mean(excess), 3) : null,
    medianSignedExcessPct: excess.length ? round(median(excess), 3) : null,
    sdSignedExcessPct: excess.length > 1 ? round(stdev(excess), 3) : null,
    /**
     * A normal-approximation 95% interval on the hit rate. At the sample sizes a
     * demo board produces, this interval is usually wider than the effect it is
     * trying to measure - which is exactly why it is printed.
     */
    hitPctCi95: n >= 5 ? (() => {
      const p = hits.length / n;
      const se = Math.sqrt((p * (1 - p)) / n);
      return [round(Math.max(0, p - 1.96 * se) * 100, 1), round(Math.min(1, p + 1.96 * se) * 100, 1)];
    })() : null,
  };
}

/**
 * Identity of a *test*, not of a card.
 *
 * The board re-issues the same claim every time the desk is run, so 140 stored
 * cards can be as few as a dozen distinct claims. Counting each restatement as
 * an independent observation would produce a hit rate with three significant
 * figures and no meaning at all. Two cards are the same test when they make the
 * same claim about the same names in the same direction over the same window.
 */
export function claimKey(row) {
  // A window that had to be TRUNCATED at the end of the price book is a
  // different test from one that ran to its stated expiry, even when both end on
  // the same date. Collapsing them would let a still-open card inherit a verdict
  // measured over a shorter window than it claimed.
  const window = row.window ? `${row.window.from}->${row.window.to}${row.window.truncated ? '(truncated)' : ''}` : 'no-window';
  const info = row.informationAt ? toDateStr(row.informationAt) : 'no-info';
  return [row.channel, [...(row.tickers || [])].sort().join(','), row.direction, info, window].join('::');
}

/**
 * Collapse restatements down to one representative per distinct test.
 * The highest-scoring restatement is kept (it is the desk's strongest version
 * of the claim) and the number collapsed into it is recorded, so nothing is
 * silently thrown away.
 */
export function dedupeClaims(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = claimKey(r);
    r.claimKey = k;
    const prev = map.get(k);
    if (!prev) { map.set(k, { ...r, restatements: 1 }); continue; }
    prev.restatements += 1;
    if ((r.score ?? -Infinity) > (prev.score ?? -Infinity)) {
      const n = prev.restatements;
      map.set(k, { ...r, claimKey: k, restatements: n });
    }
  }
  return [...map.values()];
}

function groupBy(rows, keyFn) {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

/**
 * Does the rubric's score actually predict the outcome?
 *
 * This is the only place in Prism that can answer that question, and it is the
 * mechanism by which the desk gets improved rather than merely defended.
 */
export function calibrate(rows) {
  const measurable = rows.filter(
    (r) => Number.isFinite(r.signedExcessPct) && r.outcome !== 'unmeasurable' && r.outcome !== 'not-directional',
  );

  const byGrade = {};
  for (const b of GRADE_BANDS) {
    const sub = measurable.filter((r) => r.grade === b.grade);
    const band = b.max === Infinity ? `>=${b.min}` : b.min === -Infinity ? `<${b.max}` : `${b.min}-${b.max}`;
    byGrade[b.grade] = { band, ...summariseRows(sub) };
  }

  const byChannel = {};
  for (const [ch, sub] of groupBy(rows, (r) => r.channel)) byChannel[ch] = summariseRows(sub);

  const byDirection = {};
  for (const [d, sub] of groupBy(rows, (r) => r.direction)) byDirection[d] = summariseRows(sub);

  // Published vs held back. The publish floor is a policy choice; this is the
  // only place its cost is ever measured.
  const published = summariseRows(measurable.filter((r) => r.published));
  const withheld = summariseRows(measurable.filter((r) => !r.published));

  const pts = measurable.filter((r) => Number.isFinite(r.score)).map((r) => [r.score, r.signedExcessPct]);
  const rho = pts.length >= 5 ? spearman(pts.map((p) => p[0]), pts.map((p) => p[1])) : null;

  /** Cards sharing an information date move together; count clusters, not just rows. */
  const clusters = new Set(measurable.map((r) => (r.informationAt ? toDateStr(r.informationAt) : null)).filter(Boolean));

  return {
    n: measurable.length,
    clusters: clusters.size,
    scoreVsOutcomeRho: Number.isFinite(rho) ? round(rho, 3) : null,
    byGrade,
    byChannel,
    byDirection,
    published,
    withheld,
  };
}

/**
 * Turn calibration numbers into written findings.
 *
 * Every lesson must cite the number that produced it. A lesson that cannot
 * point at a measurement is an opinion, and opinions are what the rest of this
 * codebase exists to discipline.
 */
export function deriveLessons(rows, summary, calibration, opts = {}) {
  const lessons = [];
  const floor = opts.minScoreToPublish ?? config.scoring.minScoreToPublish;
  const materiality = opts.materialityPct ?? config.review.materialityPct;

  if (calibration.n < 10) {
    lessons.push({
      id: 'sample-too-small',
      severity: 'blocker',
      finding: `Only ${calibration.n} cards are measurable across ${calibration.clusters} distinct information dates. Nothing below is a statistically meaningful result.`,
      evidence: `measurable=${calibration.n}, clusters=${calibration.clusters}`,
      action: 'Accumulate board history over more sessions, or replay the desk across more as-of dates, before acting on any calibration number.',
    });
  }

  if (Number.isFinite(calibration.scoreVsOutcomeRho)) {
    const rho = calibration.scoreVsOutcomeRho;
    const dir = rho > 0.1
      ? 'higher scores did realise better signed excess returns'
      : rho < -0.1
        ? 'higher scores realised WORSE signed excess returns - the rubric is miscalibrated in sign'
        : 'score carries no monotone relationship with realised outcome';
    lessons.push({
      id: 'score-predictiveness',
      severity: rho < -0.1 ? 'blocker' : Math.abs(rho) <= 0.1 ? 'warning' : 'ok',
      finding: `Spearman rho between card score and signed benchmark-excess return is ${rho} (n=${calibration.n}): ${dir}.`,
      evidence: `rho=${rho}, n=${calibration.n}`,
      action: Math.abs(rho) <= 0.1
        ? 'Re-examine the factor weights in src/score/rubric.mjs; a ranking that does not rank is decoration.'
        : rho < 0
          ? 'Find and repair the offending factor before publishing anything on this rubric.'
          : 'Keep the weights and re-measure as the sample grows.',
    });
  }

  const pub = calibration.published;
  const wit = calibration.withheld;
  if (pub.decided >= 3 && wit.decided >= 3) {
    const delta = round(pub.hitPct - wit.hitPct, 1);
    lessons.push({
      id: 'publish-floor',
      severity: delta < 0 ? 'blocker' : delta < 5 ? 'warning' : 'ok',
      finding: `Cards above the publish floor (${floor}) hit ${pub.hitPct}% (n=${pub.decided}); cards held back hit ${wit.hitPct}% (n=${wit.decided}). The floor is worth ${delta} points of hit rate.`,
      evidence: `published=${pub.hits}/${pub.decided}, withheld=${wit.hits}/${wit.decided}, delta=${delta}pp`,
      action: delta < 0
        ? 'The floor is filtering OUT the better cards - lower it, or fix the factors that drive it.'
        : delta < 5
          ? 'The floor adds little; consider raising it to cut noise, or leave it and collect more sample.'
          : 'The floor is earning its place. Leave it.',
    });
  }

  const chEntries = Object.entries(calibration.byChannel).filter(([, v]) => v.decided >= 3);
  if (chEntries.length >= 2) {
    const sorted = [...chEntries].sort((a, b) => (b[1].hitPct ?? 0) - (a[1].hitPct ?? 0));
    const [bestName, best] = sorted[0];
    const [worstName, worst] = sorted[sorted.length - 1];
    lessons.push({
      id: 'channel-spread',
      severity: best.hitPct - worst.hitPct > 40 ? 'warning' : 'ok',
      finding: `Best-calibrated channel ${bestName} hit ${best.hitPct}% (n=${best.decided}); worst ${worstName} hit ${worst.hitPct}% (n=${worst.decided}).`,
      evidence: `${bestName}=${best.hits}/${best.decided}, ${worstName}=${worst.hits}/${worst.decided}`,
      action: `Read the ${worstName} misses individually before touching its weights - a channel can be wrong for one reason or for several.`,
    });
  }

  if (summary.ambiguousTieBreaks > 0) {
    lessons.push({
      id: 'tie-break-affected',
      severity: 'warning',
      finding: `${summary.ambiguousTieBreaks} card(s) had a single daily bar touch BOTH stop and target. Daily OHLC cannot order intraday events, so the pessimistic reading (stop first) was applied.`,
      evidence: `ambiguous=${summary.ambiguousTieBreaks}, pessimisticTieBreak=${config.review.pessimisticTieBreak}`,
      action: 'Re-run on intraday bars before treating those verdicts as settled; the optimistic reading would raise the hit rate.',
    });
  }

  if (summary.unmeasurable > 0) {
    lessons.push({
      id: 'coverage-gap',
      severity: 'warning',
      finding: `${summary.unmeasurable} card(s) could not be adjudicated at all - the price book has no series for the names they cite.`,
      evidence: `unmeasurable=${summary.unmeasurable} of ${summary.rows}`,
      action: 'Extend the price book, or stop issuing directional cards on names the desk cannot later score. A card that is unfalsifiable in practice is worse than no card.',
    });
  }

  if (summary.viaProxy > 0) {
    lessons.push({
      id: 'proxy-substitution',
      severity: 'info',
      finding: `${summary.viaProxy} card(s) were measured through a declared demo price proxy rather than a listed price for the issuer.`,
      evidence: `viaProxy=${summary.viaProxy}`,
      action: 'Those verdicts describe the proxy series, not the fictional issuer. Do not quote them as issuer-level results.',
    });
  }

  if (summary.inconclusive > 0) {
    lessons.push({
      id: 'inconclusive-share',
      severity: summary.inconclusive > summary.decided ? 'warning' : 'info',
      finding: `${summary.inconclusive} of ${summary.scored} measurable cards closed inside the +/-${materiality}% materiality band and are reported inconclusive rather than forced into a win/loss column.`,
      evidence: `inconclusive=${summary.inconclusive}, decided=${summary.decided}, materiality=${materiality}%`,
      action: 'A high inconclusive share usually means horizons are too short for the magnitude claimed - widen the horizon, or demand a bigger expected move before publishing.',
    });
  }

  /**
   * The single most useful disagreement this module can surface: a claim whose
   * stop was touched but whose thesis still finished in the money. That is not
   * noise, it is a sizing/horizon defect - the stop is placed for a shorter
   * holding period than the card actually claims.
   */
  const stoppedOutButRight = rows.filter(
    (r) => r.riskTouch === 'stop' && Number.isFinite(r.signedExcessPct) && r.signedExcessPct >= materiality,
  );
  if (stoppedOutButRight.length) {
    const decidedWithLevels = rows.filter((r) => r.riskTouch === 'stop' || r.riskTouch === 'target');
    lessons.push({
      id: 'stops-too-tight',
      severity: 'warning',
      finding: `${stoppedOutButRight.length} of ${decidedWithLevels.length} level-decided claims were stopped out and STILL finished with signed excess >= +${materiality}%. The stop is tighter than the horizon the card claims.`,
      evidence: stoppedOutButRight.map((r) => `${r.id}(${r.channel}/${r.direction}) stop-first but excess ${r.signedExcessPct}%`).join('; '),
      action: 'Scale the stop to the horizon (e.g. a multiple of realised vol over the claimed holding period) instead of a fixed +/-3.5%, or shorten the horizon to match the stop.',
    });
  }

  const risked = rows.filter((r) => r.riskTouch === 'stop' || r.riskTouch === 'target');
  const disagree = risked.filter(
    (r) => (r.riskTouch === 'stop' && r.excessVerdict === 'confirmed') || (r.riskTouch === 'target' && r.excessVerdict === 'refuted'),
  );
  if (risked.length >= 3) {
    lessons.push({
      id: 'axes-disagree',
      severity: 'info',
      finding: `The risk path and the realised-excess test disagree on ${disagree.length} of ${risked.length} claims that had a numeric stop/target. Both are reported separately for exactly this reason: "would the trade have hurt" and "was the thesis right" are different questions, and merging them is how a stopped-out-but-correct call gets recorded as a loss.`,
      evidence: `with-risk-levels=${risked.length}, disagree=${disagree.length}`,
      action: 'Quote the pair of numbers, never one of them alone.',
    });
  }

  if (summary.invalidationUntestable > 0) {
    lessons.push({
      id: 'untestable-falsification',
      severity: 'warning',
      finding: `${summary.invalidationUntestable} of ${summary.scored} judged claims state their falsification condition in prose ("tone sign flip on >= 2 documents", "pair spread vs SPY < 50bp after 2 sessions") with no machine-testable level, so the desk's own words could not be checked and the verdict fell back to realised excess.`,
      evidence: `untestable=${summary.invalidationUntestable}, tested=${summary.invalidationFired + rows.filter((r) => r.invalidationTriggered === false).length}`,
      action: 'Require every channel to emit a numeric invalidation level plus the series it refers to. A falsification condition nobody can evaluate is a rhetorical device, not a control.',
    });
  }

  /**
   * Staleness of the board itself. A demo board is produced by replaying
   * historical as-of dates, so cards are typically ISSUED days after the
   * information landed and are measured over the short window that is left.
   * That is a property of how the board was built, not of the desk in live use,
   * and quoting a hit rate without saying so would be misleading.
   */
  const lags = rows
    .filter((r) => r.informationAt && r.issuedAt)
    .map((r) => diffDays(r.informationAt, r.issuedAt))
    .filter((d) => Number.isFinite(d));
  if (lags.length) {
    const medLag = round(median(lags), 1);
    const maxLag = round(Math.max(...lags), 1);
    if (medLag >= 1) {
      lessons.push({
        id: 'issued-after-information',
        severity: 'warning',
        finding: `Cards were issued a median of ${medLag} days (max ${maxLag}) AFTER the information they cite was published, so each was measured over only the tail of its window and the desk gets no credit for the initial move.`,
        evidence: `medianLagDays=${medLag}, maxLagDays=${maxLag}, n=${lags.length}`,
        action: 'This board was built by replaying historical as-of dates. In live use a card is issued when the information lands; re-run the review on a live-issued board before comparing the two.',
      });
    }
    const windows = rows.map((r) => r.window?.sessions).filter((v) => Number.isFinite(v));
    if (windows.length) {
      lessons.push({
        id: 'window-length',
        severity: 'info',
        finding: `Measured windows run a median of ${round(median(windows), 1)} trading sessions (range ${Math.min(...windows)}-${Math.max(...windows)}).`,
        evidence: `medianSessions=${round(median(windows), 1)}, n=${windows.length}`,
        action: 'Windows this short cannot distinguish a good thesis from a lucky fortnight; treat every hit rate here as descriptive.',
      });
    }
  }

  return lessons;
}

/**
 * Adjudicate the board.
 *
 * @param {object}   p
 * @param {object}   p.board     SignalBoard
 * @param {object}   p.book      PriceBook
 * @param {object}   [p.corpus]  Corpus, used to resolve declared price proxies
 * @param {Date}     [p.asOf]    only cards whose window closed by this date are final
 * @param {boolean}  [p.persist] write the verdict back onto already-terminal cards
 */
export function runReview({ board, book, corpus = null, asOf = new Date(), persist = false, benchmark = null, materialityPct = null } = {}) {
  const started = Date.now();
  const ctx = {
    book,
    proxies: buildProxyIndex(corpus),
    benchmark: benchmark || config.review.benchmark,
    materialityPct: Number.isFinite(materialityPct) ? materialityPct : config.review.materialityPct,
  };

  const cards = board.all({ status: null, limit: Number.MAX_SAFE_INTEGER });
  const eligible = new Set(config.review.statuses);
  const rows = [];
  let reclassified = 0;
  let stillOpen = 0;

  for (const card of cards) {
    if (!eligible.has(card.status)) continue;
    // A card whose window has not closed can be previewed, but not judged.
    const closed = card.expiresAt ? parseDate(card.expiresAt) <= parseDate(asOf) : false;
    const row = adjudicateCard(card, ctx);
    row.final = closed;
    if (!closed) {
      stillOpen += 1;
      if (row.outcome !== 'unmeasurable' && row.outcome !== 'not-directional') row.outcome = 'provisional';
    }
    rows.push(row);

    // Write back only onto cards that are already terminal. Reclassifying an
    // active card would silently remove it from the desk the trader is using.
    const terminal = card.status === 'expired' || card.status === 'superseded' || card.status === 'draft';
    if (persist && closed && terminal && (row.outcome === 'realized' || row.outcome === 'invalidated')) {
      card.status = row.outcome;
      reclassified += 1;
    }
    if (row.outcome !== 'unmeasurable' && row.outcome !== 'not-directional') {
      card.review = {
        outcome: closed ? row.outcome : 'provisional',
        riskTouch: row.riskTouch,
        invalidationTriggered: row.invalidationTriggered,
        signedExcessPct: row.signedExcessPct,
        window: row.window ?? null,
        instrument: row.instrument,
        viaProxy: Boolean(row.viaProxy),
        basis: row.basis,
        reviewedAt: new Date().toISOString(),
        final: closed,
      };
    }
  }

  if (persist) board.save();

  const claims = dedupeClaims(rows);
  const finalClaims = claims.filter((r) => r.final);
  const provisionalClaims = claims.filter((r) => !r.final);
  const bookStats = typeof book.stats === 'function' ? book.stats() : null;
  const summary = {
    asOf: new Date(asOf).toISOString(),
    benchmark: ctx.benchmark,
    materialityPct: ctx.materialityPct,
    pessimisticTieBreak: config.review.pessimisticTieBreak,
    cardsOnBoard: cards.length,
    adjudicated: rows.length,
    distinctClaims: claims.length,
    restatementsCollapsed: rows.length - claims.length,
    distinctClaimsJudged: finalClaims.length,
    provisionalClaims: provisionalClaims.length,
    stillOpen,
    reclassified,
    priceBookTo: bookStats?.to ?? null,
    ...summariseRows(finalClaims),
    generatedAt: new Date().toISOString(),
    ms: Date.now() - started,
  };
  const calibration = calibrate(finalClaims);
  const lessons = deriveLessons(finalClaims, summary, calibration, { materialityPct: ctx.materialityPct });

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  claims.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  log.info(`review: ${rows.length} cards -> ${claims.length} distinct claims; ${summary.decided} decided (${summary.hitPct}% hit), ${summary.unmeasurable} unmeasurable, rho ${calibration.scoreVsOutcomeRho}`);
  return {
    summary,
    calibration,
    lessons,
    rows,
    claims,
    provisional: provisionalClaims,
    settings: { benchmark: ctx.benchmark, materialityPct: ctx.materialityPct, floor: config.scoring.minScoreToPublish },
  };
}

export default runReview;
