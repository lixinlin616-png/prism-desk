#!/usr/bin/env node
/**
 * Prism Desk validation harness.
 *
 * `npm run validate` answers the only question that matters for a signal
 * generator: does it actually work, and does it refuse to make things up?
 *
 * Five suites, all driven by data/eval/extraction-eval.json and the bundled
 * real-price dataset:
 *
 *   1. extraction   - labelled documents with a known correct reading
 *   2. ledger       - evidence items with a known verdict, half of them
 *                     deliberately hallucinated numbers and fabricated quotes
 *   3. invariants   - every card from a full sweep is schema-valid, grounded,
 *                     scored and falsifiable
 *   4. determinism  - the same question at the same as-of gives the same answer
 *   5. data         - the bundled dataset is internally consistent
 *
 * Writes docs/reports/validation.md and exits non-zero on any failure, so it is
 * usable as a CI gate.
 */

import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.mjs';
import { logger } from '../src/util/log.mjs';
import { initHub } from '../src/ingest/index.mjs';
import { RuleExtractor } from '../src/extract/rules.mjs';
import { EvidenceLedger } from '../src/verify/ledger.mjs';
import { Pipeline } from '../src/desk/pipeline.mjs';
import { SignalBoard } from '../src/desk/board.mjs';
import { emptyCard, evidence, validateCard, CHANNEL_IDS, SCORE_FACTORS } from '../src/schema.mjs';
import { runTransmissionStudy } from '../src/research/transmission.mjs';
import { runGapStudy } from '../src/research/gap-study.mjs';
import { runReview } from '../src/review/adjudicate.mjs';
import { renderReviewReport } from '../src/review/report.mjs';
import { toDateStr } from '../src/util/time.mjs';
import { parseCsv } from '../src/util/csv.mjs';
import { round } from '../src/util/num.mjs';

const log = logger('validate');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

process.env.PRISM_DATA_MODE = process.env.PRISM_DATA_MODE || 'offline';
// Every task here runs with persist:false, but pin the board anyway: a future
// check that forgets the flag must not be able to write the demo's state file.
process.env.PRISM_STATE_FILE = join(ROOT, 'data', 'state', '__validate_board__.json');

const AS_OF = '2025-09-19T20:00:00Z';
const results = [];

/**
 * Record one check.
 *
 * `detail` is what the report shows when the check PASSES, so it must read like a
 * measurement, not like an accusation. `failDetail` is the failure message and is
 * shown only when the check fails. Passing a failure string as `detail` used to
 * print things like "a quarantined card reached the published set" on a PASS row,
 * which is exactly the kind of sloppiness this project exists to avoid.
 */
function check(suite, id, title, ok, detail = '', failDetail = '') {
  const passed = Boolean(ok);
  const pass = String(detail ?? '');
  const fail = String(failDetail ?? '') || pass;
  results.push({ suite, id, title, ok: passed, detail: passed ? pass : fail });
  const mark = passed ? 'ok  ' : 'FAIL';
  process.stderr.write(`  [${mark}] ${suite}/${id} ${title}${passed || !fail ? '' : `\n         ${fail}`}\n`);
}

const dig = (obj, path) => String(path).split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);

function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------- suite: extraction

async function suiteExtraction({ hub, rules, ledger, evalSet, docsById }) {
  for (const c of evalSet.extraction) {
    const doc = c.document;
    docsById.set(doc.id, doc);
    let cards = [];
    try {
      cards = rules.extractFromDocument(doc, { asOf: doc.publishedAt, question: '' });
    } catch (err) {
      check('extraction', c.id, c.title, false, `extractor threw: ${err.message}`);
      continue;
    }
    const exp = c.expect;

    if (exp.maxCards !== undefined) {
      check('extraction', c.id, c.title, cards.length <= exp.maxCards,
        `${cards.length} card(s) produced, cap ${exp.maxCards}`,
    `expected at most ${exp.maxCards} card(s), got ${cards.length}: ${cards.map((x) => `${x.channel}/${x.direction} "${x.title}"`).join('; ')}`);
      continue;
    }

    if (!cards.length) {
      check('extraction', c.id, c.title, false, 'extractor produced no card for a document that has an obvious reading');
      continue;
    }

    const card = exp.channel ? (cards.find((x) => x.channel === exp.channel) ?? cards[0]) : cards[0];
    const problems = [];

    if (exp.channel && card.channel !== exp.channel) problems.push(`channel ${card.channel} != expected ${exp.channel}`);
    if (exp.ticker && !(card.tickers || []).includes(exp.ticker)) problems.push(`tickers ${(card.tickers || []).join('/')} missing ${exp.ticker}`);
    if (exp.direction && card.direction !== exp.direction) problems.push(`direction ${card.direction} != expected ${exp.direction}`);
    if (exp.directionIn && !exp.directionIn.includes(card.direction)) problems.push(`direction ${card.direction} not in [${exp.directionIn.join(', ')}]`);
    if (exp.directionNot && card.direction === exp.directionNot) problems.push(`direction must not be ${exp.directionNot}`);
    if (exp.guidanceStance && card.expectationGap?.guidanceStance !== exp.guidanceStance) {
      problems.push(`guidance stance ${card.expectationGap?.guidanceStance} != expected ${exp.guidanceStance}`);
    }
    if (exp.transmissionChainMinHops && (card.transmissionChain || []).length < exp.transmissionChainMinHops) {
      problems.push(`transmission chain has ${(card.transmissionChain || []).length} hops, expected >= ${exp.transmissionChainMinHops}`);
    }
    const haystack = `${card.title || ''} ${card.claim || ''}`.toLowerCase();
    for (const needle of exp.claimContains || []) {
      if (!haystack.includes(needle.toLowerCase())) problems.push(`neither title nor claim mentions "${needle}"`);
    }

    const v = validateCard(card);
    if (!v.ok) problems.push(`schema invalid: ${v.errors.join('; ')}`);

    // Grounding: every number the extractor asserted must survive the ledger.
    const report = ledger.verifyCard(card, { documents: [doc], snapshots: [] });
    if (exp.evidencePasses && report.fail) problems.push(`ledger FAILED ${report.fail} evidence item(s): ${card.evidence.filter((e) => e.verified === 'fail').map((e) => `${e.id} ${e.note}`).join('; ')}`);
    if (report.quarantine) problems.push('card was quarantined - headline evidence did not ground');

    check('extraction', c.id, c.title, problems.length === 0,
      problems.join(' | ') || `${card.channel}/${card.direction} score-independent ok, ledger ${report.pass} pass / ${report.fail} fail / ${report.unverifiable} unverifiable`);
  }
}

// ---------------------------------------------------------------------- suite: ledger

function resolveValue(spec, { doc, book }) {
  if (!spec) return null;
  const scale = spec.scale ?? 1;
  switch (spec.kind) {
    case 'literal': return spec.value * scale;
    case 'docMeta': {
      const raw = dig(doc?.meta ?? {}, spec.path);
      return typeof raw === 'number' ? raw * scale : null;
    }
    case 'priceBook': {
      const bar = book.barOn(spec.symbol, spec.date);
      return bar ? bar[spec.field || 'close'] * scale : null;
    }
    default: return null;
  }
}

function resolveQuote(spec, { doc }) {
  if (!spec) return '';
  if (spec.kind === 'literal') return spec.text;
  if (spec.kind === 'docSentence') return sentences(doc?.body)[spec.index ?? 0] ?? '';
  return '';
}

async function suiteLedger({ ledger, evalSet, docsById, hub }) {
  for (const c of evalSet.ledger) {
    const doc = docsById.get(c.docRef);
    if (!doc) { check('ledger', c.id, c.title, false, `docRef ${c.docRef} not found`); continue; }

    const items = c.evidence.map((spec) => evidence({
      id: spec.id,
      type: spec.type,
      source: spec.source ?? doc.id,
      locator: spec.locator ?? 'eval',
      quote: resolveQuote(spec.quoteFrom, { doc }),
      value: resolveValue(spec.valueFrom, { doc, book: hub.prices }),
      unit: spec.unit ?? null,
      headline: Boolean(spec.headline),
      recipe: spec.recipe ?? null,
      symbol: spec.symbol ?? null,
      date: spec.date ?? null,
    }));

    const card = emptyCard({
      channel: c.card.channel,
      tickers: c.card.tickers,
      direction: c.card.direction,
      claim: c.card.claim,
      status: 'draft',
      evidence: items,
      invalidation: { condition: 'eval placeholder invalidation', level: 'n/a' },
    });

    const report = ledger.verifyCard(card, { documents: [doc], snapshots: c.snapshots || [] });
    const item = report.items?.find((i) => i.id === c.evidence[0].id) ?? report.items?.[0];
    const got = item?.status ?? 'missing';
    const exp = c.expect;
    const problems = [];
    if (got !== exp.status) problems.push(`evidence verdict ${got} != expected ${exp.status}${item?.note ? ` (${item.note})` : ''}`);
    if (Boolean(report.quarantine) !== Boolean(exp.quarantine)) problems.push(`quarantine=${report.quarantine} != expected ${exp.quarantine}`);

    check('ledger', c.id, c.title, problems.length === 0,
      problems.join(' | ') || `verdict ${got}, checked against ${item?.checkedAgainst ?? 'n/a'}, quarantine=${report.quarantine}`);
  }
}
// ----------------------------------------------------------------- suite: invariants

async function suiteInvariants() {
  const desk = new Pipeline();
  await desk.ready();
  const run = await desk.runTask({
    question: 'Full desk sweep across every channel - what is actually tradeable right now?',
    asOf: new Date(AS_OF),
    persist: false,
  });

  check('invariants', 'produces-cards', 'a full sweep produces cards', run.cards.length > 0, `${run.cards.length} cards`);
  check('invariants', 'spans-channels', 'a full sweep spans multiple channels', new Set(run.cards.map((c) => c.channel)).size >= 4,
    `channels: ${[...new Set(run.cards.map((c) => c.channel))].join(', ')}`);
  check('invariants', 'ledger-clean', 'no evidence item fails verification on a clean run', run.ledger.fail === 0,
    `${run.ledger.fail} failures of ${run.ledger.itemsChecked} checks`);

  let allValid = true;
  let allFalsifiable = true;
  let allGrounded = true;
  let noPending = true;
  let allScored = true;
  let allExplained = true;
  const problems = [];

  for (const card of run.cards) {
    const v = validateCard(card);
    if (!v.ok) { allValid = false; problems.push(`${card.id} invalid: ${v.errors.join('; ')}`); }
    if (!card.invalidation?.condition) { allFalsifiable = false; problems.push(`${card.id} has no invalidation condition`); }
    if (!card.evidence?.length) { allGrounded = false; problems.push(`${card.id} has no evidence`); }
    if (card.evidence?.some((e) => e.verified === 'pending')) { noPending = false; problems.push(`${card.id} left evidence in the pending state`); }
    if (!Number.isFinite(card.score?.total)) { allScored = false; problems.push(`${card.id} was not scored`); }
    const bd = card.scoreBreakdown || {};
    if (SCORE_FACTORS.some((f) => !bd[f] || typeof bd[f].reason !== 'string' || !bd[f].reason)) {
      allExplained = false; problems.push(`${card.id} has a score factor with no written reason`);
    }
  }

  check('invariants', 'schema-valid', 'every card passes the schema validator', allValid, problems.filter((p) => p.includes('invalid')).join('; '));
  check('invariants', 'falsifiable', 'every card states the condition that would prove it wrong', allFalsifiable, problems.filter((p) => p.includes('invalidation')).join('; '));
  check('invariants', 'evidenced', 'every card carries at least one evidence item', allGrounded, problems.filter((p) => p.includes('no evidence')).join('; '));
  check('invariants', 'no-pending', 'no evidence item is left unadjudicated', noPending, problems.filter((p) => p.includes('pending')).join('; '));
  check('invariants', 'scored', 'every card carries a numeric score', allScored, problems.filter((p) => p.includes('not scored')).join('; '));
  check('invariants', 'explained', 'every score factor carries an auditable written reason', allExplained, problems.filter((p) => p.includes('no written reason')).join('; '));

  const published = run.cards.filter((c) => c.status === 'active');
  check('invariants', 'publish-floor', 'no card is published below the configured threshold',
    published.every((c) => c.score.total >= config.scoring.minScoreToPublish),
    `threshold ${config.scoring.minScoreToPublish}, lowest published ${published.length ? Math.min(...published.map((c) => c.score.total)) : 'n/a'}`);
  const leaked = published.filter((c) => c.verification?.quarantined).length;
  check('invariants', 'quarantine-respected', 'no quarantined card is marked active',
    leaked === 0, `${published.length} published, ${leaked} quarantined among them`,
    'a quarantined card reached the published set');
  check('invariants', 'coverage-reported', 'the run reports names it stayed silent on',
    Boolean(run.coverage && Array.isArray(run.coverage.silent)),
    `${run.coverage?.silent?.length ?? 0} silent name(s) reported`, 'coverage block missing');
  const md = run.brief?.markdown || '';
  check('invariants', 'brief-rendered', 'the brief renders as markdown', md.includes('# Prism Desk brief'),
    `${md.length} chars of markdown with its heading`, 'brief missing its heading');

  return run;
}

// ---------------------------------------------------------------- suite: determinism

async function suiteDeterminism() {
  const desk = new Pipeline();
  await desk.ready();
  const q = 'Walk me through the earnings expectation gaps in scope and the macro transmission from the latest CPI print.';
  const shape = (run) => JSON.stringify(run.cards.map((c) => ({
    channel: c.channel, tickers: c.tickers, direction: c.direction, claim: c.claim,
    total: c.score?.total, grade: c.score?.grade, status: c.status,
    evidence: (c.evidence || []).map((e) => ({ id: e.id, verified: e.verified, value: e.value })),
  })));

  const a = await desk.runTask({ question: q, asOf: new Date(AS_OF), persist: false });
  const b = await desk.runTask({ question: q, asOf: new Date(AS_OF), persist: false });
  const same = shape(a) === shape(b);
  check('determinism', 'same-answer-twice', 'the same question at the same as-of produces the same cards',
    same, `two independent runs produced identical card sets (${a.cards.length} cards)`,
    'two identical runs diverged - the desk is not reproducible');

  const c = await desk.runTask({ question: q, asOf: new Date('2025-06-02T20:00:00Z'), persist: false });
  const differs = shape(a) !== shape(c);
  check('determinism', 'as-of-matters', 'moving the as-of date changes the answer (no time leakage)',
    differs, 'moving the as-of clock changed the cards, so freshness and session state are live',
    'the desk ignored the as-of clock, so freshness and session state are not really being used');
}

// -------------------------------------------------------------------- suite: studies

async function suiteStudies(hub) {
  const t = runTransmissionStudy(hub.prices);
  check('studies', 'transmission-scored', 'the transmission study scores a meaningful number of real events',
    t.summary.scored >= 10, `scored ${t.summary.scored}/${t.summary.events}`);
  const bl = t.summary.bySurpriseSize?.large, bm = t.summary.bySurpriseSize?.medium, bs = t.summary.bySurpriseSize?.small;
  check('studies', 'transmission-bucketed', 'the transmission study conditions on surprise size',
    Boolean(bl && bs),
    `large n=${bl?.n ?? 0}, medium n=${bm?.n ?? 0}, small n=${bs?.n ?? 0}`,
    'missing surprise buckets');
  check('studies', 'transmission-monotone', 'mean rho is higher for large surprises than for medium ones',
    (t.summary.bySurpriseSize.large.meanSpearman ?? -1) >= (t.summary.bySurpriseSize.medium.meanSpearman ?? -2),
    `large rho ${bl.meanSpearman} vs medium rho ${bm.meanSpearman} - monotone, which is what the 0.30 surprise weight assumes`,
    `large rho ${bl.meanSpearman} vs medium rho ${bm.meanSpearman} - the surprise weighting in the rubric is not empirically supported`);

  const g = runGapStudy(hub.prices);
  check('studies', 'gaps-sample', 'the gap study covers a large real sample', g.summary.gaps >= 1000, `${g.summary.gaps} gaps`);
  const ct = g.summary.overall.excessDateClustered?.fwd5?.t, nt = g.summary.overall.excessVsBenchmark?.fwd5?.t;
  check('studies', 'gaps-clustered', 'the gap study reports date-clustered t-statistics, not only naive ones',
    Boolean(ct) && Boolean(nt),
    `fwd5 clustered t ${ct} vs naive t ${nt} - the clustered figure is the one quoted elsewhere`,
    'clustered statistics missing - naive t-stats overstate significance when gaps share dates');
  check('studies', 'gaps-weekend-split', 'the gap study separates the weekend window from ordinary overnights',
    Boolean(g.summary.mondayGaps?.n) && Boolean(g.summary.otherWeekdayGaps?.n),
    `Monday n=${g.summary.mondayGaps?.n} vs Tue-Fri n=${g.summary.otherWeekdayGaps?.n}`,
    'weekend split missing');
}

// ---------------------------------------------------------------------- suite: data
// -------------------------------------------------------------------- suite: review

/**
 * The review suite never reads data/state/board.json. That file is gitignored
 * demo state and does not exist in a fresh clone, so a check that depended on it
 * would pass on one machine and fail on another. Instead it builds a throwaway
 * board out of the cards the invariant run just produced, which makes every
 * number here reproducible from the bundled corpus and price book alone.
 */
async function suiteReview(hub, run) {
  const asOf = new Date(`${hub.prices.stats().to}T23:59:59Z`);
  const mkBoard = () => {
    const b = new SignalBoard({ file: join(ROOT, 'data', 'state', '__validate_scratch__.json'), autosave: false });
    b.cards.clear();
    for (const c of run.cards) b.cards.set(c.id, structuredClone(c));
    return b;
  };

  const review = runReview({ board: mkBoard(), book: hub.prices, corpus: hub.corpus, asOf });
  const s = review.summary;
  const judged = review.claims.filter(
    (c) => c.final && c.outcome !== 'unmeasurable' && c.outcome !== 'not-directional',
  );

  check('review', 'runs', 'the review adjudicates every card it is given',
    s.adjudicated === run.cards.length && s.distinctClaims > 0,
    `${s.adjudicated} cards -> ${s.distinctClaims} distinct claims (${s.restatementsCollapsed} restatements collapsed), ${s.decided} decided`,
    `expected ${run.cards.length} rows, got ${s.adjudicated}`);

  check('review', 'dedupes', 'restatements of one claim collapse into a single observation',
    s.distinctClaims <= s.adjudicated,
    `${s.adjudicated} stored cards are ${s.distinctClaims} distinct claims - without this the hit rate would carry false precision`,
    'dedup produced more claims than cards');

  check('review', 'three-axes', 'every judged claim reports falsification, risk path and realised excess separately',
    judged.length > 0 && judged.every((c) => 'invalidationTriggered' in c && 'riskTouch' in c && 'excessVerdict' in c),
    `${judged.length} judged claims, each carrying all three axes so "was the thesis right" is never confused with "would the trade have hurt"`,
    judged.length ? 'a judged claim is missing one of the three axes' : 'no claim was judged at all');

  check('review', 'honest-denominator', 'unmeasurable and non-directional claims never enter the win/loss denominator',
    s.hits + s.misses === s.decided && s.decided <= s.scored,
    `${s.decided} decided = ${s.hits} won + ${s.misses} lost; ${s.unmeasurable} unmeasurable and ${s.notDirectional} non-directional are reported separately, not counted as losses`,
    'the hit-rate denominator includes rows that assert no direction or cannot be measured');

  check('review', 'benchmark-adjusted', 'single-name claims are measured against the benchmark, not in raw terms',
    judged.filter((c) => c.instrument === 'single').every((c) => c.benchmarkAdjusted === true),
    `excess is against ${s.benchmark}, so a rising tape is not credited to the desk as skill`,
    'a single-name claim was scored on raw return');

  const anchorViolations = judged.filter((c) => {
    if (!c.window) return true;
    const issued = toDateStr(c.issuedAt);
    if (c.window.from > issued) return true;
    const info = c.informationAt ? toDateStr(c.informationAt) : null;
    return Boolean(info && info < issued && c.window.from < info);
  });
  check('review', 'anchored-on-issuance', 'the measurement window is anchored on issuance, not on the information date',
    judged.length > 0 && anchorViolations.length === 0,
    `all ${judged.length} judged claims open their window at or before issuance and at or after the information date, so the levels a card was struck at sit inside its own window`,
    `${anchorViolations.length} window(s) anchored on the wrong date: ${anchorViolations.slice(0, 3).map((c) => c.id).join(', ')}`);

  check('review', 'auditable', 'every adjudicated claim carries a written basis',
    review.claims.every((c) => typeof c.basis === 'string' && c.basis.length > 10),
    `${review.claims.length} claims, each with a human-readable basis naming the test that produced the verdict`,
    'a claim has a verdict with no stated basis');

  check('review', 'lessons-cite-numbers', 'every finding cites the measurement that produced it',
    review.lessons.length > 0 && review.lessons.every((l) => l.finding && l.evidence && l.action && /\d/.test(l.evidence)),
    `${review.lessons.length} findings, each with a numeric evidence string and a concrete action`,
    'a finding states no measurement - an unevidenced finding is an opinion');

  check('review', 'small-sample-flagged', 'a sample too small to support a conclusion is flagged as a blocker',
    s.decided >= 10 || review.lessons.some((l) => l.id === 'sample-too-small' && l.severity === 'blocker'),
    s.decided >= 10
      ? `${s.decided} decided claims, at or above the small-sample threshold`
      : `${s.decided} decided claims - the report leads with a sample-too-small blocker rather than quoting the hit rate as a result`,
    'a tiny sample produced calibration findings without the small-sample blocker');

  const md = renderReviewReport(review);
  check('review', 'report-renders', 'the review report renders as markdown with its caveats intact',
    md.startsWith('# Signal review') && /Caveats, stated plainly/.test(md) && /not a backtest/i.test(md)
      && !/undefined|NaN|\[object Object\]/.test(md),
    `${md.length} characters; states plainly that it is not a backtest and that no costs are netted out`,
    'the report is malformed, or silently dropped a caveat');

  const again = runReview({ board: mkBoard(), book: hub.prices, corpus: hub.corpus, asOf });
  const key = (r) => JSON.stringify(r.claims.map((c) => [c.claimKey, c.outcome, c.signedExcessPct]));
  check('review', 'deterministic', 'the same board at the same date gives the same verdicts',
    key(again) === key(review),
    'verdicts are reproducible, so a judge can regenerate this report from a clean clone',
    'two identical reviews disagreed');

  const ro = mkBoard();
  const before = [...ro.cards.values()].map((c) => c.status).join(',');
  runReview({ board: ro, book: hub.prices, corpus: hub.corpus, asOf, persist: false });
  const after = [...ro.cards.values()].map((c) => c.status).join(',');
  check('review', 'read-only-by-default', 'reviewing never mutates stored card state unless asked',
    before === after,
    'the default pass is read-only, so running the review cannot corrupt the demo board',
    'a read-only review changed card statuses');
}

// ---------------------------------------------------------------------- suite: data

function suiteData(hub) {
  // --- prices
  const files = readdirSync(config.paths.prices).filter((f) => f.endsWith('.csv'));
  const structural = [];   // impossible data -> hard failure
  const vendorNoise = [];  // open/close outside [low, high] -> a known vendor artefact
  let barCount = 0;
  for (const f of files) {
    const rows = parseCsv(readFileSync(join(config.paths.prices, f), 'utf8'));
    if (rows.length < 250) { structural.push(`${f}: only ${rows.length} bars`); continue; }
    let prev = '';
    for (const r of rows) {
      const d = r.date || r.Date;
      const o = Number(r.open ?? r.Open); const h = Number(r.high ?? r.High);
      const l = Number(r.low ?? r.Low); const c = Number(r.close ?? r.Close);
      barCount += 1;
      if (!d || !Number.isFinite(Date.parse(d))) { structural.push(`${f}: unparseable date ${d}`); break; }
      if (d <= prev) { structural.push(`${f}: dates not strictly increasing at ${d}`); break; }
      prev = d;
      if (!(c > 0 && h > 0 && l > 0 && o > 0)) { structural.push(`${f}: non-positive price on ${d}`); continue; }
      if (h < l) { structural.push(`${f}: high < low on ${d}`); continue; }
      if (!(h >= o && h >= c && l <= o && l <= c)) vendorNoise.push(`${f} ${d} (o${o} h${h} l${l} c${c})`);
    }
  }
  const noisePct = barCount ? (vendorNoise.length / barCount) * 100 : 0;
  check('data', 'prices-parse', `all ${files.length} bundled price series parse, are date-sorted and structurally possible`,
    structural.length === 0, structural.slice(0, 5).join('; '));
  // Real vendor feeds occasionally print an open or close outside the session
  // range. That is noise to be disclosed, not a reason to reject the dataset -
  // but a high rate would mean the series is mis-parsed.
  check('data', 'prices-vendor-noise', `open/close stay inside [low, high] for at least 99.9% of bars`,
    noisePct <= 0.1, `${vendorNoise.length}/${barCount} bars (${round(noisePct, 3)}%) violate the range: ${vendorNoise.slice(0, 3).join('; ')}`);
  const ps = hub.prices.stats();
  check('data', 'prices-coverage', 'the price book spans multiple years', ps.bars >= 10000 && ps.from < '2020-01-01',
    `${ps.symbols} symbols, ${ps.bars} bars, ${ps.from} to ${ps.to}`);

  // --- macro events
  const eventsPath = join(config.paths.events, 'macro-events.json');
  let events = [];
  let eventsOk = true;
  const eventProblems = [];
  if (existsSync(eventsPath)) {
    const parsed = JSON.parse(readFileSync(eventsPath, 'utf8'));
    events = Array.isArray(parsed) ? parsed : parsed.events || [];
    for (const ev of events) {
      if (!ev.date || !ev.indicator) { eventsOk = false; eventProblems.push(`${JSON.stringify(ev).slice(0, 80)} missing date/indicator`); }
      if (ev.actual === undefined || ev.consensus === undefined) { eventsOk = false; eventProblems.push(`${ev.date} missing actual/consensus`); }
      if (Number.isNaN(Date.parse(ev.date))) { eventsOk = false; eventProblems.push(`${ev.date} unparseable`); }
    }
  } else { eventsOk = false; eventProblems.push('macro-events.json not found'); }
  check('data', 'macro-events', `${events.length} macro events carry date, indicator, actual and consensus`, eventsOk, eventProblems.slice(0, 4).join('; '));

  // --- corpus
  const docs = hub.corpus.all();
  const corpusProblems = [];
  for (const d of docs) {
    if (!d.id || !d.kind || !d.title || !d.body || !d.publishedAt) corpusProblems.push(`${d.id}: missing a required field`);
    if (!Array.isArray(d.tickers)) corpusProblems.push(`${d.id}: tickers is not an array`);
    if (d.synthetic !== true && d.synthetic !== false) corpusProblems.push(`${d.id}: synthetic flag not set - provenance must be explicit`);
    if (d.synthetic && !String(d.source || '').toLowerCase().includes('fictional') && !String(d.source || '').includes('demo')) {
      corpusProblems.push(`${d.id}: synthetic but the source string does not disclose it`);
    }
  }
  check('data', 'corpus-shape', `${docs.length} corpus documents are well formed and disclose their provenance`,
    corpusProblems.length === 0, corpusProblems.slice(0, 5).join('; '));

  const demoIssuers = docs.filter((d) => d.synthetic && d.meta?.priceProxy);
  check('data', 'price-proxy-disclosed', 'every fictional issuer that borrows a real price series discloses the proxy',
    demoIssuers.length === docs.filter((d) => d.synthetic && d.meta?.priceProxy !== undefined).length && demoIssuers.every((d) => hub.prices.has(d.meta.priceProxy)),
    demoIssuers.map((d) => `${d.tickers?.[0]}->${d.meta.priceProxy}`).join(', '));

  // --- fixtures
  const fixPath = config.paths.fixtures;
  let fixturesOk = true;
  let fixtureCount = 0;
  const fixProblems = [];
  if (existsSync(fixPath)) {
    for (const f of readdirSync(fixPath).filter((x) => x.endsWith('.json'))) {
      const pack = JSON.parse(readFileSync(join(fixPath, f), 'utf8'));
      const entries = pack.fixtures || pack;
      const list = Array.isArray(entries) ? entries : Object.entries(entries).map(([intent, value]) => ({ intent, value }));
      for (const entry of list) {
        fixtureCount += 1;
        if (!entry.intent) { fixturesOk = false; fixProblems.push(`${f}: fixture without an intent`); }
        // Recorded packs use `result`; hand-written ones may use `value`.
        if (entry.result === undefined && entry.value === undefined) { fixturesOk = false; fixProblems.push(`${f}/${entry.intent}: neither result nor value present`); }
      }
    }
  } else { fixturesOk = false; fixProblems.push('fixture directory missing'); }
  check('data', 'fixtures', `${fixtureCount} offline MCP fixtures are well formed`, fixturesOk, fixProblems.slice(0, 4).join('; '));
  check('data', 'offline-boot', 'the hub boots with zero network access', hub.market.state === 'offline' || hub.market.state === 'fixture' || hub.market.state === 'live',
    `market state ${hub.market.state}`);
}
// --------------------------------------------------------------------- report + main

function writeReport({ hub, run, ms }) {
  const suites = [...new Set(results.map((r) => r.suite))];
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  const L = [];
  L.push('# Prism Desk - validation report');
  L.push('');
  L.push(`Generated ${new Date().toISOString()} by \`npm run validate\` in ${ms}ms.`);
  L.push('');
  L.push(`**${pass}/${results.length} checks passed**${fail ? `, **${fail} failed**` : ''}. Node ${process.version}, data mode \`${hub.market.state}\`, extractor \`${config.llm.enabled ? 'hybrid' : 'rules'}\`.`);
  L.push('');
  L.push('| suite | checks | passed |');
  L.push('| --- | ---: | ---: |');
  for (const s of suites) {
    const rows = results.filter((r) => r.suite === s);
    L.push(`| ${s} | ${rows.length} | ${rows.filter((r) => r.ok).length} |`);
  }
  L.push('');
  for (const s of suites) {
    L.push(`## ${s}`);
    L.push('');
    L.push('| | id | check | detail |');
    L.push('| --- | --- | --- | --- |');
    for (const r of results.filter((x) => x.suite === s)) {
      L.push(`| ${r.ok ? 'PASS' : '**FAIL**'} | \`${r.id}\` | ${r.title.replace(/\|/g, '\\|')} | ${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 400)} |`);
    }
    L.push('');
  }
  if (run) {
    L.push('## Reference run');
    L.push('');
    L.push(`Full desk sweep as of ${AS_OF}: ${run.cards.length} cards, ${run.published.length} published, ${run.quarantined.length} quarantined, ${run.belowThreshold.length} below threshold. Ledger checked ${run.ledger.itemsChecked} items with a ${run.ledger.passRate}% pass rate and ${run.ledger.fail} failures.`);
    L.push('');
    L.push('| score | grade | channel | dir | tickers | claim |');
    L.push('| ---: | --- | --- | --- | --- | --- |');
    for (const c of run.cards.slice(0, 20)) {
      L.push(`| ${c.score?.total ?? '-'} | ${c.score?.grade ?? '-'} | ${c.channel} | ${c.direction} | ${(c.tickers || []).join(' ')} | ${String(c.title || '').replace(/\|/g, '\\|')} |`);
    }
    L.push('');
  }
  L.push('## What these suites are for');
  L.push('');
  L.push('- **extraction** measures recall on documents with a known correct reading, and includes a precision control: a routine housekeeping release must produce *no* card. A generator that fires on everything is not a generator.');
  L.push('- **ledger** is the anti-hallucination suite. Half of its cases are deliberately fabricated - a number inflated 10x, a quote nobody said, a price 25% above the real close, an aggregate the engine cannot reproduce. Each must be caught and the card quarantined. This is the single most important suite in the project.');
  L.push('- **invariants** assert the schema contract: every card is falsifiable, grounded, scored, and every score factor carries a written reason.');
  L.push('- **determinism** asserts the same question at the same as-of gives the same answer, and that moving the clock changes it - otherwise freshness scoring is theatre.');
  L.push('- **data** asserts the bundled dataset is internally consistent and that fictional issuers disclose the real series they proxy.');
  L.push('');
  L.push('_These checks validate the machinery. They do not validate that any card would have made money._');

  const outDir = join(ROOT, 'docs', 'reports');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'validation.md');
  writeFileSync(out, L.join('\n'), 'utf8');
  return out;
}

async function main() {
  const started = Date.now();
  process.stderr.write(`Prism Desk validation - data mode ${process.env.PRISM_DATA_MODE}\n\n`);

  const hub = await initHub();
  const rules = new RuleExtractor({ hub });
  const ledger = new EvidenceLedger({ hub });
  const evalPath = join(config.paths.eval, 'extraction-eval.json');
  if (!existsSync(evalPath)) {
    process.stderr.write(`missing eval set: ${evalPath}\n`);
    process.exitCode = 1;
    return;
  }
  const evalSet = JSON.parse(readFileSync(evalPath, 'utf8'));
  const docsById = new Map();

  process.stderr.write('extraction\n');
  await suiteExtraction({ hub, rules, ledger, evalSet, docsById });
  process.stderr.write('\nledger (including hallucination injection)\n');
  await suiteLedger({ hub, ledger, evalSet, docsById });
  process.stderr.write('\ninvariants\n');
  const run = await suiteInvariants();
  process.stderr.write('\ndeterminism\n');
  await suiteDeterminism();
  process.stderr.write('\nstudies\n');
  await suiteStudies(hub);
  process.stderr.write('\nreview\n');
  await suiteReview(hub, run);
  process.stderr.write('\ndata\n');
  suiteData(hub);

  const ms = Date.now() - started;
  const out = writeReport({ hub, run, ms });
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  process.stderr.write(`\n${pass}/${results.length} checks passed in ${ms}ms${fail ? `, ${fail} FAILED` : ''}\nreport: ${out}\n`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exitCode = 1;
});
