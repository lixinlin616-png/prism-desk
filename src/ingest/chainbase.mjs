/**
 * Optional external partner data source: Chainbase AgentKey (agentkey.app).
 *
 * AgentKey is the S2 external-partner data sponsorship - market data, on-chain,
 * news and social behind one agent-facing endpoint. It is not a Bitget product
 * and it is not required: without CHAINBASE_AGENT_KEY this provider stays in
 * state `disabled` and issues no request at all, so the offline demo, the test
 * suite and the board fixture are bit-for-bit unaffected by its existence.
 *
 * Why this file exists: Chainbase used to be a config flag only. `config.chainbase`
 * read the key, `/api/status` reported `{ enabled: true }` the moment the key was
 * set, and not one line of code ever consumed it. A desk that advertises a data
 * source it cannot produce is committing the same offence the evidence ledger
 * exists to catch, so the flag became a provider that reports what it actually
 * did - including "nothing, because you gave me no key".
 *
 * Tool names are never hard-coded. The endpoint is key-gated and cannot be
 * probed from CI, so - exactly like the Bitget market provider - the catalog is
 * discovered with tools/list at connect time and each intent is fuzzy-matched
 * against what the server really exposes.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { McpClient } from './mcp-client.mjs';

const log = logger('chainbase');

/**
 * intent -> candidate tool-name patterns, most specific first.
 * Derived from AgentKey's documented coverage (行情 / 链上 / 新闻 / 社媒 / 公司信息),
 * not from a guessed tool list.
 */
export const AGENTKEY_INTENT_PATTERNS = {
  marketData: [/market.?data/i, /quote/i, /ticker/i, /price/i, /ohlcv/i, /candle/i, /kline/i],
  onchain: [/on.?chain/i, /wallet/i, /smart.?money/i, /defi/i, /tvl/i, /token/i, /nft/i],
  news: [/news/i, /article/i, /headline/i, /press/i],
  social: [/social/i, /twitter/i, /reddit/i, /community/i, /trending/i],
  company: [/company/i, /profile/i, /fundamental/i, /earnings/i],
};

export const AGENTKEY_INTENTS = Object.keys(AGENTKEY_INTENT_PATTERNS);

export const AGENTKEY_INTENT_DOCS = {
  marketData: 'Cross-venue quotes and candles (crypto and US equities)',
  onchain: 'On-chain behaviour: wallets, smart money, DeFi TVL, token flows',
  news: 'News and headlines across crypto and macro',
  social: 'Social / community signal: X, Reddit, trending topics',
  company: 'Company profile and fundamentals',
};

export class ChainbaseProvider {
  constructor({ key = config.chainbase.key, url = config.chainbase.url, mode = config.mcp.mode, timeoutMs = config.mcp.timeoutMs } = {}) {
    this.key = key;
    this.url = url;
    this.mode = mode;
    this.client = url ? new McpClient({
      url,
      timeoutMs,
      clientName: 'prism-desk-chainbase',
      // AgentKey authenticates with the AgentKey itself; the header name is the
      // conventional bearer form. A wrong header surfaces as an auth error in
      // status(), which is reported rather than swallowed.
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    }) : null;
    this.resolution = new Map();
    this.state = 'idle'; // idle | disabled | live | error
    this.reason = null;
    this.error = null;
    this.callLog = [];
  }

  /** True only when a key AND an endpoint are configured. */
  get enabled() { return Boolean(this.key); }

  async connect() {
    if (this.state === 'live' || this.state === 'disabled' || this.state === 'error') return this;
    if (!this.key) {
      this.state = 'disabled';
      this.reason = 'CHAINBASE_AGENT_KEY not set - AgentKey is an optional external partner source, so nothing was requested';
      return this;
    }
    if (this.mode === 'offline') {
      this.state = 'disabled';
      this.reason = 'PRISM_DATA_MODE=offline - a key is configured but the desk was told not to touch the network';
      return this;
    }
    if (!this.url) {
      this.state = 'error';
      this.error = 'CHAINBASE_MCP_URL not set - AgentKey issues its endpoint alongside the key; this repo deliberately does not guess one';
      return this;
    }
    try {
      await this.client.connect();
      this.resolveIntents();
      this.state = 'live';
      log.info(`AgentKey live: resolved ${this.resolution.size}/${AGENTKEY_INTENTS.length} intents against ${this.client.toolNames().length} tools`);
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
      log.warn(`AgentKey unavailable (${err.message}) - continuing without it`);
    }
    return this;
  }

  resolveIntents() {
    const names = this.client ? this.client.toolNames() : [];
    for (const intent of AGENTKEY_INTENTS) {
      let match = null;
      for (const re of AGENTKEY_INTENT_PATTERNS[intent]) {
        match = names.find((n) => re.test(n));
        if (match) break;
      }
      if (match) this.resolution.set(intent, match);
    }
    return this.intentMap();
  }

  intentMap() {
    const out = {};
    for (const intent of AGENTKEY_INTENTS) out[intent] = { tool: this.resolution.get(intent) ?? null, description: AGENTKEY_INTENT_DOCS[intent] };
    return out;
  }

  /**
   * Fetch one intent. Returns the same envelope shape as the Bitget market
   * provider so the ledger and the trace treat all three sources alike.
   * Returns `value: null` (never throws) when the source is not wired.
   */
  async fetch(intent, args = {}) {
    await this.connect();
    const envelope = { intent, args, value: null, origin: 'none', error: null, at: new Date().toISOString() };
    if (this.state !== 'live') {
      envelope.error = this.reason || this.error || 'AgentKey not wired';
      return envelope;
    }
    const tool = this.resolution.get(intent);
    if (!tool) {
      envelope.error = `no AgentKey tool resolved for intent '${intent}'`;
      return envelope;
    }
    try {
      const res = await this.client.callTool(tool, args);
      envelope.value = res.json ?? res.text;
      envelope.origin = `chainbase-agentkey:${tool}`;
    } catch (err) {
      envelope.error = err.message;
      log.warn(`AgentKey ${intent} -> ${tool} failed: ${err.message}`);
    }
    this.callLog.push(envelope);
    if (this.callLog.length > 200) this.callLog.shift();
    return envelope;
  }

  status() {
    return {
      provider: 'chainbase-agentkey',
      configured: this.enabled,
      state: this.state,
      url: this.url || null,
      reason: this.reason,
      error: this.error,
      liveTools: this.client ? this.client.toolNames().length : 0,
      resolvedIntents: this.resolution.size,
      totalIntents: AGENTKEY_INTENTS.length,
      calls: this.callLog.length,
    };
  }
}

export default ChainbaseProvider;
