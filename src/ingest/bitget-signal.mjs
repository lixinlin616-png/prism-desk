/**
 * Adapter for Bitget's `bitget-signal` research skills (crypto-side perception).
 *
 * bitget-signal ships 5 skills backed by a public, no-key MCP data service:
 *   macro-analyst, market-intel, sentiment-analyst, technical-analysis, news-briefing
 *
 * Prism uses them for the `cross-asset` channel: tokenized US equities (rToken)
 * trade 24/7 on crypto rails, so crypto-side regime data is genuine information
 * about how an rToken will price a US macro print while the cash market is shut.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { McpClient } from './mcp-client.mjs';
import { FixtureStore } from './fixtures.mjs';

const log = logger('bitget-signal');

export const SIGNAL_SKILLS = {
  'macro-analyst': {
    id: 'macro-analyst',
    zh: '宏观与跨资产分析',
    capabilities: ['Fed policy', 'FOMC news', 'yield curve', 'BTC vs DXY / Nasdaq / Gold / S&P / 10Y correlation'],
    intents: ['fed-policy', 'yield-curve', 'cross-asset-correlation'],
    needsPython: false,
  },
  'market-intel': {
    id: 'market-intel',
    zh: '链上与机构情报',
    capabilities: ['On-chain capital flows', 'ETF flows', 'DeFi TVL', 'Cycle indicators', 'Whale movement'],
    intents: ['etf-flows', 'whale-flow', 'defi-tvl', 'cycle-indicator'],
    needsPython: false,
  },
  'sentiment-analyst': {
    id: 'sentiment-analyst',
    zh: '情绪与持仓分析',
    capabilities: ['Fear & Greed Index', 'Long/short ratio', 'Open interest', 'Funding rates', 'Taker ratio', 'Reddit signals'],
    intents: ['fear-greed', 'long-short-ratio', 'open-interest', 'funding-rate', 'taker-ratio'],
    needsPython: false,
  },
  'technical-analysis': {
    id: 'technical-analysis',
    zh: '技术分析',
    capabilities: ['23 indicators across 6 categories', 'Trend', 'Volatility', 'Oscillator', 'Volume', 'Momentum', 'Support/resistance'],
    intents: ['indicator', 'support-resistance'],
    needsPython: true,
  },
  'news-briefing': {
    id: 'news-briefing',
    zh: '新闻聚合与叙事合成',
    capabilities: ['44 RSS/Atom feeds', 'Social trending boards', 'Narrative synthesis', 'Morning brief'],
    intents: ['crypto-news', 'trending', 'narrative'],
    needsPython: false,
  },
};

export const SIGNAL_SKILL_IDS = Object.keys(SIGNAL_SKILLS);

const SKILL_PATTERN = {
  'macro-analyst': /macro|fed|yield|cross.?asset/i,
  'market-intel': /market.?intel|onchain|on.?chain|etf|whale|tvl/i,
  'sentiment-analyst': /sentiment|fear|greed|funding|long.?short/i,
  'technical-analysis': /technical|indicator|ta[_-]/i,
  'news-briefing': /news|brief|narrative|trending/i,
};

export class SignalProvider {
  constructor({ url = process.env.PRISM_SIGNAL_MCP_URL || config.mcp.url, fixtureDir = config.paths.fixtures } = {}) {
    this.url = url;
    this.client = new McpClient({ url, timeoutMs: config.mcp.timeoutMs, clientName: 'prism-desk-signal' });
    this.fixtures = new FixtureStore(fixtureDir).load();
    this.resolution = new Map();
    this.state = 'idle';
    this.error = null;
    this.callLog = [];
  }

  async connect() {
    if (this.state !== 'idle') return this;
    if (config.mcp.mode === 'offline') { this.state = 'offline'; return this; }
    try {
      await this.client.connect();
      const names = this.client.toolNames();
      for (const [skill, re] of Object.entries(SKILL_PATTERN)) {
        const hit = names.find((n) => re.test(n));
        if (hit) this.resolution.set(skill, hit);
      }
      this.state = 'live';
      log.info(`bitget-signal live: resolved ${this.resolution.size}/${SIGNAL_SKILL_IDS.length} skills`);
    } catch (err) {
      this.error = err.message;
      this.state = config.mcp.mode === 'live' ? 'error' : 'offline';
      if (this.state === 'error') throw err;
      log.warn(`bitget-signal unavailable (${err.message}) - using fixtures`);
    }
    return this;
  }

  /** Invoke one of the 5 skills with a natural-language or structured ask. */
  async invoke(skill, query = {}) {
    await this.connect();
    if (!SIGNAL_SKILLS[skill]) throw new Error(`unknown bitget-signal skill: ${skill}`);
    const fixtureKey = `signal:${skill}`;
    let value = null;
    let origin = 'none';
    const tool = this.resolution.get(skill);
    if (this.state === 'live' && tool) {
      try {
        const res = await this.client.callTool(tool, query);
        value = res.json ?? res.text;
        origin = `bitget-signal:${tool}`;
      } catch (err) {
        log.warn(`${skill} live call failed: ${err.message}`);
      }
    }
    if (value === null) {
      const fx = this.fixtures.get(fixtureKey, query);
      if (fx !== null) { value = fx; origin = 'fixture'; }
    }
    const entry = { skill, query, value, origin, at: new Date().toISOString() };
    this.callLog.push(entry);
    return entry;
  }

  async macroAsk(q) { return this.invoke('macro-analyst', { query: q }); }
  async intelAsk(q) { return this.invoke('market-intel', { query: q }); }
  async sentimentAsk(q) { return this.invoke('sentiment-analyst', { query: q }); }
  async technicalAsk(q) { return this.invoke('technical-analysis', { query: q }); }
  async newsAsk(q) { return this.invoke('news-briefing', { query: q }); }

  status() {
    return {
      state: this.state,
      url: this.url,
      error: this.error,
      skills: SIGNAL_SKILL_IDS.map((s) => ({
        id: s, zh: SIGNAL_SKILLS[s].zh,
        tool: this.resolution.get(s) ?? null,
        fixture: this.fixtures.has(`signal:${s}`),
      })),
      calls: this.callLog.length,
    };
  }
}

export default SignalProvider;