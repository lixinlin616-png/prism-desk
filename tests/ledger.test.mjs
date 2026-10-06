/**
 * Evidence ledger tests - the anti-hallucination suite.
 *
 * These are the most important tests in the project. A signal generator that
 * can invent a number is worse than no generator at all, so the ledger is
 * attacked directly here: inflated metrics, fabricated quotes, tampered prices,
 * unsourced claims and computed aggregates the engine cannot reproduce.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceLedger, closeEnough, containsQuote, numbersIn, findValueIn,
  recountInsider, recountInstitutional,
} from '../src/verify/ledger.mjs';
import { PriceBook } from '../src/ingest/prices.mjs';
import { config } from '../src/config.mjs';
import { emptyCard, evidence } from '../src/schema.mjs';

const book = new PriceBook(config.paths.prices).load();

const DOC = {
  id: 'doc-release',
  kind: 'earnings-release',
  title: 'Corvus Semiconductor Q2 results: revenue above consensus',
  publishedAt: '2025-09-09T20:05:00Z',
  source: 'test',
  tickers: ['CRVS'],
  synthetic: true,
  meta: { metric: 'EPS', actual: 1.42, consensus: 1.24, revenueActual: 9.84, revenueConsensus: 9.31 },
  body: 'Corvus Semiconductor reported revenue of 9.84 billion dollars, above the 9.31 billion consensus. Non-GAAP earnings per share were 1.42 dollars against consensus of 1.24 dollars. Management said demand visibility remains strong and the backlog grew sequentially.',
};

const ledgerOf = (tol) => new EvidenceLedger({ hub: { prices: book }, tolerancePct: tol ?? config.verify.numericTolerancePct });

const cardWith = (items) => emptyCard({
  channel: 'earnings-gap',
  tickers: ['CRVS'],
  direction: 'long',
  claim: 'CRVS beat consensus on both lines.',
  evidence: items,
  invalidation: { condition: 'price gives back the gap', level: 1 },
});

// --------------------------------------------------------------- pure helpers

test('closeEnough honours the relative tolerance', () => {
  assert.ok(closeEnough(100, 101.9, 2));
  assert.ok(!closeEnough(100, 102.1, 2));
  assert.ok(!closeEnough(100, null, 2));
  assert.ok(closeEnough(0.0001, 0.0001, 2));
});

test('containsQuote finds exact, near and absent quotes', () => {
  const exact = containsQuote(DOC.body, 'revenue of 9.84 billion dollars');
  assert.equal(exact.found, true);
  assert.equal(exact.method, 'exact');

  const fuzzy = containsQuote(DOC.body, 'Corvus Semiconductor reported revenue of 9.84 billion dollars, above the 9.31 billion dollars consensus figure');
  assert.equal(fuzzy.found, true, 'a lightly paraphrased quote should still ground via token overlap');

  const absent = containsQuote(DOC.body, 'the company announced a special dividend and a doubling of revenue by 2027');
  assert.equal(absent.found, false);
});

test('numbersIn parses currency, percent, comma-grouped and negative numbers', () => {
  const found = numbersIn('Revenue $9.84bn, up 62%, from $1,234,567 and -3.5% down').map((n) => n.value);
  assert.ok(found.includes(9.84));
  assert.ok(found.includes(62));
  assert.ok(found.includes(1234567));
  assert.ok(found.includes(-3.5));
});

test('findValueIn walks nested structures and reports the path', () => {
  const hit = findValueIn({ a: { b: [1, { c: 9.84 }] } }, 9.84, 2);
  assert.ok(hit);
  assert.match(hit.path, /a\.b\[1\]\.c/);
  assert.equal(findValueIn({ a: 1 }, 55, 2), null);
});

test('recountInsider and recountInstitutional recompute from raw rows', () => {
  const insider = recountInsider({ rows: [{ type: 'sell' }, { type: 'sell' }, { type: 'buy' }] }, null);
  assert.deepEqual(insider, { sells: 2, buys: 1 });
  const inst = recountInstitutional({ holders: [{ changePct: 12 }, { changePct: -9 }, { changePct: 1 }] });
  assert.deepEqual(inst, { increased: 1, decreased: 1, net: 0 });
});

// --------------------------------------------------------------- verification

test('a metric that really is in the document passes and reports where it was checked', () => {
  const ledger = ledgerOf();
  const card = cardWith([evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 9.84, headline: true })]);
  const report = ledger.verifyCard(card, { documents: [DOC], snapshots: [] });
  assert.equal(report.pass, 1);
  assert.equal(report.fail, 0);
  assert.equal(report.quarantine, false);
  assert.match(card.evidence[0].checkedAgainst, /doc-release/);
});

test('HALLUCINATION: the same number inflated 10x fails and quarantines the card', () => {
  const ledger = ledgerOf();
  const card = cardWith([evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 98.4, headline: true })]);
  const report = ledger.verifyCard(card, { documents: [DOC], snapshots: [] });
  assert.equal(report.fail, 1);
  assert.equal(report.headlineFail, true);
  assert.equal(report.quarantine, true);
  assert.equal(card.status, 'quarantined', 'the card must be pulled from circulation');
  assert.match(card.evidence[0].note, /does not appear/);
});

test('a non-headline failure does not quarantine, but is still counted and shown', () => {
  const ledger = ledgerOf();
  const card = cardWith([
    evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 1.42, headline: true }),
    evidence({ id: 'E2', type: 'metric', source: DOC.id, value: 9999, headline: false }),
  ]);
  const report = ledger.verifyCard(card, { documents: [DOC], snapshots: [] });
  assert.equal(report.pass, 1);
  assert.equal(report.fail, 1);
  assert.equal(report.quarantine, false);
  assert.equal(report.passRate, 50);
});

test('a number inside the tolerance passes; one outside fails', () => {
  const ledger = ledgerOf(2);
  const near = cardWith([evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 9.9, headline: true })]);
  assert.equal(ledger.verifyCard(near, { documents: [DOC] }).pass, 1);
  const far = cardWith([evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 11.5, headline: true })]);
  assert.equal(ledger.verifyCard(far, { documents: [DOC] }).fail, 1);
});

test('a verbatim quote passes; a fabricated quote fails and quarantines', () => {
  const ledger = ledgerOf();
  const real = cardWith([evidence({ id: 'E1', type: 'quote', source: DOC.id, quote: 'Non-GAAP earnings per share were 1.42 dollars against consensus of 1.24 dollars.', headline: true })]);
  assert.equal(ledger.verifyCard(real, { documents: [DOC] }).pass, 1);

  const fake = cardWith([evidence({ id: 'E1', type: 'quote', source: DOC.id, quote: 'Management committed to returning all free cash flow to shareholders via a special dividend.', headline: true })]);
  const report = ledger.verifyCard(fake, { documents: [DOC] });
  assert.equal(report.fail, 1);
  assert.equal(report.quarantine, true);
});

test('quoting the document title counts as grounding', () => {
  const ledger = ledgerOf();
  const card = cardWith([evidence({ id: 'E1', type: 'quote', source: DOC.id, quote: 'Corvus Semiconductor Q2 results: revenue above consensus', headline: true })]);
  const report = ledger.verifyCard(card, { documents: [DOC] });
  assert.equal(report.pass, 1);
  assert.match(card.evidence[0].checkedAgainst, /title/);
});

test('a number citing a document that is not in scope is unverifiable, never pass', () => {
  const ledger = ledgerOf();
  const card = cardWith([evidence({ id: 'E1', type: 'metric', source: 'no-such-doc', value: 9.84, headline: false })]);
  const report = ledger.verifyCard(card, { documents: [DOC] });
  assert.equal(report.unverifiable, 1);
  assert.equal(report.pass, 0);
});

test('an authoritative data snapshot outranks the document when both exist', () => {
  const ledger = ledgerOf();
  const snap = { intent: 'quote', args: { ticker: 'CRVS' }, origin: 'fixture', value: { symbol: 'CRVS', last: 55.5 } };
  const card = cardWith([evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 55.5, headline: true })]);
  const report = ledger.verifyCard(card, { documents: [DOC], snapshots: [snap] });
  assert.equal(report.pass, 1);
  assert.match(card.evidence[0].checkedAgainst, /fixture/);
});

test('price claims are checked against the real bundled OHLCV', () => {
  const ledger = ledgerOf();
  const bar = book.barOn('NVDA', '2025-09-30');
  assert.ok(bar, 'the bundled dataset should have an NVDA bar on 2025-09-30');

  const right = cardWith([evidence({ id: 'E1', type: 'price', source: 'price-book', symbol: 'NVDA', date: '2025-09-30', value: bar.close, headline: true })]);
  const okReport = ledger.verifyCard(right, { documents: [] });
  assert.equal(okReport.pass, 1);
  assert.match(right.evidence[0].checkedAgainst, /price-book NVDA/);

  const wrong = cardWith([evidence({ id: 'E1', type: 'price', source: 'price-book', symbol: 'NVDA', date: '2025-09-30', value: bar.close * 1.25, headline: true })]);
  const badReport = ledger.verifyCard(wrong, { documents: [] });
  assert.equal(badReport.fail, 1);
  assert.equal(badReport.quarantine, true);

  const unknown = cardWith([evidence({ id: 'E1', type: 'price', source: 'price-book', symbol: 'NOTREAL', date: '2025-09-30', value: 10, headline: false })]);
  assert.equal(ledger.verifyCard(unknown, { documents: [] }).unverifiable, 1);
});

test('a computed aggregate is only trusted if the engine can reproduce it', () => {
  const ledger = ledgerOf();
  const snap = {
    intent: 'insiderTrades',
    args: { ticker: 'CRVS' },
    origin: 'fixture',
    value: { rows: [{ type: 'sell' }, { type: 'sell' }, { type: 'buy' }] },
  };
  const right = cardWith([evidence({ id: 'E1', type: 'computed', source: 'engine', symbol: 'CRVS', recipe: 'insider-sell-count', value: 2, headline: true })]);
  const okReport = ledger.verifyCard(right, { documents: [], snapshots: [snap] });
  assert.equal(okReport.pass, 1);
  assert.match(right.evidence[0].checkedAgainst, /recounted insiderTrades/);

  const wrong = cardWith([evidence({ id: 'E1', type: 'computed', source: 'engine', symbol: 'CRVS', recipe: 'insider-sell-count', value: 9, headline: true })]);
  const badReport = ledger.verifyCard(wrong, { documents: [], snapshots: [snap] });
  assert.equal(badReport.fail, 1);
  assert.equal(badReport.quarantine, true);
});

test('an unknown evidence type is unverifiable rather than silently passed', () => {
  const ledger = ledgerOf();
  const card = cardWith([evidence({ id: 'E1', type: 'vibes', source: DOC.id, value: 1, headline: false })]);
  const report = ledger.verifyCard(card, { documents: [DOC] });
  assert.equal(report.unverifiable, 1);
  assert.match(card.evidence[0].note, /no verification strategy/);
});

test('the ledger summary aggregates across cards and never leaves an item pending', () => {
  const ledger = ledgerOf();
  for (const value of [9.84, 98.4, null]) {
    ledger.verifyCard(cardWith([evidence({ id: 'E1', type: 'metric', source: DOC.id, value, headline: false })]), { documents: [DOC] });
  }
  const s = ledger.summary();
  assert.equal(s.cardsAudited, 3);
  assert.equal(s.itemsChecked, 3);
  assert.equal(s.pass, 1);
  assert.equal(s.fail, 1);
  assert.equal(s.unverifiable, 1);
  assert.ok(s.passRate > 0 && s.passRate < 100);
});

test('verification is deterministic - the same card audits to the same verdict', () => {
  const a = ledgerOf();
  const b = ledgerOf();
  const build = () => cardWith([
    evidence({ id: 'E1', type: 'metric', source: DOC.id, value: 1.42, headline: true }),
    evidence({ id: 'E2', type: 'quote', source: DOC.id, quote: 'demand visibility remains strong', headline: false }),
  ]);
  const strip = (r) => ({ ...r, items: undefined, verifiedAt: undefined, cardId: undefined });
  const ra = a.verifyCard(build(), { documents: [DOC] });
  const rb = b.verifyCard(build(), { documents: [DOC] });
  // verifiedAt is a wall-clock stamp and is deliberately excluded
  assert.deepEqual(strip(ra), strip(rb));
  assert.deepEqual(
    ra.items.map((i) => ({ id: i.id, status: i.status, checkedAgainst: i.checkedAgainst })),
    rb.items.map((i) => ({ id: i.id, status: i.status, checkedAgainst: i.checkedAgainst })),
  );
});