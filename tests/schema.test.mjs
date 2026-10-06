/**
 * Schema contract tests.
 *
 * The schema is the enforcement point for the project's central claim: a card
 * is a falsifiable, evidenced claim, not an opinion. These tests assert that the
 * validator actually refuses the things it says it refuses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyCard, evidence, validateCard, cardSummary, nextCardId,
  CHANNEL_IDS, DIRECTIONS, HORIZONS, SCORE_FACTORS, EVIDENCE_TYPES,
} from '../src/schema.mjs';

const goodEvidence = () => evidence({
  id: 'E1', type: 'metric', source: 'doc-1', locator: 'meta.actual',
  quote: 'EPS 1.42 vs consensus 1.24', value: 1.42, unit: 'USD', headline: true, verified: 'pass',
});

const goodCard = (over = {}) => emptyCard({
  channel: 'earnings-gap',
  title: 'CRVS: EPS beat, guide raise',
  claim: 'CRVS printed EPS of 1.42 against a 1.24 consensus and raised guidance.',
  direction: 'long',
  horizon: 'days',
  tickers: ['CRVS'],
  evidence: [goodEvidence()],
  invalidation: { condition: 'Price gives back the gap and closes below the prior close.', level: 100 },
  ...over,
});

test('emptyCard carries every field the UI renders', () => {
  const c = emptyCard();
  for (const f of ['id', 'channel', 'status', 'title', 'claim', 'direction', 'horizon', 'instruments', 'tickers',
    'conviction', 'scoreBreakdown', 'evidence', 'invalidation', 'risks', 'catalysts', 'conflicts',
    'expiresAt', 'provenance', 'createdAt', 'informationAt']) {
    assert.ok(f in c, `emptyCard is missing ${f}`);
  }
  assert.equal(c.status, 'draft');
  assert.ok(c.expiresAt, 'expiresAt should be defaulted from the horizon');
  for (const f of SCORE_FACTORS) assert.ok(f in c.scoreBreakdown, `scoreBreakdown missing factor ${f}`);
});

test('a well-formed card validates', () => {
  const v = validateCard(goodCard());
  assert.deepEqual(v.errors, []);
  assert.ok(v.ok);
});

test('a card with no evidence is rejected', () => {
  const v = validateCard(goodCard({ evidence: [] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('no evidence')));
});

test('a card with no invalidation condition is rejected - unfalsifiable claims cannot ship', () => {
  for (const bad of [null, undefined, {}, { level: 100 }]) {
    const v = validateCard(goodCard({ invalidation: bad }));
    assert.equal(v.ok, false, `invalidation ${JSON.stringify(bad)} should have been rejected`);
    assert.ok(v.errors.some((e) => e.includes('invalidation')));
  }
});

test('FAILED headline evidence is a hard error, not a warning', () => {
  const ev = [{ ...goodEvidence(), verified: 'fail' }];
  const v = validateCard(goodCard({ evidence: ev }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('FAILED verification')));
});

test('unverifiable headline evidence is only a warning - it is disclosed, not hidden', () => {
  const ev = [{ ...goodEvidence(), verified: 'unverifiable' }];
  const v = validateCard(goodCard({ evidence: ev }));
  assert.ok(v.ok, v.errors.join('; '));
  assert.ok(v.warnings.some((w) => w.includes('unverifiable')));
});

test('unknown enums are rejected', () => {
  assert.equal(validateCard(goodCard({ channel: 'moonshot' })).ok, false);
  assert.equal(validateCard(goodCard({ direction: 'sideways' })).ok, false);
  assert.equal(validateCard(goodCard({ horizon: 'whenever' })).ok, false);
  assert.equal(validateCard(goodCard({ instruments: ['magic-beans'] })).ok, false);
  assert.equal(validateCard(goodCard({ conviction: 140 })).ok, false);
});

test('malformed tickers are rejected', () => {
  const v = validateCard(goodCard({ tickers: ['TOOLONGTICKER12345'] }));
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('malformed ticker')));
});

test('a claim with no magnitude is warned about', () => {
  const v = validateCard(goodCard({ claim: 'Things are looking better for the company going forward.' }));
  assert.ok(v.warnings.some((w) => w.includes('no magnitude')));
});

test('narrative-shift cards are exempt from the magnitude warning - tone is the signal', () => {
  const v = validateCard(goodCard({
    channel: 'narrative-shift',
    claim: 'Coverage of the name has turned materially more constructive this month.',
  }));
  assert.ok(!v.warnings.some((w) => w.includes('no magnitude')));
});

test('an incoherent trade sketch is warned about', () => {
  const v = validateCard(goodCard({
    direction: 'long',
    tradeSketch: { direction: 'long', entryZone: [100], stop: 120, target: 90, riskPctOfPortfolio: 0.5 },
  }));
  assert.ok(v.warnings.some((w) => w.includes('stop above entry')));
  assert.ok(v.warnings.some((w) => w.includes('target below entry')));
});

test('transmission hops must be complete and bounded', () => {
  const bad = validateCard(goodCard({ transmissionChain: [{ from: 'cpi' }] }));
  assert.equal(bad.ok, false);
  const worse = validateCard(goodCard({ transmissionChain: [{ from: 'a', to: 'b', mechanism: 'm', confidence: 4 }] }));
  assert.equal(worse.ok, false);
  const ok = validateCard(goodCard({ transmissionChain: [{ from: 'a', to: 'b', mechanism: 'm', confidence: 0.6 }] }));
  assert.ok(ok.ok, ok.errors.join('; '));
});

test('cardSummary carries everything the list views need', () => {
  const s = cardSummary(goodCard({ score: { total: 71.5, grade: 'B' } }));
  for (const f of ['id', 'channel', 'title', 'direction', 'horizon', 'tickers', 'score', 'status', 'verifiedRatio', 'hasInvalidation']) {
    assert.ok(f in s, `cardSummary missing ${f}`);
  }
  assert.equal(s.score, 71.5);
  assert.equal(s.verifiedRatio, 1);
  assert.equal(s.hasInvalidation, true);
});

test('card ids are unique', () => {
  const ids = new Set(Array.from({ length: 400 }, () => nextCardId()));
  assert.equal(ids.size, 400);
});

test('the enum sets are internally consistent and non-trivial', () => {
  assert.equal(CHANNEL_IDS.length, 7);
  assert.ok(DIRECTIONS.includes('long') && DIRECTIONS.includes('short') && DIRECTIONS.includes('pair'));
  assert.ok(HORIZONS.length >= 3);
  assert.ok(SCORE_FACTORS.length === 5);
  assert.ok(EVIDENCE_TYPES.includes('quote') && EVIDENCE_TYPES.includes('metric') && EVIDENCE_TYPES.includes('computed'));
});

test('evidence() defaults to pending - nothing is verified until the ledger says so', () => {
  const e = evidence({ id: 'E9', type: 'metric', source: 'doc', value: 1 });
  assert.equal(e.verified, 'pending');
});