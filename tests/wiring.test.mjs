/**
 * Wiring-honesty tests.
 *
 * The desk's whole pitch is that it does not claim what it cannot ground. These
 * tests pin the same discipline at the layer where a claim is easiest to fake:
 * the planner admitting it did not understand, the ingest trace admitting what it
 * asked for and did not receive, an optional data source admitting it is inert,
 * and the demo command producing the same transcript no matter what was run
 * before it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planQuestion, skillsForChannels, SKILL_TRIGGERS, Pipeline } from '../src/desk/pipeline.mjs';
import { DataHub } from '../src/ingest/index.mjs';
import { SIGNAL_SKILLS } from '../src/ingest/bitget-signal.mjs';
import { ChainbaseProvider, AGENTKEY_INTENTS } from '../src/ingest/chainbase.mjs';
import { SignalBoard } from '../src/desk/board.mjs';
import { renderBrief } from '../src/desk/brief.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A card's identity, minus the base-36 wall-clock suffix in its id. */
const shape = (cards) => cards.map((c) => [c.channel, c.title, c.score?.total, c.direction].join('|')).sort();

// ------------------------------------------------------------- plan honesty

test('a question the planner cannot parse is reported as unparsed, not as a sweep', () => {
  const gibberish = planQuestion('asdkjh asdkjh qqq');
  assert.deepEqual(gibberish.matched, [], 'gibberish should match no channel');
  assert.equal(gibberish.sweepRequested, false);
  assert.equal(gibberish.widened, true, 'the fallback must stay labelled as a fallback');
  assert.equal(gibberish.channels.length, 7, 'widening still opens the whole spectrum');

  const sweep = planQuestion('Full desk sweep across every channel - what is actually tradeable right now?');
  assert.equal(sweep.sweepRequested, true, 'an explicit sweep must be recognised as one');
  assert.equal(sweep.widened, false, '...and must not be reported as a parse failure');

  const named = planQuestion('The August CPI print came in cool on the headline but hot on core.');
  assert.ok(named.matched.includes('macro-transmission'));
  assert.equal(named.widened, false);
});

test('a Chinese sweep request is recognised too, so the notice is not English-only', () => {
  const zh = planQuestion('帮我做一次全频道扫描');
  assert.equal(zh.sweepRequested, true);
  assert.equal(zh.widened, false);
});

// ------------------------------------------------------------ skill wiring

test('every skill the desk says it calls is a skill bitget-signal actually ships', () => {
  assert.ok(SKILL_TRIGGERS.length > 0);
  for (const t of SKILL_TRIGGERS) {
    assert.ok(SIGNAL_SKILLS[t.skill], `SKILL_TRIGGERS names an undeclared skill: ${t.skill}`);
    assert.ok(t.channels.length > 0, `${t.skill} is wired to no channel`);
    assert.ok(t.why, `${t.skill} has no stated reason for being called`);
  }
});

test('the closed-window channel pulls crypto-side data, which is the whole argument of that channel', () => {
  // Regression: the skills used to be gated on cross-asset alone, so "周末休市时
  // rToken 怎么定价" - the core S2 scenario - ran with no crypto-side data at all
  // while the cards it produced argued that crypto rails decide the price.
  const q = planQuestion('周末休市的时候 rToken 是怎么定价的？');
  assert.ok(q.matched.includes('closed-window'), 'the rToken weekend question must route to closed-window');

  const forClosedWindow = skillsForChannels(['closed-window']).map((s) => s.skill);
  assert.ok(forClosedWindow.includes('sentiment-analyst'), forClosedWindow.join(','));
  assert.ok(forClosedWindow.includes('macro-analyst'), forClosedWindow.join(','));

  assert.deepEqual(skillsForChannels(['earnings-gap']), [], 'an issuer-level question needs no crypto regime data');
  assert.equal(skillsForChannels(['closed-window', 'cross-asset']).length, forClosedWindow.length, 'a skill is invoked once even when two channels want it');
});

// ------------------------------------------------------- ingest accounting

test('data the plan asked for and did not receive is named, not silently dropped', async () => {
  const hub = await new DataHub().connect();
  const desk = new Pipeline({ hub, board: new SignalBoard({ autosave: false }) });
  await desk.ready();
  const events = [];
  await desk.runTask({
    question: 'Run the contrarian screen. Where do the accounting ratios diverge from the narrative?',
    asOf: new Date('2025-09-19T20:00:00Z'),
    persist: false,
    onEvent: (e) => events.push(e),
  });

  const ingest = events.find((e) => e.stage === 'ingest:data');
  assert.ok(ingest, 'no ingest:data event');
  assert.ok(Array.isArray(ingest.requested) && ingest.requested.length, 'the trace must list what was requested');
  assert.ok(Array.isArray(ingest.missing), 'the trace must list what did not arrive');
  // The risk channel asks for balanceSheet and cashFlow; the bundled fixture pack
  // has neither, so offline they MUST appear as missing rather than vanish.
  const missingNames = ingest.missing.map((m) => m.intent);
  assert.ok(missingNames.includes('balanceSheet'), `balanceSheet went unreported: ${missingNames.join(',')}`);
  assert.ok(missingNames.includes('cashFlow'), `cashFlow went unreported: ${missingNames.join(',')}`);
  for (const m of ingest.missing) assert.ok(m.reason, `${m.intent} has no reason recorded`);
  assert.ok(!ingest.served.some((s) => missingNames.includes(s)), 'an intent cannot be both served and missing');
});

test('the skills that actually ran are listed in the trace, with the channel that asked for them', async () => {
  const hub = await new DataHub().connect();
  const desk = new Pipeline({ hub, board: new SignalBoard({ autosave: false }) });
  await desk.ready();
  const events = [];
  await desk.runTask({
    question: 'A tariff framework just landed on a Saturday afternoon. The cash market is shut but the rToken still trades.',
    asOf: new Date('2025-09-13T15:00:00Z'),
    persist: false,
    onEvent: (e) => events.push(e),
  });
  const ingest = events.find((e) => e.stage === 'ingest:data');
  assert.ok(ingest.skills.length >= 2, `expected the crypto-side skills to run, got ${ingest.skills.length}`);
  for (const s of ingest.skills) {
    assert.ok(s.wantedBy?.length, `${s.skill} ran but no channel is credited with asking for it`);
    if (s.served) assert.ok(s.origin, `${s.skill} served but reported no origin`);
    else assert.ok(s.reason, `${s.skill} failed silently`);
  }
});

// ------------------------------------------------------- brief disclosure

test('the brief says out loud when the desk widened the spectrum because it could not parse', () => {
  const ctx = (plan) => ({ asOf: '2025-09-19T20:00:00Z', session: { state: 'pre-market' }, question: 'x', dataMode: 'offline', llm: { available: false }, plan });
  const widened = renderBrief({ cards: [], context: ctx({ widened: true, matched: [], channels: [], intentsMissing: [], skills: [] }), ledger: {} });
  assert.match(widened.markdown, /How I read this question/);
  assert.match(widened.markdown, /not as an answer to a specific ask/);

  const parsed = renderBrief({ cards: [], context: ctx({ widened: false, matched: ['earnings-gap'], channels: ['earnings-gap'], intentsMissing: [], skills: [] }), ledger: {} });
  assert.doesNotMatch(parsed.markdown, /How I read this question/, 'a question the desk DID parse must not be apologised for');

  const gaps = renderBrief({ cards: [], context: ctx({ widened: false, matched: ['risk-flag'], channels: ['risk-flag'], intentsMissing: [{ intent: 'cashFlow', reason: 'no offline fixture' }], skills: [] }), ledger: {} });
  assert.match(gaps.markdown, /Data I asked for and did not get/);
  assert.match(gaps.markdown, /cashFlow/);
});

// --------------------------------------------------- optional partner source

test('Chainbase AgentKey reports itself disabled and requests nothing without a key', async () => {
  const provider = new ChainbaseProvider({ key: '', url: '' });
  await provider.connect();
  const status = provider.status();
  assert.equal(status.state, 'disabled');
  assert.equal(status.configured, false);
  assert.match(status.reason, /CHAINBASE_AGENT_KEY/);
  assert.equal(status.calls, 0);

  const got = await provider.fetch('news', { symbol: 'NVDA' });
  assert.equal(got.value, null, 'a disabled source must not invent a value');
  assert.equal(got.origin, 'none');
  assert.ok(got.error, 'the envelope must say why there is no value');
});

test('a key with no endpoint is an error the desk reports, not a URL it guesses', async () => {
  const provider = new ChainbaseProvider({ key: 'ak_test', url: '', mode: 'live' });
  await provider.connect();
  assert.equal(provider.status().state, 'error');
  assert.match(provider.status().error, /CHAINBASE_MCP_URL/);
});

test('AgentKey intents are all discoverable names, none of them a hard-coded tool', () => {
  assert.ok(AGENTKEY_INTENTS.length >= 4);
  const provider = new ChainbaseProvider({ key: '', url: '' });
  assert.deepEqual(provider.resolution.size, 0, 'nothing may be resolved before a real tools/list');
});

test('an inert AgentKey leaves the desk output untouched', async () => {
  const hub = await new DataHub().connect();
  const withoutProvider = new Pipeline({ hub, board: new SignalBoard({ autosave: false }) });
  await withoutProvider.ready();
  const baseline = await withoutProvider.runTask({ question: 'Full desk sweep across every channel', asOf: new Date('2025-09-19T20:00:00Z'), persist: false });

  const inertHub = await new DataHub({ chainbase: new ChainbaseProvider({ key: '', url: '' }) }).connect();
  const withProvider = new Pipeline({ hub: inertHub, board: new SignalBoard({ autosave: false }) });
  await withProvider.ready();
  const after = await withProvider.runTask({ question: 'Full desk sweep across every channel', asOf: new Date('2025-09-19T20:00:00Z'), persist: false });

  assert.equal(inertHub.chainbase.status().state, 'disabled');
  assert.deepEqual(shape(after.cards), shape(baseline.cards), 'adding a disabled provider changed the cards');
});

// ------------------------------------------------- platform-independent gates

test('the X-post length gate charges the same on a CRLF checkout as on an LF one', async () => {
  /**
   * Regression: weightedLength() counted the \r in a CRLF line ending, so three
   * posts that sat within 4 units of the 280 limit FAILed on Windows and PASSed
   * on Linux for identical copy. That gate guards a mandatory submission item,
   * and the natural response to a spurious FAIL is deleting real content.
   */
  const { weightedLength } = await import('../scripts/xpost.mjs');
  const lf = '第一行\nsecond line\nhttps://example.com/some/long/path';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(weightedLength(crlf).weighted, weightedLength(lf).weighted, 'CRLF measured longer than LF');
  assert.equal(weightedLength(crlf).plain, weightedLength(lf).plain);
  // A link still collapses to the flat t.co budget regardless of its real length.
  assert.equal(weightedLength('x https://example.com/a/very/long/path').weighted, weightedLength('x https://example.com/b').weighted);
});

test('the committed X-post drafts reach the same verdict with LF and with CRLF', async () => {
  /**
   * The end-to-end form of the regression above, against the real document: the
   * compliance verdict must not depend on how git happened to check the file out.
   */
  const { runXPostCheck } = await import('../scripts/xpost.mjs');
  const doc = readFileSync(join(ROOT, 'docs', 'X-POSTS.md'), 'utf8');
  const lf = doc.replace(/\r\n?/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');

  const a = runXPostCheck(lf);
  const b = runXPostCheck(crlf);
  assert.equal(a.ok, true, `the committed drafts fail their own gate: ${a.posts.filter((p) => !p.checks.every((c) => c.ok)).map((p) => p.id).join(', ')}`);
  assert.equal(b.ok, a.ok, 'the verdict changed when only the line endings did');
  assert.deepEqual(
    b.posts.map((p) => [p.id, p.weighted]),
    a.posts.map((p) => [p.id, p.weighted]),
    'a post measured a different length under CRLF',
  );
});

// --------------------------------------------- published demo vs live backend

test('the published static demo describes the same wiring as the live backend', async () => {
  /**
   * Regression: server.mjs and scripts/export-static.mjs each hand-rolled the
   * /api/capabilities body and they drifted, so the GitHub Pages demo - the
   * artefact a judge actually opens - reported "signal skills 0/5" and had no
   * agentKey block at all, while the live backend reported the truth. One
   * builder now serves both; this test is what stops them separating again.
   */
  const { capabilitiesPayload } = await import('../src/desk/capabilities.mjs');
  const bundle = join(ROOT, 'docs', 'demo', 'data', 'api', 'capabilities.json');
  assert.ok(existsSync(bundle), 'docs/demo is not built - run npm run export:static');
  const recorded = JSON.parse(readFileSync(bundle, 'utf8'));

  const hub = await new DataHub().connect();
  const live = capabilitiesPayload(hub);

  // Compared as sets of wiring facts, not as raw JSON: the bundle is pretty
  // printed and key order is not part of the contract.
  const facts = (c) => ({
    channels: c.channels.map((x) => x.id),
    intents: c.intents.map((x) => [x.id, Boolean(x.resolved), Boolean(x.fixture)]),
    skills: c.skills.map((x) => [x.id, Boolean(x.resolved), Boolean(x.fixture), Boolean(x.wired), x.invokedBy || []]),
    agentKey: [c.agentKey?.provider ?? null, c.agentKey?.state ?? null, (c.agentKey?.intents || []).map((x) => x.id)],
  });
  assert.deepEqual(facts(recorded), facts(live), 'the published demo contradicts the backend it was exported from');

  // And the substance of the fix: the bundle must not under-report the wiring.
  const wired = recorded.skills.filter((s) => s.wired);
  assert.ok(wired.length >= 2, `the bundle credits only ${wired.length} wired skill(s)`);
  for (const s of wired) assert.ok(s.invokedBy?.length, `${s.id} is wired but names no channel`);
  assert.ok(recorded.agentKey, 'the bundle has no agentKey block');
  assert.equal(recorded.agentKey.state, 'disabled', 'the bundle claims an optional source is live without a key');
});

// ------------------------------------------------------- demo idempotency

test('node prism.mjs demo rebuilds the same board whether or not state was left behind', () => {
  /**
   * Regression: the board autosaves to data/state/board.json, so a judge who ran
   * `doctor` or `ask` first - both of which the README recommends - got a
   * transcript whose closing board dump did not match the committed one, and the
   * project's headline "byte-for-byte reproducible" claim failed for exactly the
   * reader most likely to test it. `demo` now clears first.
   */
  const dir = mkdtempSync(join(tmpdir(), 'prism-demo-'));
  const state = join(dir, 'board.json');
  const out = join(dir, 'transcript.md');
  const run = () => {
    execFileSync(process.execPath, [join(ROOT, 'prism.mjs'), 'demo', '--no-trace', `--out=${out}`], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PRISM_DATA_MODE: 'offline', PRISM_STATE_FILE: state },
    });
    return readFileSync(out, 'utf8').split('\n').filter((l) => !/^Generated /.test(l) && !/ - \d+ms - extractor /.test(l));
  };

  try {
    const first = run();
    assert.ok(existsSync(state), 'demo should have persisted a board');
    const second = run();
    assert.deepEqual(second, first, 'a second demo run drifted from the first - state is leaking into the transcript');
    const totals = first.filter((l) => /^total \d+ cards \|/.test(l));
    assert.equal(totals.length, 1, `expected one board dump, got ${totals.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
