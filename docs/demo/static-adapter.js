/**
 * Prism Desk - static replay adapter.
 *
 * The desk is a Node server: web/app.js talks to /api/*, and its centrepiece is
 * POST /api/ask streaming the audit trace over SSE. GitHub Pages serves files,
 * not processes, so a published demo needs either a hosted backend or a way to
 * answer those calls without one. This is the second option - and it is
 * deliberately NOT a mock.
 *
 * Every byte served here was recorded by scripts/export-static.mjs from real
 * offline runs of the real pipeline against the committed board fixture: same
 * engine, same corpus, same price book, same numbers as docs/reports/. What a
 * browser cannot do is run YOUR question - there is no engine in it - so an
 * unrecognised question replays the closest recorded run and says so on screen.
 * Writes (paste a document, reset the board) are refused with an explanation
 * rather than silently pretended to succeed.
 *
 * Mechanically it replaces window.fetch for /api/* only. app.js is untouched and
 * cannot tell the difference; the stream is a real ReadableStream paced by the
 * recorded inter-frame gaps, so the trace still arrives stage by stage.
 *
 * Add `?replay=fast` to the URL to drop the pacing (used by the tests).
 */
(function staticReplayAdapter() {
  'use strict';

  const HERE = new URL('./', (document.currentScript && document.currentScript.src) || document.baseURI).href;
  const DATA = HERE + 'data/';
  const realFetch = window.fetch.bind(window);
  const FAST = /[?&]replay=fast\b/.test(window.location.search);

  const cache = new Map();
  const state = { lastRun: null, lastScenario: null, replayed: [] };

  /** Bundle files are immutable once published, so cache the promise, not a copy. */
  async function read(res, rel) {
    const text = await res.text();
    return /\.json$/i.test(rel) ? JSON.parse(text) : text;
  }

  function load(rel) {
    if (!cache.has(rel)) {
      cache.set(rel, realFetch(DATA + rel, { cache: 'force-cache' })
        .then(async (res) => {
          if (res.ok) return read(res, rel);
          // force-cache would replay a stored failure forever (a 404 cached
          // while the site was still building, say), so escape it once.
          const fresh = await realFetch(DATA + rel, { cache: 'reload' });
          if (!fresh.ok) throw new Error(`static bundle is missing ${rel} (HTTP ${fresh.status}) - re-run npm run export:static`);
          return read(fresh, rel);
        })
        .catch((err) => { cache.delete(rel); throw err; }));
    }
    return cache.get(rel);
  }

  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  const textResponse = (body, type) => new Response(body, { status: 200, headers: { 'Content-Type': type } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------- notice
  // The one thing a replay must never do is pass itself off as a live engine,
  // so the badge is permanent and every substitution is announced.

  function mount() {
    const style = document.createElement('style');
    style.textContent = [
      '.prism-static{position:fixed;left:12px;bottom:12px;z-index:9999;max-width:min(540px,calc(100vw - 24px));',
      'font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e8e8e8;',
      'background:rgba(16,18,22,.94);border:1px solid rgba(255,255,255,.18);border-radius:10px;',
      'padding:8px 11px;box-shadow:0 6px 22px rgba(0,0,0,.45)}',
      '.prism-static b{color:#8fd3ff;font-weight:600}',
      '.prism-static a{color:#9be29b}',
      '.prism-static code{color:#ffd9a0}',
      '.prism-static .note{margin-top:5px;padding-top:5px;border-top:1px dashed rgba(255,255,255,.2);',
      'color:#ffd9a0;transition:opacity .6s}',
      '.prism-static .note.gone{opacity:0}',
    ].join('');
    document.head.appendChild(style);

    const badge = document.createElement('div');
    badge.className = 'prism-static';
    badge.innerHTML = '<b>&#9682; static replay</b> &middot; recorded from real offline runs of the same engine '
      + '&middot; free-text questions replay the closest recorded task '
      + '&middot; <a href="https://github.com/lixinlin616-png/prism-desk" target="_blank" rel="noopener">repo</a> '
      + '&middot; live backend: <code>node server.mjs</code>';
    document.body.appendChild(badge);

    return function note(message, ms = 9000) {
      const n = document.createElement('div');
      n.className = 'note';
      n.textContent = message;
      badge.appendChild(n);
      while (badge.querySelectorAll('.note').length > 3) badge.querySelector('.note').remove();
      setTimeout(() => { n.classList.add('gone'); setTimeout(() => n.remove(), 700); }, ms);
    };
  }
  let note = () => {};
  if (document.body) note = mount();
  else document.addEventListener('DOMContentLoaded', () => { note = mount(); }, { once: true });

  // -------------------------------------------------------------------- replay

  /** Exact question first, then word overlap. A substitution is always announced. */
  async function pickRun(question, asOf) {
    const index = await load('api/ask/index.json');
    const runs = index.runs || [];
    const q = String(question || '').trim().toLowerCase();
    const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 2));
    let chosen = runs.find((r) => (r.question || '').trim().toLowerCase() === q) || null;
    let how = 'exact question';
    if (!chosen) {
      const asked = words(q);
      let best = 0;
      for (const r of runs) {
        const have = words(r.question);
        let hit = 0;
        for (const w of asked) if (have.has(w)) hit += 1;
        const score = asked.size ? hit / asked.size : 0;
        if (score > best) { best = score; chosen = r; }
      }
      how = chosen ? `closest recorded task, ${Math.round(best * 100)}% word overlap` : null;
    }
    if (!chosen) return null;

    const bundle = await load(`api/ask/${chosen.scenarioId}.json`);
    const runFrame = (bundle.frames || []).find((f) => f.event === 'run');
    if (!runFrame) throw new Error(`recorded run ${chosen.scenarioId} has no run frame`);
    if (asOf && String(asOf).slice(0, 16) !== String(chosen.asOf).slice(0, 16)) {
      note(`as-of ${asOf} ignored - the bundle replays the recorded clock ${chosen.asOf}.`);
    }
    if (how !== 'exact question') note(`no recorded answer for that question; replaying "${chosen.label}" (${how}).`);
    return { entry: chosen, bundle, run: runFrame.data };
  }

  /** A real ReadableStream, so app.js's SSE parser is doing real work. */
  function sse(frames) {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (i >= frames.length) { controller.close(); return; }
        const frame = frames[i];
        i += 1;
        if (!FAST && frame.dt > 0) await sleep(Math.min(Math.max(frame.dt, 40), 240));
        controller.enqueue(encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`));
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }

  // --------------------------------------------------------------------- routes

  async function route(u, init) {
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const method = String((init && init.method) || 'GET').toUpperCase();
    const query = u.searchParams;
    let body = {};
    if (init && init.body) { try { body = JSON.parse(init.body); } catch { body = {}; } }

    if (method === 'POST' && path === '/api/ask') {
      const picked = await pickRun(body.question, body.asOf);
      if (!picked) return jsonResponse({ ok: false, error: 'static replay bundle has no recorded run for that question' }, 404);
      state.lastRun = picked.run;
      state.lastScenario = picked.entry.scenarioId;
      state.replayed.unshift({
        id: picked.run.id,
        question: picked.run.question,
        asOf: picked.run.asOf,
        ms: picked.run.ms,
        cards: picked.run.cards.length,
        published: picked.run.published.length,
        quarantined: picked.run.quarantined.length,
        ledger: picked.run.ledger,
      });
      state.replayed = state.replayed.slice(0, 20);
      if (body.stream === false) return jsonResponse({ ok: true, run: picked.run });
      return sse(picked.bundle.frames);
    }

    // Refused, not faked: a replay cannot distil a document it has never seen.
    if (method === 'POST' && (path === '/api/corpus' || path === '/api/board/reset')) {
      return jsonResponse({
        ok: false,
        error: 'static replay demo is read-only - run "node server.mjs" (or the hosted backend) to write to the desk',
      }, 409);
    }

    if (method !== 'GET') return jsonResponse({ ok: false, error: `no route ${method} ${path}` }, 404);

    const STATUSES = ['active', 'quarantined', 'all'];
    const status = STATUSES.includes(query.get('status')) ? query.get('status') : 'active';

    switch (path) {
      case '/api/status':
        // Before anything is replayed the ledger is empty, exactly as a freshly
        // booted server holding the committed board would be.
        return jsonResponse(await load(state.lastScenario ? `api/status.${state.lastScenario}.json` : 'api/status.json'));
      case '/api/capabilities': return jsonResponse(await load('api/capabilities.json'));
      case '/api/scenarios': return jsonResponse(await load('api/scenarios.json'));
      case '/api/corpus': return jsonResponse(await load('api/corpus.json'));
      case '/api/board': return jsonResponse(await load(`api/board.${status}.json`));
      case '/api/research/transmission': return jsonResponse(await load('api/research-transmission.json'));
      case '/api/research/gaps': return jsonResponse(await load('api/research-gaps.json'));
      case '/api/review':
        if (query.get('asOf')) note('as-of ignored - the review is recorded at the price book close.');
        return jsonResponse(await load('api/review.json'));
      case '/api/runs': return jsonResponse({ ok: true, runs: state.replayed });
      case '/api/export/board.csv':
        return textResponse(await load(`api/export-board.${status}.csv`), 'text/csv; charset=utf-8');
      case '/api/export/review.md':
        return textResponse(await load('api/export-review.md'), 'text/markdown; charset=utf-8');
      case '/api/export/brief.md':
        if (!state.lastRun) return new Response('no run yet - ask a question first', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        return textResponse(state.lastRun.brief.markdown, 'text/markdown; charset=utf-8');
      default: break;
    }

    const card = path.match(/^\/api\/card\/([A-Za-z0-9\-_]+)$/);
    if (card) {
      const all = await load('api/cards.json');
      const hit = all.cards[decodeURIComponent(card[1])];
      if (!hit) return jsonResponse({ ok: false, error: `no card ${card[1]}` }, 404);
      return jsonResponse({ ok: true, card: hit.card, markdown: hit.markdown });
    }

    return jsonResponse({ ok: false, error: `no route ${method} ${path}` }, 404);
  }

  window.fetch = function patchedFetch(input, init) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, window.location.href); } catch { return realFetch(input, init); }
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    return route(url, init).catch((err) => jsonResponse({ ok: false, error: err.message }, 500));
  };

  load('manifest.json')
    .then((m) => {
      window.PRISM_STATIC_BUNDLE = m;
      document.documentElement.dataset.prismStatic = 'true';
    })
    .catch(() => { /* the badge is the part that matters */ });
})();
