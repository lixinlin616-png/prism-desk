/**
 * DataHub - the single ingestion surface the rest of Prism talks to.
 *
 *   hub.market    -> Bitget US-equity / ETF MCP data      (bitget-mcp-server)
 *   hub.signal    -> Bitget crypto research skills        (bitget-signal)
 *   hub.corpus    -> unstructured documents to distil     (data/corpus)
 *   hub.prices    -> local real daily OHLCV               (data/prices)
 *   hub.chainbase -> optional external partner data       (Chainbase AgentKey)
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
import { ChainbaseProvider, AGENTKEY_INTENTS, AGENTKEY_INTENT_DOCS } from './chainbase.mjs';

const log = logger('hub');

export class DataHub {
  constructor(opts = {}) {
    this.market = opts.market ?? new BitgetMarketProvider();
    this.signal = opts.signal ?? new SignalProvider();
    this.corpus = opts.corpus ?? new Corpus(config.paths.corpus).load();
    this.prices = opts.prices ?? new PriceBook(config.paths.prices).load();
    this.chainbase = opts.chainbase ?? new ChainbaseProvider();
    // `history` and `marketMovers` are computed from the real bundled price book
    // instead of being served from an invented fixture. Attached here, after
    // construction, so an injected provider gets it too and the book loads once.
    if (typeof this.market?.attachPrices === 'function') this.market.attachPrices(this.prices);
  }

  /** Best-effort connect of the network providers. Never throws in auto mode. */
  async connect() {
    const results = await Promise.allSettled([this.market.connect(), this.signal.connect(), this.chainbase.connect()]);
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
      chainbase: this.chainbase.status(),
      llm: { enabled: config.llm.enabled, model: config.llm.model, baseUrl: config.llm.baseUrl || null },
      intents: INTENTS.length,
      signalSkills: SIGNAL_SKILL_IDS.length,
      agentKeyIntents: AGENTKEY_INTENTS.length,
    };
  }

  /**
   * Deliberately no capabilities() here.
   *
   * There used to be one, uncalled, and server.mjs and scripts/export-static.mjs
   * each carried their own copy of the same payload. Three hand-rolled versions
   * of one contract is how the published demo ended up describing wiring the
   * backend disagreed with. src/desk/capabilities.mjs is now the only builder;
   * it cannot live here because it needs SKILL_TRIGGERS from the desk layer,
   * which imports this module.
   */
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

export { INTENTS, INTENT_DOCS, SIGNAL_SKILLS, SIGNAL_SKILL_IDS, AGENTKEY_INTENTS, AGENTKEY_INTENT_DOCS };
export { ChainbaseProvider };
export default DataHub;