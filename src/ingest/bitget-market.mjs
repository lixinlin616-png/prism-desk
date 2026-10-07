/**
 * Bitget US-equity / ETF data provider.
 *
 * Wraps `bitget-mcp-server` (https://agent.bitget.com/mcp) behind a stable set of
 * semantic *intents*, so the rest of Prism never hard-codes a remote tool name.
 * At connect time we call tools/list and fuzzy-resolve each intent against the
 * live catalog; if the endpoint is unreachable we fall back to bundled fixtures.
 *
 * The server is read-only, needs no Bitget account and no API key.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { McpClient } from './mcp-client.mjs';
import { FixtureStore } from './fixtures.mjs';

const log = logger('bitget-market');

/**
 * intent -> candidate tool-name patterns, most specific first.
 * Built from the documented bitget-mcp-server coverage: quotes & candles,
 * company profile/management, earnings calendar, three statements, ratios,
 * valuation, dividends, insider trades, major holders & 13F, analyst target
 * price and forward estimates, ETF data, news and sentiment.
 */
export const INTENT_PATTERNS = {
  quote: [/quote/i, /ticker.*price/i, /realtime/i, /price$/i],
  history: [/histor/i, /candle/i, /kline/i, /ohlcv/i, /ebar/i, /price.*series/i],
  profile: [/profile/i, /overview/i, /company/i, /business/i],
  management: [/management/i, /executive/i, /officer/i],
  earningsCalendar: [/earnings.*calendar/i, /calendar.*earnings/i, /earnings.*date/i],
  incomeStatement: [/income/i, /profit.*loss/i, /pnl/i, /statement.*income/i],
  balanceSheet: [/balance/i, /asset/i, /statement.*balance/i],
  cashFlow: [/cash.?flow/i, /statement.*cash/i],
  ratios: [/ratio/i, /financial.*ratio/i, /metric/i],
  valuation: [/valuation/i, /multiple/i, /pe.*ratio/i, /enterprise/i],
  dividends: [/dividend/i, /distribution/i],
  insiderTrades: [/insider/i, /form.?4/i],
  institutionalHoldings: [/institution/i, /13f/i, /holder/i, /ownership/i],
  analystEstimates: [/estimate/i, /consensus/i, /forecast/i, /eps.*estimate/i],
  analystTargetPrice: [/target.*price/i, /price.*target/i, /analyst.*rating/i, /recommend/i],
  news: [/news/i, /press/i, /article/i],
  sentiment: [/sentiment/i, /fear.*greed/i, /mood/i],
  etfInfo: [/etf/i],
  etfHoldings: [/etf.*holding/i, /holding.*etf/i, /constituent/i],
  marketMovers: [/gainer/i, /loser/i, /mover/i, /active/i],
};

export const INTENTS = Object.keys(INTENT_PATTERNS);

/** Human-readable description of each intent, surfaced in the demo UI. */
export const INTENT_DOCS = {
  quote: 'Real-time last price, change, volume for a US equity / ETF',
  history: 'Historical OHLCV candles',
  profile: 'Company profile, sector, industry, description',
  management: 'Executive team and leadership',
  earningsCalendar: 'Upcoming / past earnings report dates',
  incomeStatement: 'Income statement (revenue, EPS, margins)',
  balanceSheet: 'Balance sheet (cash, debt, equity)',
  cashFlow: 'Cash flow statement (OCF, FCF, capex)',
  ratios: 'Financial ratios (ROE, current ratio, leverage)',
  valuation: 'Valuation multiples (P/E, EV/EBITDA, P/S)',
  dividends: 'Dividend history and yield',
  insiderTrades: 'Insider (Form 4) buy/sell transactions',
  institutionalHoldings: '13F institutional holders and position changes',
  analystEstimates: 'Consensus forward EPS / revenue / EBITDA estimates',
  analystTargetPrice: 'Analyst price targets and ratings distribution',
  news: 'Company and market news headlines',
  sentiment: 'Market sentiment indicators',
  etfInfo: 'ETF metadata, expense ratio, AUM',
  etfHoldings: 'ETF constituent holdings and weights',
  marketMovers: 'Top gainers / losers / most active',
};

export class BitgetMarketProvider {
  constructor({ url = config.mcp.url, mode = config.mcp.mode, fixtureDir = config.paths.fixtures } = {}) {
    this.url = url;
    this.mode = mode; // auto | live | offline
    this.client = new McpClient({ url, timeoutMs: config.mcp.timeoutMs });
    this.fixtures = new FixtureStore(fixtureDir).load();
    this.resolution = new Map(); // intent -> live tool name
    this.state = 'idle'; // idle | live | offline | error
    this.error = null;
    this.cache = new Map();
    this.callLog = [];
  }

  async connect() {
    if (this.state === 'live' || this.state === 'offline') return this;
    if (this.mode === 'offline') {
      this.state = 'offline';
      log.info('offline mode - serving bundled fixtures only');
      return this;
    }
    try {
      await this.client.connect();
      this.resolveIntents();
      this.state = 'live';
    } catch (err) {
      this.error = err.message;
      if (this.mode === 'live') {
        this.state = 'error';
        throw err;
      }
      this.state = 'offline';
      log.warn(`live MCP unavailable (${err.message}) - falling back to fixtures`);
    }
    return this;
  }

  /** Map each semantic intent onto a discovered tool name. */
  resolveIntents() {
    const names = this.client.toolNames();
    for (const intent of INTENTS) {
      const patterns = INTENT_PATTERNS[intent];
      let match = null;
      for (const re of patterns) {
        match = names.find((n) => re.test(n));
        if (match) break;
      }
      if (match) this.resolution.set(intent, match);
    }
    log.info(`resolved ${this.resolution.size}/${INTENTS.length} intents against ${names.length} live tools`);
    return this.intentMap();
  }

  intentMap() {
    const out = {};
    for (const intent of INTENTS) {
      out[intent] = {
        tool: this.resolution.get(intent) ?? null,
        fixture: this.fixtures.has(intent),
        description: INTENT_DOCS[intent],
      };
    }
    return out;
  }

  _cacheKey(intent, args) {
    return `${intent}:${JSON.stringify(args ?? {})}`;
  }

  /**
   * Fetch an intent. Live first (when connected), fixtures as fallback.
   * Every call is logged so the UI can show which tools backed each claim.
   */
  async fetch(intent, args = {}) {
    await this.connect();
    const key = this._cacheKey(intent, args);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < config.mcp.cacheTtlMs) return cached.value;

    let value = null;
    let origin = 'none';
    let error = null;

    const tool = this.resolution.get(intent);
    if (this.state === 'live' && tool) {
      try {
        const res = await this.client.callTool(tool, args);
        value = res.json ?? res.text;
        origin = `bitget-mcp-server:${tool}`;
      } catch (err) {
        error = err.message;
        log.warn(`live call ${intent} -> ${tool} failed: ${err.message}`);
      }
    }

    if (value === null || value === undefined) {
      const fx = this.fixtures.get(intent, args);
      if (fx !== null && fx !== undefined) {
        value = fx;
        origin = error ? 'fixture (live call failed)' : 'fixture';
      }
    }

    const envelope = { intent, args, value, origin, error, at: new Date().toISOString() };
    this.callLog.push(envelope);
    if (this.callLog.length > 500) this.callLog.shift();
    if (value !== null && value !== undefined) this.cache.set(key, { at: Date.now(), value: envelope });
    return envelope;
  }

  /** Convenience wrappers - these are what channels and the verify ledger call. */
  quote(ticker) { return this.fetch('quote', { ticker }); }
  history(ticker, opts = {}) { return this.fetch('history', { ticker, ...opts }); }
  profile(ticker) { return this.fetch('profile', { ticker }); }
  earningsCalendar(ticker) { return this.fetch('earningsCalendar', { ticker }); }
  incomeStatement(ticker, period = 'quarterly') { return this.fetch('incomeStatement', { ticker, period }); }
  balanceSheet(ticker, period = 'quarterly') { return this.fetch('balanceSheet', { ticker, period }); }
  cashFlow(ticker, period = 'quarterly') { return this.fetch('cashFlow', { ticker, period }); }
  ratios(ticker) { return this.fetch('ratios', { ticker }); }
  valuation(ticker) { return this.fetch('valuation', { ticker }); }
  dividends(ticker) { return this.fetch('dividends', { ticker }); }
  insiderTrades(ticker) { return this.fetch('insiderTrades', { ticker }); }
  institutionalHoldings(ticker) { return this.fetch('institutionalHoldings', { ticker }); }
  analystEstimates(ticker) { return this.fetch('analystEstimates', { ticker }); }
  analystTargetPrice(ticker) { return this.fetch('analystTargetPrice', { ticker }); }
  news(query = {}) { return this.fetch('news', typeof query === 'string' ? { query } : query); }
  sentiment() { return this.fetch('sentiment', {}); }
  etfHoldings(ticker) { return this.fetch('etfHoldings', { ticker }); }

  status() {
    return {
      mode: this.mode,
      state: this.state,
      url: this.url,
      error: this.error,
      liveTools: this.client.toolNames().length,
      resolvedIntents: this.resolution.size,
      totalIntents: INTENTS.length,
      fixtures: this.fixtures.countFor(INTENTS),
      fixtureEntries: this.fixtures.count(),
      calls: this.callLog.length,
    };
  }
}

export default BitgetMarketProvider;