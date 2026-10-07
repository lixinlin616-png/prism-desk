/**
 * Prism Desk - the language user interface.
 *
 * Vanilla ES module. No framework, no bundler, no dependencies: the server
 * hands this file to the browser exactly as it sits on disk, which is the same
 * reason the backend has no npm install step. A judge clones the repo, runs
 * `node server.mjs`, and this is what they get.
 *
 * Responsibilities:
 *   - stream a research run (PLAN -> INGEST -> EXTRACT -> VERIFY -> SCORE ->
 *     PRESENT) into the thread so the work is visible while it happens;
 *   - render signal cards with their evidence ledger, score breakdown and the
 *     condition that would prove them wrong;
 *   - keep the signal board, watchlist and data-wiring panel honest about what
 *     is live, what fell back to a fixture, and what is quarantined.
 *
 * Every string that reaches the DOM goes through esc() or a text node. The desk
 * reads documents written by strangers; it should not execute them.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape untrusted text. Used for anything derived from corpus or model output. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build an element without innerHTML, so interpolation can never inject markup. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value; // only ever called with esc()'d input
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pct = (n, digits = 1) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(digits)}%` : '-');
const num = (n, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '-');
const signClass = (n) => (Number.isFinite(n) ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : '');

function timeAgo(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return String(iso || '-');
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return secs <= 1 ? 'just now' : `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Date(then).toISOString().slice(0, 10);
}

function shortTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(5, 16).replace('T', ' ') : String(iso || '-');
}

/** Trigger a browser download for a text payload. */
function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// --------------------------------------------------------------------------- state

const state = {
  status: null,
  capabilities: null,
  scenarios: [],
  channels: {},
  boardFilter: 'active',
  channelFilter: null,
  showTrace: true,
  showQuarantine: true,
  busy: false,
  turns: 0,
  lastRun: null,
  corpus: null,
};

// ---------------------------------------------------------------------------- api

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) throw new Error(parsed?.error || `HTTP ${res.status} ${path}`);
  return parsed;
}

/**
 * POST /api/ask and consume the server-sent stream.
 *
 * EventSource cannot issue a POST, so the stream is read by hand: split on the
 * blank line that terminates each frame, keep the `event:` name (the server
 * multiplexes stage / run / done on one connection) and JSON-parse the data.
 */
async function askStream(payload, onFrame) {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ stream: true, ...payload }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`ask failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
      const raw = dataLines.join('\n');
      let data;
      try { data = JSON.parse(raw); } catch { data = { raw }; }
      onFrame(name, data);
    }
  }
}

// --------------------------------------------------------------------------- boot

let wiredOnce = false;

async function boot() {
  if (!wiredOnce) {
    wireEvents();
    startClock();
    setAsOfNow();
    wiredOnce = true;
  }
  try {
    $('#thread .boot-error')?.remove();
    const [status, caps, scenarios] = await Promise.all([
      api('/api/status'),
      api('/api/capabilities'),
      api('/api/scenarios'),
    ]);
    state.status = status;
    state.capabilities = caps;
    state.scenarios = scenarios.scenarios || [];
    state.channels = Object.fromEntries((caps.channels || []).map((c) => [c.id, c]));
    renderPills();
    renderChannels();
    renderWiring();
    renderScenarios();
    if (window.PRISM_STATIC_BUNDLE) coachStatic();
    await refreshBoard();
    toast(`Desk online - ${caps.corpus?.documents ?? 0} documents, ${caps.prices?.symbols ?? 0} symbols, ${(caps.intents || []).length} MCP intents wired`, 'ok');
  } catch (err) {
    renderBootError(err);
    toast(`Desk did not start: ${err.message}`, 'err');
    $('#pillData').textContent = 'data offline';
    $('#pillData').className = 'pill bad';
  }
  // keep the wiring panel honest as provider state changes
  setInterval(refreshStatus, 20000);
}

/**
 * A silent empty desk reads as "broken demo", so a failed boot gets a
 * permanent, actionable panel instead of a toast that fades in seven seconds.
 */
/**
 * The replay engine is a classic <script>; if that one request died (site still
 * building, blocked request, poisoned cache) no amount of retrying fetches can
 * bring it back - the tag has to be re-injected. Only meaningful on the static
 * bundle: web/index.html (the live server) ships no such tag.
 */
function rehydrateStaticAdapter() {
  const tag = document.querySelector('script[src*="static-adapter"]');
  if (!tag || window.PRISM_STATIC_BUNDLE || window.PRISM_STATIC_ADAPTER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const src = new URL(tag.getAttribute('src'), document.baseURI);
    src.searchParams.set('retry', String(Date.now()));
    const s = el('script', { src: src.href });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('static-adapter.js still fails to load - hard-refresh (Ctrl+Shift+R) or check the network to this host'));
    document.head.append(s);
  });
}

async function retryBoot() {
  try {
    await rehydrateStaticAdapter();
  } catch (err) {
    renderBootError(err);
    return;
  }
  await boot();
}

/** First-run guidance, static bundle only: a live server needs no coach. */
function coachStatic() {
  const empty = $('#emptyState');
  if (!empty || empty.dataset.coached) return;
  empty.dataset.coached = '1';
  empty.append(el('p', {
    class: 'dim',
    html: '第一次打开？点上方 <b>Full desk sweep</b> 看「提问 → 取数 → 抽取 → 核验 → 打分 → 可用判断」全链路；或直接在下面输入框打字后回车。<br />First time? Click <b>Full desk sweep</b> above, or type a question and press Enter.',
  }));
}

function renderBootError(err) {
  const thread = $('#thread');
  thread.textContent = '';
  const message = String(err && err.message ? err.message : err);
  thread.append(el('div', { class: 'empty boot-error' }, [
    el('h1', { text: 'The desk could not start.' }),
    el('p', { text: message }),
    el('p', {
      class: 'dim',
      text: 'On the GitHub Pages static replay this almost always means the replay bundle failed to load once and that failure got cached - the site was still building, or a request was blocked. The button re-fetches it; a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) does the same by hand.',
    }),
    el('div', { class: 'boot-error-actions' }, [
      el('button', {
        class: 'btn primary',
        text: 'retry',
        onclick: (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          btn.textContent = 'retrying…';
          retryBoot();
        },
      }),
    ]),
  ]));
}

async function refreshStatus() {
  try {
    state.status = await api('/api/status');
    renderPills();
    renderWiring();
  } catch { /* transient; the next tick will retry */ }
}

function renderPills() {
  const s = state.status;
  if (!s) return;
  const market = s.hub?.market || {};
  const ledger = s.ledger || {};
  const extractor = s.extractor || {};

  const data = $('#pillData');
  const stateName = market.state || s.config?.dataMode || 'unknown';
  // On the published replay the mode is honestly 'offline'; say what that
  // means here so the pill does not read as 'nothing is wired'.
  const shownName = document.documentElement.dataset.prismStatic && stateName === 'offline'
    ? 'offline · replay bundle'
    : stateName;
  const live = stateName === 'live';
  data.className = `pill ${live ? 'ok' : stateName === 'fixture' || stateName === 'offline' ? 'warn' : 'live'}`;
  data.innerHTML = `data <b>${esc(shownName)}</b> ${esc(String(market.resolvedIntents ?? 0))}/${esc(String(market.totalIntents ?? 0))} intents`;
  data.title = `mode ${esc(s.config?.dataMode || '?')} - ${esc(market.url || '')}${market.error ? `\nlast error: ${esc(market.error)}` : ''}`;

  const llm = $('#pillLlm');
  const llmInfo = s.hub?.llm || {};
  const mode = extractor.mode || (llmInfo.enabled ? 'hybrid' : 'rules');
  llm.className = `pill ${mode === 'rules' ? 'warn' : 'ok'}`;
  llm.innerHTML = `extractor <b>${esc(mode)}</b>`;
  llm.title = llmInfo.enabled
    ? `LLM ${esc(llmInfo.model || '')} @ ${esc(llmInfo.baseUrl || '')} reconciled against the rule extractor`
    : 'No LLM key configured - deterministic rule extractor only. Set PRISM_LLM_BASE_URL + PRISM_LLM_API_KEY for the hybrid path.';

  const led = $('#pillLedger');
  const passRate = ledger.passRate ?? 0;
  led.className = `pill ${passRate >= 80 ? 'ok' : passRate >= 50 ? 'warn' : 'bad'}`;
  led.innerHTML = `ledger <b>${esc(String(passRate))}%</b> ${esc(String(ledger.itemsChecked ?? 0))} items`;
  led.title = `checked ${ledger.itemsChecked ?? 0} - pass ${ledger.pass ?? 0}, fail ${ledger.fail ?? 0}, unverifiable ${ledger.unverifiable ?? 0}. ${ledger.cardsQuarantined ?? 0} cards quarantined.`;
}

function startClock() {
  const tick = () => {
    const now = new Date();
    $('#pillClock').textContent = `${now.toISOString().slice(11, 19)} UTC`;
    const session = sessionOf(now);
    const pill = $('#pillSession');
    pill.textContent = `session ${session.label}`;
    pill.className = `pill ${session.open ? 'ok' : 'warn'}`;
    pill.title = session.title;
  };
  tick();
  setInterval(tick, 1000);
}

/** US cash session state, computed client-side so the pill is always current. */
function sessionOf(at = new Date()) {
  const day = at.getUTCDay();
  const mins = at.getUTCHours() * 60 + at.getUTCMinutes();
  const weekend = day === 0 || day === 6;
  const open = !weekend && mins >= 13 * 60 + 30 && mins < 20 * 60;
  const pre = !weekend && mins >= 8 * 60 && mins < 13 * 60 + 30;
  const after = !weekend && mins >= 20 * 60 && mins < 24 * 60;
  let hoursClosed = 0;
  if (weekend) {
    const toMon = ((8 - day + 7) % 7) * 24 + (24 - at.getUTCHours()) + (13.5 - at.getUTCMinutes() / 60);
    hoursClosed = Math.max(0, toMon - (day === 6 ? 24 : 0));
  }
  return {
    open,
    label: open ? 'OPEN' : pre ? 'pre-market' : after ? 'after-hours' : weekend ? `CLOSED (${Math.round(hoursClosed)}h)` : 'closed',
    title: open
      ? 'US cash equity session is open - native share and rToken both price continuously.'
      : weekend
        ? `US cash equity market is shut. An rToken on a tokenized-equity venue still trades 7x24, so this window is where the closed-window channel earns its keep (~${Math.round(hoursClosed)}h until the Monday open).`
        : 'US cash equity market is closed. Overnight information is still arriving.',
  };
}

function renderChannels() {
  const list = $('#channelList');
  const caps = state.capabilities;
  if (!caps) return;
  const counts = boardCounts();
  list.replaceChildren(...(caps.channels || []).map((c) => {
    const n = counts[c.id] || 0;
    const li = el('li', {
      class: state.channelFilter === c.id ? 'active' : '',
      title: `${c.question}\ninputs: ${(c.inputs || []).join(', ')}\nhalf-life: ${c.halfLifeHours}h`,
      style: { background: state.channelFilter === c.id ? 'var(--bg-sunk)' : '' },
      onclick: () => {
        state.channelFilter = state.channelFilter === c.id ? null : c.id;
        renderChannels();
        refreshBoard();
      },
    }, [
      el('span', { class: 'channel-dot', style: { background: c.colour, color: c.colour } }),
      el('span', { class: 'channel-name' }, [c.name, el('span', { class: 'channel-zh', text: c.zh })]),
      el('span', { class: `channel-count ${n ? 'nonzero' : ''}`, text: String(n) }),
    ]);
    return li;
  }));
}

function renderWiring() {
  const s = state.status;
  const caps = state.capabilities;
  if (!s || !caps) return;
  const market = s.hub?.market || {};
  const live = (caps.intents || []).filter((i) => i.resolved && !i.fixture).length;
  const fixtured = (caps.intents || []).filter((i) => i.fixture).length;
  const rows = [
    ['mcp', `${esc(market.url || s.config?.mcpUrl || '-').replace(/^https?:\/\//, '')}`],
    ['mode', `<span class="${market.state === 'live' ? 'on' : 'off'}">${esc(String(market.state || '-'))}</span>`],
    ['intents', `${esc(String(market.resolvedIntents ?? 0))}/${esc(String(market.totalIntents ?? 0))} · live ${esc(String(live))} · fixture ${esc(String(fixtured))}`],
    ['signal skills', `${esc(String((caps.skills || []).filter((k) => k.resolved || k.fixture).length))}/${esc(String((caps.skills || []).length))} · live ${esc(String((caps.skills || []).filter((k) => k.resolved).length))} · fixture ${esc(String((caps.skills || []).filter((k) => k.fixture).length))}`],
    ['agentkey', caps.agentKey?.configured
      ? `<span class="${caps.agentKey.state === 'live' ? 'on' : 'off'}">${esc(String(caps.agentKey.state))}</span> · ${esc(String((caps.agentKey.intents || []).filter((i) => i.resolved).length))}/${esc(String((caps.agentKey.intents || []).length))} intents`
      : '<span class="off">no key</span> · optional partner source, inert'],
    ['corpus', `${esc(String(caps.corpus?.documents ?? 0))} docs · ${esc(String(caps.corpus?.words ?? 0))} words`],
    ['prices', `${esc(String(caps.prices?.symbols ?? 0))} symbols · ${esc(String(caps.prices?.bars ?? 0))} bars`],
    ['price range', `${esc(String(caps.prices?.from ?? '-'))} → ${esc(String(caps.prices?.to ?? '-'))}`],
    ['llm', s.hub?.llm?.enabled ? `<span class="on">${esc(s.hub.llm.model)}</span>` : '<span class="off">not configured</span>'],
    ['board', `${esc(String(s.board?.total ?? 0))} cards · ${esc(String(s.board?.byStatus?.active ?? 0))} active`],
    ['min score', `${esc(String(s.config?.minScore ?? '-'))}`],
  ];
  const dl = $('#wiringList');
  dl.replaceChildren(...rows.flatMap(([k, v]) => [
    el('dt', { text: k }),
    el('dd', { html: v }),
  ]));
}

function renderScenarios() {
  const host = $('#scenarios');
  host.replaceChildren(...state.scenarios.map((sc) => el('button', {
    class: 'scenario',
    type: 'button',
    title: `${sc.note || ''}\n\nchannels: ${(sc.channels || ['all']).join(', ')}`,
    onclick: () => runScenario(sc),
  }, [sc.label, el('span', { class: 'zh', text: sc.zh })])));
}

// -------------------------------------------------------------------------- thread

function setAsOfNow() {
  const input = $('#asOf');
  const now = new Date();
  now.setSeconds(0, 0);
  // datetime-local wants wall-clock time with no zone suffix; the desk runs on UTC.
  input.value = now.toISOString().slice(0, 16);
}

function asOfFromDateInput() {
  const raw = $('#asOf').value;
  if (!raw) return new Date();
  const parsed = new Date(`${raw}:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

async function runScenario(sc) {
  if (sc.asOf) $('#asOf').value = new Date(sc.asOf).toISOString().slice(0, 16);
  await ask(sc.question, { channels: sc.channels, note: sc.note });
}

/**
 * Run one research task end to end, streaming the trace into the thread.
 * The trace is the product: it is where a reader decides whether to trust the
 * cards, so it is on by default and every stage is shown with its real numbers.
 */
async function ask(question, { channels = null, note = null } = {}) {
  const q = String(question || '').trim();
  if (!q) return;
  if (state.busy) { toast('A run is already in flight', 'warn'); return; }

  $('#emptyState')?.remove();
  const asOf = asOfFromDateInput();
  const turn = newTurn(q, asOf, { channels, note });
  state.busy = true;
  setBusy(true);

  let run = null;
  try {
    await askStream({ question: q, asOf: asOf.toISOString(), channels }, (name, data) => {
      if (name === 'stage') addTraceRow(turn, data);
      else if (name === 'run') { run = data; }
      else if (name === 'done') finishTrace(turn);
    });
    if (!run) throw new Error('stream closed without a run payload');
    state.lastRun = run;
    state.turns += 1;
    if (run.replayNote) {
      turn.body.prepend(el('div', { class: 'coverage' }, [
        el('b', { text: 'Static replay' }), ` ${esc(run.replayNote)}`,
      ]));
    }
    renderRun(turn, run);
    await Promise.all([refreshBoard(), refreshStatus()]);
    renderChannels();
  } catch (err) {
    finishTrace(turn);
    turn.body.append(el('div', { class: 'silence-note' }, [
      el('b', { text: 'run failed' }), ` ${esc(err.message)}`,
    ]));
    toast(err.message, 'err');
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

function setBusy(busy) {
  const btn = $('#askBtn');
  btn.disabled = busy;
  btn.firstChild.textContent = busy ? 'Running' : 'Run';
  $('#question').disabled = busy;
}

function newTurn(question, asOf, { channels, note } = {}) {
  const thread = $('#thread');
  const body = el('div', { class: 'turn-body' });
  const trace = el('div', { class: 'trace' });
  const turn = el('div', { class: 'turn' }, [
    el('div', { class: 'q-row' }, [
      el('div', { class: 'q-avatar', text: 'Q' }),
      el('div', {}, [
        el('div', { class: 'q-text', text: question }),
        el('div', {
          class: 'q-meta',
          text: `as-of ${asOf.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${sessionOf(asOf).label}`
            + `${channels?.length ? ` · channels ${channels.join(', ')}` : ' · all channels'}`
            + `${note ? ` · ${note}` : ''}`,
        }),
      ]),
    ]),
    el('button', {
      class: 'trace-toggle',
      type: 'button',
      text: state.showTrace ? '▾ hide trace' : '▸ show trace',
      onclick: (ev) => {
        const collapsed = trace.classList.toggle('collapsed');
        ev.target.textContent = collapsed ? '▸ show trace' : '▾ hide trace';
      },
    }),
    trace,
    body,
  ]);
  if (!state.showTrace) trace.classList.add('collapsed');
  thread.append(turn);
  turn.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return { node: turn, trace, body, stages: new Map() };
}

const STAGE_LABELS = {
  plan: 'PLAN',
  'plan:ticker-fallback': 'PLAN·tickers',
  'plan:widened': 'PLAN·not parsed',
  'ingest:corpus': 'INGEST·corpus',
  'ingest:data': 'INGEST·mcp',
  extract: 'EXTRACT',
  verify: 'VERIFY',
  'verify:summary': 'VERIFY·ledger',
  score: 'SCORE',
  present: 'PRESENT',
};

/** One line of the live audit trace. Same stage twice updates in place. */
function addTraceRow(turn, evt) {
  const stage = evt.stage || 'stage';
  const label = STAGE_LABELS[stage] || stage;
  const detail = describeStage(stage, evt);
  const key = stage === 'verify' || stage === 'score' ? stage : `${stage}#${turn.stages.size}`;

  const aggregated = stage === 'verify' || stage === 'score';
  if (aggregated) {
    // per-card stages would flood the trace; roll them into a running counter
    const agg = turn.stages.get(stage);
    if (agg) {
      agg.count += 1;
      agg.detail.textContent = `${detail}   [${agg.count} ${stage === 'verify' ? 'audited' : 'scored'}]`;
      return;
    }
    turn.stages.set(stage, { count: 1 });
  }

  const row = el('div', { class: 'trace-row' }, [
    el('span', { class: 'stage', text: label }),
    el('span', { class: 'detail', text: detail }),
  ]);
  if (aggregated) turn.stages.get(stage).detail = row.querySelector('.detail');
  turn.trace.append(row);
  turn.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function describeStage(stage, evt) {
  switch (stage) {
    case 'plan': {
      const p = evt.plan || {};
      const bits = [];
      bits.push(`channels ${(p.channels || []).map((c) => state.channels[c]?.zh || c).join(' / ') || 'none matched'}`);
      if (p.widened) bits.push('NOT PARSED - spectrum widened to all seven');
      else if (p.matched?.length) bits.push(`matched ${p.matched.length}/7`);
      if (p.intents?.length) bits.push(`intents ${p.intents.join(', ')}`);
      if (p.indicators?.length) bits.push(`macro ${p.indicators.join(', ')}`);
      if (evt.resolvedTickers?.length) bits.push(`tickers ${evt.resolvedTickers.join(', ')}`);
      if (evt.rejectedTickers?.length) bits.push(`ignored words ${evt.rejectedTickers.slice(0, 6).join(', ')}`);
      bits.push(`session ${p.session?.state || '?'}`);
      return bits.join(' · ');
    }
    case 'plan:ticker-fallback':
      return `question named no resolvable ticker - falling back to issuers in scope: ${(evt.tickers || []).join(', ')}`;
    case 'plan:widened':
      return evt.message || 'no channel keyword matched - all seven channels opened; this is a scan, not a parsed ask';
    case 'ingest:corpus':
      return `${evt.count} documents · kinds ${(evt.kinds || []).join(', ') || 'none'}`;
    case 'ingest:data': {
      if (evt.message) return evt.message;
      return `${evt.snapshots} data snapshots · intents ${(evt.intents || []).join(', ') || 'none'} · origin ${(evt.origins || []).join('/') || 'none'}`;
    }
    case 'extract': {
      const t = (evt.trace || []).map((x) => `${x.stage}:${x.cards ?? 0}`).join(' → ');
      return `mode ${evt.mode} · ${evt.cards} candidate cards · ${t || 'no trace'}`;
    }
    case 'verify':
      return `${evt.title || evt.cardId} · pass ${evt.pass} fail ${evt.fail} unverifiable ${evt.unverifiable}${evt.quarantined ? ' · QUARANTINED' : ''}`;
    case 'verify:summary':
      return `ledger ${evt.itemsChecked} items · pass rate ${evt.passRate}% · ${evt.cardsQuarantined} cards quarantined`;
    case 'score':
      return `${evt.title || evt.cardId} · ${evt.total}/100 grade ${evt.grade}${evt.publishable ? '' : ' · below publish threshold'}`;
    case 'present':
      return `published ${evt.published} · quarantined ${evt.quarantined} · below threshold ${evt.belowThreshold} · ${evt.ms}ms`;
    default:
      return JSON.stringify(evt).slice(0, 200);
  }
}

function finishTrace(turn) {
  $$('.trace-row.pending', turn.trace).forEach((r) => r.classList.remove('pending'));
}

// ------------------------------------------------------------------- run rendering

function renderRun(turn, run) {
  const body = turn.body;
  body.append(renderRunSummary(run));
  if (run.coverage?.silent?.length) body.append(renderCoverage(run.coverage));

  const published = (run.cards || []).filter((c) => c.status === 'active');
  const quarantined = (run.cards || []).filter((c) => c.status === 'quarantined');
  const below = (run.cards || []).filter((c) => c.status === 'draft' || c.status === 'expired');

  if (published.length) {
    body.append(el('div', { class: 'section-label', text: `Signal cards - ${published.length} published` }));
    body.append(el('div', { class: 'card-grid' }, published.map((c) => cardEl(c, { full: true }))));
  }
  if (quarantined.length && state.showQuarantine) {
    body.append(el('div', { class: 'section-label', text: `Quarantined - ${quarantined.length} failed the ledger` }));
    body.append(el('div', { class: 'card-grid' }, quarantined.map((c) => cardEl(c, { full: true }))));
  }
  if (below.length) {
    body.append(el('div', { class: 'section-label', text: `Below threshold - ${below.length} not published` }));
    body.append(el('div', { class: 'card-grid' }, below.slice(0, 8).map((c) => cardEl(c, { full: false }))));
  }
  if (!published.length && !quarantined.length && !below.length) {
    body.append(el('div', { class: 'silence-note' }, [
      el('b', { text: 'No cards.' }),
      ' The documents in scope produced nothing that cleared the ledger and the publish threshold. That is a real answer, not a failure - the desk says so rather than manufacturing a signal.',
    ]));
  }
  if (run.brief?.markdown) {
    body.append(el('div', { class: 'card-foot' }, [
      el('span', {}, [
        el('button', {
          class: 'btn tiny ghost', type: 'button', text: 'view brief.md',
          onclick: () => openMarkdown('Research brief', run.brief.markdown),
        }),
        ' ',
        el('button', {
          class: 'btn tiny ghost', type: 'button', text: 'download',
          onclick: () => download(`prism-brief-${run.id}.md`, run.brief.markdown, 'text/markdown;charset=utf-8'),
        }),
      ]),
    ]));
  }
}

function renderRunSummary(run) {
  const led = run.ledger || {};
  const origins = [...new Set((run.snapshotsUsed || []).map((s) => s.origin))];
  const bits = [
    el('span', {}, [el('b', { text: String(run.published?.length ?? 0) }), ' published']),
    el('span', {}, [el('b', { text: String(run.quarantined?.length ?? 0) }), ' quarantined']),
    el('span', {}, [el('b', { text: String(run.belowThreshold?.length ?? 0) }), ' below threshold']),
    el('span', {}, [el('b', { text: `${led.passRate ?? 0}%` }), ` ledger pass (${led.pass ?? 0}/${led.itemsChecked ?? 0})`]),
    el('span', {}, [el('b', { text: String(run.documentsUsed?.length ?? 0) }), ' documents']),
    el('span', {}, [el('b', { text: String(run.snapshotsUsed?.length ?? 0) }), ` data snapshots${origins.length ? ` (${origins.join('/')})` : ''}`]),
    el('span', {}, [el('b', { text: String(run.ms ?? 0) }), ' ms']),
    el('span', {}, [el('b', { text: String(run.mode ?? '-') }), ' extractor']),
  ];
  return el('div', { class: 'run-summary' }, bits);
}

/** Names the trader asked about that produced nothing. Silence is reported, never hidden. */
function renderCoverage(coverage) {
  return el('div', { class: 'silence-note' }, [
    el('b', { text: 'Coverage' }),
    ` asked about ${(coverage.asked || []).join(', ')}; answered ${(coverage.answered || []).join(', ') || 'none'}; `,
    el('b', { text: `silent on ${(coverage.silent || []).join(', ')}` }),
    ' - no document in scope and no data snapshot supported a falsifiable claim about those names, so the desk produced nothing rather than guessing.',
  ]);
}
// ---------------------------------------------------------------------- card views

const channelColour = (id) => state.channels[id]?.colour || '#8b95a5';

function scoreFillColour(total) {
  if (total >= 75) return 'var(--long)';
  if (total >= 62) return 'var(--accent)';
  if (total >= 48) return 'var(--hedge)';
  return 'var(--fail)';
}

function gradeOf(score) {
  if (!Number.isFinite(score)) return 'F';
  return score >= 75 ? 'A' : score >= 62 ? 'B' : score >= 48 ? 'C' : score >= 35 ? 'D' : 'F';
}

/**
 * The card as it appears in the thread and on the board. Accepts a full card or
 * a cardSummary - both carry every field used here, so one renderer serves both.
 */
function cardEl(card, { full = true } = {}) {
  const colour = channelColour(card.channel);
  const score = card.score?.total ?? null;
  const grade = card.score?.grade || gradeOf(score);
  const v = card.verification || {};
  const evidence = card.evidence || [];
  const verified = evidence.filter((e) => e.verified === 'pass').length;

  const flags = [];
  if (card.status === 'quarantined') {
    flags.push(el('span', { class: 'chip-flag fail', text: 'QUARANTINED', title: 'Headline evidence failed the ledger, so this card can never be published.' }));
  }
  if (v.fail && card.status !== 'quarantined') flags.push(el('span', { class: 'chip-flag fail', text: `${v.fail} failed` }));
  if (v.unverifiable) {
    flags.push(el('span', {
      class: 'chip-flag warn', text: `${v.unverifiable} unverifiable`,
      title: 'Numbers the desk could not ground in a source. They are shown but never allowed to carry the headline.',
    }));
  }
  if ((card.conflicts || []).length) {
    flags.push(el('span', { class: 'chip-flag conflict', text: `${card.conflicts.length} conflict`, title: card.conflicts.map((c) => c.detail).join('\n') }));
  }
  if (card.validation && !card.validation.ok) {
    flags.push(el('span', { class: 'chip-flag warn', text: 'schema', title: (card.validation.errors || []).join('\n') }));
  }

  return el('article', {
    class: `signal-card ${card.status || ''}`,
    style: { borderLeftColor: colour },
    title: 'Open the full dossier',
    onclick: () => openCard(card.id),
  }, [
    el('div', { class: 'card-top' }, [
      el('span', { class: `chip-dir dir-${card.direction || 'neutral'}`, text: String(card.direction || 'neutral').toUpperCase() }),
      el('span', { class: 'chip-ch', style: { '--ch': colour }, text: state.channels[card.channel]?.zh || card.channel }),
      ...(card.tickers || []).map((t) => el('span', { class: 'chip-ticker', text: t })),
      el('span', { class: 'chip-flag', style: { color: 'var(--text-faint)', borderColor: 'var(--line)' }, text: String(card.horizon || 'days') }),
      ...flags,
    ]),
    el('h3', { class: 'card-title', text: card.title || (card.claim || '').slice(0, 90) }),
    full ? el('p', { class: 'card-claim', text: card.claim || '' }) : null,
    el('div', { class: 'score-row' }, [
      el('span', { class: `grade grade-${grade}`, text: grade }),
      el('div', { class: 'score-meter' }, [
        el('div', { class: 'score-fill', style: { width: `${clamp(score ?? 0, 0, 100)}%`, background: scoreFillColour(score ?? 0) } }),
      ]),
      el('span', { class: 'score-num', text: score === null ? '-' : String(Math.round(score)) }),
    ]),
    el('div', { class: 'card-foot' }, [
      el('span', {}, [el('b', { text: `${verified}/${evidence.length}` }), ' evidence verified']),
      card.invalidation?.condition
        ? el('span', { title: card.invalidation.condition }, [el('b', { text: 'falsifiable' }), ' yes'])
        : el('span', { text: 'no invalidation' }),
      el('span', {}, [el('b', { text: String(card.provenance?.extractor || '?') }), ' extractor']),
      el('span', { text: `expires ${shortTime(card.expiresAt)}` }),
      el('span', { text: card.id }),
    ]),
  ]);
}

// --------------------------------------------------------------------------- board

const boardCounts = () => state.boardCounts || {};

async function refreshBoard() {
  try {
    const params = new URLSearchParams({ status: state.boardFilter });
    const data = await api(`/api/board?${params}`);
    const counts = state.boardFilter === 'active'
      ? data.byChannel
      : (await api('/api/board?status=active')).byChannel;
    state.boardCounts = Object.fromEntries(Object.entries(counts || {}).map(([k, v]) => [k, v.length]));
    renderBoard(data);
  } catch (err) {
    $('#boardStats').replaceChildren(el('div', { class: 'board-empty', text: `board unavailable: ${err.message}` }));
  }
}

function renderBoard(data) {
  const status = data.status || {};
  $('#boardStats').replaceChildren(
    statBox('active', String(status.byStatus?.active ?? 0), 'good'),
    statBox('quarantined', String(status.byStatus?.quarantined ?? 0), (status.byStatus?.quarantined ?? 0) ? 'warn' : ''),
    statBox('avg score', String(status.activeAvgScore ?? '-'), ''),
    statBox('conflicts', String(status.conflicts ?? 0), (status.conflicts ?? 0) ? 'bad' : ''),
  );

  const list = $('#boardList');
  const cards = (data.cards || []).filter((c) => !state.channelFilter || c.channel === state.channelFilter);
  if (!cards.length) {
    list.replaceChildren(el('div', {
      class: 'board-empty',
      text: state.channelFilter
        ? `No ${state.boardFilter} cards on ${state.channels[state.channelFilter]?.name || state.channelFilter} yet. Clear the filter in the left rail or run that scenario.`
        : 'The board is empty. Ask a question, or run one of the scenarios above - cards accumulate here across runs and survive a restart.',
    }));
  } else {
    list.replaceChildren(...cards.map((c, i) => el('li', {
      class: 'board-item',
      title: c.claim || '',
      onclick: () => openCard(c.id),
    }, [
      el('span', { class: 'rank', text: String(i + 1) }),
      el('div', {}, [
        el('div', { class: 'bi-title', text: c.title || (c.claim || '').slice(0, 80) }),
        el('div', { class: 'bi-sub' }, [
          el('span', { style: { color: channelColour(c.channel) }, text: (c.tickers || []).join(' ') || c.channel }),
          ` - ${c.direction} - ${c.status}`,
        ]),
      ]),
      el('span', { class: 'bi-score', style: { color: scoreFillColour(c.score) }, text: c.score === null ? '-' : String(Math.round(c.score)) }),
    ])));
  }

  renderWatchlist(data.watchlist || []);
}

function statBox(k, v, tone = '') {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'k', text: k }),
    el('div', { class: `v ${tone}`, text: v }),
  ]);
}

function renderWatchlist(rows) {
  const table = $('#watchlist');
  if (!rows.length) {
    table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'board-empty', text: 'no names in scope yet' }))));
    return;
  }
  table.replaceChildren(
    el('thead', {}, el('tr', {}, [
      el('th', { text: 'ticker' }), el('th', { text: 'cards' }), el('th', { text: 'L/S' }),
      el('th', { text: 'best' }), el('th', { text: 'net read' }),
    ])),
    el('tbody', {}, rows.slice(0, 14).map((r) => el('tr', {
      style: { cursor: 'pointer' },
      title: `channels: ${(r.channels || []).join(', ')} (best score ${r.bestScore}). Click to load a question about ${r.ticker}.`,
      onclick: () => {
        state.channelFilter = null;
        renderChannels();
        $('#question').value = `What is the desk's current read on ${r.ticker}? Walk me through every channel.`;
        $('#question').focus();
      },
    }, [
      el('td', {}, [r.ticker, r.conflict ? el('span', { class: 'conflict-dot', text: ' !', title: 'Opposing active cards on this name' }) : null]),
      el('td', { text: String(r.cards) }),
      el('td', { text: `${r.long ?? 0}/${r.short ?? 0}` }),
      el('td', { text: String(Math.round(r.bestScore ?? 0)) }),
      el('td', { class: `read-${r.netRead}`, text: r.netRead }),
    ]))),
  );
}
// -------------------------------------------------------------------------- drawer

function openDrawer(title) {
  $('#drawerTitle').textContent = title;
  $('#drawerBody').replaceChildren(el('div', { class: 'board-empty', text: 'loading...' }));
  $('#drawer').hidden = false;
  $('#drawerScrim').hidden = false;
  return $('#drawerBody');
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawerScrim').hidden = true;
}

/** The dossier: everything a reader needs to decide whether to trust the card. */
async function openCard(id) {
  const body = openDrawer('Card dossier');
  body.replaceChildren(el('div', { class: 'board-empty', text: 'loading the dossier bundle (about 2 MB the first time a card is opened)…' }));
  let data;
  try {
    data = await api(`/api/card/${encodeURIComponent(id)}`);
  } catch (err) {
    body.replaceChildren(el('div', { class: 'board-empty', text: `could not load card: ${err.message}` }));
    return;
  }
  const card = data.card;
  $('#drawerTitle').textContent = card.title || card.id;
  body.replaceChildren(...renderDossier(card, data.markdown));
  body.scrollTop = 0;
}

function renderDossier(card, markdown) {
  const colour = channelColour(card.channel);
  const out = [];

  out.push(el('div', { class: 'd-section' }, [
    el('p', { class: 'd-claim', text: card.claim || '' }),
    el('div', { class: 'd-meta' }, [
      el('span', { class: `chip-dir dir-${card.direction}`, text: String(card.direction).toUpperCase() }),
      el('span', { class: 'chip-ch', style: { '--ch': colour }, text: `${state.channels[card.channel]?.name || card.channel} / ${state.channels[card.channel]?.zh || ''}` }),
      ...(card.tickers || []).map((t) => el('span', { class: 'chip-ticker', text: t })),
      ...(card.instruments || []).map((i) => el('span', { class: 'chip-ticker', style: { opacity: 0.7 }, text: i })),
      el('span', { class: 'chip-flag', style: { color: 'var(--text-faint)', borderColor: 'var(--line)' }, text: `${card.horizon} horizon` }),
      el('span', { class: 'chip-flag', style: { color: 'var(--text-faint)', borderColor: 'var(--line)' }, text: card.status }),
    ]),
  ]));

  if (card.expectationGap) out.push(renderGap(card.expectationGap));
  if (card.transmissionChain?.length) out.push(renderChain(card.transmissionChain));
  out.push(renderScoreSection(card));
  out.push(renderEvidenceSection(card.evidence || []));
  out.push(renderInvalidation(card.invalidation));
  if (card.tradeSketch) out.push(renderTradeSketch(card.tradeSketch));
  if ((card.risks || []).length || (card.catalysts || []).length) out.push(renderRiskCatalyst(card));
  if ((card.conflicts || []).length) out.push(renderConflicts(card.conflicts));
  out.push(renderProvenance(card));
  if (markdown) {
    out.push(el('div', { class: 'd-section' }, [
      el('h3', { text: 'Export' }),
      el('div', { class: 'rail-buttons' }, [
        el('button', { class: 'btn tiny ghost', type: 'button', text: 'copy markdown', onclick: () => copyText(markdown) }),
        el('button', { class: 'btn tiny ghost', type: 'button', text: 'copy json', onclick: () => copyText(JSON.stringify(card, null, 2)) }),
        el('button', { class: 'btn tiny ghost', type: 'button', text: 'download card.json', onclick: () => download(`${card.id}.json`, JSON.stringify(card, null, 2), 'application/json') }),
        el('button', { class: 'btn tiny ghost', type: 'button', text: 'view brief.md', onclick: () => openMarkdown('Card markdown', markdown) }),
      ]),
    ]));
  }
  return out;
}

function section(title, children) {
  return el('div', { class: 'd-section' }, [el('h3', { text: title }), ...[].concat(children)]);
}

function kvList(pairs) {
  return el('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [
    el('dt', { text: k }),
    el('dd', { html: v === null || v === undefined || v === '' ? '<span class="dim">-</span>' : v }),
  ]));
}

function renderGap(gap) {
  return section('Expectation gap', kvList([
    ['metric', esc(gap.metric || '-')],
    ['consensus', esc(String(gap.consensus ?? '-')) + (gap.unit ? ` ${esc(gap.unit)}` : '')],
    ['actual', `<b>${esc(String(gap.actual ?? '-'))}</b>` + (gap.unit ? ` ${esc(gap.unit)}` : '')],
    ['delta', `<b class="${gap.deltaPct > 0 ? 'pos' : gap.deltaPct < 0 ? 'neg' : ''}">${esc(pct(gap.deltaPct, 2))}</b>`],
    ['surprise (sigma)', esc(gap.sigma === null || gap.sigma === undefined ? '-' : `${gap.sigma}σ`)],
    ['band', esc(gap.band || '-')],
    ['guidance stance', esc(gap.guidanceStance || '-')],
    ['tone', esc(gap.tone === null || gap.tone === undefined ? '-' : String(gap.tone))],
    ['confidence', esc(gap.confidence === null || gap.confidence === undefined ? '-' : String(gap.confidence))],
    ['source', esc(gap.source || '-')],
  ]));
}

function renderChain(hops) {
  return section('Transmission chain', el('ol', { class: 'chain' }, hops.map((hop, i) => el('li', {}, [
    el('div', { class: 'hop-head' }, [
      `${i + 1}. ${esc(hop.from || '?')}`,
      el('span', { class: 'arrow', text: '->' }),
      esc(hop.to || '?'),
    ]),
    el('div', { class: 'hop-mech', text: hop.mechanism || '' }),
    hop.exposed?.length ? el('div', { class: 'hop-exposed', text: `exposed: ${hop.exposed.join(', ')}` }) : null,
    el('div', {
      class: 'hop-meta',
      text: `confidence ${hop.confidence ?? '-'}${hop.lag ? ` - lag ${hop.lag}` : ''}${hop.source ? ` - source ${hop.source}` : ''}`,
    }),
  ]))));
}

function renderScoreSection(card) {
  const score = card.score || {};
  const breakdown = card.scoreBreakdown || {};
  const rows = Object.entries(breakdown).map(([factor, f]) => el('tr', {}, [
    el('td', { text: factor }),
    el('td', { class: 'num', text: String(f.score ?? '-') }),
    el('td', { class: 'num', text: String(f.weight ?? '-') }),
    el('td', { class: 'num', text: String(f.contribution ?? '-') }),
    el('td', { class: 'reason', text: f.reason || '' }),
  ]));
  for (const p of score.penalties || []) {
    rows.push(el('tr', { class: 'penalty' }, [
      el('td', { text: p.id }), el('td', { class: 'num', text: `-${p.amount}` }),
      el('td', { class: 'num', text: '-' }), el('td', { class: 'num', text: `-${p.amount}` }),
      el('td', { class: 'reason', text: p.reason }),
    ]));
  }
  rows.push(el('tr', { class: 'total' }, [
    el('td', { text: 'total' }), el('td', { class: 'num', text: String(score.raw ?? '-') }),
    el('td', { class: 'num', text: '1.0' }), el('td', { class: 'num', text: String(score.total ?? '-') }),
    el('td', { class: 'reason', text: `grade ${score.grade ?? '-'} - ${score.publishable ? 'publishable' : 'below the publish threshold or headline unverified'}` }),
  ]));

  return section('Score breakdown', [
    el('table', { class: 'score-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'factor' }), el('th', { class: 'num', text: 'score' }),
        el('th', { class: 'num', text: 'weight' }), el('th', { class: 'num', text: 'contrib' }),
        el('th', { text: 'why' }),
      ])),
      el('tbody', {}, rows),
    ]),
    el('p', { class: 'hint', text: `conviction ${card.conviction ?? '-'} / 100 - publish threshold ${state.status?.config?.minScore ?? '-'} - every factor carries the reason it got that number.` }),
  ]);
}

function renderEvidenceSection(evidence) {
  if (!evidence.length) return section('Evidence ledger', el('p', { class: 'hint', text: 'none - the card would be rejected by the schema validator.' }));
  const marks = { pass: 'OK', fail: 'XX', unverifiable: '??', pending: '..' };
  return section(`Evidence ledger - ${evidence.length} items`, evidence.map((e) => el('div', {
    class: `ev-item ${e.verified || 'pending'}`,
  }, [
    el('div', { class: 'ev-head' }, [
      el('span', { class: 'ev-mark', text: marks[e.verified] || '..' }),
      el('span', { class: 'ev-id', text: e.id }),
      el('span', { class: 'ev-tag', text: e.type || 'item' }),
      e.headline ? el('span', { class: 'ev-tag ev-headline', text: 'headline' }) : null,
      e.symbol ? el('span', { class: 'ev-tag', text: e.symbol }) : null,
      e.date ? el('span', { class: 'ev-tag', text: e.date }) : null,
      el('span', { class: `ev-status ${e.verified || 'pending'}`, text: e.verified || 'pending' }),
    ]),
    e.quote ? el('p', { class: 'ev-quote', text: `"${e.quote}"` }) : null,
    el('div', {
      class: 'ev-checked',
      html: `value <b>${esc(e.value === null || e.value === undefined ? '-' : String(e.value))}${esc(e.unit ? ` ${e.unit}` : '')}</b>`
        + `${e.checkedAgainst ? ` - checked against <b>${esc(String(e.checkedAgainst))}</b>` : ''}`
        + `${e.locator ? ` - ${esc(String(e.locator))}` : ''}`
        + `<br/>source: ${esc(String(e.source || '-'))}`,
    }),
    e.recipe ? el('div', { class: 'ev-note', text: `recomputed: ${e.recipe}` }) : null,
    e.note ? el('div', { class: 'ev-note', text: e.note }) : null,
  ])));
}

function renderInvalidation(inval) {
  if (!inval?.condition) {
    return section('What would prove this wrong', el('p', { class: 'hint', text: 'MISSING - the schema validator rejects unfalsifiable cards, so this one cannot be published.' }));
  }
  return section('What would prove this wrong', el('div', { class: 'inval' }, [
    el('p', { text: inval.condition }),
    el('div', { class: 'lvl', text: `trigger: ${inval.level ?? '-'}${inval.recheckAt ? ` - recheck ${String(inval.recheckAt).slice(0, 10)}` : ''}` }),
  ]));
}

function renderTradeSketch(ts) {
  const rows = [];
  if (ts.pair) rows.push(['structure', `pair: long ${esc(ts.pair.long)} / short ${esc(ts.pair.short)}`]);
  if (ts.entryZone) rows.push(['entry zone', esc([].concat(ts.entryZone).join(' - '))]);
  if (ts.stop !== null && ts.stop !== undefined) rows.push(['stop', esc(String(ts.stop))]);
  if (ts.target !== null && ts.target !== undefined) rows.push(['target', esc(String(ts.target))]);
  if (ts.riskPctOfPortfolio !== undefined) rows.push(['risk', `${esc(String(ts.riskPctOfPortfolio))}% of portfolio`]);
  if (ts.venue) rows.push(['venue', esc(ts.venue)]);
  if (ts.sizing) rows.push(['sizing', esc(ts.sizing)]);
  if (ts.rtokenNote) rows.push(['rtoken note', esc(ts.rtokenNote)]);
  return section('Trade sketch', [
    kvList(rows),
    el('p', { class: 'hint', text: 'A sketch, not an order. Prism sizes the idea; a human decides whether to take it.' }),
  ]);
}

function renderRiskCatalyst(card) {
  const kids = [];
  if (card.risks?.length) {
    kids.push(el('div', { class: 'section-label', text: 'Bear case' }));
    kids.push(el('ul', { class: 'chain' }, card.risks.map((r) => el('li', { class: 'hop-mech', text: r }))));
  }
  if (card.catalysts?.length) {
    kids.push(el('div', { class: 'section-label', text: 'Catalysts' }));
    kids.push(el('ul', { class: 'chain' }, card.catalysts.map((c) => el('li', { class: 'hop-mech', text: typeof c === 'string' ? c : `${c.date ?? ''} ${c.event ?? ''}`.trim() }))));
  }
  return section('Risks and catalysts', kids);
}

function renderConflicts(conflicts) {
  return section('Conflicts', conflicts.map((c) => el('div', { class: 'conflict-box' }, [
    el('div', { class: 'ct', text: c.type || 'conflict' }),
    el('div', { class: 'cd', text: c.detail || JSON.stringify(c) }),
  ])));
}

function renderProvenance(card) {
  const p = card.provenance || {};
  const v = card.verification || {};
  const val = card.validation || {};
  return section('Provenance and audit', kvList([
    ['card id', esc(card.id)],
    ['extractor', esc(p.extractor || '-')],
    ['llm model', esc(p.llmModel || 'none - deterministic rules only')],
    ['documents', esc((p.documents || []).join(', ') || '-')],
    ['tools', esc((p.tools || []).join(', ') || '-')],
    ['created', esc(String(card.createdAt || '-'))],
    ['expires', esc(String(card.expiresAt || '-'))],
    ['ledger', `pass ${v.pass ?? 0} / fail ${v.fail ?? 0} / unverifiable ${v.unverifiable ?? 0} - pass rate ${v.passRate ?? 0}%`],
    ['schema', val.ok ? 'valid' : `<span class="neg">invalid</span>: ${esc((val.errors || []).join('; '))}`],
    ['warnings', esc((val.warnings || []).join('; ') || 'none')],
    ['notes', esc(card.notes || '-')],
  ]));
}

/** Generic markdown/text viewer - used for the brief and the study reports. */
function openMarkdown(title, markdown) {
  const body = openDrawer(title);
  body.replaceChildren(
    el('div', { class: 'rail-buttons', style: { marginBottom: '14px' } }, [
      el('button', { class: 'btn tiny ghost', type: 'button', text: 'copy', onclick: () => copyText(markdown) }),
      el('button', { class: 'btn tiny ghost', type: 'button', text: 'download .md', onclick: () => download(`${title.toLowerCase().replace(/\W+/g, '-')}.md`, markdown, 'text/markdown;charset=utf-8') }),
    ]),
    el('pre', { class: 'ev-quote', style: { whiteSpace: 'pre-wrap', fontStyle: 'normal', fontSize: '12px' }, text: markdown }),
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('copied to clipboard', 'ok');
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' }, text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('copied', 'ok');
  }
}
// ------------------------------------------------------------------ event studies

/**
 * The macro transmission study. This is the empirical basis for weighting the
 * surprise factor at 0.30: bigger surprises produce a measurably tighter rank
 * correlation between predicted exposure and realised relative return.
 */
async function openTransmission() {
  const body = openDrawer('Macro transmission study');
  let data;
  try {
    data = await api('/api/research/transmission');
  } catch (err) {
    body.replaceChildren(el('div', { class: 'board-empty', text: err.message }));
    return;
  }
  const s = data.summary || {};
  $('#drawerTitle').textContent = `Transmission study - ${s.scored}/${s.events} events`;

  const buckets = ['large', 'medium', 'small'].map((k) => s.bySurpriseSize?.[k]).filter(Boolean);
  const bucketRows = buckets.map((b) => el('tr', {}, [
    el('td', { text: b.label }),
    el('td', { text: String(b.n ?? 0) }),
    el('td', { class: b.meanSpearman > 0 ? 'pos' : 'neg', text: num(b.meanSpearman, 3) }),
    el('td', { text: b.positiveRhoPct === null || b.positiveRhoPct === undefined ? '-' : `${b.positiveRhoPct}%` }),
    el('td', { class: signClass(b.meanSpreadPct), text: pct(b.meanSpreadPct, 2) }),
    el('td', { text: b.spreadHitRatePct === null || b.spreadHitRatePct === undefined ? '-' : `${b.spreadHitRatePct}%` }),
  ]));

  const eventRows = (data.results || []).map((r) => (r.skipped
    ? el('tr', {}, [
      el('td', { text: r.date }), el('td', { text: r.label }),
      el('td', { class: 'neg', text: 'skipped' }), el('td', { text: r.reason || '' }),
    ])
    : el('tr', { title: `top basket ${(r.topBasket?.symbols || []).join(', ')} vs bottom ${(r.bottomBasket?.symbols || []).join(', ')}` }, [
      el('td', { text: r.date }),
      el('td', { text: `${r.label} (${r.side}, ${r.surprise}${r.unit || ''}, ${r.sigma}σ)` }),
      el('td', { class: r.spearman > 0 ? 'pos' : 'neg', text: num(r.spearman, 3) }),
      el('td', { class: signClass(r.spreadPct), text: `${pct(r.spreadPct, 2)}${r.spreadDirectionCorrect ? ' ok' : ' x'}` }),
    ])));

  body.replaceChildren(
    el('div', { class: 'study' }, [
      el('div', { class: 'big', text: num(s.meanSpearman, 3) }),
      el('div', { class: 'sub', text: `mean Spearman rho between predicted exposure and realised relative return, over ${s.scored} scored macro events` }),
      el('div', { class: 'study-grid' }, [
        statBox('events scored', `${s.scored}/${s.events}`),
        statBox('positive rho', `${s.positiveRhoPct ?? '-'}%`),
        statBox('t-stat', String(s.tStat ?? '-'), (s.tStat ?? 0) >= 2 ? 'good' : 'warn'),
        statBox('spread hit rate', `${s.spreadHitRatePct ?? '-'}%`),
        statBox('mean spread', pct(s.meanSpreadPct, 2)),
        statBox('median rho', num(s.medianSpearman, 3)),
      ]),
      el('div', { class: 'section-label', text: 'By surprise size' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'bucket' }), el('th', { text: 'n' }), el('th', { text: 'mean rho' }),
          el('th', { text: 'rho>0' }), el('th', { text: 'spread' }), el('th', { text: 'hit' }),
        ])),
        el('tbody', {}, bucketRows),
      ]),
      el('div', { class: 'section-label', text: 'Per event' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'date' }), el('th', { text: 'print' }), el('th', { text: 'rho' }), el('th', { text: 'top-bottom spread' }),
        ])),
        el('tbody', {}, eventRows),
      ]),
      el('div', {
        class: 'caveat',
        text: `Method: for each print, factor exposures are measured by OLS of daily returns on ${s.benchmark} over the ${s.window} sessions ending the day before the print (no look-ahead). Names are ranked by predicted exposure times the surprise sign, then compared with the realised relative return on the event day. Universe ${s.universe?.length} names. Caveat: ${s.scored} events is a small sample and the t-statistic (${s.tStat}) treats them as independent, which they are not - overlapping regimes inflate it. Read the monotonicity across surprise buckets as the signal, not the p-value. Skipped: ${s.skipped} (${(s.skipReasons || []).slice(0, 3).join('; ')}).`,
      }),
    ]),
  );
  body.scrollTop = 0;
}

/**
 * The overnight gap study. This calibrates the closed-window channel: it is the
 * empirical prior for how a native share behaves when information arrives while
 * the cash market is shut - exactly the window an rToken keeps trading through.
 */
async function openGaps() {
  const body = openDrawer('Overnight gap study');
  let data;
  try {
    data = await api('/api/research/gaps');
  } catch (err) {
    body.replaceChildren(el('div', { class: 'board-empty', text: err.message }));
    return;
  }
  const s = data.summary || {};
  const o = s.overall || {};
  $('#drawerTitle').textContent = `Gap study - ${s.gaps} gaps`;

  const fwd = o.excessVsBenchmark || {};
  const cl = o.excessDateClustered || {};
  const bucketRows = Object.entries(s.bySizeBucket || {}).map(([label, b]) => el('tr', {}, [
    el('td', { text: label }),
    el('td', { text: String(b.n) }),
    el('td', { text: `${b.continuedPct}%` }),
    el('td', { text: `${b.revertedPct}%` }),
    el('td', { class: signClass(b.excessDateClustered?.fwd5?.mean), text: pct(b.excessDateClustered?.fwd5?.mean, 3) }),
    el('td', { text: String(b.excessDateClustered?.fwd5?.t ?? '-') }),
  ]));

  const mon = s.mondayGaps || {};
  const wk = s.otherWeekdayGaps || {};

  body.replaceChildren(
    el('div', { class: 'study' }, [
      el('div', { class: 'big', text: pct(cl.fwd5?.mean ?? o.meanFwd5Pct, 3) }),
      el('div', { class: 'sub', text: `mean 5-session excess return vs ${s.benchmark} after an overnight gap of at least ${s.minAbsPct}% - ${s.gaps} observations, ${s.symbols} symbols, ${s.from} to ${s.to}` }),
      el('div', { class: 'study-grid' }, [
        statBox('gaps', String(s.gaps)),
        statBox('continued', `${o.continuedPct ?? '-'}%`),
        statBox('reverted', `${o.revertedPct ?? '-'}%`),
        statBox('median |gap|', `${o.medianAbsGapPct ?? '-'}%`),
        statBox('excess fwd1 t', String(cl.fwd1?.t ?? '-')),
        statBox('excess fwd5 t', String(cl.fwd5?.t ?? '-'), 'good'),
        statBox('excess fwd10 t', String(cl.fwd10?.t ?? '-')),
      ]),
      el('div', { class: 'section-label', text: 'Weekend window vs ordinary overnight' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'window' }), el('th', { text: 'n' }), el('th', { text: 'up-gap continued' }),
          el('th', { text: 'down-gap continued' }), el('th', { text: 'mean fwd5' }),
        ])),
        el('tbody', {}, [
          el('tr', {}, [
            el('td', { text: mon.label || 'Monday open' }), el('td', { text: String(mon.n ?? 0) }),
            el('td', { text: `${mon.upGaps?.continuedPct ?? '-'}%` }), el('td', { text: `${mon.downGaps?.continuedPct ?? '-'}%` }),
            el('td', { class: signClass(mon.meanFwd5Pct), text: pct(mon.meanFwd5Pct, 3) }),
          ]),
          el('tr', {}, [
            el('td', { text: wk.label || 'Tue-Fri open' }), el('td', { text: String(wk.n ?? 0) }),
            el('td', { text: `${wk.upGaps?.continuedPct ?? '-'}%` }), el('td', { text: `${wk.downGaps?.continuedPct ?? '-'}%` }),
            el('td', { class: signClass(wk.meanFwd5Pct), text: pct(wk.meanFwd5Pct, 3) }),
          ]),
        ]),
      ]),
      el('div', { class: 'section-label', text: 'By gap size' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'bucket' }), el('th', { text: 'n' }), el('th', { text: 'continued' }),
          el('th', { text: 'reverted' }), el('th', { text: 'excess fwd5' }), el('th', { text: 't (clustered)' }),
        ])),
        el('tbody', {}, bucketRows),
      ]),
      el('div', { class: 'section-label', text: 'Raw vs benchmark-adjusted' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'horizon' }), el('th', { text: 'raw mean' }),
          el('th', { text: 'excess mean' }), el('th', { text: 'naive t' }), el('th', { text: 'date-clustered t' }),
        ])),
        el('tbody', {}, ['fwd1', 'fwd5', 'fwd10'].map((h) => el('tr', {}, [
          el('td', { text: h.replace('fwd', '') + ' sessions' }),
          el('td', { class: signClass(o[`mean${h[0].toUpperCase()}${h.slice(1)}Pct`]), text: pct(o[`mean${h[0].toUpperCase()}${h.slice(1)}Pct`], 3) }),
          el('td', { class: signClass(cl[h]?.mean), text: pct(cl[h]?.mean, 3) }),
          el('td', { text: String(fwd[h]?.t ?? '-') }),
          el('td', { text: String(cl[h]?.t ?? '-') }),
        ]))),
      ]),
      el('div', {
        class: 'caveat',
        text: `Method: an overnight gap is today's open against yesterday's close on the native share. Continuation is the intraday move in the direction of the gap. Excess returns are against ${s.benchmark} over the same window. Two t-statistics are reported on purpose: the naive one treats ${s.gaps} observations as independent, which is false - gaps cluster on common dates - so the date-clustered figure (${cl.fwd5?.dates ?? '-'} independent dates for fwd5) is the honest one and is the number quoted in the docs. Caveat: this is the historical behaviour of the NATIVE share. An rToken trading 7x24 is a different process with thinner liquidity; the study is a prior for the size of the dislocation, not a claim about rToken microstructure.`,
      }),
    ]),
  );
  body.scrollTop = 0;
}

/**
 * The post-hoc review.
 *
 * The board is not a log, it is a pile of falsifiable claims whose windows have
 * closed. This panel scores them against what actually happened and - the part
 * that matters - reports whether the rubric's score predicts the outcome. A
 * desk that cannot show you its own misses is a marketing page.
 */
async function openReview() {
  const body = openDrawer('Signal review');
  let data;
  try {
    data = await api('/api/review');
  } catch (err) {
    body.replaceChildren(el('div', { class: 'board-empty', text: err.message }));
    return;
  }
  const s = data.summary || {};
  const cal = data.calibration || {};
  $('#drawerTitle').textContent = `Signal review - ${s.decided ?? 0} claims decided`;

  const rho = cal.scoreVsOutcomeRho;
  const gradeRows = Object.entries(cal.byGrade || {}).map(([g, v]) => el('tr', {}, [
    el('td', { text: `${g} (${v.band})` }),
    el('td', { text: String(v.rows) }),
    el('td', { text: String(v.decided) }),
    el('td', { text: v.hitPct === null || v.hitPct === undefined ? '-' : `${v.hitPct}%` }),
    el('td', { class: signClass(v.meanSignedExcessPct), text: pct(v.meanSignedExcessPct, 2) }),
  ]));

  const channelRows = Object.entries(cal.byChannel || {})
    .sort((a, b) => b[1].rows - a[1].rows)
    .map(([k, v]) => el('tr', {}, [
      el('td', { text: k }),
      el('td', { text: String(v.rows) }),
      el('td', { text: String(v.decided) }),
      el('td', { text: v.hitPct === null || v.hitPct === undefined ? '-' : `${v.hitPct}%` }),
      el('td', { class: signClass(v.meanSignedExcessPct), text: pct(v.meanSignedExcessPct, 2) }),
    ]));

  const claimRows = (data.claims || []).map((c) => el('tr', { title: c.basis || '' }, [
    el('td', { text: num(c.score, 1) }),
    el('td', { text: c.grade || '-' }),
    el('td', { text: c.channel }),
    el('td', { text: c.direction }),
    el('td', { text: c.window ? `${c.window.from} -> ${c.window.to}` : '-' }),
    el('td', { text: (c.symbols || []).join('/') || '-' }),
    el('td', { class: c.invalidationTriggered === true ? 'neg' : '', text: c.invalidationTriggered === null ? 'untestable' : c.invalidationTriggered ? 'FIRED' : 'held' }),
    el('td', { text: c.riskTouch }),
    el('td', { class: signClass(c.signedExcessPct), text: pct(c.signedExcessPct, 2) }),
    el('td', { class: `outcome ${c.outcome}`, text: c.final ? c.outcome : 'open' }),
  ]));

  const sevOrder = { blocker: 0, warning: 1, info: 2, ok: 3 };
  const lessons = [...(data.lessons || [])].sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
  const lessonNodes = lessons.map((l) => el('div', { class: `lesson ${l.severity}` }, [
    el('div', { class: 'lesson-head' }, [
      el('span', { class: 'sev', text: l.severity }),
      el('span', { class: 'lid', text: l.id }),
    ]),
    el('div', { class: 'lesson-find', text: l.finding }),
    el('div', { class: 'lesson-act', text: `-> ${l.action}` }),
    el('div', { class: 'lesson-ev', text: l.evidence }),
  ]));

  body.replaceChildren(
    el('div', { class: 'study' }, [
      el('div', { class: 'big', text: s.hitPct === null || s.hitPct === undefined ? '-' : `${s.hitPct}%` }),
      el('div', {
        class: 'sub',
        text: `hit rate on ${s.decided} decided claims${s.hitPctCi95 ? ` (95% CI ${s.hitPctCi95[0]}-${s.hitPctCi95[1]}%)` : ''} - ${s.distinctClaims} distinct claims collapsed from ${s.cardsOnBoard} stored cards, adjudicated against ${s.benchmark} as of ${String(s.asOf || '').slice(0, 10)}`,
      }),
      el('div', { class: 'study-grid' }, [
        statBox('decided', `${s.hits}W / ${s.misses}L`),
        statBox('inconclusive', String(s.inconclusive ?? 0), 'warn'),
        statBox('mean signed excess', pct(s.meanSignedExcessPct, 2), (s.meanSignedExcessPct ?? 0) >= 0 ? 'good' : 'bad'),
        statBox('score vs outcome rho', num(rho, 3), rho === null ? '' : rho > 0.1 ? 'good' : rho < -0.1 ? 'bad' : 'warn'),
        statBox('falsification fired', String(s.invalidationFired ?? 0)),
        statBox('conditions untestable', String(s.invalidationUntestable ?? 0), (s.invalidationUntestable ?? 0) > 0 ? 'warn' : 'good'),
        statBox('stop touched', String(s.stoppedOut ?? 0)),
        statBox('unmeasurable', String(s.unmeasurable ?? 0), (s.unmeasurable ?? 0) > 0 ? 'warn' : 'good'),
      ]),
      el('div', { class: 'section-label', text: 'By score band - does the rubric rank?' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'grade' }), el('th', { text: 'claims' }), el('th', { text: 'decided' }),
          el('th', { text: 'hit rate' }), el('th', { text: 'mean signed excess' }),
        ])),
        el('tbody', {}, gradeRows),
      ]),
      el('div', { class: 'section-label', text: 'By channel' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'channel' }), el('th', { text: 'claims' }), el('th', { text: 'decided' }),
          el('th', { text: 'hit rate' }), el('th', { text: 'mean signed excess' }),
        ])),
        el('tbody', {}, channelRows),
      ]),
      el('div', { class: 'section-label', text: 'Findings' }),
      el('div', { class: 'lessons' }, lessonNodes),
      el('div', { class: 'section-label', text: 'Per claim (restatements collapsed)' }),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'score' }), el('th', { text: 'gr' }), el('th', { text: 'channel' }),
          el('th', { text: 'dir' }), el('th', { text: 'window' }), el('th', { text: 'instrument' }),
          el('th', { text: 'falsification' }), el('th', { text: 'risk path' }),
          el('th', { text: 'signed excess' }), el('th', { text: 'verdict' }),
        ])),
        el('tbody', {}, claimRows),
      ]),
      el('div', {
        class: 'caveat',
        text: `Method: three axes kept separate. FALSIFICATION - did a close cross the numeric level the card itself named, by its own recheck date, and stay there? RISK PATH - was the tradeSketch stop or target touched en route (reported, never decisive)? REALISED - signed benchmark-excess return over the card's own window against ${s.benchmark}. The verdict comes from falsification when it fired, otherwise from realised excess, with a +/-${s.materialityPct}% materiality band so an uneventful window reads inconclusive rather than being forced into a win/loss column. Windows are anchored on ISSUANCE (createdAt), not on the information date, because every level a card carries is struck off the issuance price. When one daily bar touches both stop and target the stop is assumed first (pessimistic=${s.pessimisticTieBreak}), which biases the hit rate down. Caveat: ${s.decided} decided claims from ${cal.clusters} information dates is a tiny, non-independent sample - ${s.cardsOnBoard} stored cards collapse to ${s.distinctClaims} distinct claims, and ${s.restatementsCollapsed} restatements were removed so the hit rate is not given false precision. ${s.viaProxy} claims were measured through a declared demo price proxy, so those verdicts describe the proxy series, not the fictional issuer. Nothing here nets out commission, spread, borrow or slippage. This is not a backtest of the desk and no conclusion about profitability should be drawn from it.`,
      }),
    ]),
  );
  body.scrollTop = 0;
}
// ------------------------------------------------------------------ corpus dialog

function openPaste() {
  $('#pasteDate').value = new Date().toISOString().slice(0, 19) + 'Z';
  $('#modalScrim').hidden = false;
  $('#pasteTitle').focus();
}

function closePaste() {
  $('#modalScrim').hidden = true;
}

async function savePasted() {
  const bodyText = $('#pasteBody').value.trim();
  if (!bodyText) { toast('paste some text first', 'warn'); return; }
  const payload = {
    title: $('#pasteTitle').value.trim() || 'Pasted document',
    kind: $('#pasteKind').value,
    tickers: $('#pasteTickers').value.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
    publishedAt: $('#pasteDate').value.trim() || new Date().toISOString(),
    body: bodyText,
    source: 'pasted by operator',
  };
  try {
    const res = await api('/api/corpus', { method: 'POST', body: payload });
    closePaste();
    $('#pasteBody').value = '';
    $('#pasteTitle').value = '';
    $('#pasteTickers').value = '';
    toast(`added "${res.document.title}" to the corpus (${res.stats.documents} documents now) - run a question to distil it`, 'ok');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ------------------------------------------------------------------------ exports

async function exportBrief() {
  try {
    const res = await fetch('/api/export/brief.md');
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    download('prism-brief.md', await res.text(), 'text/markdown;charset=utf-8');
    toast('brief.md downloaded', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function exportCsv() {
  try {
    const res = await fetch(`/api/export/board.csv?status=${state.boardFilter}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    download('prism-board.csv', await res.text(), 'text/csv;charset=utf-8');
    toast('board.csv downloaded', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function resetBoard() {
  if (!window.confirm('Clear every card on the board? The run history in the thread stays.')) return;
  try {
    await api('/api/board/reset', { method: 'POST' });
    await refreshBoard();
    renderChannels();
    refreshStatus();
    toast('board cleared', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ------------------------------------------------------------------------- toasts

function toast(message, kind = '') {
  const host = $('#toastHost');
  const node = el('div', { class: `toast ${kind}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.4s';
    setTimeout(() => node.remove(), 450);
  }, kind === 'err' ? 7000 : 4200);
}

// The static replay adapter announces substitutions and ignored as-of clocks
// through this event, so those notices share the desk's toast UI instead of a
// corner badge of their own.
window.addEventListener('prism-static-note', (ev) => toast(String(ev.detail?.message || ''), 'warn'));

// ------------------------------------------------------------------------- wiring

function wireEvents() {
  $('#composer').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const question = $('#question').value;
    $('#question').value = '';
    ask(question);
  });

  const question = $('#question');
  question.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const value = question.value;
      question.value = '';
      ask(value);
    }
  });

  $('#btnNow').addEventListener('click', () => { setAsOfNow(); toast('desk clock reset to now'); });
  $('#toggleTrace').addEventListener('change', (ev) => {
    state.showTrace = ev.target.checked;
    $$('.trace').forEach((t) => t.classList.toggle('collapsed', !state.showTrace));
    $$('.trace-toggle').forEach((b) => { b.textContent = state.showTrace ? '▾ hide trace' : '▸ show trace'; });
  });
  $('#toggleQuarantine').addEventListener('change', (ev) => {
    state.showQuarantine = ev.target.checked;
    if (state.lastRun) {
      // re-render the most recent turn rather than losing it
      const turns = $$('.turn');
      const last = turns[turns.length - 1];
      if (last) {
        const body = last.querySelector('.turn-body');
        body.replaceChildren();
        renderRun({ body }, state.lastRun);
      }
    }
  });
  $('#btnExportMd').addEventListener('click', exportBrief);
  $('#btnExportCsv').addEventListener('click', exportCsv);
  $('#btnPaste').addEventListener('click', openPaste);
  $('#btnReset').addEventListener('click', resetBoard);
  $('#btnTransmission').addEventListener('click', openTransmission);
  $('#btnGaps').addEventListener('click', openGaps);
  $('#btnReview').addEventListener('click', openReview);

  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerScrim').addEventListener('click', closeDrawer);
  $('#pasteCancel').addEventListener('click', closePaste);
  $('#pasteSave').addEventListener('click', savePasted);
  $('#modalScrim').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) closePaste(); });

  $$('#boardFilters .chip').forEach((chip) => chip.addEventListener('click', () => {
    $$('#boardFilters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.boardFilter = chip.dataset.status;
    refreshBoard();
  }));

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { closeDrawer(); closePaste(); }
    if (ev.key === '/' && document.activeElement !== question && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
      ev.preventDefault();
      question.focus();
    }
  });
}

boot();
