/**
 * HTTP integration tests.
 *
 * Boots the real server on an ephemeral port and drives it over HTTP, so the
 * routes, the SSE stream and the static UI are all covered by `npm test`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Windows absolute paths are not valid ESM specifiers, so always go via file:// URLs. */
const moduleUrl = (rel) => pathToFileURL(join(ROOT, rel)).href;
process.env.PRISM_DATA_MODE = 'offline';
/**
 * Tests must not touch the demo board. POST /api/ask persists by default, so
 * without this the suite silently appended cards to data/state/board.json on
 * every `npm test` - which is how the committed review numbers stopped matching
 * a fresh checkout. The suite gets a scratch board it owns and deletes.
 */
process.env.PRISM_STATE_FILE = join(tmpdir(), `prism-test-board-${process.pid}.json`);

const { buildApp, SCENARIOS } = await import(moduleUrl('server.mjs'));

let server;
let base;

before(async () => {
  const handler = await buildApp();
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(process.env.PRISM_STATE_FILE, { force: true });
});

const get = async (path) => {
  const res = await fetch(base + path);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json, headers: res.headers };
};

const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
};

test('GET /api/status reports the data wiring', async () => {
  const { status, json } = await get('/api/status');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.hub.mode, 'offline');
  assert.equal(json.hub.market.state, 'offline');
  assert.ok(json.hub.corpus.documents > 0, 'corpus should not be empty');
  assert.ok(json.hub.prices.symbols > 0, 'price book should not be empty');
  assert.equal(json.hub.llm.enabled, false);
});

test('GET /api/capabilities exposes all seven channels and the MCP intents', async () => {
  const { status, json } = await get('/api/capabilities');
  assert.equal(status, 200);
  assert.equal(json.channels.length, 7);
  assert.ok(json.intents.length >= 18, 'expected the documented bitget-mcp-server coverage');
  assert.equal(json.skills.length, 5);
  const ids = json.channels.map((c) => c.id);
  for (const expected of ['earnings-gap', 'macro-transmission', 'narrative-shift', 'flow-footprint', 'closed-window', 'cross-asset', 'risk-flag']) {
    assert.ok(ids.includes(expected), `missing channel ${expected}`);
  }
});

test('GET /api/scenarios returns demo presets', async () => {
  const { json } = await get('/api/scenarios');
  assert.ok(json.scenarios.length >= 5);
  /**
   * Every preset must pin its own as-of. The bundled corpus and price book are
   * a fixed September-2025 window, so a scenario that lets the desk clock
   * default to "now" produces different cards depending on the day it is run -
   * and docs/DEMO-TRANSCRIPT.md stops being reproducible from a fresh clone.
   * This is the guard on that invariant; the pins themselves live in server.mjs.
   */
  for (const s of json.scenarios) {
    assert.ok(s.question && s.id && s.label);
    assert.ok(s.asOf, `scenario ${s.id} must carry an explicit asOf so the demo replays identically`);
    assert.ok(!Number.isNaN(Date.parse(s.asOf)), `scenario ${s.id} has an unparseable asOf: ${s.asOf}`);
  }
});

test('POST /api/ask runs a full task and returns verified, scored cards', async () => {
  const { status, json } = await post('/api/ask', {
    question: 'Full desk sweep across every channel',
    asOf: '2025-09-13T15:00:00Z',
    stream: false,
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  const run = json.run;
  assert.ok(run.cards.length >= 5, `expected several cards, got ${run.cards.length}`);
  assert.ok(run.published.length >= 1, 'at least one card should clear the publish threshold');
  assert.ok(run.brief.markdown.includes('# Prism Desk brief'));

  // Every published card must satisfy the schema and carry a falsifiable claim.
  const { validateCard } = await import(moduleUrl('src/schema.mjs'));
  for (const card of run.cards) {
    const v = validateCard(card);
    assert.ok(v.ok, `card ${card.id} failed validation: ${v.errors.join('; ')}`);
    assert.ok(card.invalidation?.condition, 'card has no invalidation condition');
    assert.ok(card.evidence?.length, 'card has no evidence');
    assert.ok(Number.isFinite(card.score?.total), 'card was not scored');
    for (const e of card.evidence) {
      assert.notEqual(e.verified, 'pending', `evidence ${e.id} never left the pending state`);
    }
  }

  // The channels actually fired.
  const channels = new Set(run.cards.map((c) => c.channel));
  assert.ok(channels.has('earnings-gap'), 'earnings-gap did not fire');
  assert.ok(channels.has('macro-transmission'), 'macro-transmission did not fire');
});

test('POST /api/ask rejects an empty question', async () => {
  const { status, json } = await post('/api/ask', { question: '   ' });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
});

test('POST /api/ask streams SSE stage events ending in a run frame', async () => {
  const res = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'Any insider selling clusters?', asOf: '2025-09-13T15:00:00Z', stream: true }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  const text = await res.text();
  const events = text.split(/\n\n+/).filter(Boolean).map((block) => {
    const event = (block.match(/^event: (.*)$/m) || [])[1];
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    return { event, data: data ? JSON.parse(data) : null };
  });
  const stages = events.filter((e) => e.event === 'stage').map((e) => e.data.stage);
  for (const expected of ['plan', 'ingest:corpus', 'extract', 'verify', 'score', 'present']) {
    assert.ok(stages.includes(expected), `missing streamed stage ${expected} (got ${stages.join(',')})`);
  }
  assert.ok(events.some((e) => e.event === 'run' && e.data.id));
  assert.ok(events.some((e) => e.event === 'done'));
});

test('the board accumulates cards and groups them by channel', async () => {
  const { json } = await get('/api/board');
  assert.equal(json.ok, true);
  assert.ok(json.cards.length >= 1);
  assert.ok(json.status.total >= 1);
  assert.ok(Object.keys(json.byChannel).length === 7);
});

test('GET /api/card/:id returns the full dossier with markdown', async () => {
  const board = (await get('/api/board')).json;
  const id = board.cards[0].id;
  const { status, json } = await get(`/api/card/${id}`);
  assert.equal(status, 200);
  assert.equal(json.card.id, id);
  assert.ok(json.markdown.includes('Evidence ledger'));
  assert.ok(json.markdown.includes('What would make this wrong'));
});

test('GET /api/card/:id 404s on an unknown id', async () => {
  const { status } = await get('/api/card/SIG-NOPE-999');
  assert.equal(status, 404);
});

test('POST /api/corpus accepts a pasted document and it becomes searchable', async () => {
  const { status, json } = await post('/api/corpus', {
    id: 'test-pasted-doc',
    kind: 'news',
    title: 'Pasted test document',
    tickers: ['CRVS'],
    body: 'A pasted note with record revenue and strong demand and accelerating momentum and a clear tailwind.',
    publishedAt: '2025-09-12T12:00:00Z',
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.stats.documents > 0);
  const corpus = (await get('/api/corpus')).json;
  assert.ok(corpus.documents.some((d) => d.id === 'test-pasted-doc'));
});

test('research endpoints return the real-data studies', async () => {
  const t1 = await get('/api/research/transmission');
  assert.equal(t1.status, 200);
  assert.ok(t1.json.summary.scored >= 10, 'transmission study should score a meaningful number of events');
  assert.ok(Number.isFinite(t1.json.summary.meanSpearman));
  assert.ok(t1.json.summary.bySurpriseSize, 'surprise-size conditioning must be reported');

  const t2 = await get('/api/research/gaps');
  assert.equal(t2.status, 200);
  assert.ok(t2.json.summary.gaps >= 1000, 'gap study should cover a large real sample');
  assert.ok(t2.json.summary.overall.excessVsBenchmark, 'benchmark-excess returns must be reported');
  assert.ok(t2.json.summary.overall.excessDateClustered, 'date-clustered stats must be reported');
});

test('CSV export contains the board columns', async () => {
  const { status, text, headers } = await get('/api/export/board.csv');
  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /text\/csv/);
  const header = text.split('\n')[0];
  for (const col of ['id', 'channel', 'direction', 'score', 'grade', 'verifiedPct', 'claim', 'invalidation']) {
    assert.ok(header.includes(col), `csv header missing ${col}`);
  }
});

test('brief markdown export works once a run exists', async () => {
  const { status, text } = await get('/api/export/brief.md');
  assert.equal(status, 200);
  assert.ok(text.includes('# Prism Desk brief'));
});

test('the static UI is served and cannot escape the web root', async () => {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(index.text, /<html/i);
  assert.match(index.text, /Prism/i);

  const escape = await fetch(`${base}/../../package.json`, { redirect: 'manual' });
  assert.ok([403, 404].includes(escape.status) || !(await escape.text()).includes('"prism-desk"'), 'path traversal must not leak files outside web/');
});

test('unknown API routes 404 rather than crash', async () => {
  const { status, json } = await get('/api/does-not-exist');
  assert.equal(status, 404);
  assert.equal(json.ok, false);
});

test('every preset scenario runs end to end', async () => {
  for (const scenario of SCENARIOS) {
    const { status, json } = await post('/api/ask', {
      question: scenario.question,
      channels: scenario.channels,
      asOf: scenario.asOf || '2025-09-13T15:00:00Z',
      stream: false,
    });
    assert.equal(status, 200, `scenario ${scenario.id} failed`);
    assert.equal(json.ok, true, `scenario ${scenario.id} not ok`);
    assert.ok(Array.isArray(json.run.cards), `scenario ${scenario.id} returned no cards array`);
    assert.ok(json.run.brief.markdown.length > 200, `scenario ${scenario.id} produced an empty brief`);
  }
});

test('bundled assets exist', () => {
  for (const f of ['web/index.html', 'web/app.js', 'web/styles.css', 'package.json', 'README.md']) {
    const p = join(ROOT, f);
    let ok = true;
    try { readFileSync(p); } catch { ok = false; }
    assert.ok(ok, `missing bundled asset ${f}`);
  }
});

/**
 * The submission form has one free-text box for every link, so a stale path in
 * the link list would hand an evaluator a 404 on a project whose whole pitch is
 * that everything is checkable. The list lives as data in the generator; this
 * asserts every repo path it names is actually in the tree.
 */
test('the submission link manifest points only at files that exist', async () => {
  const mod = await import(moduleUrl('scripts/submission-links.mjs'));
  assert.ok(mod.MANIFEST.length >= 15, 'the manifest should cover every submission artefact');
  assert.deepEqual(mod.missingPaths(), [], 'the submission manifest references files that are not in the repo');
  // Every hard number in the box must still match the report that is its authority.
  assert.deepEqual(mod.verifyClaims(), [], 'the submission block quotes a number its own generated report contradicts');
  assert.ok(mod.CLAIMS.length >= 10, 'the claims table should cover the headline numbers');
  assert.ok(mod.UNVERIFIED_HERE.length >= 3, 'numbers that cannot be checked from disk must be listed, not silently asserted');
  const block = mod.renderBlock({ repo: 'https://example.invalid/r' });
  for (const p of mod.manifestPaths()) {
    assert.ok(block.includes(p), `manifest path ${p} never made it into the rendered block`);
  }
  assert.ok(!/undefined|NaN|\[object Object\]/.test(block), 'the rendered block contains an undefined value');
  // TEST_COUNT is the one number the generator cannot re-read from a report, so it
  // is declared once and interpolated. Assert both places actually picked it up.
  assert.ok(block.includes(`${mod.TEST_COUNT} 个测试`), 'the manifest did not interpolate TEST_COUNT');
  assert.ok(block.includes(`${mod.TEST_COUNT} / ${mod.TEST_COUNT}`), 'the reproduce footer did not interpolate TEST_COUNT');
});