#!/usr/bin/env node
/**
 * Build the static replay bundle that GitHub Pages serves at /demo/.
 *
 *   npm run export:static            -> docs/demo/   (committed; Pages publishes it)
 *   npm run export:static -- --serve -> also preview it on http://127.0.0.1:4321
 *
 * Why this exists. The submission needs a demo a judge can open during the
 * review window without installing anything. A Node server cannot be published
 * to static hosting, and a tunnel from a laptop dies with the laptop. So this
 * script RECORDS the real thing: it boots the same offline pipeline the server
 * boots, runs every demo scenario against the committed board fixture, and
 * writes down exactly the bytes each /api/* route would have returned -
 * including the SSE stage frames and the gaps between them. web/app.js then
 * runs unchanged against web/static-adapter.js, which answers those routes from
 * the recording.
 *
 * Nothing here is simulated. Cards, ledger totals, scores and review verdicts
 * are produced by the engine at export time; the adapter only replays them. The
 * only things a static page genuinely cannot do are run an arbitrary new
 * question and write to the board, and the adapter says so on screen instead of
 * pretending.
 *
 * Determinism. Everything semantic (card ids, scores, ledger, review) is pinned
 * by the fixtures and reproduces byte for byte. Three things carry the export
 * wall clock and are listed in manifest.volatileFields: run ids, run timings and
 * the SSE frame gaps.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.mjs';
import { logger } from '../src/util/log.mjs';
import { initHub } from '../src/ingest/index.mjs';
import { Pipeline } from '../src/desk/pipeline.mjs';
import { SignalBoard } from '../src/desk/board.mjs';
import { boardCsv, renderCard } from '../src/desk/brief.mjs';
import { CHANNELS, CHANNEL_IDS, cardSummary } from '../src/schema.mjs';
import { INTENTS, INTENT_DOCS } from '../src/ingest/bitget-market.mjs';
import { SIGNAL_SKILLS, SIGNAL_SKILL_IDS } from '../src/ingest/bitget-signal.mjs';
import { runTransmissionStudy } from '../src/research/transmission.mjs';
import { runGapStudy } from '../src/research/gap-study.mjs';
import { runReview } from '../src/review/adjudicate.mjs';
import { renderReviewReport } from '../src/review/report.mjs';
import { SCENARIOS, serialiseRun } from '../server.mjs';

const log = logger('export-static');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const OUT = join(ROOT, 'docs', 'demo');
const SEED = join(ROOT, 'data', 'fixtures', 'board-seed.json');
const DOCS_INDEX = join(ROOT, 'docs', 'index.html');

/**
 * config.mcp.mode is evaluated the moment src/config.mjs is imported, so setting
 * PRISM_DATA_MODE inside main() is too late: the hub would already be in auto
 * mode and would record whatever the live MCP happened to return that day. An
 * export that is not offline is not reproducible, so force it here.
 */
process.env.PRISM_DATA_MODE = 'offline';
config.mcp.mode = 'offline';

const argv = process.argv.slice(2);
const flag = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/** Same shape the server sends: { ok, ...desk.status(), config }. */
function statusPayload(desk) {
  return {
    ok: true,
    ...desk.status(),
    config: {
      dataMode: config.mcp.mode,
      mcpUrl: config.mcp.url,
      minScore: config.scoring.minScoreToPublish,
    },
  };
}

function boardPayload(board, status) {
  const all = status === 'all' ? board.all({ limit: 400 }) : board.all({ status, limit: 400 });
  return {
    ok: true,
    status: board.status(),
    byChannel: Object.fromEntries(Object.entries(board.byChannel({ status: status === 'all' ? null : status }))),
    watchlist: board.watchlist(),
    cards: all.map(cardSummary),
  };
}

function capabilitiesPayload(desk) {
  return {
    ok: true,
    channels: CHANNEL_IDS.map((id) => ({ id, ...CHANNELS[id] })),
    intents: INTENTS.map((id) => ({ id, description: INTENT_DOCS[id], resolved: desk.hub.market.resolution.get(id) ?? null, fixture: desk.hub.market.fixtures.has(id) })),
    skills: SIGNAL_SKILL_IDS.map((id) => ({ id, ...SIGNAL_SKILLS[id], resolved: desk.hub.signal.resolution.get(id) ?? null })),
    corpus: desk.hub.corpus.stats(),
    prices: desk.hub.prices.stats(),
  };
}

const write = (rel, body) => {
  const file = join(OUT, 'data', rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 1) + '\n', 'utf8');
  return statSync(file).size;
};

async function main() {
  if (!existsSync(SEED)) {
    process.stderr.write('data/fixtures/board-seed.json is missing - run `npm run seed` first.\n');
    process.exitCode = 1;
    return;
  }

  // Pointed at the committed fixture so the published board and the published
  // review report are the same board. autosave:false - an export must never
  // write to a fixture it is only reading.
  process.env.PRISM_STATE_FILE = SEED;

  const t0 = Date.now();
  const hub = await initHub();
  const board = new SignalBoard({ file: SEED, autosave: false });
  const bookTo = hub.prices.stats().to;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'data'), { recursive: true });

  // ---------------------------------------------------------------- baseline
  // A server that has booted but run nothing: empty ledger, seeded board.
  const baseline = new Pipeline({ hub, board });
  await baseline.ready();
  const bytes = [];
  bytes.push(['api/status.json', write('api/status.json', statusPayload(baseline))]);
  bytes.push(['api/capabilities.json', write('api/capabilities.json', capabilitiesPayload(baseline))]);
  bytes.push(['api/scenarios.json', write('api/scenarios.json', { ok: true, scenarios: SCENARIOS })]);
  bytes.push(['api/corpus.json', write('api/corpus.json', {
    ok: true,
    stats: hub.corpus.stats(),
    documents: hub.corpus.all().map((d) => ({
      id: d.id, kind: d.kind, title: d.title, tickers: d.tickers, publishedAt: d.publishedAt,
      source: d.source, synthetic: d.synthetic, words: String(d.body || '').split(/\s+/).length,
    })),
  })]);

  // -------------------------------------------------------------------- runs
  const index = [];
  const runCards = new Map();
  for (const sc of SCENARIOS) {
    // A fresh pipeline per scenario: ledger and extractor counters are
    // cumulative per process, and the status pill must describe THIS run rather
    // than the sum of all six. That is what a server looks like after one
    // question - and what docs/DEMO-TRANSCRIPT.md quotes.
    const desk = new Pipeline({ hub, board });
    await desk.ready();

    const frames = [];
    let last = Date.now();
    const push = (event, data) => {
      const now = Date.now();
      frames.push({ event, dt: now - last, data });
      last = now;
    };

    const run = await desk.runTask({
      question: sc.question,
      asOf: new Date(sc.asOf),
      channels: sc.channels,
      limit: 14,
      persist: false,
      onEvent: (evt) => push('stage', evt),
    });
    push('run', serialiseRun(run));
    push('done', { ok: true, runId: run.id });

    for (const card of run.cards) runCards.set(card.id, card);
    bytes.push([`api/ask/${sc.id}.json`, write(`api/ask/${sc.id}.json`, JSON.stringify({
      scenarioId: sc.id,
      label: sc.label,
      zh: sc.zh,
      note: sc.note,
      recordedFrom: { question: sc.question, asOf: sc.asOf, channels: sc.channels, limit: 14, persist: false },
      frames,
    }))]);
    bytes.push([`api/status.${sc.id}.json`, write(`api/status.${sc.id}.json`, statusPayload(desk))]);

    index.push({
      scenarioId: sc.id,
      label: sc.label,
      zh: sc.zh,
      question: sc.question,
      asOf: sc.asOf,
      channels: sc.channels,
      runId: run.id,
      ms: run.ms,
      mode: run.mode,
      cards: run.cards.length,
      published: run.published.length,
      quarantined: run.quarantined.length,
      belowThreshold: run.belowThreshold.length,
      frames: frames.length,
      ledger: run.ledger,
    });
    log.info(`${sc.id}: ${run.cards.length} cards, ${run.published.length} published, ledger ${run.ledger.passRate}% over ${run.ledger.itemsChecked} items, ${frames.length} frames, ${run.ms}ms`);
  }
  bytes.push(['api/ask/index.json', write('api/ask/index.json', { ok: true, runs: index })]);

  // ------------------------------------------------------------------- board
  for (const status of ['active', 'quarantined', 'all']) {
    bytes.push([`api/board.${status}.json`, write(`api/board.${status}.json`, boardPayload(board, status))]);
    const rows = board.all({ status: status === 'all' ? null : status, limit: 500 });
    bytes.push([`api/export-board.${status}.csv`, write(`api/export-board.${status}.csv`, boardCsv(rows))]);
  }

  // Every card the board lists plus every card any recorded run produced, with
  // the markdown dossier the drawer renders. One file, loaded on first click.
  const cards = {};
  for (const card of [...board.all({ limit: 2000 }), ...runCards.values()]) {
    if (cards[card.id]) continue;
    cards[card.id] = { card, markdown: renderCard(card, { showEvidence: true, showBreakdown: true }) };
  }
  bytes.push(['api/cards.json', write('api/cards.json', JSON.stringify({ ok: true, count: Object.keys(cards).length, cards }))]);

  // -------------------------------------------------------------- validation
  const transmission = runTransmissionStudy(hub.prices);
  const gaps = { summary: runGapStudy(hub.prices).summary };
  bytes.push(['api/research-transmission.json', write('api/research-transmission.json', JSON.stringify({ ok: true, ...transmission }))]);
  bytes.push(['api/research-gaps.json', write('api/research-gaps.json', JSON.stringify({ ok: true, ...gaps }))]);

  // Same call and same default as GET /api/review: the price book's last bar.
  const reviewAsOf = new Date(`${bookTo}T23:59:59Z`);
  const review = runReview({ board, book: hub.prices, corpus: hub.corpus, asOf: reviewAsOf, persist: false });
  bytes.push(['api/review.json', write('api/review.json', JSON.stringify({
    ok: true,
    summary: review.summary,
    calibration: review.calibration,
    lessons: review.lessons,
    claims: review.claims,
    provisional: review.provisional,
    settings: review.settings,
  }))]);
  bytes.push(['api/export-review.md', write('api/export-review.md', renderReviewReport(review))]);

  // -------------------------------------------------------------------- site
  for (const asset of readdirSync(WEB)) {
    if (!statSync(join(WEB, asset)).isFile()) continue;
    cpSync(join(WEB, asset), join(OUT, asset));
  }
  const html = readFileSync(join(OUT, 'index.html'), 'utf8');
  const moduleTag = '<script type="module" src="./app.js"></script>';
  if (!html.includes(moduleTag)) throw new Error('web/index.html no longer loads ./app.js the way the exporter expects');
  let siteHtml = html.replace(moduleTag,
    '<!-- static replay: answers /api/* from ./data, recorded by scripts/export-static.mjs -->\n'
    + '<script src="./static-adapter.js"></script>\n'
    + moduleTag);
  // Cache-bust the mutable assets: a visitor holding a broken cached build must
  // heal on a plain reload, not only on a hard refresh.
  const { createHash } = await import('node:crypto');
  const stamp = (file) => createHash('sha256').update(readFileSync(join(OUT, file))).digest('hex').slice(0, 10);
  for (const [file, attr] of [['styles.css', 'href'], ['static-adapter.js', 'src'], ['app.js', 'src']]) {
    siteHtml = siteHtml.split(`${attr}="./${file}"`).join(`${attr}="./${file}?v=${stamp(file)}`);
  }
  writeFileSync(join(OUT, 'index.html'), siteHtml, 'utf8');
  writeFileSync(join(OUT, '.nojekyll'), '', 'utf8');
  writeFileSync(join(ROOT, 'docs', '.nojekyll'), '', 'utf8');

  const seedProv = JSON.parse(readFileSync(SEED, 'utf8')).provenance || {};
  const priceStats = hub.prices.stats();
  const manifest = {
    builtBy: 'scripts/export-static.mjs',
    exportedAt: new Date().toISOString(),
    engine: {
      dataMode: config.mcp.mode,
      extractor: baseline._extractor ? baseline._extractor.mode : 'rules',
      llm: config.llm.enabled ? config.llm.model : 'not configured (deterministic rule extractor)',
      corpus: hub.corpus.stats(),
      prices: { symbols: priceStats.symbols, bars: priceStats.bars, from: priceStats.from, to: priceStats.to },
    },
    board: { fixture: 'data/fixtures/board-seed.json', seedProvenance: seedProv, ...board.status() },
    runs: index.map((r) => ({ scenarioId: r.scenarioId, runId: r.runId, asOf: r.asOf, cards: r.cards, published: r.published, quarantined: r.quarantined, ms: r.ms })),
    review: {
      asOf: reviewAsOf.toISOString(),
      cardsOnBoard: review.summary.cardsOnBoard,
      distinctClaims: review.summary.distinctClaims,
      judged: review.summary.distinctClaimsJudged,
      decided: review.summary.decided,
      hitPct: review.summary.hitPct,
      scoreVsOutcomeRho: review.calibration.scoreVsOutcomeRho,
      report: 'docs/reports/review.md',
    },
    routes: [
      'GET /api/status', 'GET /api/capabilities', 'GET /api/scenarios', 'GET /api/corpus',
      'GET /api/board', 'GET /api/card/:id', 'GET /api/research/transmission', 'GET /api/research/gaps',
      'GET /api/review', 'GET /api/runs', 'GET /api/export/board.csv', 'GET /api/export/brief.md',
      'GET /api/export/review.md', 'POST /api/ask',
    ],
    refused: ['POST /api/corpus (read-only bundle)', 'POST /api/board/reset (read-only bundle)'],
    volatileFields: [
      'manifest.exportedAt',
      'run ids (RUN-<base36 wall clock>)',
      'run ms timings',
      'SSE frame dt gaps',
      'review.summary.generatedAt / review.summary.ms',
    ],
    note: 'Replaying, not simulating: every payload was produced by the offline pipeline at export time. Re-run `npm run export:static` after any change to the engine, the corpus or the board fixture.',
  };
  bytes.push(['manifest.json', write('manifest.json', manifest)]);

  writeDocsIndex();

  const total = bytes.reduce((a, b) => a + b[1], 0);
  process.stdout.write(
    '\nstatic bundle: ' + OUT + '\n'
    + '  scenarios      ' + index.length + ' (' + index.map((r) => r.scenarioId).join(', ') + ')\n'
    + '  cards          ' + Object.keys(cards).length + ' dossiers\n'
    + '  board          ' + board.status().total + ' cards from data/fixtures/board-seed.json\n'
    + '  review         ' + review.summary.decided + ' decided of ' + review.summary.distinctClaimsJudged + ' judged ('
      + review.summary.cardsOnBoard + ' cards -> ' + review.summary.distinctClaims + ' claims, ' + review.summary.hitPct + '% hit)\n'
    + '  payload        ' + (total / 1048576).toFixed(2) + ' MB in ' + bytes.length + ' files\n'
    + '  built in       ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n'
    + '\npublish: git add docs && git commit && git push, then enable Pages on main /docs\n');

  if (flag('serve')) await preview(Number(value('serve', '4321')));
}

/**
 * docs/index.html - the Pages site root.
 *
 * Pages publishes docs/, so the bare site URL lands here rather than on the
 * desk. One screen, no framework: what this is, where the demo is, and which
 * report backs which claim.
 */
function writeDocsIndex() {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Prism Desk - 信息提炼与信号生成</title>
<meta name="description" content="Prism Desk: 把财报、宏观与新闻提炼成可证伪、带证据账本的信号卡。Bitget AI Base Camp S2 - AI Trading Desk." />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>%E2%97%A3</text></svg>" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 20px 64px; background: #0b0d10; color: #e8e8e8;
    font: 15px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h1 .dim { color: #8a9099; font-weight: 400; }
  p.sub { color: #a8aeb6; margin: 0 0 28px; }
  a.btn { display: inline-block; padding: 11px 18px; border-radius: 9px; text-decoration: none;
    background: #2f81f7; color: #fff; font-weight: 600; margin: 0 10px 10px 0; }
  a.btn.ghost { background: transparent; border: 1px solid #3a4048; color: #d6dae0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .12em; color: #8a9099; margin: 34px 0 10px; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 6px 0; }
  code { background: #161a1f; border: 1px solid #262c33; border-radius: 5px; padding: 1px 5px; font-size: 13px; }
  a { color: #8fd3ff; }
  .note { border-left: 2px solid #3a4048; padding: 2px 0 2px 14px; color: #a8aeb6; margin: 26px 0 0; }
</style>
</head>
<body>
<main>
  <h1>&#9682; Prism<span class="dim">Desk</span></h1>
  <p class="sub">信息提炼与信号生成 &middot; information in, falsifiable signals out<br />
  Bitget AI Base Camp Hackathon S2 &mdash; Track 3 AI Trading Desk</p>

  <a class="btn" href="./demo/">打开演示 &middot; Open the demo</a>
  <a class="btn ghost" href="https://github.com/lixinlin616-png/prism-desk">GitHub 仓库</a>

  <h2>这个演示是什么</h2>
  <ul>
    <li>演示页是 <b>静态回放</b>：所有接口响应都由 <code>scripts/export-static.mjs</code> 在导出时驱动<b>真实离线引擎</b>录制（含 SSE 逐帧节奏），浏览器端 <code>web/static-adapter.js</code> 原样回放。不是 mock，也不是手写数据。</li>
    <li>看板与复盘用仓库里已提交的 <code>data/fixtures/board-seed.json</code>（11 个固定 as-of &times; 6 个场景 = 66 次回放），所以页面上的复盘数字与 <a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/reports/review.md">docs/reports/review.md</a> 完全一致。</li>
    <li>静态页面确实做不到两件事：跑一个<b>全新</b>的自由提问、写入看板。遇到这两种情况页面会明说，不会假装成功。要实时后端：<code>git clone</code> 之后 <code>node server.mjs</code>（零依赖，不需要 npm install）。</li>
  </ul>

  <h2>建议的观看顺序</h2>
  <ul>
    <li><a href="./demo/">演示台</a> &mdash; 先点 <b>Full desk sweep / 全频道扫描</b>，看 PLAN &rarr; INGEST &rarr; EXTRACT &rarr; VERIFY &rarr; SCORE &rarr; PRESENT 全流程；再点右侧看板任意一张卡，看它的证据账本与失效条件。</li>
    <li>左栏 <b>Score the board</b> &mdash; 窗口已关闭的卡用真实价格回头裁决，并报告"分数是否真的预测了结果"。</li>
    <li><a href="https://github.com/lixinlin616-png/prism-desk#readme">README</a> &middot; <a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/ARCHITECTURE.md">ARCHITECTURE</a> &middot; <a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/PROJECT-STATEMENT.md">PROJECT-STATEMENT</a> &middot; <a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/VALIDATION.md">VALIDATION</a></li>
    <li><a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/reports/validation.md">验证报告</a> &middot; <a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/reports/review.md">复盘报告</a> &middot; <a href="https://github.com/lixinlin616-png/prism-desk/blob/main/docs/reports/submission-links.txt">提交材料逐条对照</a></li>
  </ul>

  <p class="note">Nothing here is investment advice. Every card carries the condition that would prove it wrong.<br />
  演示中的发行人为虚构，价格为真实历史日线；本页不构成任何投资建议。</p>
</main>
</body>
</html>
`;
  writeFileSync(DOCS_INDEX, html, 'utf8');
}

/** Minimal static server, so the published artefact can be checked locally. */
async function preview(port) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml' };
  const base = resolve(OUT);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    let file = resolve(join(base, rel));
    if (!file.startsWith(base)) { res.writeHead(403); res.end('forbidden'); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found: ' + rel);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  process.stdout.write(`\npreview: http://127.0.0.1:${port}/  (exactly what Pages will serve)\nCtrl-C to stop.\n`);
}

main().catch((err) => {
  process.stderr.write(((err && err.stack) || String(err)) + '\n');
  process.exitCode = 1;
});
