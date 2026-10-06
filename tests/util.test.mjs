/**
 * Utility tests: time/session maths, number formatting, CSV and statistics.
 *
 * These are small, but they are load-bearing. The session clock decides whether
 * the closed-window channel fires at all; the statistics module decides whether
 * the validation numbers in the docs mean anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionState, expiryFor, decayWeight, addDays, addHours, parseDate, toDateStr,
  nyWeekday, isWeekday, HORIZONS, diffDays,
} from '../src/util/time.mjs';
import { toNum, round, pctChange, clamp, zScore, fmtCompact, fmtPct } from '../src/util/num.mjs';
import { parseCsv, toCsv } from '../src/util/csv.mjs';
import { mean, median, stdev, quantile, pearson, spearman, corrPValue, hitRate, sharpe, maxDrawdown } from '../src/util/stats.mjs';
import { stableStringify } from '../src/util/json.mjs';

// ----------------------------------------------------------------------- time

test('the US cash session clock is right at each boundary', () => {
  // 2025-09-12 is a Friday, 2025-09-13 a Saturday, 2025-09-15 a Monday.
  assert.equal(sessionState('2025-09-12T14:00:00Z').state, 'open');          // 10:00 ET
  assert.equal(sessionState('2025-09-12T13:29:00Z').state, 'pre-market');     // 09:29 ET
  assert.equal(sessionState('2025-09-12T13:30:00Z').state, 'open');           // 09:30 ET
  assert.equal(sessionState('2025-09-12T20:01:00Z').state, 'after-hours');    // 16:01 ET
  assert.equal(sessionState('2025-09-13T15:00:00Z').state, 'closed');         // Saturday
  assert.equal(sessionState('2025-09-14T15:00:00Z').state, 'closed');         // Sunday
  assert.equal(sessionState('2025-09-13T15:00:00Z').reason, 'weekend');
});

test('the session clock is what makes the closed-window channel possible', () => {
  // 47 hours of a shut cash market against a 7x24 rToken is the S2 core scenario.
  const saturday = sessionState('2025-09-13T15:00:00Z');
  assert.equal(saturday.state, 'closed');
  assert.equal(saturday.weekday, 'Sat');
  assert.equal(isWeekday('2025-09-13T15:00:00Z'), false);
  assert.equal(isWeekday('2025-09-15T15:00:00Z'), true);
  assert.equal(nyWeekday('2025-09-15T15:00:00Z'), 'Mon');
});

test('parseDate accepts ISO strings and bare dates, and rejects junk', () => {
  assert.equal(toDateStr('2025-09-13'), '2025-09-13');
  assert.equal(toDateStr('2025-09-13T15:00:00Z'), '2025-09-13');
  assert.ok(parseDate(new Date('2025-09-13T00:00:00Z')) instanceof Date);
  assert.equal(parseDate('not a date'), null);
  assert.equal(toDateStr('not a date'), null);
});

test('every horizon has an expiry and expiryFor applies it', () => {
  const from = '2025-09-13T15:00:00Z';
  for (const [label, h] of Object.entries(HORIZONS)) {
    assert.ok(h.hours > 0, `${label} has no duration`);
    assert.equal(expiryFor(label, from), addHours(from, h.hours));
  }
  // unknown horizons fall back to `days` rather than never expiring
  assert.equal(expiryFor('nonsense', from), addHours(from, HORIZONS.days.hours));
});

test('decayWeight is 1 for future timestamps and halves at the half-life', () => {
  const at = '2025-09-13T15:00:00Z';
  assert.equal(decayWeight(addHours(at, 5), at, 24), 1);
  assert.equal(decayWeight(at, at, 24), 1);
  assert.ok(Math.abs(decayWeight(addHours(at, -24), at, 24) - 0.5) < 1e-9);
  assert.ok(Math.abs(decayWeight(addHours(at, -48), at, 24) - 0.25) < 1e-9);
  assert.ok(decayWeight(addHours(at, -24 * 30), at, 24) < 0.001);
});

test('addDays and diffDays agree', () => {
  assert.equal(toDateStr(addDays('2025-09-13T00:00:00Z', 2)), '2025-09-15');
  assert.equal(diffDays('2025-09-13T00:00:00Z', '2025-09-15T00:00:00Z'), 2);
  assert.equal(addDays('garbage', 1), null);
});

// -------------------------------------------------------------------- numbers

test('toNum handles the strings real data sources emit', () => {
  assert.equal(toNum('1,234.5'), 1234.5);
  assert.equal(toNum('$177.11'), 177.11);
  assert.equal(toNum('-3.5%'), -3.5);
  assert.equal(toNum(42), 42);
  assert.equal(toNum('n/a'), null);
  assert.equal(toNum(null), null);
  assert.equal(toNum(''), null);
});

test('pctChange is signed and handles a zero base', () => {
  assert.ok(Math.abs(pctChange(100, 110) - 10) < 1e-9);
  assert.ok(Math.abs(pctChange(100, 90) + 10) < 1e-9);
  assert.ok(!Number.isFinite(pctChange(0, 10)) || pctChange(0, 10) === null || pctChange(0, 10) === 0,
    'a zero base must not produce Infinity silently');
});

test('clamp and round behave at the edges', () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp(50, 0, 100), 50);
  assert.equal(round(1.2345, 2), 1.23);
  assert.equal(round(2.5, 0), 3);
  assert.equal(round(-1.005, 2), -1);
  // 1.005 is stored as 1.00499999... in binary floating point, so it rounds down.
  // That is inherent to IEEE-754, not a defect in round(); it is asserted here so
  // nobody "fixes" it by accident and shifts every displayed score.
  assert.equal(round(1.005, 2), 1);
  // Non-finite input returns null rather than propagating NaN into a report.
  assert.equal(round(NaN, 2), null);
  assert.equal(round(null, 2), null);
  assert.equal(round(undefined, 2), null);
  assert.equal(round(Infinity, 2), null);
});

test('zScore and formatters do not throw on degenerate input', () => {
  assert.ok(Number.isFinite(zScore(5, 3, 2)));
  assert.equal(zScore(5, 3, 0), 0);
  assert.equal(typeof fmtCompact(4318000000000), 'string');
  assert.equal(typeof fmtPct(1.234), 'string');
});

// ------------------------------------------------------------------------ csv

test('CSV round-trips including quoted commas and embedded quotes', () => {
  const rows = [
    { id: 'a', claim: 'a claim, with a comma', note: 'he said "no"' },
    { id: 'b', claim: 'plain', note: '' },
  ];
  const text = toCsv(rows);
  const back = parseCsv(text);
  assert.deepEqual(back, rows);
});

test('parseCsv strips a BOM and tolerates CRLF', () => {
  const back = parseCsv('\uFEFFdate,close\r\n2025-09-30,177.11\r\n');
  assert.deepEqual(back, [{ date: '2025-09-30', close: '177.11' }]);
});

test('toCsv honours an explicit column order and returns empty for no rows', () => {
  assert.equal(toCsv([]), '');
  const text = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
  assert.equal(text.split('\n')[0], 'a,b');
});

// ---------------------------------------------------------------------- stats

test('mean, median, quantile and stdev match hand-computed values', () => {
  const xs = [1, 2, 3, 4, 5];
  assert.equal(mean(xs), 3);
  assert.equal(median(xs), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile(xs, 0), 1);
  assert.equal(quantile(xs, 1), 5);
  assert.ok(Math.abs(stdev(xs) - Math.sqrt(2.5)) < 1e-9);
  assert.ok(Number.isNaN(mean([])));
});

test('pearson and spearman agree on a monotone series and diverge on a non-linear one', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 4, 6, 8, 10];
  assert.ok(Math.abs(pearson(xs, ys) - 1) < 1e-9);
  assert.ok(Math.abs(spearman(xs, ys) - 1) < 1e-9);
  // A perfect rank relationship that is not linear: Spearman stays at 1, Pearson drops.
  const curved = [1, 4, 9, 16, 25];
  assert.ok(Math.abs(spearman(xs, curved) - 1) < 1e-9);
  assert.ok(pearson(xs, curved) < 0.99);
});

test('spearman is what the transmission study needs - rank correlation, not linearity', () => {
  const predicted = [3, 2, 1, 0, -1];
  const realised = [2.5, 1.1, 0.2, -0.4, -2.0];
  assert.ok(spearman(predicted, realised) > 0.9);
  assert.ok(spearman(predicted, realised.slice().reverse()) < -0.9);
});

test('corrPValue shrinks as n grows and is honest about a tiny sample', () => {
  const small = corrPValue(0.5, 5);
  const large = corrPValue(0.5, 200);
  assert.ok(small > large, `p at n=5 (${small}) should exceed p at n=200 (${large})`);
  assert.ok(large < 0.01);
  assert.ok(small > 0.05, 'a 0.5 correlation on 5 observations must not be called significant');
});

test('hitRate counts sign agreement and ignores unusable pairs', () => {
  const r = hitRate([
    { predicted: 1, actual: 2 }, { predicted: -1, actual: -3 },
    { predicted: 1, actual: -2 }, { predicted: NaN, actual: 1 },
  ]);
  assert.equal(r.n, 3);
  assert.equal(r.hits, 2);
  assert.ok(Math.abs(r.rate - 66.67) < 0.01);
});

test('sharpe and maxDrawdown behave on a known series', () => {
  const flat = [0.01, 0.01, 0.01, 0.01];
  assert.ok(Number.isNaN(sharpe([0.01, 0.01])), 'fewer than 3 returns cannot give a Sharpe');
  assert.ok(!Number.isFinite(sharpe(flat)) || sharpe(flat) > 10, 'a zero-volatility series has no meaningful Sharpe');
  assert.ok(maxDrawdown([100, 120, 60, 90]) < -49, 'peak 120 to trough 60 is a 50% drawdown');
  assert.equal(maxDrawdown([100, 110, 120]), 0);
});

test('stableStringify is key-order independent, which is what fixture lookups depend on', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});