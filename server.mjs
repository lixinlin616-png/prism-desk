#!/usr/bin/env node
/**
 * Prism Desk server.
 *
 * Zero dependencies - node:http only. Serves the LUI from /web and a small JSON
 * + SSE API. `npm install` is never required, which is deliberate: a judge
 * should be able to clone, run `node server.mjs`, and be looking at the desk.
 *
 *   GET  /                          the desk UI
 *   GET  /api/status                data wiring, ledger totals, extractor mode
 *   GET  /api/capabilities          channels, MCP intents, bitget-signal skills
 *   GET  /api/scenarios             preset research questions for the demo
 *   POST /api/ask                   run a research task; streams SSE stage events
 *   GET  /api/board                 the signal board
 *   GET  /api/card/:id              one card in full, with its evidence ledger
 *   GET  /api/corpus                the documents in scope
 *   POST /api/corpus                paste a document into the corpus at runtime
 *   GET  /api/research/transmission macro transmission study
 *   GET  /api/research/gaps         overnight gap study
 *   GET  /api/review                post-hoc adjudication of the board
 *   GET  /api/export/board.csv      board as CSV
 *   GET  /api/export/brief.md       latest brief as markdown
 *   GET  /api/export/review.md      the review as a markdown report
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { config } from './src/config.mjs';
import { logger } from './src/util/log.mjs';
import { Pipeline } from './src/desk/pipeline.mjs';
import { capabilitiesPayload } from './src/desk/capabilities.mjs';
import { SignalBoard } from './src/desk/board.mjs';
import { boardCsv, renderCard } from './src/desk/brief.mjs';
import { CHANNELS, cardSummary } from './src/schema.mjs';
import { runTransmissionStudy } from './src/research/transmission.mjs';
import { runGapStudy } from './src/research/gap-study.mjs';
import { runReview } from './src/review/adjudicate.mjs';
import { renderReviewReport } from './src/review/report.mjs';
import { sseFrame } from './src/util/http.mjs';
import { parseDate } from './src/util/time.mjs';

const log = logger('server');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Preset questions that between them exercise all seven channels.
 *
 * Every scenario carries an explicit `asOf`. The bundled corpus and price book
 * are a fixed September-2025 window, so letting the desk clock default to "now"
 * would make the same command produce different cards depending on the day it
 * was run - and docs/DEMO-TRANSCRIPT.md would stop being reproducible. Pinning
 * the clock to the data is what makes the demo a claim a judge can check.
 * `--as-of=<iso>` on the CLI, or the clock field in the web UI, still wins.
 */
export const SCENARIOS = [
  {
    id: 'full-sweep',
    label: 'Full desk sweep',
    zh: '全频道扫描',
    question: 'Full desk sweep across every channel - what is actually tradeable right now?',
    channels: null,
    asOf: '2025-09-19T20:00:00Z',
    note: 'Exercises all seven channels in one pass. Best first thing to run.',
  },
  {
    id: 'earnings-gap',
    label: 'Earnings expectation gaps',
    zh: '财报预期差',
    question: 'Walk me through the earnings expectation gaps in scope. Which print is wide enough versus consensus to actually reprice the name, and which is already discounted?',
    channels: ['earnings-gap', 'risk-flag'],
    asOf: '2025-09-19T20:00:00Z',
    note: 'Shows consensus-vs-actual, guidance stance classification and the beat-but-ugly case.',
  },
  {
    id: 'macro-transmission',
    label: 'CPI transmission',
    zh: 'CPI 传导链路',
    question: 'The August CPI print came in cool on the headline but hot on core. Map the transmission chain and tell me who is most exposed cross-sectionally.',
    channels: ['macro-transmission'],
    asOf: '2025-09-19T20:00:00Z',
    note: 'The ranking is computed from measured 252-session OLS betas, not asserted.',
  },
  {
    id: 'closed-window',
    label: 'Weekend rToken window',
    zh: '周末 rToken 窗口',
    question: 'A tariff framework just landed on a Saturday afternoon. The cash market is shut for 47 hours but the rToken still trades. How should I think about pricing that gap?',
    channels: ['closed-window', 'cross-asset'],
    asOf: '2025-09-13T15:00:00Z',
    note: 'The core S2 scenario: 7x24 tokenized equity versus a 6.5-hour cash session.',
  },
  {
    id: 'flows',
    label: 'Insider and 13F flows',
    zh: '内部人与 13F 资金',
    question: 'Any insider selling clusters or 13F position changes I should know about?',
    channels: ['flow-footprint'],
    asOf: '2025-09-19T20:00:00Z',
    note: 'Aggregates are recomputed from the raw snapshot by the evidence ledger.',
  },
  {
    id: 'risk',
    label: 'Bear case hunt',
    zh: '反向风险扫描',
    question: 'Run the contrarian screen. Where is the language softening and where do the accounting ratios diverge from the narrative?',
    channels: ['risk-flag', 'narrative-shift'],
    asOf: '2025-09-19T20:00:00Z',
    note: 'Adverse-language and ratio-anomaly flags. Demo issuers are fictional by design.',
  },
];

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limitBytes = 2_000_000) {
  return new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limitBytes) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolveBody({});
      try { resolveBody(JSON.parse(data)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

/** Static file serving with traversal protection. */
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const base = resolve(config.webDir);
  const target = resolve(join(base, normalize(rel)));
  if (!target.startsWith(base + sep) && target !== base) {
    send(res, 403, 'forbidden');
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    // SPA fallback so client-side routes still load.
    const fallback = join(base, 'index.html');
    if (existsSync(fallback)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      createReadStream(fallback).pipe(res);
      return;
    }
    send(res, 404, 'not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
  createReadStream(target).pipe(res);
}
export async function buildApp({ pipeline } = {}) {
  const board = new SignalBoard();
  const desk = pipeline ?? new Pipeline({ board });
  await desk.ready();

  const researchCache = new Map();
  async function research(kind) {
    if (researchCache.has(kind)) return researchCache.get(kind);
    const value = kind === 'transmission'
      ? runTransmissionStudy(desk.hub.prices)
      : { summary: runGapStudy(desk.hub.prices).summary };
    researchCache.set(kind, value);
    return value;
  }

  /**
   * Adjudicate the board against the price book. Not cached: the board changes
   * as the desk runs, and a pass costs ~20ms.
   *
   * Always read-only. The API must never silently reclassify stored cards just
   * because somebody opened a panel - use `node prism.mjs review --persist`.
   */
  function review(asOfParam) {
    const bookTo = desk.hub.prices.stats().to;
    const parsed = (asOfParam ? parseDate(asOfParam) : null) || new Date(`${bookTo}T23:59:59Z`);
    return runReview({
      board: desk.board,
      book: desk.hub.prices,
      corpus: desk.hub.corpus,
      asOf: parsed,
      persist: false,
    });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return send(res, 204, '');

    try {
      // ------------------------------------------------------------ status
      if (path === '/api/status' && req.method === 'GET') {
        return send(res, 200, { ok: true, ...desk.status(), config: { dataMode: config.mcp.mode, mcpUrl: config.mcp.url, minScore: config.scoring.minScoreToPublish } });
      }

      // ------------------------------------------------------ capabilities
      // Built by the one shared builder that scripts/export-static.mjs also
      // uses, so the published static demo can never describe wiring the live
      // backend disagrees with.
      if (path === '/api/capabilities' && req.method === 'GET') {
        return send(res, 200, capabilitiesPayload(desk.hub));
      }

      if (path === '/api/scenarios' && req.method === 'GET') return send(res, 200, { ok: true, scenarios: SCENARIOS });

      // ---------------------------------------------------------------- ask
      if (path === '/api/ask' && req.method === 'POST') {
        const body = await readBody(req);
        const question = String(body.question || '').trim();
        if (!question) return send(res, 400, { ok: false, error: 'question is required' });
        const asOf = (body.asOf ? parseDate(body.asOf) : null) || new Date();
        const stream = body.stream !== false;

        if (!stream) {
          const run = await desk.runTask({ question, asOf, channels: body.channels || null, tickers: body.tickers || null, limit: body.limit ?? 14 });
          return send(res, 200, { ok: true, run: serialiseRun(run) });
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          /**
           * Reverse proxies buffer responses by default, which turns a streaming
           * trace into one blob that lands when the run finishes - the single
           * most visible thing the demo does, silently broken by deploying it.
           * nginx honours this header directly; Caddy and Cloudflare honour it
           * too. See docs/DEPLOY.md.
           */
          'X-Accel-Buffering': 'no',
        });
        const run = await desk.runTask({
          question, asOf,
          channels: body.channels || null,
          tickers: body.tickers || null,
          limit: body.limit ?? 14,
          onEvent: (evt) => { try { res.write(sseFrame('stage', evt)); } catch { /* client left */ } },
        });
        res.write(sseFrame('run', serialiseRun(run)));
        res.write(sseFrame('done', { ok: true, runId: run.id }));
        return res.end();
      }

      // -------------------------------------------------------------- board
      if (path === '/api/board' && req.method === 'GET') {
        const status = url.searchParams.get('status') || 'active';
        const all = status === 'all' ? desk.board.all({ limit: 400 }) : desk.board.all({ status, limit: 400 });
        return send(res, 200, {
          ok: true,
          status: desk.board.status(),
          byChannel: Object.fromEntries(Object.entries(desk.board.byChannel({ status: status === 'all' ? null : status }))),
          watchlist: desk.board.watchlist(),
          cards: all.map(cardSummary),
        });
      }

      const cardMatch = path.match(/^\/api\/card\/([A-Za-z0-9\-_]+)$/);
      if (cardMatch && req.method === 'GET') {
        const card = desk.board.get(cardMatch[1]) ?? desk.runs.flatMap((r) => r.cards).find((c) => c.id === cardMatch[1]);
        if (!card) return send(res, 404, { ok: false, error: `no card ${cardMatch[1]}` });
        return send(res, 200, { ok: true, card, markdown: renderCard(card, { showEvidence: true, showBreakdown: true }) });
      }

      if (path === '/api/board/reset' && req.method === 'POST') {
        desk.board.clear();
        return send(res, 200, { ok: true, status: desk.board.status() });
      }

      // ------------------------------------------------------------- corpus
      if (path === '/api/corpus' && req.method === 'GET') {
        return send(res, 200, {
          ok: true,
          stats: desk.hub.corpus.stats(),
          documents: desk.hub.corpus.all().map((d) => ({ id: d.id, kind: d.kind, title: d.title, tickers: d.tickers, publishedAt: d.publishedAt, source: d.source, synthetic: d.synthetic, words: String(d.body || '').split(/\s+/).length })),
        });
      }

      if (path === '/api/corpus' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.body || !String(body.body).trim()) return send(res, 400, { ok: false, error: 'body is required' });
        const doc = {
          id: body.id || `pasted-${Date.now().toString(36)}`,
          kind: body.kind || 'other',
          title: body.title || 'Pasted document',
          tickers: (body.tickers || []).map((t) => String(t).toUpperCase()),
          publishedAt: body.publishedAt || new Date().toISOString(),
          source: body.source || 'pasted by operator',
          body: String(body.body),
          meta: body.meta || {},
          tags: body.tags || [],
          synthetic: body.synthetic !== false,
        };
        desk.hub.corpus.docs.push(doc);
        desk.hub.corpus.docs.sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
        log.info(`operator pasted document ${doc.id} (${doc.kind}, ${doc.tickers.join('/') || 'no tickers'})`);
        return send(res, 200, { ok: true, document: { id: doc.id, kind: doc.kind, title: doc.title, tickers: doc.tickers }, stats: desk.hub.corpus.stats() });
      }

      // ---------------------------------------------------------- research
      if (path === '/api/research/transmission' && req.method === 'GET') {
        const study = await research('transmission');
        return send(res, 200, { ok: true, ...study });
      }
      if (path === '/api/research/gaps' && req.method === 'GET') {
        const study = await research('gaps');
        return send(res, 200, { ok: true, ...study });
      }

      // -------------------------------------------------------------- review
      if (path === '/api/review' && req.method === 'GET') {
        const r = review(url.searchParams.get('asOf'));
        return send(res, 200, {
          ok: true,
          summary: r.summary,
          calibration: r.calibration,
          lessons: r.lessons,
          claims: r.claims,
          provisional: r.provisional,
          settings: r.settings,
        });
      }

      // ------------------------------------------------------------ export
      if (path === '/api/export/board.csv' && req.method === 'GET') {
        const rows = desk.board.all({ status: url.searchParams.get('status') || 'active', limit: 500 });
        return send(res, 200, boardCsv(rows), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="prism-board.csv"' });
      }
      if (path === '/api/export/brief.md' && req.method === 'GET') {
        const last = desk.lastRun();
        if (!last) return send(res, 404, 'no run yet - ask a question first');
        return send(res, 200, last.brief.markdown, { 'Content-Type': 'text/markdown; charset=utf-8' });
      }
      if (path === '/api/export/review.md' && req.method === 'GET') {
        const r = review(url.searchParams.get('asOf'));
        return send(res, 200, renderReviewReport(r), {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="prism-review.md"',
        });
      }
      if (path === '/api/runs' && req.method === 'GET') {
        return send(res, 200, { ok: true, runs: desk.runs.slice(-20).reverse().map((r) => ({ id: r.id, question: r.question, asOf: r.asOf, ms: r.ms, cards: r.cards.length, published: r.published.length, quarantined: r.quarantined.length, ledger: r.ledger })) });
      }

      if (path.startsWith('/api/')) return send(res, 404, { ok: false, error: `no route ${req.method} ${path}` });

      return serveStatic(req, res, path);
    } catch (err) {
      log.error(`${req.method} ${path} failed: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { ok: false, error: err.message });
      else res.end();
      return undefined;
    }
  };
}

/** Trim a run down to what the UI needs, keeping the full audit trail. */
export function serialiseRun(run) {
  return {
    id: run.id,
    question: run.question,
    asOf: run.asOf,
    ms: run.ms,
    mode: run.mode,
    plan: run.plan,
    coverage: run.coverage,
    documentsUsed: run.documentsUsed,
    snapshotsUsed: run.snapshotsUsed,
    trace: run.trace,
    ledger: run.ledger,
    cards: run.cards,
    published: run.published,
    quarantined: run.quarantined,
    belowThreshold: run.belowThreshold,
    brief: run.brief,
  };
}

/**
 * Bind the HTTP server.
 *
 * Two different situations hide behind the same EADDRINUSE:
 *
 *   1. A container PaaS injected PORT and something else already holds it. That
 *      is fatal and must be fatal: silently moving to another port means the
 *      platform's health check never finds us and the deploy "succeeds" into a
 *      black hole.
 *   2. Somebody ran `npm start` on a laptop where the default port is squatted.
 *      This is not rare - 4310 belongs to Tencent's QQ components on Windows,
 *      5000 to AirPlay on macOS - and the failure mode used to be an unhandled
 *      EADDRINUSE stack trace with no hint about PRISM_PORT. A judge should get
 *      a desk, not a crash.
 *
 * So: fall back to the next free port only when the port was ours to choose,
 * and explain loudly when it was not.
 */
const PORT_FALLBACKS = 20;

export async function start() {
  const handler = await buildApp();
  const server = createServer(handler);
  const explicitPort = process.env.PRISM_PORT !== undefined || process.env.PORT !== undefined;
  let port = config.server.port;

  return new Promise((resolveStart, rejectStart) => {
    const onListening = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
      const bound = server.address();
      const url = `http://${config.server.host}:${bound?.port ?? port}`;
      log.info('');
      log.info('  Prism Desk');
      log.info(`  ${url}`);
      log.info(`  data mode   : ${config.mcp.mode}`);
      log.info(`  mcp endpoint: ${config.mcp.url}`);
      log.info(`  llm         : ${config.llm.enabled ? `${config.llm.model} @ ${config.llm.baseUrl}` : 'not configured - deterministic rule extractor'}`);
      log.info('');
      log.info('  Ask a question in the UI, or: curl -X POST ' + url + '/api/ask -H "Content-Type: application/json" -d \'{"question":"full desk sweep","stream":false}\'');
      log.info('');
      resolveStart(server);
    };

    const onError = (err) => {
      if (err.code !== 'EADDRINUSE') {
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
        rejectStart(err);
        return;
      }
      const next = port + 1;
      if (!explicitPort && next - config.server.port <= PORT_FALLBACKS) {
        log.warn(`port ${port} on ${config.server.host} is already in use (a squatter, not Prism) - trying ${next}`);
        port = next;
        server.listen(port, config.server.host);
        return;
      }
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
      log.error('');
      log.error(`  cannot bind ${config.server.host}:${port} - that port is already in use.`);
      log.error('');
      log.error('  Start on another port instead:');
      log.error('');
      log.error('    PRISM_PORT=4400 npm start        # bash / macOS / Linux');
      log.error('    $env:PRISM_PORT=4400; npm start  # PowerShell');
      log.error('');
      log.error(`  Who owns it:  netstat -ano | findstr :${port}   (Windows)`);
      log.error(`                lsof -i :${port}                  (macOS / Linux)`);
      log.error('');
      rejectStart(err);
    };

    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(port, config.server.host);
  });
}

import { fileURLToPath } from 'node:url';

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  start().catch((err) => {
    // EADDRINUSE has already been explained above; a stack trace on top of it
    // just buries the one line that tells the reader what to do.
    if (err?.code !== 'EADDRINUSE') log.error(err.stack || err.message);
    process.exit(1);
  });
}
