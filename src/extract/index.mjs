/**
 * Extraction orchestrator.
 *
 * Prism runs TWO extractors over the same documents and reconciles them:
 *
 *   rules -> deterministic, auditable, always available
 *   llm   -> richer language understanding, but capable of inventing numbers
 *
 * Reconciliation policy:
 *   - The LLM may add narrative, transmission hops, risks and trade structure.
 *   - The LLM may NOT introduce a headline number the rules did not also find.
 *     If it does, the number survives only if the evidence ledger can ground it
 *     in a document or a data snapshot; otherwise the card is quarantined.
 *   - Where both extractors independently reach the same direction on the same
 *     name, corroboration is credited. Where they disagree, the disagreement is
 *     written onto the card as a visible conflict instead of being hidden.
 *
 * This is the whole point of the design: the model gets to be smart, but it
 * never gets to be the only witness.
 */

import { config } from '../config.mjs';
import { logger } from '../util/log.mjs';
import { emptyCard, evidence, validateCard, rebaseCardId, CHANNELS, CHANNEL_IDS, DIRECTIONS, HORIZONS, INSTRUMENTS } from '../schema.mjs';
import { RuleExtractor } from './rules.mjs';
import { LlmClient } from './llm.mjs';
import { extractionPrompt } from './prompts.mjs';
import { round } from '../util/num.mjs';
import { expiryFor, parseDate } from '../util/time.mjs';

const log = logger('extract');

/**
 * Time-stamp every card against the RUN clock, not the wall clock.
 *
 * Two distinct timestamps, because they answer two different questions:
 *
 *   createdAt     when the desk issued the judgement (== the run's as-of).
 *                 Expiry is measured from here: "this view is valid for N hours
 *                 from when I gave it to you".
 *   informationAt when the underlying document was published, clamped to the
 *                 as-of. Freshness decays against here: a card built on a
 *                 ten-day-old release is stale information even though the desk
 *                 only just wrote it down.
 *
 * Before this, cards were stamped with `new Date()` at construction, so freezing
 * the clock with --as-of changed nothing and the freshness factor was a constant
 * for every card in every run - a scored factor that carries no information.
 */
export function stampTime(cards, { asOf, documents = [] }) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const atMs = parseDate(asOf)?.getTime() ?? Date.now();
  for (const card of cards) {
    const sources = [...new Set([
      ...(card.provenance?.documents || []),
      ...(card.evidence || []).map((e) => e.source),
    ])];
    const stamps = sources
      .map((id) => byId.get(id)?.publishedAt)
      .filter(Boolean)
      .map((d) => parseDate(d)?.getTime())
      .filter((ms) => Number.isFinite(ms));
    // Newest source document, but never in the future relative to the run clock.
    const infoMs = stamps.length ? Math.min(Math.max(...stamps), atMs) : atMs;
    card.informationAt = new Date(infoMs).toISOString();
    card.createdAt = new Date(atMs).toISOString();
    card.expiresAt = expiryFor(card.horizon, card.createdAt);
    // The id was minted before the run clock was applied, so it still carries a
    // wall-clock stamp. Re-mint it from createdAt; otherwise the same --as-of
    // replay on a different day yields different ids and nothing downstream -
    // least of all the committed review fixture - is reproducible.
    card.id = rebaseCardId(card.id, card.createdAt);
  }
  return cards;
}

export class Extractor {
  /**
   * @param {object} opts
   * @param {import('../ingest/index.mjs').DataHub} opts.hub
   * @param {LlmClient} [opts.llm]
   * @param {string[]} [opts.universe]
   */
  constructor({ hub, llm, universe } = {}) {
    this.hub = hub;
    this.llm = llm ?? new LlmClient();
    this.rules = new RuleExtractor({ hub, universe });
    this.stats = { runs: 0, ruleCards: 0, llmCards: 0, merged: 0, conflicts: 0, llmFailures: 0 };
  }

  get mode() {
    if (process.env.PRISM_EXTRACTOR === 'rules') return 'rules';
    if (process.env.PRISM_EXTRACTOR === 'llm') return 'llm';
    return this.llm.available ? 'hybrid' : 'rules';
  }

  /**
   * @param {object} p
   * @param {string} p.question      the trader's natural-language ask
   * @param {Array}  p.documents     corpus documents in scope
   * @param {Array}  [p.snapshots]   data provider results already fetched
   * @param {string[]} [p.channels]  restrict to specific channels
   * @param {Date|string} [p.asOf]
   */
  async run({ question, documents, snapshots = [], channels = CHANNEL_IDS, asOf = new Date() }) {
    this.stats.runs += 1;
    const trace = [];
    const asOfIso = asOf instanceof Date ? asOf.toISOString() : asOf;

    // ---- 1. deterministic pass (always runs) -----------------------------
    const ruleCards = this.rules.extractFromDocuments(documents, { asOf: asOfIso, question })
      .filter((c) => channels.includes(c.channel));
    this.stats.ruleCards += ruleCards.length;
    trace.push({ stage: 'rules', cards: ruleCards.length, mode: this.mode });

    // ---- 2. data-driven cards (flow / cross-asset) -----------------------
    const dataCards = (await this.rules.fromDataSnapshots(snapshots, asOfIso)).filter((c) => channels.includes(c.channel));
    trace.push({ stage: 'data-snapshots', cards: dataCards.length });

    // ---- 3. LLM pass (only when credentials exist) -----------------------
    let llmCards = [];
    let llmNotes = null;
    if (this.mode !== 'rules' && documents.length) {
      const relevant = snapshots.filter((s) => documents.some((d) => (d.tickers || []).some((t) => JSON.stringify(s.args ?? {}).includes(t))));
      const prompt = extractionPrompt({
        question,
        documents,
        channels,
        dataSnapshots: [...relevant, ...snapshots].slice(0, 8),
        asOf: asOfIso,
      });
      const res = await this.llm.json(prompt.messages);
      if (res.ok) {
        llmCards = this.hydrate(res.value, { asOf: asOfIso, documents });
        llmNotes = res.value?.researchNotes ?? null;
        trace.push({ stage: 'llm', cards: llmCards.length, model: this.llm.model, rejected: res.value?.rejected ?? [] });
      } else {
        this.stats.llmFailures += 1;
        trace.push({ stage: 'llm', cards: 0, error: res.error });
        log.warn(`LLM extraction unavailable (${res.error}); continuing with rules only`);
      }
    }
    this.stats.llmCards += llmCards.length;

    // ---- 4. reconcile ----------------------------------------------------
    const { cards, reconciliations } = this.reconcile(ruleCards, llmCards, dataCards);
    this.stats.merged += reconciliations.filter((r) => r.action === 'merged').length;
    this.stats.conflicts += reconciliations.filter((r) => r.action === 'conflict').length;
    stampTime(cards, { asOf: asOfIso, documents });
    trace.push({ stage: 'reconcile', cards: cards.length, reconciliations });

    return { cards, trace, llmNotes, mode: this.mode, question, asOf: asOfIso };
  }

  /** Turn raw LLM JSON into schema-valid cards, dropping anything malformed. */
  hydrate(payload, { asOf, documents = [] } = {}) {
    const rawCards = Array.isArray(payload?.cards) ? payload.cards : Array.isArray(payload) ? payload : [];
    const out = [];
    for (const raw of rawCards) {
      if (!raw || typeof raw !== 'object') continue;
      const channel = CHANNEL_IDS.includes(raw.channel) ? raw.channel : null;
      if (!channel) { log.warn(`LLM card dropped: unknown channel "${raw.channel}"`); continue; }
      const direction = DIRECTIONS.includes(raw.direction) ? raw.direction : 'neutral';
      const horizon = HORIZONS.includes(raw.horizon) ? raw.horizon : 'days';
      const instruments = Array.isArray(raw.instruments) ? raw.instruments.filter((i) => INSTRUMENTS.includes(i)) : ['native-equity'];
      const tickers = (Array.isArray(raw.tickers) ? raw.tickers : []).map((t) => String(t).toUpperCase()).filter(Boolean);

      const ev = (Array.isArray(raw.evidence) ? raw.evidence : []).map((e2, i) => evidence({
        id: e2.id || `L${i + 1}`,
        type: e2.type || 'quote',
        source: e2.source || 'llm',
        locator: e2.locator || '',
        quote: String(e2.quote ?? '').slice(0, 600),
        value: e2.value ?? null,
        unit: e2.unit ?? null,
        headline: Boolean(e2.headline),
        note: e2.note || '',
      }));

      const card = emptyCard({
        channel,
        title: String(raw.title || '').slice(0, 120),
        claim: String(raw.claim || ''),
        direction,
        horizon,
        instruments: instruments.length ? instruments : ['native-equity'],
        tickers,
        conviction: Number.isFinite(Number(raw.conviction)) ? Math.round(Number(raw.conviction)) : 0,
        expectationGap: raw.expectationGap && typeof raw.expectationGap === 'object' ? {
          metric: raw.expectationGap.metric ?? null,
          consensus: raw.expectationGap.consensus ?? null,
          actual: raw.expectationGap.actual ?? null,
          unit: raw.expectationGap.unit ?? null,
          deltaPct: raw.expectationGap.deltaPct ?? null,
          sigma: raw.expectationGap.sigma ?? null,
          source: raw.expectationGap.source ?? null,
          confidence: raw.expectationGap.confidence ?? null,
        } : null,
        transmissionChain: Array.isArray(raw.transmissionChain) ? raw.transmissionChain.map((h) => ({
          from: h.from, to: h.to, mechanism: h.mechanism,
          confidence: Number.isFinite(Number(h.confidence)) ? Math.min(1, Math.max(0, Number(h.confidence))) : 0.5,
        })) : [],
        evidence: ev,
        invalidation: raw.invalidation && typeof raw.invalidation === 'object' ? {
          condition: raw.invalidation.condition ?? null,
          level: raw.invalidation.level ?? null,
          recheckAt: raw.invalidation.recheckAt ?? null,
        } : null,
        tradeSketch: raw.tradeSketch && typeof raw.tradeSketch === 'object' ? raw.tradeSketch : null,
        risks: Array.isArray(raw.risks) ? raw.risks.map(String) : [],
        catalysts: Array.isArray(raw.catalysts) ? raw.catalysts : [],
        createdAt: asOf,
        provenance: {
          extractor: 'llm',
          llmModel: this.llm.model,
          documents: documents.map((d) => d.id),
          tools: [],
        },
      });
      out.push(card);
    }
    return out;
  }

  /**
   * Merge rule cards and LLM cards that describe the same thing.
   * Key = channel + sorted tickers.
   */
  reconcile(ruleCards, llmCards, dataCards) {
    const key = (c) => `${c.channel}::${[...(c.tickers || [])].sort().join(',')}`;
    const byKey = new Map();
    const reconciliations = [];

    for (const c of [...ruleCards, ...dataCards]) byKey.set(key(c), { base: c, llm: null });

    for (const lc of llmCards) {
      const k = key(lc);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { base: lc, llm: null });
        reconciliations.push({ key: k, action: 'llm-only', note: 'LLM produced a card the rules did not; it must clear the ledger on its own evidence.' });
        continue;
      }
      existing.llm = lc;
      reconciliations.push({
        key: k,
        action: existing.base.direction === lc.direction ? 'merged' : 'conflict',
        note: existing.base.direction === lc.direction
          ? 'Both extractors agree on direction - corroboration credited.'
          : `Extractors disagree: rules say ${existing.base.direction}, LLM says ${lc.direction}.`,
      });
    }

    const cards = [];
    for (const { base, llm } of byKey.values()) {
      if (!llm) { cards.push(base); continue; }
      cards.push(mergePair(base, llm));
    }
    return { cards, reconciliations };
  }
}

/**
 * Merge a rule card (authoritative numbers) with an LLM card (richer prose).
 * The LLM's numeric fields are only adopted when the rules did not supply them.
 */
export function mergePair(base, llm) {
  const merged = emptyCard({ ...base });
  merged.id = base.id;
  merged.provenance = {
    extractor: 'hybrid',
    llmModel: llm.provenance?.llmModel ?? null,
    documents: [...new Set([...(base.provenance?.documents ?? []), ...(llm.provenance?.documents ?? [])])],
    tools: [...new Set([...(base.provenance?.tools ?? []), ...(llm.provenance?.tools ?? [])])],
  };

  // Numbers: rules win. Prose: LLM wins if it is longer and non-empty.
  merged.expectationGap = base.expectationGap ?? llm.expectationGap ?? null;
  merged.title = base.title || llm.title;
  merged.claim = base.claim || llm.claim;

  if (llm.claim && base.claim && llm.claim !== base.claim) {
    merged.notes = `LLM phrasing: ${llm.claim}`;
  }

  // Transmission chain: prefer the measured one; append unique LLM hops.
  const chain = [...(base.transmissionChain || [])];
  for (const hop of llm.transmissionChain || []) {
    const dup = chain.some((h) => h.to === hop.to && h.mechanism === hop.mechanism);
    if (!dup) chain.push({ ...hop, source: 'llm' });
  }
  merged.transmissionChain = chain;

  // Evidence: union, de-duplicated by (type, source, quote prefix).
  const seen = new Set();
  const ev = [];
  for (const item of [...(base.evidence || []), ...(llm.evidence || [])]) {
    const k = `${item.type}|${item.source}|${String(item.quote || '').slice(0, 60)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ev.push({ ...item, extractor: (base.evidence || []).includes(item) ? 'rules' : 'llm' });
  }
  merged.evidence = ev;

  // Direction conflicts stay visible instead of being averaged away.
  if (base.direction !== llm.direction) {
    merged.conflicts = [...(base.conflicts || []), {
      type: 'extractor-disagreement',
      detail: `rules -> ${base.direction}; llm -> ${llm.direction}`,
      resolution: 'Kept the deterministic read. The LLM dissent is preserved so the trader can weigh it.',
    }];
    merged.direction = base.direction;
    merged.conviction = Math.max(5, Math.round(((base.conviction || 0) * 0.75) - 6));
  } else {
    merged.conviction = Math.min(95, Math.round(((base.conviction || 0) * 0.8) + ((llm.conviction || 0) * 0.2) + 4));
  }

  merged.risks = [...new Set([...(base.risks || []), ...(llm.risks || [])])];
  merged.catalysts = [...new Set([...(base.catalysts || []), ...(llm.catalysts || [])].map((c) => JSON.stringify(c)))].map((s) => JSON.parse(s));
  merged.tradeSketch = base.tradeSketch || llm.tradeSketch || null;
  merged.invalidation = base.invalidation || llm.invalidation || null;
  merged.horizon = base.horizon || llm.horizon;
  merged.instruments = [...new Set([...(base.instruments || []), ...(llm.instruments || [])])];
  merged.tickers = [...new Set([...(base.tickers || []), ...(llm.tickers || [])])];
  return merged;
}

export { validateCard, CHANNELS, round };
export default Extractor;