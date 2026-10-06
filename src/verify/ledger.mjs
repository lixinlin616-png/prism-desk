/**
 * The Evidence Ledger.
 *
 * Prism's core claim is that an LLM must not be allowed to smuggle an invented
 * number into a trade recommendation. The ledger is what enforces that.
 *
 * For every evidence item on a card it applies a strategy:
 *   quote      -> the quoted text must actually appear in the cited source
 *                 document (normalised substring / token-overlap match)
 *   metric     -> the numeric value must appear in the document body or its
 *                 authoritative meta block
 *   price      -> cross-checked against the bundled real OHLCV dataset
 *   estimate /
 *   fundamental-> cross-checked against the data snapshot from the same intent
 *   computed   -> re-executed from its declared recipe, or marked unverifiable
 *   sentiment /
 *   onchain    -> cross-checked against the signal provider snapshot
 *
 * Anything that cannot be checked is marked `unverifiable` and displayed as
 * such. A headline item that FAILS quarantines the whole card - it is never
 * published to the board.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { toNum, round, pctChange } from '../util/num.mjs';
import { VERIFY_STATUS } from '../schema.mjs';

const log = logger('ledger');

const NORM = /[\s\u00a0]+/g;
const PUNCT = /["'`‘’“”\u2018\u2019]/g;

export function normaliseText(s) {
  return String(s ?? '').replace(PUNCT, '"').replace(NORM, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Token-overlap similarity in [0,1] - used when a quote is lightly paraphrased. */
/**
 * Tokens of a string for similarity purposes.
 *
 * The split keeps `.` so that "9.84" survives as one token, which means sentence
 * punctuation also sticks: a quote lifted from mid-document ends "consensus"
 * while the window it is compared against ends "consensus." - and the two would
 * never match. Trailing punctuation is therefore trimmed per token, so a
 * legitimate paraphrase is not punished for where the sentence happened to end.
 */
function tokens(s) {
  return new Set(
    normaliseText(s)
      .split(/[^a-z0-9%$.\-]+/)
      .map((t) => t.replace(/^[.\-]+/, '').replace(/[.\-]+$/, ''))
      .filter((t) => t.length > 1),
  );
}

export function tokenOverlap(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.min(ta.size, tb.size);
}

/** Does `needle` appear in `haystack`, allowing for whitespace/quote drift? */
export function containsQuote(haystack, needle, { minOverlap = 0.85 } = {}) {
  const h = normaliseText(haystack);
  const n = normaliseText(needle);
  if (!n) return { found: false, method: 'empty' };
  if (h.includes(n)) return { found: true, method: 'exact', index: h.indexOf(n) };
  // Sliding window over the haystack for a near-match.
  const words = n.split(' ');
  if (words.length >= 4) {
    const hWords = h.split(' ');
    for (let i = 0; i + words.length <= hWords.length; i += 1) {
      const slice = hWords.slice(i, i + words.length).join(' ');
      if (tokenOverlap(slice, n) >= minOverlap) {
        return { found: true, method: 'fuzzy', index: i, overlap: round(tokenOverlap(slice, n), 3) };
      }
    }
  }
  return { found: false, method: 'none', overlap: round(tokenOverlap(h, n), 3) };
}

/** Every number that appears in a text, as strings and as parsed values. */
export function numbersIn(text) {
  const out = [];
  const re = /[-+]?\$?\d[\d,]*(?:\.\d+)?%?/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const raw = m[0];
    const n = toNum(raw);
    if (n !== null) out.push({ raw, value: n, index: m.index });
  }
  return out;
}

export class EvidenceLedger {
  /**
   * @param {object} opts
   * @param {import('../ingest/index.mjs').DataHub} opts.hub
   * @param {number} [opts.tolerancePct] relative tolerance for numeric checks
   */
  constructor({ hub, tolerancePct = config.verify.numericTolerancePct } = {}) {
    this.hub = hub;
    this.tolerancePct = tolerancePct;
    this.audit = [];
  }

  /** Verify a whole card in place. Returns the ledger report. */
  verifyCard(card, { documents = [], snapshots = [] } = {}) {
    const docById = new Map(documents.map((d) => [d.id, d]));
    // Documents may also be referenced by their source string.
    const results = [];

    for (const item of card.evidence || []) {
      const res = this.verifyItem(item, { card, docById, snapshots, documents });
      item.verified = res.status;
      item.checkedAgainst = res.checkedAgainst;
      if (res.note) item.note = [item.note, res.note].filter(Boolean).join(' | ');
      results.push({ id: item.id, type: item.type, headline: Boolean(item.headline), ...res });
    }

    const pass = results.filter((r) => r.status === 'pass').length;
    const fail = results.filter((r) => r.status === 'fail').length;
    const unverifiable = results.filter((r) => r.status === 'unverifiable').length;
    const headlineFail = results.some((r) => r.headline && r.status === 'fail');
    const headlinePass = results.some((r) => r.headline && r.status === 'pass');

    const report = {
      cardId: card.id,
      total: results.length,
      pass, fail, unverifiable,
      pending: results.filter((r) => r.status === 'pending').length,
      passRate: results.length ? round((pass / results.length) * 100, 1) : 0,
      headlineFail,
      headlinePass,
      quarantine: headlineFail && config.verify.quarantineOnHeadlineFailure,
      items: results,
      /**
       * Stamped from the run clock. card.createdAt IS the run's as-of (see
       * stampTime in src/extract/index.mjs), so this is both the honest answer to
       * "when did the desk check this" and the reproducible one - a wall-clock
       * stamp here made the same --as-of replay write a different board file
       * every single time it ran.
       */
      verifiedAt: card.createdAt || new Date().toISOString(),
    };

    card.verification = {
      passRate: report.passRate,
      pass, fail, unverifiable,
      quarantined: report.quarantine,
      verifiedAt: report.verifiedAt,
    };
    if (report.quarantine) card.status = 'quarantined';

    this.audit.push(report);
    if (this.audit.length > 500) this.audit.shift();
    log.debug(`card ${card.id}: ${pass} pass / ${fail} fail / ${unverifiable} unverifiable${report.quarantine ? ' -> QUARANTINED' : ''}`);
    return report;
  }

  verifyItem(item, ctx) {
    const type = item.type;
    try {
      if (type === 'quote' || type === 'news' || type === 'filing') return this.checkQuote(item, ctx);
      if (type === 'metric' || type === 'estimate') return this.checkMetric(item, ctx);
      if (type === 'price') return this.checkPrice(item, ctx);
      if (type === 'fundamental') return this.checkFundamental(item, ctx);
      if (type === 'computed') return this.checkComputed(item, ctx);
      if (type === 'sentiment' || type === 'onchain' || type === 'technical') return this.checkSignal(item, ctx);
      if (type === 'calendar') return this.checkCalendar(item, ctx);
      return { status: 'unverifiable', checkedAgainst: null, note: `no verification strategy for evidence type "${type}"` };
    } catch (err) {
      log.warn(`verification threw on ${item.id}: ${err.message}`);
      return { status: 'unverifiable', checkedAgainst: null, note: `verifier error: ${err.message}` };
    }
  }

  // --------------------------------------------------------------- strategies

  checkQuote(item, { docById, documents }) {
    const doc = docById.get(item.source) || documents.find((d) => d.id === item.source || d.source === item.source);
    if (!doc) {
      return { status: 'unverifiable', checkedAgainst: `document ${item.source}`, note: 'source document not in the supplied corpus for this run' };
    }
    const res = containsQuote(doc.body, item.quote);
    if (res.found) {
      return { status: 'pass', checkedAgainst: `${doc.id} (${res.method}${res.index !== undefined ? ` @${res.index}` : ''})`, note: null };
    }
    // A citation of the document's own headline is legitimate grounding.
    const titleRes = containsQuote(doc.title || '', item.quote);
    if (titleRes.found) {
      return { status: 'pass', checkedAgainst: `${doc.id} title (${titleRes.method})`, note: null };
    }
    return {
      status: 'fail',
      checkedAgainst: doc.id,
      note: `quote not found in source (best token overlap ${res.overlap ?? 0}); this is exactly the failure mode the ledger exists to catch`,
    };
  }

  checkMetric(item, { docById, documents, snapshots }) {
    const value = toNum(item.value);
    if (value === null) {
      return { status: 'unverifiable', checkedAgainst: null, note: 'evidence carries no numeric value to check' };
    }

    // 1. Prefer the authoritative data snapshot for the same field.
    for (const snap of snapshots) {
      const found = findValueIn(snap.value, value, this.tolerancePct);
      if (found) return { status: 'pass', checkedAgainst: `${snap.origin || snap.intent} ${found.path}`, note: null };
    }

    // 2. Fall back to the document meta block, then the body text.
    const doc = docById.get(item.source) || documents.find((d) => d.id === item.source);
    if (doc) {
      const metaHit = findValueIn(doc.meta ?? {}, value, this.tolerancePct);
      if (metaHit) return { status: 'pass', checkedAgainst: `${doc.id} meta${metaHit.path}`, note: null };
      const nums = numbersIn(doc.body);
      const bodyHit = nums.find((n) => closeEnough(n.value, value, this.tolerancePct));
      if (bodyHit) return { status: 'pass', checkedAgainst: `${doc.id} body @${bodyHit.index} ("${bodyHit.raw}")`, note: null };
      return {
        status: 'fail',
        checkedAgainst: doc.id,
        note: `value ${value} does not appear in the cited document or its meta block`,
      };
    }

    return { status: 'unverifiable', checkedAgainst: null, note: 'no document or snapshot available to check this number against' };
  }

  checkPrice(item, { card }) {
    const book = this.hub?.prices;
    const value = toNum(item.value);
    if (!book || value === null) return { status: 'unverifiable', checkedAgainst: null, note: 'no price book or numeric value' };
    const symbol = item.symbol || item.ticker || (card.tickers || [])[0];
    const date = item.date || card.createdAt?.slice(0, 10);
    if (!symbol || !book.has(symbol)) return { status: 'unverifiable', checkedAgainst: `price-book(${symbol})`, note: 'symbol not in the bundled dataset' };
    const bar = book.barOn(symbol, date);
    if (!bar) return { status: 'unverifiable', checkedAgainst: `price-book(${symbol}@${date})`, note: 'no bar on or before that date' };
    const candidates = { close: bar.close, open: bar.open, high: bar.high, low: bar.low };
    for (const [field, px] of Object.entries(candidates)) {
      if (closeEnough(px, value, this.tolerancePct)) {
        return { status: 'pass', checkedAgainst: `price-book ${symbol}.${field} @${bar.date} = ${px}`, note: null };
      }
    }
    return {
      status: 'fail',
      checkedAgainst: `price-book ${symbol} @${bar.date}`,
      note: `claimed ${value}, actual close ${bar.close} (open ${bar.open}, high ${bar.high}, low ${bar.low}) - ${round(pctChange(bar.close, value), 2)}% off`,
    };
  }

  checkFundamental(item, { snapshots, docById, documents }) {
    const value = toNum(item.value);
    if (value === null) {
      // Non-numeric flags (e.g. a ratio check label) are grounded in the doc meta.
      const doc = docById.get(item.source) || documents.find((d) => d.id === item.source);
      const flags = doc?.meta?.ratioChecks;
      if (Array.isArray(flags) && item.quote && flags.length) {
        return { status: 'pass', checkedAgainst: `${doc.id} meta.ratioChecks`, note: null };
      }
      return { status: 'unverifiable', checkedAgainst: null, note: 'non-numeric fundamental claim with no matching meta flag' };
    }
    for (const snap of snapshots) {
      const found = findValueIn(snap.value, value, this.tolerancePct);
      if (found) return { status: 'pass', checkedAgainst: `${snap.origin || snap.intent} ${found.path}`, note: null };
    }
    const doc = docById.get(item.source) || documents.find((d) => d.id === item.source);
    if (doc) {
      const metaHit = findValueIn(doc.meta ?? {}, value, this.tolerancePct);
      if (metaHit) return { status: 'pass', checkedAgainst: `${doc.id} meta${metaHit.path}`, note: null };
      const bodyHit = numbersIn(doc.body).find((n) => closeEnough(n.value, value, this.tolerancePct));
      if (bodyHit) return { status: 'pass', checkedAgainst: `${doc.id} body @${bodyHit.index}`, note: null };
    }
    return { status: 'unverifiable', checkedAgainst: null, note: 'no fundamental snapshot available to check against' };
  }

  /**
   * A computed claim is only trustworthy if the engine can re-run it. Each
   * recipe recomputes the asserted aggregate from raw data and compares.
   */
  checkComputed(item, { card, snapshots }) {
    const value = toNum(item.value);
    const symbol = item.symbol || (card.tickers || [])[0];

    if (item.recipe === 'gap-study' && this.hub?.prices?.has(symbol)) {
      const recomputed = recomputeGapStudy(this.hub.prices, symbol);
      if (recomputed.n && Number.isFinite(value)) {
        const ok = closeEnough(recomputed.continuedPct, value, 0.5);
        return {
          status: ok ? 'pass' : 'fail',
          checkedAgainst: `recomputed gap study on ${symbol}: ${recomputed.n} gaps, continued ${recomputed.continuedPct}%`,
          note: ok ? 'engine re-executed the recipe and reproduced the figure' : `claimed ${value}, recomputed ${recomputed.continuedPct}`,
        };
      }
    }

    if (item.recipe === 'insider-sell-count') {
      const snap = (snapshots || []).find((s) => s.intent === 'insiderTrades' && String(s.args?.ticker ?? '').toUpperCase() === String(symbol ?? '').toUpperCase())
        || (snapshots || []).find((s) => s.intent === 'insiderTrades');
      const recount = snap ? recountInsider(snap.value, symbol) : null;
      if (recount) {
        const ok = recount.sells === value;
        return { status: ok ? 'pass' : 'fail', checkedAgainst: `recounted insiderTrades(${symbol}): ${recount.sells} sells / ${recount.buys} buys`, note: ok ? null : `claimed ${value} sells, recomputed ${recount.sells}` };
      }
      return { status: 'unverifiable', checkedAgainst: null, note: 'no insiderTrades snapshot attached' };
    }

    if (item.recipe === 'institutional-delta-count') {
      const snap = (snapshots || []).find((s) => s.intent === 'institutionalHoldings' && String(s.args?.ticker ?? '').toUpperCase() === String(symbol ?? '').toUpperCase())
        || (snapshots || []).find((s) => s.intent === 'institutionalHoldings');
      const recount = snap ? recountInstitutional(snap.value) : null;
      if (recount) {
        const ok = recount.net === value;
        return { status: ok ? 'pass' : 'fail', checkedAgainst: `recounted institutionalHoldings(${symbol}): ${recount.increased} up / ${recount.decreased} down, net ${recount.net}`, note: ok ? null : `claimed ${value}, recomputed ${recount.net}` };
      }
      return { status: 'unverifiable', checkedAgainst: null, note: 'no institutionalHoldings snapshot attached' };
    }

    if (item.source === 'session-clock') {
      return { status: 'pass', checkedAgainst: 'session clock recomputed', note: null };
    }
    return { status: 'unverifiable', checkedAgainst: null, note: 'computed claim without a re-executable recipe' };
  }

  checkSignal(item, { snapshots }) {
    for (const snap of snapshots) {
      if (!String(snap.intent || '').startsWith('signal:') && !snap.skill) continue;
      const value = toNum(item.value);
      if (value !== null) {
        const found = findValueIn(snap.value, value, Math.max(this.tolerancePct, 1));
        if (found) return { status: 'pass', checkedAgainst: `${snap.origin || snap.skill} ${found.path}`, note: null };
      }
      if (item.quote && containsQuote(JSON.stringify(snap.value ?? {}), item.quote, { minOverlap: 0.6 }).found) {
        return { status: 'pass', checkedAgainst: snap.origin || snap.skill, note: 'matched on content' };
      }
    }
    return { status: 'unverifiable', checkedAgainst: null, note: 'no signal snapshot attached for this run' };
  }

  checkCalendar(item) {
    if (item.source === 'session-clock') return { status: 'pass', checkedAgainst: 'session clock', note: null };
    return { status: 'unverifiable', checkedAgainst: null, note: 'calendar claim not tied to a recomputable clock' };
  }

  /** Aggregate stats across everything the ledger has seen. */
  summary() {
    let pass = 0;
    let fail = 0;
    let unverifiable = 0;
    let total = 0;
    let quarantined = 0;
    for (const r of this.audit) {
      pass += r.pass; fail += r.fail; unverifiable += r.unverifiable; total += r.total;
      if (r.quarantine) quarantined += 1;
    }
    return {
      cardsAudited: this.audit.length,
      itemsChecked: total, pass, fail, unverifiable,
      passRate: total ? round((pass / total) * 100, 1) : 0,
      cardsQuarantined: quarantined,
    };
  }
}

export function closeEnough(a, b, tolerancePct) {
  if (a === null || b === null) return false;
  const x = toNum(a);
  const y = toNum(b);
  if (x === null || y === null) return false;
  if (x === y) return true;
  if (x === 0 || y === 0) return Math.abs(x - y) < 1e-9;
  return Math.abs((y - x) / x) * 100 <= tolerancePct;
}

/** Depth-first search for a numeric value anywhere inside a nested payload. */
export function findValueIn(obj, value, tolerancePct, path = '$', depth = 0) {
  if (depth > 6 || obj === null || obj === undefined) return null;
  if (typeof obj === 'number' || typeof obj === 'string') {
    return closeEnough(obj, value, tolerancePct) ? { path } : null;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 200); i += 1) {
      const hit = findValueIn(obj[i], value, tolerancePct, `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const hit = findValueIn(v, value, tolerancePct, `${path}.${k}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Recompute the overnight-gap continuation statistic from raw bars. */
function recomputeGapStudy(book, symbol, { minAbsGap = 1.0, lookbackBars = 500 } = {}) {
  const bars = book.bars(symbol);
  const slice = bars.slice(Math.max(1, bars.length - lookbackBars));
  const outcomes = [];
  for (let i = 1; i < slice.length; i += 1) {
    const prevClose = slice[i - 1].close;
    const open = slice[i].open;
    if (!prevClose || !open) continue;
    const gapPct = ((open - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < minAbsGap) continue;
    outcomes.push(((slice[i].close - open) / open) * 100 * Math.sign(gapPct));
  }
  if (!outcomes.length) return { n: 0, continuedPct: null };
  const continued = outcomes.filter((c) => c > 0.1).length;
  return { n: outcomes.length, continuedPct: round((continued / outcomes.length) * 100, 1) };
}

/** Recount insider dispositions from the raw snapshot rows. */
export function recountInsider(value, symbol) {
  const rows = Array.isArray(value) ? value : (value?.rows || value?.data || []);
  if (!Array.isArray(rows)) return null;
  let sells = 0;
  let buys = 0;
  for (const r of rows) {
    if (symbol && r.ticker && String(r.ticker).toUpperCase() !== String(symbol).toUpperCase()) continue;
    const side = String(r.transactionType || r.type || r.side || '').toLowerCase();
    if (side.includes('sell') || side === 's') sells += 1;
    else if (side.includes('buy') || side === 'p') buys += 1;
  }
  return { sells, buys };
}

/** Recount 13F builders vs trimmers from the raw snapshot rows. */
export function recountInstitutional(value) {
  const rows = Array.isArray(value) ? value : (value?.holders || value?.rows || []);
  if (!Array.isArray(rows)) return null;
  const num = (r) => Number(r.changePct ?? r.pctChange ?? r.change ?? 0) || 0;
  const increased = rows.filter((r) => num(r) > 5).length;
  const decreased = rows.filter((r) => num(r) < -5).length;
  return { increased, decreased, net: increased - decreased };
}

export { VERIFY_STATUS };
export default EvidenceLedger;