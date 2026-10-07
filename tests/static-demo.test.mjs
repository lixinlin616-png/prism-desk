/**
 * Static replay bundle tests.
 *
 * docs/demo/ is a recording of the engine, and a recording can go stale: someone
 * edits a scenario, rebuilds the board fixture or adds an API route, and the
 * published demo quietly stops describing the repo it came from. These tests
 * fail in that case instead of letting a contradictory demo ship.
 *
 * The adapter is browser code, but it is only fetch + a little DOM, so it runs
 * here against a small DOM stub with the bundle served from disk. That exercises
 * the real routing table and the real SSE replay through the same contract
 * web/app.js consumes - no browser, no dependencies, same as the rest of the
 * suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'docs', 'demo');
const DATA = join(DEMO, 'data');
const SITE = 'https://example.github.io/prism-desk/demo/';
const moduleUrl = (rel) => pathToFileURL(join(ROOT, rel)).href;

process.env.PRISM_DATA_MODE = 'offline';

const readJson = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));

if (!existsSync(join(DATA, 'manifest.json'))) {
  throw new Error('docs/demo/data/manifest.json is missing - run npm run export:static before npm test');
}

// --------------------------------------------------------------------- DOM stub
// Only what web/static-adapter.js actually touches. remove() has to detach from
// the parent, because the adapter prunes its own notice list in a while loop.

function makeElement(tag) {
  const node = {
    tagName: tag,
    children: [],
    parentNode: null,
    className: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
    remove() {
      const kids = node.parentNode ? node.parentNode.children : [];
      const at = kids.indexOf(node);
      if (at >= 0) kids.splice(at, 1);
      node.parentNode = null;
    },
    querySelectorAll(sel) {
      const want = sel.replace(/^\./, '');
      return node.children.filter((c) => c.className.split(' ').includes(want));
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    _text: '',
    _html: '',
    addEventListener() {},
  };
  Object.defineProperty(node, 'textContent', { get: () => node._text, set: (v) => { node._text = String(v); } });
  Object.defineProperty(node, 'innerHTML', { get: () => node._html, set: (v) => { node._html = String(v); } });
  return node;
}

/** Serve the bundle from disk so the adapter's own fetch has something to hit. */
function diskFetch(url) {
  const path = decodeURIComponent(String(url)).split('?')[0];
  const at = path.lastIndexOf('/demo/');
  const rel = at >= 0 ? path.slice(at + '/demo/'.length) : path.replace(/^\/+/, '');
  const file = join(DEMO, rel);
  if (!file.startsWith(DEMO) || !existsSync(file)) return Promise.resolve(new Response('not found: ' + rel, { status: 404 }));
  const type = /\.json$/.test(file) ? 'application/json'
    : /\.csv$/.test(file) ? 'text/csv'
      : /\.md$/.test(file) ? 'text/markdown'
        : /\.js$/.test(file) ? 'text/javascript'
          : /\.css$/.test(file) ? 'text/css' : 'text/plain';
  return Promise.resolve(new Response(readFileSync(file, 'utf8'), { status: 200, headers: { 'Content-Type': type } }));
}

/** Boot the adapter exactly as index.html does, and hand back its window. */
function bootAdapter(search = '?replay=fast') {
  const document = {
    head: makeElement('head'),
    body: makeElement('body'),
    documentElement: makeElement('html'),
    currentScript: null,
    baseURI: SITE + 'index.html',
    createElement: makeElement,
    addEventListener() {},
  };
  const window = {
    document,
    location: { href: SITE + 'index.html' + search, search },
    fetch: diskFetch,
  };
  const source = readFileSync(join(ROOT, 'web', 'static-adapter.js'), 'utf8');
  // The adapter is an IIFE over window/document; new Function is the cheapest
  // honest way to run browser code in a suite that installs nothing.
  new Function('window', 'document', source)(window, document);
  return { window, document };
}

const call = (win, path, init) => win.fetch(path.startsWith('http') ? path : 'https://example.github.io' + path, init);

/** web/app.js's SSE parser, copied so the test consumes the stream the way the UI does. */
async function readFrames(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let name = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join('\n')); } catch { data = { raw: dataLines.join('\n') }; }
      frames.push({ name, data });
    }
  }
  return frames;
}

// --------------------------------------------------------------- bundle hygiene

test('the published page loads the adapter before the app', () => {
  const html = readFileSync(join(DEMO, 'index.html'), 'utf8');
  const adapterAt = html.indexOf('<script src="./static-adapter.js"></script>');
  const appAt = html.indexOf('<script type="module" src="./app.js"></script>');
  assert.ok(adapterAt > 0, 'docs/demo/index.html must load ./static-adapter.js');
  assert.ok(appAt > adapterAt, 'the adapter must be wired before app.js or the real fetch wins');
  assert.ok(existsSync(join(DEMO, '.nojekyll')), 'docs/demo/.nojekyll keeps Pages from running Jekyll over the bundle');
  assert.ok(existsSync(join(ROOT, 'docs', '.nojekyll')), 'docs/.nojekyll keeps the site root raw too');
  // The served app stays untouched: the adapter is a publish-time injection.
  const source = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  assert.ok(!source.includes('static-adapter.js'), 'web/index.html must not reference the adapter - the server has a real backend');
  for (const asset of ['app.js', 'styles.css', 'static-adapter.js']) {
    assert.ok(existsSync(join(DEMO, asset)), asset + ' missing from the bundle');
  }
});

test('every API route the server exposes is answered or refused by the bundle', () => {
  const server = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  const routes = [...new Set([...server.matchAll(/path === '(\/api\/[^']+)'/g)].map((m) => m[1]))];
  assert.ok(routes.length >= 12, 'route extraction broke - server.mjs changed shape');
  const manifest = readJson('manifest.json');
  const covered = manifest.routes.map((r) => r.replace(/^(GET|POST) /, ''));
  const refused = manifest.refused.map((r) => r.split(' ')[1]);
  for (const route of routes) {
    if (route.startsWith('/api/card/')) continue; // parameterised, exercised below
    assert.ok(covered.includes(route) || refused.includes(route),
      route + ' is served by server.mjs but the static bundle neither answers nor refuses it');
  }
});

test('the recorded scenarios are the scenarios the server serves', async () => {
  const { SCENARIOS } = await import(moduleUrl('server.mjs'));
  assert.deepEqual(readJson('api/scenarios.json').scenarios, SCENARIOS,
    'docs/demo is stale - re-run npm run export:static');
});

test('the recorded board is the committed fixture', () => {
  const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'fixtures', 'board-seed.json'), 'utf8'));
  const board = readJson('api/board.all.json');
  const manifest = readJson('manifest.json');
  assert.equal(board.status.total, seed.cards.length);
  assert.equal(manifest.board.total, seed.cards.length);
  assert.equal(board.cards.length, Math.min(400, seed.cards.length), 'the server caps the board at 400; the bundle must too');
  assert.equal(manifest.board.fixture, 'data/fixtures/board-seed.json');
});

test('the recorded review reproduces the committed review report', () => {
  const report = readFileSync(join(ROOT, 'docs', 'reports', 'review.md'), 'utf8');
  const cell = (label) => {
    const m = report.match(new RegExp('^\\|\\s*' + label + '\\s*\\|\\s*\\**(-?[0-9.]+)', 'm'));
    assert.ok(m, 'headline row not found in review.md: ' + label);
    return Number(m[1]);
  };
  const review = readJson('api/review.json');
  const manifest = readJson('manifest.json');
  assert.equal(review.summary.cardsOnBoard, cell('cards on the board'));
  assert.equal(review.summary.distinctClaims, cell('distinct claims'));
  assert.equal(review.summary.decided, cell('decided \\(won / lost\\)'));
  assert.equal(review.summary.hitPct, cell('\\*\\*hit rate\\*\\*'));
  assert.equal(review.calibration.scoreVsOutcomeRho, cell('Spearman rho, score vs realised excess'));
  assert.equal(manifest.review.decided, review.summary.decided);
  assert.equal(manifest.review.scoreVsOutcomeRho, review.calibration.scoreVsOutcomeRho);
  assert.equal(review.summary.asOf, manifest.review.asOf);
});

// ------------------------------------------------------------------- live routes

test('GET routes replay the recorded payloads', async () => {
  const { window } = bootAdapter();
  const checks = [
    ['/api/status', (j) => {
      assert.equal(j.ok, true);
      assert.equal(j.runs, 0);
      assert.equal(j.board.total, 235);
      assert.equal(j.ledger.itemsChecked, 0, 'a freshly booted desk has audited nothing yet');
    }],
    ['/api/capabilities', (j) => { assert.equal(j.channels.length, 7); assert.ok(j.intents.length > 10); assert.equal(j.skills.length, 5); }],
    ['/api/scenarios', (j) => assert.equal(j.scenarios.length, 6)],
    ['/api/corpus', (j) => { assert.ok(j.documents.length > 0); assert.equal(j.stats.documents, j.documents.length); }],
    ['/api/board?status=active', (j) => { assert.ok(j.cards.length > 0); assert.ok(j.watchlist.length > 0); assert.ok(j.byChannel); }],
    ['/api/board?status=quarantined', (j) => assert.ok(Array.isArray(j.cards))],
    ['/api/board?status=all', (j) => assert.equal(j.status.total, 235)],
    ['/api/research/transmission', (j) => assert.ok(j.events || j.summary || j.rows)],
    ['/api/research/gaps', (j) => assert.ok(j.summary)],
    ['/api/review', (j) => { assert.equal(j.summary.decided, 34); assert.equal(j.calibration.scoreVsOutcomeRho, -0.138); assert.ok(j.claims.length > 0); }],
    ['/api/runs', (j) => assert.deepEqual(j.runs, [], 'nothing has been replayed yet')],
  ];
  for (const [path, check] of checks) {
    const res = await call(window, path);
    assert.equal(res.status, 200, path + ' -> HTTP ' + res.status);
    check(await res.json());
  }
});

test('card dossiers resolve for board cards and 404 for strangers', async () => {
  const { window } = bootAdapter();
  const board = await (await call(window, '/api/board?status=all')).json();
  const first = board.cards[0];
  const res = await call(window, '/api/card/' + encodeURIComponent(first.id));
  assert.equal(res.status, 200);
  const one = await res.json();
  assert.equal(one.card.id, first.id);
  assert.ok(one.markdown.includes(first.id), 'the dossier markdown should carry the card id');
  const missing = await call(window, '/api/card/SIG-DOESNOTEXIST');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).ok, false);
});

test('exports download the recorded artefacts', async () => {
  const { window } = bootAdapter();
  const csv = await call(window, '/api/export/board.csv?status=all');
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  assert.ok(csvText.split('\n')[0].includes('id'), 'board.csv lost its header');
  assert.ok(csvText.split('\n').length > 100, 'board.csv should carry the whole board');

  const review = await call(window, '/api/export/review.md');
  assert.equal(review.status, 200);
  assert.ok((await review.text()).startsWith('# Signal review'));

  const brief = await call(window, '/api/export/brief.md');
  assert.equal(brief.status, 404, 'no run has been replayed, so there is no brief - same as the server');
});

test('POST /api/ask replays a recorded run as a real SSE stream', async () => {
  const { window } = bootAdapter();
  const index = readJson('api/ask/index.json');
  const sweep = index.runs.find((r) => r.scenarioId === 'full-sweep');

  const res = await call(window, '/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: sweep.question, asOf: sweep.asOf, stream: true }),
  });
  assert.equal(res.status, 200);
  assert.ok(res.body, 'the replay must be a stream, not one blob');

  const frames = await readFrames(res);
  const stages = frames.filter((f) => f.name === 'stage');
  const runFrame = frames.find((f) => f.name === 'run');
  const done = frames.find((f) => f.name === 'done');

  assert.equal(frames.length, sweep.frames, 'every recorded frame must reach the client');
  assert.equal(stages.length, sweep.frames - 2);
  for (const name of ['plan', 'ingest:corpus', 'ingest:data', 'extract', 'verify', 'verify:summary', 'score', 'present']) {
    assert.ok(stages.some((s) => s.data.stage === name), 'stage missing from the replay: ' + name);
  }
  assert.ok(runFrame, 'the run payload frame is what renders the cards');
  assert.equal(runFrame.data.cards.length, sweep.cards);
  assert.equal(runFrame.data.published.length, sweep.published);
  assert.equal(runFrame.data.ledger.itemsChecked, 26);
  assert.equal(runFrame.data.ledger.passRate, 88.5);
  assert.equal(done.data.ok, true);
  assert.equal(done.data.runId, runFrame.data.id);

  // The desk now looks like a server that has answered exactly that question.
  const status = await (await call(window, '/api/status')).json();
  assert.equal(status.runs, 1);
  assert.equal(status.ledger.itemsChecked, 26);
  assert.equal(status.ledger.passRate, 88.5);
  assert.equal(status.board.total, 235, 'the board is the committed fixture and a replay does not write to it');

  const runs = await (await call(window, '/api/runs')).json();
  assert.equal(runs.runs.length, 1);
  assert.equal(runs.runs[0].id, runFrame.data.id);

  const brief = await call(window, '/api/export/brief.md');
  assert.equal(brief.status, 200);
  assert.equal(await brief.text(), runFrame.data.brief.markdown);
});

test('an unrecorded question replays the closest run instead of inventing one', async () => {
  const { window } = bootAdapter();
  const res = await call(window, '/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What does the desk make of the CPI print and the transmission chain?', stream: true }),
  });
  assert.equal(res.status, 200);
  const frames = await readFrames(res);
  const run = frames.find((f) => f.name === 'run');
  assert.ok(run, 'a fuzzy match must still produce a run');
  const index = readJson('api/ask/index.json');
  assert.ok(index.runs.some((r) => r.runId === run.data.id), 'the replayed run must be one of the recorded ones');

  const empty = await call(window, '/api/ask', { method: 'POST', body: JSON.stringify({ question: '', stream: true }) });
  assert.equal(empty.status, 404, 'an empty question matches nothing and must not fall back to a default');
});

test('POST /api/ask with stream:false returns the run in one payload', async () => {
  const { window } = bootAdapter();
  const index = readJson('api/ask/index.json');
  const res = await call(window, '/api/ask', {
    method: 'POST',
    body: JSON.stringify({ question: index.runs[0].question, stream: false }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.run.question, index.runs[0].question);
  assert.ok(json.run.cards.length > 0);
});

test('writes are refused with an explanation rather than faked', async () => {
  const { window } = bootAdapter();
  for (const [path, body] of [['/api/corpus', { body: 'some text' }], ['/api/board/reset', {}]]) {
    const res = await call(window, path, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(res.status, 409, path + ' must be refused');
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.match(json.error, /read-only/);
  }
  const unknown = await call(window, '/api/nope');
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /no route/);
});

test('non-API requests are passed through untouched', async () => {
  const { window } = bootAdapter();
  const res = await call(window, SITE + 'styles.css');
  assert.equal(res.status, 200, 'static assets must reach the real fetch');
  assert.ok((await res.text()).length > 1000);
});

test('every recorded run replays end to end', async () => {
  const { window } = bootAdapter();
  const index = readJson('api/ask/index.json');
  assert.equal(index.runs.length, 6);
  for (const entry of index.runs) {
    const res = await call(window, '/api/ask', { method: 'POST', body: JSON.stringify({ question: entry.question, stream: true }) });
    assert.equal(res.status, 200, entry.scenarioId);
    const frames = await readFrames(res);
    assert.equal(frames.length, entry.frames, entry.scenarioId + ': frame count drifted');
    assert.equal(frames[frames.length - 1].name, 'done');
    const run = frames.find((f) => f.name === 'run').data;
    assert.equal(run.cards.length, entry.cards, entry.scenarioId + ': card count drifted');
    assert.equal(run.ledger.itemsChecked, entry.ledger.itemsChecked, entry.scenarioId + ': ledger drifted');
    // run.asOf is normalised to milliseconds by the engine; the scenario pin is not.
    assert.equal(new Date(run.asOf).getTime(), new Date(entry.asOf).getTime(),
      entry.scenarioId + ': the clock must stay pinned to the fixture window');
  }
});
