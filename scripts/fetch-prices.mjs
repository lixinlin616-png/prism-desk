#!/usr/bin/env node
/**
 * Build the bundled daily OHLCV dataset.
 *
 *   node scripts/fetch-prices.mjs                 # download from Nasdaq's public chart API
 *   node scripts/fetch-prices.mjs --cache-dir DIR # reuse already-downloaded JSON
 *
 * Data source: Nasdaq's public chart API (no key required).
 *   stocks : https://api.nasdaq.com/api/quote/{SYM}/chart?assetclass=stocks&fromdate=..&todate=..
 *   etfs   : https://api.nasdaq.com/api/quote/{SYM}/chart?assetclass=etf&fromdate=..&todate=..
 *
 * Output: data/prices/{SYM}.csv with header  date,open,high,low,close,volume
 *
 * In production Prism takes price data from `bitget-mcp-server`. This local
 * dataset exists so the research studies and the test-suite are reproducible
 * offline, and so the verify ledger can cross-check price claims without a
 * round-trip.
 */

import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv } from '../src/util/csv.mjs';
import { toNum } from '../src/util/num.mjs';
import { logger } from '../src/util/log.mjs';

const log = logger('fetch-prices');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'prices');

export const STOCKS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX', 'JPM', 'XOM', 'PLTR', 'COIN', 'WMT', 'PFE', 'CAT'];
export const ETFS = ['SPY', 'QQQ', 'XLK', 'XLE', 'XLF', 'SMH', 'TLT', 'IWM'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Accept: 'application/json',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

function parseArgs(argv) {
  const args = { from: '2019-01-01', to: null, cacheDir: null, symbols: null, retries: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--symbols') args.symbols = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--retries') args.retries = Number(argv[++i]);
  }
  if (!args.to) args.to = new Date().toISOString().slice(0, 10);
  return args;
}

function urlFor(symbol, assetclass, from, to) {
  return `https://api.nasdaq.com/api/quote/${symbol}/chart?assetclass=${assetclass}&fromdate=${from}&todate=${to}`;
}

/** Nasdaq returns {data:{chart:[{z:{open,high,low,close,volume,dateTime}}]}} */
export function toRows(payload) {
  const chart = payload?.data?.chart;
  if (!Array.isArray(chart)) return [];
  const rows = [];
  for (const point of chart) {
    const z = point?.z;
    if (!z) continue;
    const rawDate = z.dateTime || '';
    const m = String(rawDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const date = m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : String(rawDate).slice(0, 10);
    const close = toNum(z.close);
    if (!date || close === null) continue;
    rows.push({
      date,
      open: toNum(z.open),
      high: toNum(z.high),
      low: toNum(z.low),
      close,
      volume: toNum(z.volume) ?? 0,
    });
  }
  const seen = new Set();
  return rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !seen.has(r.date) && seen.add(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function download(url, retries) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = JSON.parse(text);
      if (!parsed?.data?.chart) throw new Error('empty chart payload');
      return parsed;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT, { recursive: true });

  const wanted = args.symbols
    ? args.symbols.map((s) => ({ symbol: s, assetclass: ETFS.includes(s) ? 'etf' : 'stocks' }))
    : [...STOCKS.map((s) => ({ symbol: s, assetclass: 'stocks' })), ...ETFS.map((s) => ({ symbol: s, assetclass: 'etf' }))];

  let ok = 0;
  let failed = 0;
  for (const { symbol, assetclass } of wanted) {
    let payload = null;
    if (args.cacheDir) {
      const cached = join(resolve(args.cacheDir), `${symbol}.json`);
      if (existsSync(cached)) {
        try { payload = JSON.parse(readFileSync(cached, 'utf8')); } catch { payload = null; }
      }
    }
    if (!payload) {
      try {
        payload = await download(urlFor(symbol, assetclass, args.from, args.to), args.retries);
      } catch (err) {
        log.error(`${symbol}: ${err.message}`);
        failed += 1;
        continue;
      }
    }
    const rows = toRows(payload);
    if (!rows.length) { log.error(`${symbol}: no rows parsed`); failed += 1; continue; }
    writeFileSync(join(OUT, `${symbol}.csv`), toCsv(rows, ['date', 'open', 'high', 'low', 'close', 'volume']), 'utf8');
    log.info(`${symbol.padEnd(6)} ${String(rows.length).padStart(5)} bars  ${rows[0].date} -> ${rows[rows.length - 1].date}`);
    ok += 1;
  }

  log.info(`done: ${ok} written, ${failed} failed -> ${OUT}`);
  if (args.cacheDir) {
    const extra = readdirSync(resolve(args.cacheDir)).filter((f) => f.endsWith('.json'));
    if (extra.length > ok + failed) log.debug(`cache dir held ${extra.length} files`);
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();