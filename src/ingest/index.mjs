/**
 * DataHub - the single ingestion surface the rest of Prism talks to.
 *
 *   hub.market    -> Bitget US-equity / ETF MCP data      (bitget-mcp-server)
 *   hub.signal    -> Bitget crypto research skills        (bitget-signal)
 *   hub.corpus    -> unstructured documents to distil     (data/corpus)
 *   hub.prices    -> local real daily OHLCV               (data/prices)
 *
 * Every provider degrades to bundled offline data, so the demo, the tests and
 * the CI pipeline all run with no network and no keys.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { BitgetMarketProvider, INTENTS, INTENT_DOCS } from './bitget-market.mjs';
import { SignalProvider, SIGNAL_SKILLS, SIGNAL_SKILL_IDS } from './bitget-signal.mjs';
import { Corpus } from './corpus.mjs';
import { PriceBook } from './prices.mjs';

const log = logger('hub');

export class DataHub {
  constructor(opts = {}) {
    this.market = opts.market ?? new BitgetMarketProvider();
    this.signal = opts.signal ?? new SignalProvider();
    this.corpus = opts.corpus ?? new Corpus(config.paths.corpus).load();
    this.prices = opts.prices ?? new PriceBook(config.paths.prices).load();
    this.chainbase = { enabled: config.chainbase.enabled };
  }

  /** Best-effort connect of the network providers. Never throws in auto mode. */
  async connect() {
    const results = await Promise.allSettled([this.market.connect(), this.signal.connect()]);
    for (const r of results) if (r.status === 'rejected') log.warn(`provider connect failed: ${r.reason?.message}`);
    return this;
  }

  /** Documents that plausibly relate to a free-text research question. */
  gather(question, { limit = 10, tickers = [], kinds = [], from = null, to = null } = {}) {
    let docs = [];
    const searched = this.corpus.search(question, { limit: limit * 2 });
    docs.push(...searched);
    for (const t of tickers) docs.push(...this.corpus.byTicker(t));
    for (const k of kinds) docs.push(...this.corpus.byKind(k));
    if (from && to) docs.push(...this.corpus.between(from, to));
    const seen = new Set();
    const unique = [];
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      unique.push(d);
    }
    unique.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return unique.slice(0, limit);
  }

  /** Everything a judge or an operator needs to see about data wiring. */
  status() {
    return {
      mode: config.mcp.mode,
      market: this.market.status(),
      signal: this.signal.status(),
      corpus: this.corpus.stats(),
      prices: this.prices.stats(),
      chainbase: this.chainbase,
      llm: { enabled: config.llm.enabled, model: config.llm.model, baseUrl: config.llm.baseUrl || null },
      intents: INTENTS.length,
      signalSkills: SIGNAL_SKILL_IDS.length,
    };
  }

  capabilities() {
    return {
      intents: INTENTS.map((i) => ({ id: i, description: INTENT_DOCS[i] })),
      skills: SIGNAL_SKILL_IDS.map((s) => ({ id: s, zh: SIGNAL_SKILLS[s].zh, capabilities: SIGNAL_SKILLS[s].capabilities })),
    };
  }
}

let singleton = null;
export function getHub(opts = {}) {
  if (!singleton) singleton = new DataHub(opts);
  return singleton;
}

export async function initHub(opts = {}) {
  const hub = getHub(opts);
  await hub.connect();
  return hub;
}

export { INTENTS, INTENT_DOCS, SIGNAL_SKILLS, SIGNAL_SKILL_IDS };
export default DataHub;