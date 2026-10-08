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
import { toDateStr } from '../util/time.mjs';
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

/**
 * Intents answered by computing over the bundled real daily OHLCV book rather
 * than by replaying a recorded tool response.
 *
 * These two are the intents whose answer this repo already owns: data/prices is
 * real end-of-day US equity/ETF data with its provenance and refresh procedure
 * written down in scripts/fetch-prices.mjs. Serving them from a synthetic
 * fixture would mean inventing prices in the same directory as real ones, so
 * they are computed instead - and both honour the task clock, because a series
 * that leaked bars past `asOf` would let a card see its own outcome.
 */
const COMPUTED_FROM_PRICE_BOOK = {
  history: 'daily OHLCV bars sliced from the bundled real price book, cut at the task clock',
  marketMovers: 'gainers / losers / most active ranked across the bundled price book on the task date',
};

export class BitgetMarketProvider {
  constructor({ url = config.mcp.url, mode = config.mcp.mode, fixtureDir = config.paths.fixtures, prices = null } = {}) {
    this.url = url;
    this.mode = mode; // auto | live | offline
    this.client = new McpClient({ url, timeoutMs: config.mcp.timeoutMs });
    this.fixtures = new FixtureStore(fixtureDir).load();
    this.resolution = new Map(); // intent -> live tool name
    this.state = 'idle'; // idle | live | offline | error
    this.error = null;
    this.prices = prices; // local real price book, for the computed intents
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

  /**
   * Hand the provider the local real price book.
   *
   * Called by DataHub after construction so an injected provider (the tests do
   * this) gets the same computed intents as the default one, and so the book is
   * loaded exactly once for the whole hub.
   */
  attachPrices(book) {
    this.prices = book ?? null;
    this.cache.clear();
    return this;
  }

  /** Bars up to the task clock, never past it. */
  _barsAsOf(symbol, args = {}) {
    const cut = args.asOf || args.to || args.until || null;
    const cutStr = cut ? toDateStr(cut) : null;
    const bars = this.prices.bars(symbol);
    return cutStr ? bars.filter((b) => b.date <= cutStr) : bars;
  }

  _computedHistory(args = {}) {
    const symbol = String(args.ticker || '').toUpperCase();
    if (!symbol || !this.prices?.has(symbol)) return null;
    const bars = this._barsAsOf(symbol, args);
    if (!bars.length) return null;
    const want = Number(args.limit ?? args.count);
    const slice = Number.isFinite(want) && want > 0 ? bars.slice(-want) : bars;
    return {
      symbol,
      interval: '1d',
      count: slice.length,
      from: slice[0].date,
      to: slice[slice.length - 1].date,
      bars: slice.map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
      source: 'computed from data/prices (real bundled end-of-day OHLCV)',
      synthetic: false,
    };
  }

  /**
   * Movers over the bundled book only.
   *
   * The universe is the repo's 25 price series, not "the US market", and the
   * payload says so: a top-gainers list that quietly covered 25 names while
   * reading like a market scan is the kind of overstatement this codebase exists
   * to prevent.
   */
  _computedMovers(args = {}) {
    if (!this.prices?.symbols?.().length) return null;
    const want = Number(args.limit ?? args.count);
    const limit = Number.isFinite(want) && want > 0 ? want : 5;
    const rows = [];
    for (const symbol of this.prices.symbols()) {
      const bars = this._barsAsOf(symbol, args);
      if (bars.length < 2) continue;
      const last = bars[bars.length - 1];
      const prev = bars[bars.length - 2];
      if (!prev.close || !Number.isFinite(last.close)) continue;
      rows.push({
        symbol,
        date: last.date,
        close: last.close,
        change: Number((last.close - prev.close).toFixed(4)),
        changePercent: Number((((last.close - prev.close) / prev.close) * 100).toFixed(3)),
        volume: last.volume,
      });
    }
    if (!rows.length) return null;
    const byPct = [...rows].sort((a, b) => b.changePercent - a.changePercent);
    const byVol = [...rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    return {
      asOf: dates[dates.length - 1],
      universe: rows.length,
      universeNote: `the ${rows.length} symbols in the bundled data/prices book, not the whole market`,
      gainers: byPct.slice(0, limit),
      losers: byPct.slice(-limit).reverse(),
      mostActive: byVol.slice(0, limit),
      source: 'computed from data/prices (real bundled end-of-day OHLCV)',
      synthetic: false,
    };
  }

  /** Computed intents, or null when this intent is not one of them. */
  _compute(intent, args = {}) {
    if (!Object.hasOwn(COMPUTED_FROM_PRICE_BOOK, intent) || !this.prices) return null;
    return intent === 'history' ? this._computedHistory(args) : this._computedMovers(args);
  }

  /**
   * One checkable statement per intent about where its answer comes from.
   *
   * `resolved=0/20` printed next to `fixture-backed=10/20` left ten intents with
   * no stated source at all, so a reader of the capabilities rail could not tell
   * "answered from real bundled data" from "answered from an invented demo
   * fixture" from "asked for and got nothing back". Every intent now resolves to
   * exactly one of four kinds, and every count the UI prints is derived from
   * this map instead of being written down beside it.
   *
   *   live      a resolved live tool answered (only in PRISM_DATA_MODE=live)
   *   computed  derived here from data/prices - real end-of-day OHLCV
   *   fixture   a bundled response; `synthetic` says whether it is invented
   *   unserved  nothing offline can answer it, so the run trace must report it
   */
  provenance() {
    const out = {};
    for (const intent of INTENTS) {
      const tool = this.resolution.get(intent) ?? null;
      if (this.state === 'live' && tool) {
        out[intent] = { kind: 'live', source: `bitget-mcp-server:${tool}`, synthetic: false, detail: 'answered by a resolved live tool' };
        continue;
      }
      if (Object.hasOwn(COMPUTED_FROM_PRICE_BOOK, intent) && this.prices) {
        out[intent] = { kind: 'computed', source: 'data/prices/*.csv', synthetic: false, detail: COMPUTED_FROM_PRICE_BOOK[intent] };
        continue;
      }
      const entry = this.fixtures.entryFor(intent);
      if (entry) {
        const synthetic = entry.synthetic !== false;
        out[intent] = {
          kind: 'fixture',
          source: entry.source ?? 'bundled fixture',
          synthetic,
          detail: `bundled demo fixture${synthetic ? ', labelled synthetic' : ', recorded from the live server'} (${entry._file ?? 'pack'})`,
        };
        continue;
      }
      out[intent] = {
        kind: 'unserved',
        source: null,
        synthetic: null,
        detail: 'no live tool, no computed source and no bundled fixture - a run that asks for it records the miss in its trace',
      };
    }
    return out;
  }

  /** Counts by kind, derived from provenance() so no summary can drift from it. */
  provenanceSummary() {
    const summary = { total: INTENTS.length, live: 0, computed: 0, fixture: 0, unserved: 0, synthetic: 0 };
    for (const p of Object.values(this.provenance())) {
      summary[p.kind] += 1;
      if (p.synthetic === true) summary.synthetic += 1;
    }
    summary.stated = summary.total - summary.unserved;
    return summary;
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

    // Computed from the real bundled price book BEFORE the fixture pack: real
    // data beats an invented recording of the same intent.
    if (value === null || value === undefined) {
      const computed = this._compute(intent, args);
      if (computed !== null && computed !== undefined) {
        value = computed;
        origin = error ? 'computed:data/prices (live call failed)' : 'computed:data/prices';
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
    const prov = this.provenanceSummary();
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
      // Stated sources, derived from provenance() rather than counted by hand.
      stated: prov.stated,
      computed: prov.computed,
      unserved: prov.unserved,
      syntheticFixtures: prov.synthetic,
      live: prov.live,
    };
  }
}

export default BitgetMarketProvider;