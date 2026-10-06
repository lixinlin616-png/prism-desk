/**
 * Document corpus loader.
 *
 * The corpus is the raw, unstructured input Prism is asked to distil:
 * earnings releases, call transcripts, macro prints, FOMC statements, news
 * wires, filing excerpts. Documents are plain JSON files under data/corpus/.
 *
 * Document shape:
 * {
 *   id, kind, tickers[], title, publishedAt, source, url?,
 *   body, meta { consensus?, actual?, unit?, ... }, tags[]
 * }
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../util/log.mjs';
import { parseDate, toDateStr } from '../util/time.mjs';

const log = logger('corpus');

export const DOC_KINDS = [
  'earnings-release', 'earnings-call', 'guidance', 'macro-print', 'fomc-statement',
  'news', 'filing', 'analyst-note', 'social', 'transcript', 'other',
];

export class Corpus {
  constructor(dir) {
    this.dir = dir;
    this.docs = [];
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    if (!existsSync(this.dir)) { log.warn(`corpus dir missing: ${this.dir}`); return this; }
    const files = readdirSync(this.dir).filter((f) => {
      if (/^readme/i.test(f)) return false;
      return f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.txt');
    });
    for (const file of files) {
      const full = join(this.dir, file);
      try {
        const raw = readFileSync(full, 'utf8');
        if (file.endsWith('.json')) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const doc of list) if (doc && doc.body) this.docs.push(normaliseDoc(doc, file));
        } else {
          this.docs.push(normaliseDoc(parseMarkdownDoc(raw, file), file));
        }
      } catch (err) {
        log.warn(`skipping ${file}: ${err.message}`);
      }
    }
    this.docs.sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
    log.debug(`corpus loaded: ${this.docs.length} documents`);
    return this;
  }

  all() { this.load(); return this.docs; }

  byId(id) { this.load(); return this.docs.find((d) => d.id === id) ?? null; }

  byTicker(ticker) {
    this.load();
    const t = String(ticker).toUpperCase();
    return this.docs.filter((d) => (d.tickers || []).map((x) => x.toUpperCase()).includes(t));
  }

  byKind(kind) { this.load(); return this.docs.filter((d) => d.kind === kind); }

  /** Documents published within [from, to] inclusive. */
  between(from, to) {
    this.load();
    const a = toDateStr(from);
    const b = toDateStr(to);
    return this.docs.filter((d) => {
      const day = toDateStr(d.publishedAt);
      return day && day >= a && day <= b;
    });
  }

  /** Latest N documents, optionally filtered. */
  latest(n = 10, filter = {}) {
    let docs = this.all();
    if (filter.ticker) docs = docs.filter((d) => (d.tickers || []).includes(String(filter.ticker).toUpperCase()));
    if (filter.kind) docs = docs.filter((d) => d.kind === filter.kind);
    if (filter.tags) docs = docs.filter((d) => filter.tags.some((t) => (d.tags || []).includes(t)));
    return docs.slice(-n).reverse();
  }

  /** Naive but effective keyword retrieval used to keep LLM context tight. */
  search(query, { limit = 8, ticker = null } = {}) {
    this.load();
    const terms = String(query).toLowerCase().split(/[^a-z0-9%$.\-]+/).filter((t) => t.length > 2);
    let pool = this.docs;
    if (ticker) {
      const t = String(ticker).toUpperCase();
      const scoped = pool.filter((d) => (d.tickers || []).includes(t));
      if (scoped.length) pool = scoped;
    }
    const scored = pool.map((d) => {
      const hay = `${d.title} ${d.body} ${(d.tags || []).join(' ')} ${d.kind}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const hits = hay.split(term).length - 1;
        if (hits) score += 1 + Math.log1p(hits);
      }
      if ((d.tickers || []).some((tk) => hay.includes(tk.toLowerCase()))) score += 0.5;
      return { doc: d, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((x) => ({ ...x.doc, _score: Number(x.score.toFixed(3)) }));
  }

  stats() {
    this.load();
    const byKind = {};
    const tickers = new Set();
    for (const d of this.docs) {
      byKind[d.kind] = (byKind[d.kind] || 0) + 1;
      for (const t of d.tickers || []) tickers.add(t);
    }
    return {
      documents: this.docs.length,
      byKind,
      tickers: [...tickers].sort(),
      range: this.docs.length
        ? { from: toDateStr(this.docs[0].publishedAt), to: toDateStr(this.docs[this.docs.length - 1].publishedAt) }
        : null,
      words: this.docs.reduce((a, d) => a + String(d.body || '').split(/\s+/).length, 0),
    };
  }
}

function normaliseDoc(doc, file) {
  return {
    id: doc.id || `${file.replace(/\.[^.]+$/, '')}`,
    kind: DOC_KINDS.includes(doc.kind) ? doc.kind : 'other',
    tickers: (doc.tickers || []).map((t) => String(t).toUpperCase()),
    title: doc.title || doc.id || file,
    publishedAt: doc.publishedAt || doc.date || new Date().toISOString(),
    source: doc.source || 'unknown',
    url: doc.url || null,
    body: String(doc.body || ''),
    meta: doc.meta || {},
    tags: doc.tags || [],
    synthetic: doc.synthetic !== false,
    file,
  };
}

/** Lightweight front-matter parser so analysts can drop .md notes straight in. */
export function parseMarkdownDoc(raw, file) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fm) return { id: file, kind: 'other', title: file, body: raw, tickers: [], publishedAt: new Date().toISOString(), source: file };
  const meta = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    meta[m[1]] = v;
  }
  return {
    id: meta.id || file.replace(/\.[^.]+$/, ''),
    kind: meta.kind || 'other',
    title: meta.title || file,
    publishedAt: meta.publishedAt || meta.date || new Date().toISOString(),
    source: meta.source || file,
    url: meta.url || null,
    body: fm[2].trim(),
    tickers: Array.isArray(meta.tickers) ? meta.tickers : meta.tickers ? [meta.tickers] : [],
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
    meta: meta.meta ? JSON.parse(meta.meta) : {},
    synthetic: meta.synthetic === undefined ? true : meta.synthetic !== 'false',
  };
}

export function corpusAgeDays(doc, at = new Date()) {
  const d = parseDate(doc.publishedAt);
  if (!d) return NaN;
  return (parseDate(at) - d) / 86400000;
}

export default Corpus;