#!/usr/bin/env node
/**
 * Record real bitget-mcp-server responses into data/fixtures/mcp/.
 *
 * Fixtures are what let the demo, the test suite and CI run with zero network
 * access and zero API keys. They are also what make evaluation deterministic:
 * the same input always produces the same card.
 *
 * This script needs a reachable MCP endpoint. In `auto` mode Prism falls back to
 * the bundled fixtures when the endpoint is unreachable, so recording is an
 * explicit, opt-in operation:
 *
 *   PRISM_DATA_MODE=live node scripts/record-fixtures.mjs
 *   PRISM_DATA_MODE=live node scripts/record-fixtures.mjs --tickers=NVDA,AAPL --out=recorded.json
 *   node scripts/record-fixtures.mjs --dry-run     # show what would be called
 *
 * Recorded entries are written with `"synthetic": false` so the fixture store,
 * the UI wiring panel and `npm run validate` can all tell recorded data apart
 * from the hand-written demo pack. Nothing here invents a number.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.mjs';
import { logger } from '../src/util/log.mjs';
import { BitgetMarketProvider, INTENTS, INTENT_DOCS } from '../src/ingest/bitget-market.mjs';
import { SignalProvider, SIGNAL_SKILL_IDS } from '../src/ingest/bitget-signal.mjs';

const log = logger('record');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Intents that are market-wide and take no symbol argument. */
const NO_TICKER = new Set(['sentiment', 'marketMovers', 'news']);
/** Intents that only mean something against a single issuer. */
const PER_NAME = new Set(['insiderTrades', 'institutionalHoldings', 'earningsCalendar', 'incomeStatement', 'balanceSheet', 'cashFlow', 'ratios', 'valuation', 'dividends', 'analystEstimates', 'analystTargetPrice', 'profile', 'management', 'etfHoldings']);

function parseArgs(argv) {
  const out = { tickers: ['NVDA', 'AAPL', 'MSFT'], dryRun: false, includeSkills: true, out: null };
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) continue;
    if (m[1] === 'tickers' && m[2]) out.tickers = m[2].split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
    else if (m[1] === 'dry-run') out.dryRun = true;
    else if (m[1] === 'no-skills') out.includeSkills = false;
    else if (m[1] === 'out' && m[2]) out.out = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun) {
    const calls = [];
    for (const intent of INTENTS) {
      const targets = NO_TICKER.has(intent) ? [null] : (PER_NAME.has(intent) ? args.tickers : args.tickers.slice(0, 1));
      for (const t of targets) calls.push({ intent, args: t ? { ticker: t } : {}, doc: INTENT_DOCS[intent] });
    }
    for (const s of (args.includeSkills ? SIGNAL_SKILL_IDS : [])) calls.push({ intent: `signal:${s}`, args: { query: 'market regime' } });
    process.stdout.write(`${calls.length} calls would be made against ${config.mcp.url}:\n\n`);
    for (const c of calls) process.stdout.write(`  ${c.intent.padEnd(22)} ${JSON.stringify(c.args)}\n`);
    return;
  }

  if (config.mcp.mode !== 'live') {
    process.stderr.write(`
Refusing to record in PRISM_DATA_MODE=${config.mcp.mode}.

Recording means calling the real endpoint and writing whatever it returned. In
auto/offline mode the provider silently falls back to bundled fixtures, so a
recording run would capture fixtures and label them as real - exactly the
failure mode the whole evidence-ledger design exists to prevent.

Run it explicitly:

  PRISM_DATA_MODE=live node scripts/record-fixtures.mjs --tickers=NVDA,AAPL

On PowerShell:

  $env:PRISM_DATA_MODE='live'; node scripts/record-fixtures.mjs --tickers=NVDA,AAPL
`);
    process.exitCode = 1;
    return;
  }

  const market = new BitgetMarketProvider({ mode: 'live' });
  await market.resolveIntents?.();
  log.info(`market provider state=${market.state} resolved ${market.resolution.size}/${INTENTS.length} intents against ${market.url}`);
  if (!market.resolution.size) {
    log.error('no intents resolved - the endpoint is unreachable or exposed no matching tools. Nothing recorded.');
    process.exitCode = 1;
    return;
  }

  const recorded = [];
  const failures = [];
  const seen = new Set();

  for (const intent of INTENTS) {
    if (!market.resolution.has(intent)) { failures.push(`${intent}: unresolved`); continue; }
    const targets = NO_TICKER.has(intent) ? [null] : (PER_NAME.has(intent) ? args.tickers : args.tickers.slice(0, 1));
    for (const ticker of targets) {
      const callArgs = ticker ? { ticker } : {};
      const key = `${intent}::${ticker ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const snap = await market.fetch(intent, callArgs);
        if (snap.value === null || snap.value === undefined) { failures.push(`${key}: empty response`); continue; }
        if (snap.origin !== 'live') { failures.push(`${key}: provider returned origin=${snap.origin}, not live - refusing to record a fallback`); continue; }
        recorded.push({
          intent,
          args: callArgs,
          recordedAt: new Date().toISOString(),
          source: 'bitget-mcp-server',
          tool: market.resolution.get(intent) ?? null,
          synthetic: false,
          result: snap.value,
        });
        log.info(`recorded ${key}`);
      } catch (err) {
        failures.push(`${key}: ${err.message}`);
      }
    }
  }

  if (args.includeSkills) {
    const signal = new SignalProvider();
    for (const skill of SIGNAL_SKILL_IDS) {
      try {
        const r = await signal.invoke(skill, { query: 'current market regime and cross-asset read' });
        if (r.value === null || r.origin !== 'live') { failures.push(`signal:${skill}: origin=${r.origin}, not live`); continue; }
        recorded.push({
          intent: `signal:${skill}`,
          args: { query: 'current market regime and cross-asset read' },
          recordedAt: new Date().toISOString(),
          source: 'bitget-signal',
          synthetic: false,
          result: r.value,
        });
        log.info(`recorded signal:${skill}`);
      } catch (err) {
        failures.push(`signal:${skill}: ${err.message}`);
      }
    }
  }

  if (!recorded.length) {
    log.error(`nothing recorded. ${failures.length} failures:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(config.paths.fixtures, { recursive: true });
  const target = args.out
    ? resolve(args.out)
    : join(config.paths.fixtures, `recorded-${new Date().toISOString().slice(0, 10)}.json`);
  // Never silently overwrite an existing pack.
  if (existsSync(target)) {
    const existing = JSON.parse(readFileSync(target, 'utf8'));
    const merged = new Map((Array.isArray(existing) ? existing : [existing]).map((e) => [`${e.intent}::${JSON.stringify(e.args ?? {})}`, e]));
    for (const e of recorded) merged.set(`${e.intent}::${JSON.stringify(e.args ?? {})}`, e);
    writeFileSync(target, JSON.stringify([...merged.values()], null, 2), 'utf8');
    log.info(`merged into existing pack ${target} (${merged.size} entries)`);
  } else {
    writeFileSync(target, JSON.stringify(recorded, null, 2), 'utf8');
    log.info(`wrote ${target}`);
  }

  process.stdout.write(`\nrecorded ${recorded.length} responses, ${failures.length} failures\n`);
  if (failures.length) process.stdout.write(`\nfailures:\n  ${failures.join('\n  ')}\n`);
  process.stdout.write(`\nNext: review ${target}, then run \`npm run validate\` and \`npm test\` against it.\n`);
}

main().catch((err) => { log.error(err.stack || err.message); process.exitCode = 1; });