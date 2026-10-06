/**
 * The Signal Board.
 *
 * Holds every card the desk has produced, and does the three housekeeping jobs
 * a human would otherwise have to do by hand:
 *
 *   1. DEDUPE     - the same claim about the same name from a newer document
 *                   supersedes the older card instead of stacking up next to it.
 *   2. CONFLICT   - two active cards on the same ticker pointing in opposite
 *                   directions are surfaced explicitly. Never silently netted.
 *   3. EXPIRE     - cards are time-boxed. Once `expiresAt` passes the card is
 *                   retired, because a stale signal is worse than no signal.
 *
 * State persists to data/state/board.json so the demo board survives a restart
 * and judges see an accumulated desk rather than an empty one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { cardSummary, CHANNELS } from '../schema.mjs';
import { parseDate } from '../util/time.mjs';
import { round } from '../util/num.mjs';

const log = logger('board');

const OPPOSITES = { long: 'short', short: 'long' };

export class SignalBoard {
  /**
   * `PRISM_STATE_FILE` exists because a container filesystem is either ephemeral
   * or read-only. Pointing the board at a mounted volume keeps a demo's state
   * across restarts; leaving it unset keeps the in-repo path used by the tests.
   */
  constructor({
    file = process.env.PRISM_STATE_FILE || join(config.root, 'data', 'state', 'board.json'),
    autosave = true,
  } = {}) {
    this.file = file;
    this.autosave = autosave;
    this.cards = new Map();
    this.history = [];
    this.load();
  }

  load() {
    if (!existsSync(this.file)) return this;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const c of raw.cards || []) this.cards.set(c.id, c);
      this.history = raw.history || [];
      log.debug(`board restored: ${this.cards.size} cards`);
    } catch (err) {
      log.warn(`could not restore board state: ${err.message}`);
    }
    return this;
  }

  save() {
    if (!this.autosave) return this;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({
        savedAt: new Date().toISOString(),
        cards: [...this.cards.values()],
        history: this.history.slice(-200),
      }, null, 2), 'utf8');
    } catch (err) {
      log.warn(`could not persist board: ${err.message}`);
    }
    return this;
  }

  /** Identity used for supersession: same channel + same tickers + same direction. */
  static identity(card) {
    return `${card.channel}::${[...(card.tickers || [])].sort().join(',')}::${card.direction}`;
  }

  /**
   * Add cards produced by a run. Supersedes older identical-identity cards and
   * records what happened so the UI can show an audit trail.
   */
  ingest(cards, { asOf = new Date() } = {}) {
    const added = [];
    const superseded = [];
    for (const card of cards) {
      const id = SignalBoard.identity(card);
      const existing = [...this.cards.values()].find((c) => SignalBoard.identity(c) === id && c.id !== card.id && c.status === 'active');
      if (existing) {
        existing.status = 'superseded';
        existing.supersededBy = card.id;
        superseded.push(existing.id);
      }
      this.cards.set(card.id, card);
      added.push(card.id);
      this.history.push({ at: new Date(asOf).toISOString(), action: 'ingest', cardId: card.id, channel: card.channel, score: card.score?.total ?? null, status: card.status });
    }
    this.recomputeConflicts();
    this.expire(asOf);
    this.save();
    return { added: added.length, superseded: superseded.length };
  }

  /** Mark cards whose expiry has passed. */
  expire(at = new Date()) {
    let n = 0;
    for (const card of this.cards.values()) {
      if (card.status !== 'active') continue;
      if (card.expiresAt && parseDate(card.expiresAt) < parseDate(at)) {
        card.status = 'expired';
        n += 1;
      }
    }
    return n;
  }

  /**
   * Surface direct contradictions. A long card and a short card on the same
   * ticker is information the trader must see, not something to average away.
   */
  recomputeConflicts() {
    for (const card of this.cards.values()) card.conflicts = (card.conflicts || []).filter((c) => c.type !== 'board-conflict');
    const active = [...this.cards.values()].filter((c) => c.status === 'active');
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        const shared = (a.tickers || []).filter((t) => (b.tickers || []).includes(t));
        if (!shared.length) continue;
        if (OPPOSITES[a.direction] === b.direction) {
          const detail = `${shared.join(', ')}: "${a.title}" (${a.direction}, score ${a.score?.total}) vs "${b.title}" (${b.direction}, score ${b.score?.total})`;
          a.conflicts.push({ type: 'board-conflict', with: b.id, tickers: shared, detail });
          b.conflicts.push({ type: 'board-conflict', with: a.id, tickers: shared, detail });
        }
      }
    }
  }

  get(id) { return this.cards.get(id) ?? null; }

  all({ status = null, channel = null, ticker = null, limit = 200 } = {}) {
    let out = [...this.cards.values()];
    if (status) out = out.filter((c) => c.status === status);
    if (channel) out = out.filter((c) => c.channel === channel);
    if (ticker) out = out.filter((c) => (c.tickers || []).includes(String(ticker).toUpperCase()));
    out.sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
    return out.slice(0, limit);
  }

  active() { return this.all({ status: 'active' }); }

  /** Board grouped by channel, for the desk view. */
  byChannel({ status = 'active' } = {}) {
    const out = {};
    for (const id of Object.keys(CHANNELS)) out[id] = [];
    for (const c of this.all({ status })) (out[c.channel] = out[c.channel] || []).push(cardSummary(c));
    return out;
  }

  /** Names the desk currently has an opinion on, with the net read. */
  watchlist() {
    const map = new Map();
    for (const c of this.all({ status: 'active' })) {
      for (const t of c.tickers || []) {
        const row = map.get(t) || { ticker: t, cards: 0, long: 0, short: 0, hedge: 0, avoid: 0, bestScore: 0, channels: new Set(), conflict: false };
        row.cards += 1;
        if (row.directions === undefined) row.directions = {};
        if (c.direction in row) row[c.direction] += 1;
        row.bestScore = Math.max(row.bestScore, c.score?.total ?? 0);
        row.channels.add(c.channel);
        if ((c.conflicts || []).some((x) => x.type === 'board-conflict')) row.conflict = true;
        map.set(t, row);
      }
    }
    return [...map.values()]
      .map((r) => ({ ...r, channels: [...r.channels], netRead: r.long > r.short + r.avoid ? 'constructive' : r.short + r.avoid > r.long ? 'defensive' : 'mixed' }))
      .sort((a, b) => b.bestScore - a.bestScore);
  }

  clear() {
    this.cards.clear();
    this.history = [];
    this.save();
  }

  status() {
    const counts = {};
    for (const c of this.cards.values()) counts[c.status] = (counts[c.status] || 0) + 1;
    const scores = [...this.cards.values()].filter((c) => c.status === 'active').map((c) => c.score?.total ?? 0);
    return {
      total: this.cards.size,
      byStatus: counts,
      activeAvgScore: scores.length ? round(scores.reduce((a, x) => a + x, 0) / scores.length, 1) : null,
      conflicts: [...this.cards.values()].filter((c) => (c.conflicts || []).some((x) => x.type === 'board-conflict')).length,
      events: this.history.length,
      persisted: existsSync(this.file),
    };
  }
}

export default SignalBoard;