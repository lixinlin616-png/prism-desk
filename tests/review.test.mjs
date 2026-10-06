/**
 * Review tests: post-hoc adjudication of the board.
 *
 * The properties worth pinning here are the ones that stop the review from
 * flattering the desk:
 *
 *   - the window anchors on ISSUANCE, not on the information date
 *   - returns are benchmark-excess, never raw
 *   - a stop/target tie resolves pessimistically
 *   - an invalidation level only counts if the breach HOLDS to the recheck date
 *   - unmeasurable and non-directional cards never enter the win/loss denominator
 *   - restatements are collapsed, so the hit rate is not given false precision
 *   - the command is read-only unless asked, and never reclassifies an active card
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { config } from '../src/config.mjs';
import { PriceBook } from '../src/ingest/prices.mjs';
import { Corpus } from '../src/ingest/corpus.mjs';
import { SignalBoard } from '../src/desk/board.mjs';
import { emptyCard } from '../src/schema.mjs';
import {
  GRADE_BANDS, gradeOf, buildProxyIndex, resolveSymbol, resolveInstrument,
  measurementWindow, walkInvalidation, walkRiskLevels, adjudicateCard,
  summariseRows, dedupeClaims, calibrate, deriveLessons, runReview,
} from '../src/review/adjudicate.mjs';
import { renderReviewReport } from '../src/review/report.mjs';

// ------------------------------------------------------------------ fake market

const DATES = [
  '2025-09-02', '2025-09-03', '2025-09-04', '2025-09-05', '2025-09-08',
  '2025-09-09', '2025-09-10', '2025-09-11', '2025-09-12', '2025-09-15', '2025-09-16',
];

/** A bar with a symmetric intraday range around the close, unless overridden. */
function bar(date, close, prev = null, spread = 0.5, override = {}) {
  return {
    date,
    open: override.open ?? (prev === null ? close : prev),
    high: override.high ?? close + spread,
    low: override.low ?? close - spread,
    close,
    volume: 1000,
  };
}

function series(closes, opts = {}) {
  return closes.map((c, i) => bar(DATES[i], c, i ? closes[i - 1] : null, opts.spread ?? 0.5, opts.bars?.[i] ? { ...opts.bars[i] } : {}));
}

const RISING = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const FALLING = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90];
const FLAT = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100.2];
const STILL = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
/** Dips through 100 mid-window then recovers: crosses a level but does not hold it. */
const DIP_AND_RECOVER = [100, 102, 104, 97, 99, 103, 106, 108, 110, 111, 112];
/** One bar spanning a huge range, so a stop and a target are both touched on the same day. */
const WHIPSAW = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];

function fakeBook(defs) {
  const map = new Map(Object.entries(defs).map(([k, v]) => [k.toUpperCase(), v]));
  return {
    has(s) { return map.has(String(s).toUpperCase()); },
    bars(s) { return map.get(String(s).toUpperCase()) ?? []; },
    indexOfDate(s, date) {
      const b = this.bars(s);
      const i = b.findIndex((x) => x.date === date);
      if (i !== -1) return i;
      for (let k = b.length - 1; k >= 0; k -= 1) if (b[k].date <= date) return k;
      return -1;
    },
    closeOn(s, date) { const i = this.indexOfDate(s, date); return i === -1 ? null : this.bars(s)[i].close; },
    stats() { return { symbols: map.size, bars: DATES.length * map.size, from: DATES[0], to: DATES[DATES.length - 1] }; },
  };
}

const BOOK = fakeBook({
  SPY: series(STILL),
  AAA: series(RISING),
  BBB: series(FALLING),
  FLT: series(FLAT),
  DIP: series(DIP_AND_RECOVER),
  WHP: series(WHIPSAW, { bars: { 3: { high: 130, low: 80 } } }),
});

const PROXIES = new Map([['ZZZ', 'AAA']]);
const CTX = { book: BOOK, proxies: PROXIES, benchmark: 'SPY', materialityPct: 1 };

/** A card whose levels are struck off the issuance price, exactly as the desk does. */
function card(over = {}) {
  return emptyCard({
    id: over.id ?? `SIG-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    channel: 'earnings-gap',
    direction: 'long',
    horizon: 'days',
    tickers: ['AAA'],
    informationAt: '2025-08-20T20:05:00Z',
    createdAt: '2025-09-02T20:00:00Z',
    expiresAt: '2025-09-16T20:00:00Z',
    status: 'expired',
    claim: 'A test claim long enough to pass the schema length check.',
    invalidation: { condition: 'test', level: null, recheckAt: '2025-09-16T20:00:00Z' },
    tradeSketch: null,
    evidence: [],
    score: { total: 70, grade: 'B', publishable: true },
    ...over,
  });
}

function scratchBoard(cards) {
  const b = new SignalBoard({ file: join(tmpdir(), `prism-review-test-${process.pid}-${Date.now()}.json`), autosave: false });
  b.cards.clear();
  for (const c of cards) b.cards.set(c.id, c);
  return b;
}

// ------------------------------------------------------------------- resolution

test('a real symbol resolves to itself, a declared proxy resolves, and an unknown name does not resolve at all', () => {
  assert.deepEqual(resolveSymbol('AAA', CTX), { symbol: 'AAA', viaProxy: false, requested: 'AAA' });
  assert.deepEqual(resolveSymbol('zzz', CTX), { symbol: 'AAA', viaProxy: true, requested: 'ZZZ' });
  assert.equal(resolveSymbol('NOPE', CTX), null, 'an unpriced name must resolve to null, never to a guess');
  assert.equal(resolveSymbol('', CTX), null);
});

test('the proxy index is built from what the corpus documents actually declare', () => {
  const corpus = new Corpus(config.paths.corpus).load();
  const idx = buildProxyIndex(corpus);
  assert.ok(idx.size > 0, 'the bundled demo corpus declares price proxies for its fictional issuers');
  for (const [ticker, proxy] of idx) {
    assert.match(ticker, /^[A-Z0-9.\-]+$/, `bad ticker key ${ticker}`);
    assert.match(proxy, /^[A-Z0-9.\-]+$/, `bad proxy ${proxy}`);
  }
  assert.deepEqual([...buildProxyIndex(null)], [], 'a missing corpus yields an empty index, not a throw');
});

test('instrument resolution distinguishes single, pair, basket and nothing-measurable', () => {
  assert.equal(resolveInstrument(card({ tickers: ['AAA'] }), CTX).kind, 'single');
  assert.equal(resolveInstrument(card({ tickers: ['AAA', 'BBB'] }), CTX).kind, 'basket');
  assert.equal(resolveInstrument(card({ tickers: ['NOPE'] }), CTX).kind, 'none');
  assert.equal(resolveInstrument(card({ tickers: [] }), CTX).kind, 'none');

  const pair = resolveInstrument(card({ direction: 'pair', tradeSketch: { pair: { long: 'AAA', short: 'BBB' } } }), CTX);
  assert.equal(pair.kind, 'pair');
  assert.deepEqual(pair.legs.map((l) => [l.symbol, l.sign]), [['AAA', 1], ['BBB', -1]]);

  // Half a spread is not a spread. Refusing is the honest answer.
  const half = resolveInstrument(card({ direction: 'pair', tradeSketch: { pair: { long: 'AAA', short: 'NOPE' } } }), CTX);
  assert.equal(half.kind, 'none');
  assert.match(half.note, /half measurable/);
});

test('a basket weights its legs equally and the weights sum to one', () => {
  const inst = resolveInstrument(card({ tickers: ['AAA', 'BBB', 'FLT'] }), CTX);
  assert.equal(inst.legs.length, 3);
  const total = inst.legs.reduce((a, l) => a + l.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-4, `weights sum to ${total}`);
  assert.match(inst.note, /equal-weighted basket of 3 measurable names/);
  assert.ok(!/unmeasurable/.test(inst.note), 'a fully measurable basket must not claim exclusions');
  // Every leg of a long basket carries the same positive sign.
  assert.deepEqual([...new Set(inst.legs.map((l) => l.sign))], [1]);
});

test('a short basket flips the sign on every leg', () => {
  const inst = resolveInstrument(card({ direction: 'short', tickers: ['AAA', 'BBB'] }), CTX);
  assert.deepEqual(inst.legs.map((l) => l.sign), [-1, -1]);
});

test('a basket with an unpriced member excludes it and says so', () => {
  const inst = resolveInstrument(card({ tickers: ['AAA', 'NOPE'] }), CTX);
  assert.equal(inst.kind, 'single');
  assert.match(inst.note, /unmeasurable \(NOPE\) excluded/);
});

// --------------------------------------------------------------------- window

test('the measurement window anchors on ISSUANCE, not on the information date', () => {
  // informationAt predates the whole price book; createdAt does not. Anchoring
  // on the information date would make this card unmeasurable, and - worse -
  // would judge it against levels struck off a price outside the window.
  const c = card({ informationAt: '2025-08-20T20:05:00Z', createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });
  const win = measurementWindow(BOOK, 'AAA', c);
  assert.equal(win.ok, true);
  assert.equal(win.refDate, '2025-09-02');
  assert.equal(win.endDate, '2025-09-16');
  assert.equal(win.sessions, 10);
  assert.equal(win.truncated, false);
});

test('with no issuance time the window falls back to the information date', () => {
  const win = measurementWindow(BOOK, 'AAA', { createdAt: null, informationAt: '2025-09-04T12:00:00Z', expiresAt: '2025-09-16T00:00:00Z' });
  assert.equal(win.ok, true);
  assert.equal(win.refDate, '2025-09-04');
});

test('a window with no forward sessions is refused rather than measured as zero', () => {
  const win = measurementWindow(BOOK, 'AAA', { createdAt: '2025-09-16T20:00:00Z', expiresAt: '2025-09-16T22:00:00Z' });
  assert.equal(win.ok, false);
  assert.match(win.reason, /no forward sessions/);
});

test('an expiry past the end of the book truncates the window and says so', () => {
  const win = measurementWindow(BOOK, 'AAA', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2026-01-01T00:00:00Z' });
  assert.equal(win.ok, true);
  assert.equal(win.truncated, true);
  assert.equal(win.endDate, DATES[DATES.length - 1]);
});

// ------------------------------------------------------------- falsification

const WIN = measurementWindow(BOOK, 'AAA', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });

test('a prose falsification condition is reported untestable, never approximated', () => {
  const r = walkInvalidation(BOOK, 'AAA', WIN, { level: NaN, sign: 1, recheckAt: '2025-09-16' });
  assert.equal(r.triggered, null);
  assert.match(r.detail, /no numeric invalidation level/);

  const prose = walkInvalidation(BOOK, 'AAA', WIN, { level: 'tone sign flip on >= 2 documents', sign: 1 });
  assert.equal(prose.triggered, null);
  assert.match(prose.detail, /prose/);
});

test('a breach that recovers before the recheck date did NOT fire - the card says "and holds"', () => {
  const w = measurementWindow(BOOK, 'DIP', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });
  const r = walkInvalidation(BOOK, 'DIP', w, { level: 100, sign: 1, recheckAt: '2025-09-16' });
  assert.equal(r.triggered, false, 'DIP closes at 97 mid-window but 112 at the recheck date');
  assert.match(r.detail, /recovered/);
});

test('a breach still in force at the recheck date DID fire', () => {
  const w = measurementWindow(BOOK, 'DIP', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });
  const r = walkInvalidation(BOOK, 'DIP', w, { level: 100, sign: 1, recheckAt: '2025-09-05' });
  assert.equal(r.triggered, true);
  assert.equal(r.at, '2025-09-05');
});

test('a level never crossed is reported as held, not as missing data', () => {
  const r = walkInvalidation(BOOK, 'AAA', WIN, { level: 50, sign: 1, recheckAt: '2025-09-16' });
  assert.equal(r.triggered, false);
  assert.match(r.detail, /no close crossed/);
});

test('a recheck date that leaves no testable session falls back to a short fixed horizon', () => {
  // recheckAt is before the window opens, so it cannot be used. The fallback is
  // refIdx + 2 sessions = 2025-09-04, and the detail must name that date so the
  // reader can see which window was actually tested.
  const r = walkInvalidation(BOOK, 'AAA', WIN, { level: 95, sign: 1, recheckAt: '2025-08-01' });
  assert.equal(r.triggered, false, 'AAA never closes at or below 95');
  assert.match(r.detail, /by the recheck date 2025-09-04/);

  // And the fallback window really is only two sessions wide. On the short side
  // a breach means the close rising THROUGH the level: AAA first closes at or
  // above 105 on 2025-09-09 (index 5), well outside indices 1-2, so it must not
  // fire - while the same level tested to the real expiry does.
  const outside = walkInvalidation(BOOK, 'AAA', WIN, { level: 105, sign: -1, recheckAt: '2025-08-01' });
  assert.equal(outside.triggered, false, 'index 5 is beyond the 2-session fallback that ends at index 2');
  const inside = walkInvalidation(BOOK, 'AAA', WIN, { level: 105, sign: -1, recheckAt: '2025-09-16' });
  assert.equal(inside.triggered, true, 'over the full window the same level is breached and holds');
});

// ------------------------------------------------------------------ risk path

test('the risk walk reports the first level a resting order would have hit', () => {
  const target = walkRiskLevels(BOOK, 'AAA', WIN, { stop: 95, target: 105, sign: 1 });
  assert.equal(target.touch, 'target');
  assert.equal(target.ambiguous, undefined);

  const wBBB = measurementWindow(BOOK, 'BBB', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });
  const stop = walkRiskLevels(BOOK, 'BBB', wBBB, { stop: 96, target: 200, sign: 1 });
  assert.equal(stop.touch, 'stop');

  const neither = walkRiskLevels(BOOK, 'AAA', WIN, { stop: 10, target: 900, sign: 1 });
  assert.equal(neither.touch, 'neither');

  assert.equal(walkRiskLevels(BOOK, 'AAA', WIN, { stop: NaN, target: NaN, sign: 1 }).touch, 'n/a');
});

test('when one bar touches both levels the STOP is assumed - the pessimistic reading', () => {
  const w = measurementWindow(BOOK, 'WHP', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });
  const r = walkRiskLevels(BOOK, 'WHP', w, { stop: 95, target: 120, sign: 1 });
  assert.equal(config.review.pessimisticTieBreak, true, 'this test only means anything while the default is pessimistic');
  assert.equal(r.touch, 'stop');
  assert.equal(r.ambiguous, true);
  assert.match(r.detail, /assumed the STOP/);
});

test('a short reads its levels the other way round', () => {
  const w = measurementWindow(BOOK, 'BBB', { createdAt: '2025-09-02T20:00:00Z', expiresAt: '2025-09-16T20:00:00Z' });
  // Short BBB: target is BELOW, stop is ABOVE. BBB falls to 90, so the target fills.
  const r = walkRiskLevels(BOOK, 'BBB', w, { stop: 104, target: 92, sign: -1 });
  assert.equal(r.touch, 'target');
});

// ------------------------------------------------------------------ verdicts

const ISSUED = '2025-09-02T20:00:00Z';
const EXPIRY = '2025-09-16T20:00:00Z';

test('a long that beat the benchmark is realized; one that lagged it is invalidated', () => {
  const up = adjudicateCard(card({ tickers: ['AAA'] }), CTX);
  assert.equal(up.outcome, 'realized');
  assert.equal(up.excessVerdict, 'confirmed');
  assert.ok(up.signedExcessPct > 9, `expected ~+10% excess, got ${up.signedExcessPct}`);

  const down = adjudicateCard(card({ tickers: ['BBB'] }), CTX);
  assert.equal(down.outcome, 'invalidated');
  assert.equal(down.excessVerdict, 'refuted');
  assert.ok(down.signedExcessPct < -9);
});

test('a short is signed the other way, so shorting a falling name is a win', () => {
  const shortWin = adjudicateCard(card({ direction: 'short', tickers: ['BBB'] }), CTX);
  assert.equal(shortWin.outcome, 'realized');
  assert.ok(shortWin.signedExcessPct > 9, `signed excess should be positive for a right short, got ${shortWin.signedExcessPct}`);

  const shortLoss = adjudicateCard(card({ direction: 'short', tickers: ['AAA'] }), CTX);
  assert.equal(shortLoss.outcome, 'invalidated');
  assert.ok(shortLoss.signedExcessPct < -9);
});

test('an uneventful window is inconclusive, not a loss', () => {
  const r = adjudicateCard(card({ tickers: ['FLT'] }), CTX);
  assert.equal(r.excessVerdict, 'immaterial');
  assert.equal(r.outcome, 'inconclusive');
  assert.ok(Math.abs(r.signedExcessPct) < 1);
});

test('a rising tape is not skill: excess is measured against the benchmark', () => {
  const rising = fakeBook({ SPY: series(RISING), AAA: series(RISING), BBB: series(FALLING), FLT: series(FLAT) });
  const ctx = { ...CTX, book: rising };
  const r = adjudicateCard(card({ tickers: ['AAA'] }), ctx);
  // AAA is up 10% raw, but the benchmark is up exactly the same, so the call
  // proved nothing. Counting the raw move as a win is the classic self-flattery.
  assert.ok(Math.abs(r.signedExcessPct) < 1e-9, `expected zero excess, got ${r.signedExcessPct}`);
  assert.equal(r.outcome, 'inconclusive');
  assert.equal(r.benchmarkAdjusted, true);
});

test('a pair is measured as a spread, where the benchmark cancels by construction', () => {
  const pair = adjudicateCard(card({
    direction: 'pair',
    tickers: ['AAA', 'BBB'],
    tradeSketch: { pair: { long: 'AAA', short: 'BBB' } },
  }), CTX);
  assert.equal(pair.instrument, 'pair');
  assert.equal(pair.benchmarkAdjusted, false);
  assert.equal(pair.outcome, 'realized');
  // 0.5 * (+10) + 0.5 * (+10) = +10 for a long-rising / short-falling pair.
  assert.ok(Math.abs(pair.signedExcessPct - 10) < 1e-6, `got ${pair.signedExcessPct}`);
});

test('the card\'s OWN falsification condition outranks a good realised number', () => {
  // DIP closes at 97 on 2025-09-05 (the card's recheck date) and rallies to 112
  // by expiry. The card said "I am wrong if it closes below 100 by the recheck
  // date". It was wrong on its own terms; the later rally does not rescue it.
  const r = adjudicateCard(card({
    tickers: ['DIP'],
    invalidation: { condition: 'test', level: 100, recheckAt: '2025-09-05T20:00:00Z' },
  }), CTX);
  assert.equal(r.invalidationTriggered, true);
  assert.equal(r.excessVerdict, 'confirmed', 'the window as a whole did make money');
  assert.equal(r.outcome, 'invalidated', 'falsification takes precedence over realised excess');
});

test('the risk path is reported but never decides the verdict', () => {
  // Stop at 105 is touched on the way up, yet the claim still finishes +10%.
  const r = adjudicateCard(card({
    tickers: ['AAA'],
    tradeSketch: { entryZone: [100, 101], stop: 105, target: 999, riskPctOfPortfolio: 0.5 },
  }), CTX);
  assert.equal(r.riskTouch, 'stop');
  assert.equal(r.outcome, 'realized', 'being stopped out is not the same as being wrong');
  assert.match(r.basis, /risk path/);
});

test('non-directional cards are excluded rather than scored as half a win', () => {
  for (const direction of ['neutral', 'hedge']) {
    const r = adjudicateCard(card({ direction, tickers: ['AAA'] }), CTX);
    assert.equal(r.outcome, 'not-directional');
    assert.equal(r.signedExcessPct, null);
  }
});

test('an unpriced name is unmeasurable, never a win or a loss', () => {
  const r = adjudicateCard(card({ tickers: ['NOPE'] }), CTX);
  assert.equal(r.outcome, 'unmeasurable');
  assert.match(r.basis, /no price series for NOPE/);
});

test('a fictional issuer is measured through its declared proxy and says so', () => {
  const r = adjudicateCard(card({ tickers: ['ZZZ'] }), CTX);
  assert.equal(r.viaProxy, true);
  assert.deepEqual(r.symbols, ['AAA']);
  assert.equal(r.outcome, 'realized');
  assert.match(r.basis, /declared demo price proxy/);
});

test('every adjudicated row carries a written basis - no verdict without an audit trail', () => {
  for (const c of [
    card({ tickers: ['AAA'] }), card({ tickers: ['NOPE'] }),
    card({ direction: 'neutral', tickers: ['AAA'] }), card({ tickers: ['FLT'] }),
  ]) {
    const r = adjudicateCard(c, CTX);
    assert.ok(typeof r.basis === 'string' && r.basis.length > 10, `${c.id} has no usable basis: "${r.basis}"`);
  }
});

// ---------------------------------------------------- tallies and dedup

test('the hit-rate denominator excludes inconclusive, unmeasurable and non-directional rows', () => {
  const rows = [
    { outcome: 'realized', signedExcessPct: 4, riskTouch: 'n/a', invalidationTriggered: null },
    { outcome: 'invalidated', signedExcessPct: -4, riskTouch: 'n/a', invalidationTriggered: null },
    { outcome: 'inconclusive', signedExcessPct: 0.1, riskTouch: 'n/a', invalidationTriggered: null },
    { outcome: 'unmeasurable', signedExcessPct: null, riskTouch: 'n/a', invalidationTriggered: null },
    { outcome: 'not-directional', signedExcessPct: null, riskTouch: 'n/a', invalidationTriggered: null },
  ];
  const s = summariseRows(rows);
  assert.equal(s.rows, 5);
  assert.equal(s.scored, 3, 'only realized/invalidated/inconclusive are scored at all');
  assert.equal(s.decided, 2, 'inconclusive is scored but not decided');
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
  assert.equal(s.hitPct, 50, 'the denominator must be decided claims, not every row');
  assert.equal(s.unmeasurable, 1);
  assert.equal(s.notDirectional, 1);
  assert.equal(s.hitPctCi95, null, 'no interval at n=2 - an interval here would be false precision');
});

test('restatements collapse to one claim and the strongest version is kept', () => {
  const a = adjudicateCard(card({ id: 'SIG-A', score: { total: 60, grade: 'C', publishable: true } }), CTX);
  const b = adjudicateCard(card({ id: 'SIG-B', score: { total: 78, grade: 'A', publishable: true } }), CTX);
  const c = adjudicateCard(card({ id: 'SIG-C', tickers: ['BBB'], score: { total: 70, grade: 'B', publishable: true } }), CTX);
  assert.equal(a.claimKey, b.claimKey, 'same channel, names, direction and window is the same test');
  assert.notEqual(a.claimKey, c.claimKey);

  const claims = dedupeClaims([a, b, c]);
  assert.equal(claims.length, 2);
  const kept = claims.find((x) => x.claimKey === a.claimKey);
  assert.equal(kept.id, 'SIG-B', 'the highest-scoring restatement represents the claim');
  assert.equal(kept.restatements, 2);
});

test('a different measurement window is a different test, not a restatement', () => {
  const short = adjudicateCard(card({ id: 'SIG-S', expiresAt: '2025-09-08T20:00:00Z' }), CTX);
  const long = adjudicateCard(card({ id: 'SIG-L', expiresAt: '2025-09-16T20:00:00Z' }), CTX);
  assert.notEqual(short.claimKey, long.claimKey);
  assert.equal(dedupeClaims([short, long]).length, 2);
});

// ------------------------------------------------------------- calibration

test('grade bands match the rubric, and every score lands in exactly one', () => {
  assert.deepEqual(GRADE_BANDS.map((b) => b.grade), ['A', 'B', 'C', 'D', 'F']);
  assert.equal(gradeOf(75), 'A');
  assert.equal(gradeOf(74.9), 'B');
  assert.equal(gradeOf(62), 'B');
  assert.equal(gradeOf(48), 'C');
  assert.equal(gradeOf(35), 'D');
  assert.equal(gradeOf(34.9), 'F');
  assert.equal(gradeOf(null), null);
  assert.equal(gradeOf(NaN), null);
});

test('calibration buckets every grade and reports the score-vs-outcome correlation', () => {
  const rows = [
    { grade: 'A', channel: 'earnings-gap', direction: 'long', score: 80, signedExcessPct: 5, outcome: 'realized', published: true, informationAt: '2025-09-02' },
    { grade: 'C', channel: 'earnings-gap', direction: 'long', score: 55, signedExcessPct: -5, outcome: 'invalidated', published: true, informationAt: '2025-09-03' },
    { grade: 'F', channel: 'narrative-shift', direction: 'short', score: 20, signedExcessPct: -2, outcome: 'invalidated', published: false, informationAt: '2025-09-04' },
  ];
  const cal = calibrate(rows);
  assert.equal(cal.n, 3);
  assert.equal(cal.clusters, 3, 'three distinct information dates');
  assert.deepEqual(Object.keys(cal.byGrade), ['A', 'B', 'C', 'D', 'F']);
  assert.equal(cal.byGrade.B.decided, 0);
  assert.equal(cal.byGrade.A.hits, 1);
  assert.equal(cal.published.decided, 2);
  assert.equal(cal.withheld.decided, 1);
  assert.equal(cal.scoreVsOutcomeRho, null, 'rho is not computed below 5 points - a correlation on 3 points is noise');
});

test('a small sample is always flagged as a blocker before any other finding', () => {
  const rows = [{ grade: 'A', channel: 'c', direction: 'long', score: 80, signedExcessPct: 1, outcome: 'realized', published: true, informationAt: '2025-09-02' }];
  const summary = summariseRows(rows);
  const cal = calibrate(rows);
  const lessons = deriveLessons(rows, summary, cal, {});
  assert.ok(lessons.some((l) => l.id === 'sample-too-small' && l.severity === 'blocker'));
  for (const l of lessons) {
    assert.ok(l.finding && l.evidence && l.action, `lesson ${l.id} is missing a field`);
    assert.ok(/\d/.test(l.evidence), `lesson ${l.id} cites no number - a finding without a measurement is an opinion`);
  }
});

// ------------------------------------------------------------------ runReview

const AS_OF = new Date('2025-09-30T00:00:00Z');

/** A small board covering every verdict the review can hand down. */
function fixtureBoard() {
  return scratchBoard([
    // Two restatements of one claim - must collapse to a single observation.
    card({ id: 'SIG-R1', tickers: ['AAA'], score: { total: 66, grade: 'B', publishable: true } }),
    card({ id: 'SIG-R2', tickers: ['AAA'], score: { total: 79, grade: 'A', publishable: true } }),
    card({ id: 'SIG-LOSS', tickers: ['BBB'], score: { total: 70, grade: 'B', publishable: true } }),
    // Still open at the adjudication date: previewed, never judged.
    card({ id: 'SIG-OPEN', tickers: ['AAA'], expiresAt: '2026-01-01T00:00:00Z', status: 'active', score: { total: 72, grade: 'B', publishable: true } }),
    card({ id: 'SIG-FLATDIR', direction: 'neutral', tickers: ['AAA'], score: { total: 55, grade: 'C', publishable: true } }),
    card({ id: 'SIG-NOPX', tickers: ['NOPE'], score: { total: 68, grade: 'B', publishable: true } }),
  ]);
}

test('runReview reports the whole board honestly: collapsed, judged, provisional and unmeasurable', () => {
  const r = runReview({ board: fixtureBoard(), book: BOOK, asOf: AS_OF });
  const s = r.summary;

  assert.equal(s.cardsOnBoard, 6);
  assert.equal(s.adjudicated, 6);
  assert.equal(s.distinctClaims, 5, 'the two restatements collapse into one claim');
  assert.equal(s.restatementsCollapsed, 1);
  assert.equal(s.stillOpen, 1);
  assert.equal(s.provisionalClaims, 1);
  assert.equal(s.unmeasurable, 1);
  assert.equal(s.notDirectional, 1);
  assert.equal(s.scored + s.unmeasurable + s.notDirectional + s.provisionalClaims, s.distinctClaims);
  assert.equal(s.hits + s.misses, s.decided);
  assert.equal(s.reclassified, 0, 'read-only by default');

  // The AAA restatement pair and the BBB loss are the only judged, decided claims.
  assert.equal(s.decided, 2);
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
  assert.equal(s.hitPct, 50);

  assert.equal(r.claims.length, 5);
  assert.ok(r.claims.every((c) => c.basis && c.basis.length > 10), 'every claim carries a written basis');
  assert.equal(r.provisional.length, 1);
  assert.equal(r.provisional[0].id, 'SIG-OPEN');
});

test('runReview is deterministic - the same board at the same date gives the same answer', () => {
  const a = runReview({ board: fixtureBoard(), book: BOOK, asOf: AS_OF });
  const b = runReview({ board: fixtureBoard(), book: BOOK, asOf: AS_OF });
  const strip = (r) => JSON.stringify({ summary: { ...r.summary, generatedAt: null, ms: null }, claims: r.claims.map((c) => c.claimKey + c.outcome + c.signedExcessPct) });
  assert.equal(strip(a), strip(b));
});

test('moving the adjudication date changes what is final - no time leakage', () => {
  const early = runReview({ board: fixtureBoard(), book: BOOK, asOf: new Date('2025-09-03T00:00:00Z') });
  const late = runReview({ board: fixtureBoard(), book: BOOK, asOf: AS_OF });
  assert.ok(early.summary.provisionalClaims > late.summary.provisionalClaims,
    `at 2025-09-03 more windows are still open (${early.summary.provisionalClaims}) than at 2025-09-30 (${late.summary.provisionalClaims})`);
  assert.equal(early.summary.decided, 0, 'nothing can be judged before any window has closed');
});

test('without persist no card status changes; with persist only terminal cards are reclassified', () => {
  const ro = fixtureBoard();
  runReview({ board: ro, book: BOOK, asOf: AS_OF, persist: false });
  assert.equal(ro.get('SIG-R2').status, 'expired');
  assert.equal(ro.get('SIG-OPEN').status, 'active');

  const rw = fixtureBoard();
  const r = runReview({ board: rw, book: BOOK, asOf: AS_OF, persist: true });
  assert.ok(r.summary.reclassified > 0, 'some terminal cards should have been given a verdict status');
  // The two statuses declared in the schema for exactly this purpose are now used.
  const statuses = [...rw.cards.values()].map((c) => c.status);
  assert.ok(statuses.includes('realized') || statuses.includes('invalidated'), `no verdict statuses written: ${statuses.join(',')}`);
  assert.equal(rw.get('SIG-OPEN').status, 'active', 'an ACTIVE card must never be reclassified - the trader is still using it');
  assert.equal(rw.get('SIG-OPEN').review.outcome, 'provisional');
  assert.equal(rw.get('SIG-NOPX').status, 'expired', 'an unmeasurable card keeps its status - there is no verdict to write');
  assert.equal(rw.get('SIG-NOPX').review, undefined, 'and gets no review block either');
});

test('the verdict written back onto a card carries its own audit trail', () => {
  const b = fixtureBoard();
  runReview({ board: b, book: BOOK, asOf: AS_OF, persist: true });
  const rev = b.get('SIG-LOSS').review;
  assert.ok(rev, 'a judged card gets a review block');
  assert.equal(rev.outcome, 'invalidated');
  assert.ok(Number.isFinite(rev.signedExcessPct));
  assert.equal(rev.final, true);
  assert.ok(rev.basis.length > 20);
  assert.ok(rev.window && rev.window.sessions > 0);
});

// --------------------------------------------------------------------- report

test('the rendered report is markdown, cites every finding, and states what it is not', () => {
  const r = runReview({ board: fixtureBoard(), book: BOOK, asOf: AS_OF });
  const md = renderReviewReport(r);
  assert.match(md, /^# Signal review/m);
  assert.match(md, /## Method/);
  assert.match(md, /## Headline/);
  assert.match(md, /## Caveats, stated plainly/);
  assert.match(md, /This is not a backtest of the desk/);
  assert.match(md, /No costs/);
  for (const l of r.lessons) assert.ok(md.includes(l.id), `finding ${l.id} is missing from the report`);
  assert.ok(!/undefined/.test(md), 'the report renders an undefined value somewhere');
  assert.ok(!/NaN/.test(md), 'the report renders a NaN somewhere');
  assert.ok(!/\[object Object\]/.test(md), 'the report renders a raw object somewhere');
});

// ------------------------------------------------------- real bundled data

test('the real bundled price book satisfies the interface the review needs', () => {
  const realBook = new PriceBook(config.paths.prices).load();
  const corpus = new Corpus(config.paths.corpus).load();
  const stats = realBook.stats();
  assert.ok(realBook.has('SPY') && realBook.has('NVDA'));

  const ctx = {
    book: realBook,
    proxies: buildProxyIndex(corpus),
    benchmark: config.review.benchmark,
    materialityPct: config.review.materialityPct,
  };
  // A fictional demo issuer must resolve through the proxy its own document declares.
  const proxyTicker = [...ctx.proxies.keys()][0];
  assert.ok(proxyTicker, 'the bundled corpus declares at least one price proxy');
  const row = adjudicateCard(card({
    tickers: [proxyTicker],
    createdAt: '2025-09-02T20:00:00Z',
    expiresAt: '2025-09-16T20:00:00Z',
  }), ctx);
  assert.equal(row.viaProxy, true);
  assert.equal(row.outcome !== 'unmeasurable', true, 'a proxied issuer is measurable on the real book');
  assert.ok(Number.isFinite(row.signedExcessPct));
  assert.ok(row.window.to <= stats.to, 'the window never runs past the end of the real book');
});

/**
 * Runs against the COMMITTED board fixture, not data/state/board.json.
 *
 * The runtime board is gitignored, so on a fresh clone it does not exist and
 * this test used to skip - which is how `npm test` came to report 177 pass +
 * 1 skip on a clean checkout while every doc in the repo claimed 178/178. A
 * skipped check is not a passed check.
 *
 * data/fixtures/board-seed.json is the same board `npm run review:seed`
 * adjudicates into docs/reports/review.md, so pointing the test at it makes the
 * check run everywhere and ties it to an artifact a judge can rebuild.
 */
test('the review runs clean over the committed board fixture', () => {
  const fixture = join(config.root, 'data', 'fixtures', 'board-seed.json');
  assert.ok(existsSync(fixture), 'the committed board fixture must ship with the repo - rebuild it with npm run seed');
  const realBook = new PriceBook(config.paths.prices).load();
  const corpus = new Corpus(config.paths.corpus).load();
  const board = new SignalBoard({ file: fixture, autosave: false });
  assert.ok(board.all({ limit: 1 }).length > 0, 'the committed fixture must not be an empty board');
  const r = runReview({ board, book: realBook, corpus, asOf: new Date(`${realBook.stats().to}T23:59:59Z`) });
  const s = r.summary;
  // Non-vacuous: the fixture spans closed windows, so there must be verdicts.
  assert.ok(s.decided > 0, `the committed fixture produced ${s.decided} decided claims - expected some`);
  assert.ok(s.adjudicated >= s.distinctClaims, 'collapsing can only reduce the count');
  assert.equal(s.hits + s.misses, s.decided);
  if (s.decided > 0) {
    assert.ok(s.hitPct >= 0 && s.hitPct <= 100);
    assert.equal(s.hitPct, Math.round((s.hits / s.decided) * 1000) / 10);
  }
  // The report must render on real state without emitting a placeholder.
  const md = renderReviewReport(r);
  assert.ok(md.length > 2000);
  assert.ok(!/undefined|NaN/.test(md));
});
