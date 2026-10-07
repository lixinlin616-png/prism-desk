/**
 * Runtime configuration. Everything is optional: with no env vars at all Prism
 * boots in deterministic offline mode using the bundled corpus + fixtures.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined && process.env[key] !== '') continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadDotEnv();

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  root: ROOT,
  dataDir: join(ROOT, 'data'),
  webDir: join(ROOT, 'web'),

  llm: {
    baseUrl: (process.env.PRISM_LLM_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.PRISM_LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.PRISM_LLM_MODEL || 'gpt-4o-mini',
    temperature: Number(process.env.PRISM_LLM_TEMPERATURE ?? 0.1),
    maxTokens: Number(process.env.PRISM_LLM_MAX_TOKENS ?? 4096),
    timeoutMs: Number(process.env.PRISM_LLM_TIMEOUT_MS ?? 90000),
    get enabled() {
      return Boolean(this.baseUrl && this.apiKey);
    },
  },

  mcp: {
    url: process.env.PRISM_MCP_URL || 'https://agent.bitget.com/mcp',
    /** auto | live | offline */
    mode: (process.env.PRISM_DATA_MODE || 'auto').toLowerCase(),
    timeoutMs: Number(process.env.PRISM_MCP_TIMEOUT_MS ?? 25000),
    cacheTtlMs: Number(process.env.PRISM_MCP_CACHE_TTL_MS ?? 60000),
  },

  /**
   * Chainbase AgentKey - the S2 external partner data source (optional).
   *
   * The endpoint is issued together with the key, so it has no default here:
   * guessing a URL and shipping it would be an unverifiable claim about someone
   * else's infrastructure. No key -> the provider reports itself disabled and
   * never opens a socket.
   */
  chainbase: {
    key: process.env.CHAINBASE_AGENT_KEY || '',
    url: process.env.CHAINBASE_MCP_URL || '',
    get enabled() { return Boolean(this.key); },
  },

  server: {
    /**
     * `HOST` / `PORT` are what every container PaaS (Fly, Render, Railway,
     * Heroku) actually injects. Honouring them next to the PRISM_* names is what
     * makes `docker run -e PORT=...` work without a wrapper script. The loopback
     * default stays, so a bare `node server.mjs` is still local-only.
     */
    host: process.env.PRISM_HOST || process.env.HOST || '127.0.0.1',
    port: Number(process.env.PRISM_PORT ?? process.env.PORT ?? 4310),
  },

  scoring: {
    weights: {
      surprise: 0.30,
      corroboration: 0.22,
      tradability: 0.18,
      asymmetry: 0.20,
      freshness: 0.10,
    },
    minScoreToPublish: Number(process.env.PRISM_MIN_SCORE ?? 45),
    maxActiveCards: Number(process.env.PRISM_MAX_CARDS ?? 40),
  },

  verify: {
    /** Relative tolerance when cross-checking an LLM-stated number against source data. */
    numericTolerancePct: Number(process.env.PRISM_VERIFY_TOL ?? 2.0),
    /** Cards whose headline evidence fails verification are quarantined, never published. */
    quarantineOnHeadlineFailure: bool(process.env.PRISM_STRICT_VERIFY, true),
  },

  /**
   * Post-hoc adjudication (`node prism.mjs review`).
   *
   * An expired card is not a dead card - it is a falsifiable claim whose
   * falsification window has closed, which means it can finally be scored
   * against what actually happened. These settings govern that judgement.
   */
  review: {
    /** Benchmark subtracted from every realised move, so a rising tape is not mistaken for skill. */
    benchmark: (process.env.PRISM_REVIEW_BENCHMARK || 'SPY').toUpperCase(),
    /**
     * Below this |benchmark-excess| move the window closed without confirming or
     * refuting anything, so the card is reported `inconclusive` instead of being
     * forced into a win/loss column it does not belong in.
     */
    materialityPct: Number(process.env.PRISM_REVIEW_MATERIALITY ?? 1.0),
    /**
     * When one daily bar touches BOTH the stop and the target, OHLC alone cannot
     * say which came first. Assume the stop - the pessimistic reading is the only
     * one that does not flatter the desk.
     */
    pessimisticTieBreak: bool(process.env.PRISM_REVIEW_PESSIMISTIC, true),
    /**
     * Sessions used to test a numeric invalidation level when the card's own
     * `recheckAt` leaves no testable window (it lands on a weekend, or before
     * the first forward session). Two sessions matches the wording the desk
     * actually writes: "reclaims the pre-print close WITHIN TWO SESSIONS".
     */
    invalidationFallbackSessions: Number(process.env.PRISM_REVIEW_INVALIDATION_SESSIONS ?? 2),
    /** Card statuses eligible for adjudication. */
    statuses: ['expired', 'superseded', 'invalidated', 'realized', 'draft', 'active'],
  },

  paths: {
    corpus: join(ROOT, 'data', 'corpus'),
    prices: join(ROOT, 'data', 'prices'),
    events: join(ROOT, 'data', 'events'),
    eval: join(ROOT, 'data', 'eval'),
    fixtures: join(ROOT, 'data', 'fixtures', 'mcp'),
  },
};

export default config;
