/**
 * Offline fixture store.
 *
 * Fixtures are recorded MCP tool responses (see scripts/record-fixtures.mjs).
 * They let the whole demo, the test-suite and the CI pipeline run with no
 * network access and no API keys - and they make evaluation deterministic.
 *
 * Fixture file shape:
 *   { "intent": "quote", "args": { "ticker": "NVDA" },
 *     "recordedAt": "...", "source": "bitget-mcp-server", "synthetic": true,
 *     "result": <whatever the tool returned> }
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../util/log.mjs';
import { stableStringify } from '../util/json.mjs';

const log = logger('fixtures');

export class FixtureStore {
  constructor(dir) {
    this.dir = dir;
    this.entries = [];
    this.byKey = new Map();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    if (!existsSync(this.dir)) {
      log.warn(`fixture dir missing: ${this.dir}`);
      return this;
    }
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
      try {
        const doc = JSON.parse(readFileSync(join(this.dir, file), 'utf8'));
        const list = Array.isArray(doc) ? doc : [doc];
        for (const entry of list) {
          if (!entry || !entry.intent) continue;
          entry._file = file;
          this.entries.push(entry);
          this.byKey.set(this.key(entry.intent, entry.args), entry);
        }
      } catch (err) {
        log.warn(`skipping unreadable fixture ${file}: ${err.message}`);
      }
    }
    log.debug(`loaded ${this.entries.length} fixtures from ${this.dir}`);
    return this;
  }

  key(intent, args = {}) {
    return `${intent}::${stableStringify(args ?? {})}`;
  }

  get(intent, args) {
    this.load();
    const exact = this.byKey.get(this.key(intent, args));
    if (exact) return exact.result;
    // Fall back to any fixture for the same intent (ignores arg drift).
    const loose = this.entries.find((e) => e.intent === intent);
    return loose ? loose.result : null;
  }

  has(intent, args) {
    return this.get(intent, args) !== null;
  }

  intents() {
    this.load();
    return [...new Set(this.entries.map((e) => e.intent))].sort();
  }

  count() {
    this.load();
    return this.entries.length;
  }
}

export function readFixtureMeta(dir) {
  const store = new FixtureStore(dir).load();
  const byIntent = {};
  for (const e of store.entries) {
    byIntent[e.intent] = (byIntent[e.intent] || 0) + 1;
  }
  return { total: store.entries.length, byIntent, synthetic: store.entries.every((e) => e.synthetic !== false) };
}