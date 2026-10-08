#!/usr/bin/env node
/**
 * Live-wiring proof.
 *
 * The desk claims it is wired to bitget-mcp-server and the five bitget-signal
 * skills. A claim about somebody else's infrastructure is worth exactly as much as
 * the artefact behind it, and until now the only artefact was a hand-written
 * fixture pack that says `"synthetic": true` - so `doctor` printed `resolved=0/20`
 * and an evaluator had no way to tell "never attempted" from "attempted and
 * blocked".
 *
 * This script closes that gap. It performs the real handshake with the repo's own
 * MCP client, records what actually came back, and writes the evidence to
 * docs/reports/live-wiring.md. Both outcomes are publishable:
 *
 *   - it connected  -> real tool names, real resolved=N/20, and (with --record)
 *                      real responses written to data/fixtures/mcp-live/ as
 *                      `"synthetic": false` entries
 *   - it did not     -> the exact failure (DNS code, TCP error, HTTP status, body
 *                      excerpt) with a timestamp, which is still evidence, and is
 *                      what the submission should quote instead of a vague claim
 *
 *   node scripts/live-wiring.mjs                  # probe + report
 *   node scripts/live-wiring.mjs --record         # probe + record real responses
 *   node scripts/live-wiring.mjs --tickers=NVDA,AAPL
 *   node scripts/live-wiring.mjs --out=/tmp/x.md  # report elsewhere
 *   node scripts/live-wiring.mjs --check          # report and pack agree (offline)
 *
 * Exits 1 when the handshake failed, so a blocked probe can never be mistaken for
 * a pass by a script or a CI job.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';

import { config } from '../src/config.mjs';
import { logger } from '../src/util/log.mjs';
import { McpClient } from '../src/ingest/mcp-client.mjs';
import { BitgetMarketProvider, INTENTS, INTENT_DOCS } from '../src/ingest/bitget-market.mjs';
import { SignalProvider, SIGNAL_SKILL_IDS } from '../src/ingest/bitget-signal.mjs';

const log = logger('live-wiring');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_DIR = join(ROOT, 'data', 'fixtures', 'mcp-live');
const REPORT = join(ROOT, 'docs', 'reports', 'live-wiring.md');

/** Intents that are market-wide and take no symbol argument. */
const NO_TICKER = new Set(['news', 'sentiment', 'marketMovers']);
/** Intents worth one real call per ticker when recording. */
const PER_NAME = ['quote', 'analystEstimates', 'earningsCalendar', 'incomeStatement', 'insiderTrades', 'institutionalHoldings', 'ratios', 'valuation'];

function parseArgs(argv) {
  const out = { tickers: ['NVDA'], record: false, check: false, out: REPORT, json: false, control: 'https://api.github.com/zen' };
  for (const a of argv) {
    if (a === '--record') out.record = true;
    else if (a === '--check') out.check = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--tickers=')) out.tickers = a.slice(10).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith('--out=')) out.out = resolve(a.slice(6));
    else if (a.startsWith('--control=')) out.control = a.slice(10);
  }
  return out;
}

/** Everything we can learn about why a connection failed, without guessing. */
function describeFailure(err) {
  const cause = err?.cause || {};
  return {
    message: String(err?.message || err).slice(0, 300),
    code: cause.code || err?.code || null,
    status: err?.status ?? null,
    body: (err?.body || '').slice(0, 300) || null,
  };
}

async function probeDns(host) {
  const t = Date.now();
  try {
    const res = await lookup(host, { all: true });
    return { ok: true, addresses: res.map((r) => r.address), ms: Date.now() - t };
  } catch (err) {
    return { ok: false, ...describeFailure(err), ms: Date.now() - t };
  }
}

/**
 * Reach a host we have no reason to be blocked by, in the same minute as the real
 * probe. Without this a failed handshake is ambiguous: it could mean the endpoint
 * refused us, or that this machine had no egress at all. The control says which.
 */
async function probeControl(url) {
  const t = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    await res.text().catch(() => {});
    return { ok: res.ok, url, status: res.status, ms: Date.now() - t };
  } catch (err) {
    return { ok: false, url, ms: Date.now() - t, ...describeFailure(err) };
  }
}

function controlLine(c) {
  if (!c) return 'not probed';
  if (c.ok) {
    return '' + c.url + ' answered HTTP ' + c.status + ' in ' + c.ms + ' ms at the same moment - general egress worked, so the failure above is specific to the MCP host (or to how it treats this network), not to this machine being offline';
  }
  return '' + c.url + ' also failed (' + (c.code || c.status || '') + ' ' + (c.message || '') + ') - this machine had no usable egress at all, so the result above says nothing about the endpoint';
}

async function probe(controlUrl) {
  const url = config.mcp.url;
  const host = new URL(url).hostname;
  const started = new Date().toISOString();
  const evidence = { startedAt: started, url, host, protocolVersion: null, serverInfo: null, tools: [], dns: null, handshake: null, market: null, signal: null, calls: [], recorded: [] };

  evidence.dns = await probeDns(host);
  evidence.control = await probeControl(controlUrl);

  const client = new McpClient({ url, timeoutMs: config.mcp.timeoutMs, clientName: 'prism-desk-live-wiring' });
  const t0 = Date.now();
  try {
    await client.connect();
    evidence.handshake = { ok: true, ms: Date.now() - t0 };
    evidence.protocolVersion = client.protocolVersion;
    evidence.serverInfo = client.serverInfo;
    evidence.tools = client.toolNames();
  } catch (err) {
    evidence.handshake = { ok: false, ms: Date.now() - t0, ...describeFailure(err) };
  }

  // Intent resolution uses the same fuzzy map the desk itself uses, so the number
  // printed here is the number `doctor` and /api/capabilities would print live.
  const provider = new BitgetMarketProvider({ url, mode: 'live' });
  if (evidence.handshake.ok) {
    provider.client = client;
    const map = provider.resolveIntents();
    evidence.market = {
      state: 'live',
      resolved: Object.values(map).filter((m) => m.tool).length,
      total: INTENTS.length,
      map,
    };
  } else {
    evidence.market = { state: 'unreachable', resolved: 0, total: INTENTS.length, map: null, error: evidence.handshake };
  }

  const signal = new SignalProvider({ url });
  if (evidence.handshake.ok) {
    signal.client = client;
    try {
      await signal.connect();
      evidence.signal = { state: signal.state, resolved: signal.resolution.size, total: SIGNAL_SKILL_IDS.length, skills: signal.status().skills };
    } catch (err) {
      evidence.signal = { state: 'error', resolved: 0, total: SIGNAL_SKILL_IDS.length, ...describeFailure(err) };
    }
  } else {
    evidence.signal = { state: 'unreachable', resolved: 0, total: SIGNAL_SKILL_IDS.length };
  }

  return { client, provider, signal, evidence };
}

/** One real tools/call per intent, recorded verbatim. Nothing here invents a number. */
async function record({ client, provider, signal, evidence }, tickers) {
  const at = new Date().toISOString();
  const entries = [];
  for (const intent of INTENTS) {
    const tool = evidence.market.map?.[intent]?.tool;
    if (!tool) continue;
    const argsList = NO_TICKER.has(intent) ? [{}] : tickers.map((ticker) => ({ ticker }));
    for (const args of argsList) {
      const t = Date.now();
      try {
        const res = await client.callTool(tool, args);
        const value = res.json ?? res.text;
        entries.push({ intent, args, recordedAt: at, source: 'bitget-mcp-server', tool, synthetic: false, ms: Date.now() - t, result: value });
        evidence.calls.push({ intent, tool, args, ok: true, ms: Date.now() - t, bytes: JSON.stringify(value ?? '').length });
      } catch (err) {
        evidence.calls.push({ intent, tool, args, ok: false, ms: Date.now() - t, ...describeFailure(err) });
      }
    }
  }
  for (const skill of SIGNAL_SKILL_IDS) {
    const t = Date.now();
    try {
      const r = await signal.invoke(skill, { query: 'current regime snapshot for US equities and tokenized equities' });
      if (r.origin.startsWith('bitget-signal:')) {
        entries.push({ intent: `signal:${skill}`, args: r.query, recordedAt: at, source: r.origin, tool: r.origin.split(':')[1], synthetic: false, ms: Date.now() - t, result: r.value });
        evidence.calls.push({ intent: `signal:${skill}`, tool: r.origin, ok: true, ms: Date.now() - t, bytes: JSON.stringify(r.value ?? '').length });
      } else {
        evidence.calls.push({ intent: `signal:${skill}`, ok: false, ms: Date.now() - t, message: `fell back to ${r.origin}, not recorded` });
      }
    } catch (err) {
      evidence.calls.push({ intent: `signal:${skill}`, ok: false, ms: Date.now() - t, ...describeFailure(err) });
    }
  }
  evidence.recorded = entries;
  return entries;
}

function renderReport(e) {
  const L = [];
  const ok = e.handshake?.ok;
  L.push('# Live wiring evidence');
  L.push('');
  L.push(`Generated ${e.startedAt} by \`node scripts/live-wiring.mjs\`. Every line below is the output of a real request made at that moment; nothing is asserted from documentation.`);
  L.push('');
  L.push('## Verdict');
  L.push('');
  if (ok) {
    L.push(`**Connected.** \`initialize\` and \`tools/list\` succeeded against \`${e.url}\` in ${e.handshake.ms} ms.`);
    L.push('');
    L.push(`| measure | value |`);
    L.push(`| --- | --- |`);
    L.push(`| protocol version | ${e.protocolVersion || 'n/a'} |`);
    L.push(`| server | ${e.serverInfo?.name ?? 'unknown'} ${e.serverInfo?.version ?? ''} |`);
    L.push(`| tools discovered | ${e.tools.length} |`);
    L.push(`| market intents resolved | **${e.market.resolved}/${e.market.total}** |`);
    L.push(`| bitget-signal skills resolved | **${e.signal.resolved ?? 0}/${e.signal.total}** |`);
    L.push('| control egress | ' + controlLine(e.control) + ' |');
    L.push(`| real responses recorded | ${e.recorded.length} (\`synthetic: false\`) |`);
    L.push(`| calls that failed | ${e.calls.filter((c) => !c.ok).length} |`);
  } else {
    L.push(`**Not connected.** The handshake against \`${e.url}\` did not complete, so no live number in this project has ever been served by that endpoint. The failure is recorded below rather than papered over.`);
    L.push('');
    L.push(`| step | result |`);
    L.push(`| --- | --- |`);
    L.push(`| DNS \`${e.host}\` | ${e.dns?.ok ? `resolved ${e.dns.addresses.join(', ')} (${e.dns.ms} ms)` : `**${e.dns?.code || 'failed'}** - ${e.dns?.message || ''} (${e.dns?.ms} ms)`} |`);
    L.push(`| MCP \`initialize\` | **failed after ${e.handshake?.ms} ms** - ${e.handshake?.code || e.handshake?.status || ''} ${e.handshake?.message || ''} |`);
    if (e.handshake?.body) L.push(`| response body | \`${e.handshake.body.replace(/\|/g, '/')}\` |`);
    L.push('| control egress | ' + controlLine(e.control) + ' |');
    L.push(`| market intents resolved | 0/${INTENTS.length} (endpoint unreachable) |`);
    L.push(`| bitget-signal skills resolved | 0/${SIGNAL_SKILL_IDS.length} (endpoint unreachable) |`);
  }
  L.push('');
  L.push('## What this means for the submission');
  L.push('');
  if (ok) {
    L.push(`The desk resolved ${e.market.resolved}/${e.market.total} semantic intents onto real discovered tool names using the same fuzzy map it uses at runtime, and ${e.recorded.length} real responses are committed under \`data/fixtures/mcp-live/\` with \`"synthetic": false\`. The bundled demo pack under \`data/fixtures/mcp/\` is still synthetic and still says so; the demo stays deterministic by design. Point the desk at the recorded pack with \`PRISM_FIXTURE_DIR=data/fixtures/mcp-live node server.mjs\`.`);
  } else {
    L.push('The integration is built and test-covered (discovery, fuzzy intent resolution, transparent degradation, per-intent provenance), but it has **not** been exercised against the live endpoint from this machine. That is a statement about the network this run had, not about the wiring. Re-run `node scripts/live-wiring.mjs --record` from a network that can reach the endpoint and commit the result; this file is regenerated, never hand-edited.');
  }
  L.push('');
  if (ok && e.market.map) {
    L.push('## Intent resolution');
    L.push('');
    L.push('| intent | resolved tool | what it is for |');
    L.push('| --- | --- | --- |');
    for (const intent of INTENTS) {
      const m = e.market.map[intent] || {};
      L.push(`| \`${intent}\` | ${m.tool ? `\`${m.tool}\`` : (m.kind === 'computed' ? '_computed from the bundled price book_' : '**unserved**')} | ${m.description || INTENT_DOCS[intent] || ''} |`);
    }
    L.push('');
  }
  if (ok && e.signal?.skills) {
    L.push('## bitget-signal skills');
    L.push('');
    L.push('| skill | resolved tool |');
    L.push('| --- | --- |');
    for (const s of e.signal.skills) L.push(`| \`${s.id}\` | ${s.tool ? `\`${s.tool}\`` : '**unresolved**'} |`);
    L.push('');
  }
  if (e.calls.length) {
    L.push('## Individual calls');
    L.push('');
    L.push('| intent | tool | args | result | ms |');
    L.push('| --- | --- | --- | --- | ---: |');
    for (const c of e.calls) {
      L.push(`| \`${c.intent}\` | \`${c.tool || '-'}\` | ${JSON.stringify(c.args ?? {})} | ${c.ok ? `ok, ${c.bytes} bytes` : `**failed** ${c.code || c.status || ''} ${(c.message || '').slice(0, 90).replace(/\|/g, '/')}`} | ${c.ms} |`);
    }
    L.push('');
  }
  L.push('## Reproduce');
  L.push('');
  L.push('```bash');
  L.push('node scripts/live-wiring.mjs --record   # probe, record real responses, rewrite this file');
  L.push('node scripts/live-wiring.mjs --check    # assert this file and the recorded pack agree');
  L.push('PRISM_FIXTURE_DIR=data/fixtures/mcp-live node server.mjs   # run the desk on the recorded data');
  L.push('```');
  L.push('');
  return L.join('\n');
}

function check() {
  if (!existsSync(REPORT)) {
    console.log('live-wiring: no committed evidence yet - run `node scripts/live-wiring.mjs --record`');
    return 0;
  }
  const md = readFileSync(REPORT, 'utf8');
  const claimsConnected = /\*\*Connected\.\*\*/.test(md);
  const packPath = join(LIVE_DIR, 'recorded.json');
  const packExists = existsSync(packPath);
  const problems = [];
  if (claimsConnected && !packExists) problems.push('the report claims a live connection but data/fixtures/mcp-live/recorded.json is missing');
  if (!claimsConnected && packExists) problems.push('a recorded pack exists but the report says the endpoint was unreachable');
  if (packExists) {
    const pack = JSON.parse(readFileSync(packPath, 'utf8'));
    const entries = Array.isArray(pack) ? pack : [pack];
    if (entries.some((x) => x.synthetic !== false)) problems.push('every entry in the recorded pack must carry "synthetic": false');
    const claimed = Number((md.match(/real responses recorded \| (\d+)/) || [])[1]);
    if (Number.isFinite(claimed) && claimed !== entries.length) problems.push(`report claims ${claimed} recorded responses, the pack holds ${entries.length}`);
  }
  if (problems.length) {
    console.log('live-wiring: DRIFT');
    for (const p of problems) console.log('  -', p);
    return 1;
  }
  console.log(`live-wiring: OK - report and recorded pack agree (${packExists ? JSON.parse(readFileSync(packPath, 'utf8')).length + ' recorded responses' : 'no pack, report says unreachable'})`);
  return 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.check) process.exit(check());

const { client, provider, signal, evidence } = await probe(args.control);
if (evidence.handshake.ok && args.record) {
  await record({ client, provider, signal, evidence }, args.tickers);
  if (evidence.recorded.length) {
    mkdirSync(LIVE_DIR, { recursive: true });
    writeFileSync(join(LIVE_DIR, 'recorded.json'), JSON.stringify(evidence.recorded, null, 2) + '\n');
    log.info(`recorded ${evidence.recorded.length} real responses -> data/fixtures/mcp-live/recorded.json`);
  }
}
writeFileSync(args.out, renderReport(evidence));
try { await client.close(); } catch { /* best effort */ }

const ok = evidence.handshake.ok;
const line = ok
  ? `live-wiring: CONNECTED ${evidence.url} | tools ${evidence.tools.length} | market intents ${evidence.market.resolved}/${INTENTS.length} | signal skills ${evidence.signal?.resolved ?? 0}/${SIGNAL_SKILL_IDS.length} | recorded ${evidence.recorded.length}`
  : `live-wiring: NOT CONNECTED ${evidence.url} | dns ${evidence.dns?.ok ? 'ok' : (evidence.dns?.code || 'failed')} | control ${evidence.control?.ok ? 'HTTP ' + evidence.control.status : 'also failed'} | ${evidence.handshake?.code || evidence.handshake?.status || ''} ${evidence.handshake?.message || ''}`;
if (args.json) console.log(JSON.stringify(evidence, null, 2));
else console.log(line);
console.log(`report: ${args.out}`);
process.exit(ok ? 0 : 1);
