/**
 * Scoring rubric tests.
 *
 * The rubric is the part of Prism that turns evidence into a ranking, so it has
 * to be transparent and monotone: more surprise, more corroboration, fresher
 * information and a real invalidation condition must all push the score up, and
 * every factor must explain itself in prose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, scoreCard, rankCards, explainScore,
  scoreSurprise, scoreCorroboration, scoreTradability, scoreAsymmetry, scoreFreshness,
} from '../src/score/rubric.mjs';
import { emptyCard, evidence, SCORE_FACTORS } from '../src/schema.mjs';
import { addHours } from '../src/util/time.mjs';
import { config } from '../src/config.mjs';

const AT = '2025-09-19T20:00:00Z';

const ev = (over = {}) => evidence({
  id: 'E1', type: 'metric', source: 'doc-1', locator: 'meta', quote: 'EPS 1.42 vs 1.24 consensus',
  value: 1.42, headline: true, verified: 'pass', ...over,
});

const base = (over = {}) => emptyCard({
  channel: 'earnings-gap',
  title: 'CRVS: EPS beat, guide raise',
  claim: 'CRVS printed EPS 1.42 vs a 1.24 consensus (+14.5%) and raised guidance.',
  direction: 'long',
  horizon: 'days',
  tickers: ['CRVS'],
  instruments: ['native-equity', 'rtoken'],
  createdAt: AT,
  informationAt: AT,
  expiresAt: addHours(AT, 24 * 5),
  evidence: [ev()],
  invalidation: { condition: 'Price gives back the gap within two sessions.', level: 100 },
  risks: ['Guidance lexicon can flip on one ambiguous sentence.'],
  expectationGap: { metric: 'EPS', consensus: 1.24, actual: 1.42, deltaPct: 14.5, sigma: 1.8, source: 'doc-1', confidence: 0.9 },
  ...over,
});

test('the rubric weights sum to exactly 1', () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
  assert.deepEqual(Object.keys(WEIGHTS).sort(), [...SCORE_FACTORS].sort());
});

test('scoreCard fills in every factor with a numeric score, a weight and a written reason', () => {
  const score = scoreCard(base(), { at: AT });
  assert.ok(Number.isFinite(score.total));
  assert.ok(score.total >= 0 && score.total <= 100, `total ${score.total} out of range`);
  const card = base();
  scoreCard(card, { at: AT });
  for (const f of SCORE_FACTORS) {
    const factor = card.scoreBreakdown[f];
    assert.ok(factor, `missing factor ${f}`);
    assert.ok(Number.isFinite(factor.score), `${f}.score is not numeric`);
    assert.ok(Number.isFinite(factor.weight), `${f}.weight is not numeric`);
    assert.ok(typeof factor.reason === 'string' && factor.reason.length > 10, `${f} has no written reason`);
  }
  assert.equal(card.score.grade, card.score.total >= 75 ? 'A' : card.score.total >= 62 ? 'B' : card.score.total >= 48 ? 'C' : card.score.total >= 35 ? 'D' : 'F');
});

test('a bigger expectation gap scores higher on surprise', () => {
  const small = scoreSurprise(base({ expectationGap: { metric: 'EPS', consensus: 1.24, actual: 1.26, deltaPct: 1.6, sigma: 0.2, confidence: 0.9 } }));
  const large = scoreSurprise(base({ expectationGap: { metric: 'EPS', consensus: 1.24, actual: 1.86, deltaPct: 50, sigma: 3.2, confidence: 0.9 } }));
  assert.ok(large.score > small.score, `sigma 3.2 scored ${large.score}, sigma 0.2 scored ${small.score}`);
});

test('more independent corroborating evidence scores higher', () => {
  const one = scoreCorroboration(base({ evidence: [ev()] }));
  const many = scoreCorroboration(base({
    evidence: [
      ev({ id: 'E1' }),
      ev({ id: 'E2', type: 'quote', value: null, source: 'doc-2' }),
      ev({ id: 'E3', type: 'fundamental', value: 72.4, source: 'doc-3' }),
    ],
  }));
  assert.ok(many.score > one.score, `3 items scored ${many.score}, 1 item scored ${one.score}`);
});

test('fresher information scores higher on freshness', () => {
  const fresh = scoreFreshness(base({ informationAt: AT }), AT);
  const stale = scoreFreshness(base({ informationAt: addHours(AT, -24 * 12) }), AT);
  assert.ok(fresh.score > stale.score, `fresh ${fresh.score} vs 12-day-old ${stale.score}`);
  assert.equal(fresh.score, 100);
});

test('an expired card scores zero on freshness - time-boxed signals are not renewable', () => {
  const expired = scoreFreshness(base({ expiresAt: addHours(AT, -1) }), AT);
  assert.equal(expired.score, 0);
  assert.match(expired.reason, /expired/i);
});

test('freshness decays against informationAt, not against when the card was written', () => {
  // Same issue time, different information age: the older information must score worse.
  const recentInfo = scoreFreshness(base({ createdAt: AT, informationAt: addHours(AT, -2) }), AT);
  const oldInfo = scoreFreshness(base({ createdAt: AT, informationAt: addHours(AT, -72) }), AT);
  assert.ok(recentInfo.score > oldInfo.score);
});

test('FAILED headline evidence costs 35 points and blocks publication outright', () => {
  const card = base({ evidence: [ev({ verified: 'fail' })] });
  const score = scoreCard(card, { at: AT });
  assert.ok(score.penalties.some((p) => p.id === 'headline-unverified' && p.amount === 35));
  assert.equal(score.publishable, false);
});

test('a card with no invalidation condition is penalised - unfalsifiable claims cannot be published', () => {
  const card = base({ invalidation: null });
  const score = scoreCard(card, { at: AT });
  assert.ok(score.penalties.some((p) => p.id === 'no-invalidation'));
  assert.ok(score.total < scoreCard(base(), { at: AT }).total);
});

test('a card with no stated bear case is penalised', () => {
  const withRisks = scoreCard(base(), { at: AT }).total;
  const withoutRisks = scoreCard(base({ risks: [] }), { at: AT }).total;
  assert.ok(withoutRisks < withRisks);
});

test('scores are clamped into [0, 100] no matter how bad the input', () => {
  const terrible = base({
    evidence: [ev({ verified: 'fail' })],
    invalidation: null,
    risks: [],
    expectationGap: null,
    conviction: 0,
  });
  const score = scoreCard(terrible, { at: AT });
  assert.ok(score.total >= 0 && score.total <= 100, `score ${score.total} escaped the clamp`);
  assert.equal(score.grade, 'F');
});

test('rankCards sorts by score and pushes quarantined cards to the bottom', () => {
  const a = base({ id: 'A' });
  const b = base({ id: 'B' });
  const c = base({ id: 'C' });
  scoreCard(a, { at: AT }); scoreCard(b, { at: AT }); scoreCard(c, { at: AT });
  a.score.total = 90; b.score.total = 50; c.score.total = 99; c.status = 'quarantined';
  const ranked = rankCards([a, b, c], { at: AT });
  assert.deepEqual(ranked.map((x) => x.id), ['A', 'B', 'C']);
});

test('explainScore renders the audit trail a human can read', () => {
  const card = base();
  scoreCard(card, { at: AT });
  const text = explainScore(card);
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  for (const f of SCORE_FACTORS) assert.ok(s.toLowerCase().includes(f), `explainScore omits ${f}`);
});

test('the publish threshold is configurable and respected', () => {
  assert.equal(config.scoring.minScoreToPublish, 45);
  const card = base();
  const score = scoreCard(card, { at: AT });
  assert.equal(score.publishable, score.total >= 45);
});

test('non-quantified channels still score rather than throwing', () => {
  for (const channel of ['narrative-shift', 'closed-window', 'cross-asset', 'flow-footprint', 'risk-flag']) {
    const card = base({ channel, expectationGap: null, conviction: 55 });
    const score = scoreCard(card, { at: AT });
    assert.ok(Number.isFinite(score.total), `${channel} produced a non-finite score`);
  }
});

test('weights can be overridden at call time without mutating the module config', () => {
  const before = { ...WEIGHTS };
  const card = base();
  scoreCard(card, { at: AT, weights: { surprise: 1, corroboration: 0, tradability: 0, asymmetry: 0, freshness: 0 } });
  assert.deepEqual(WEIGHTS, before);
  assert.equal(card.scoreBreakdown.corroboration.weight, 0);
});