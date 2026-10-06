/**
 * Prompt templates for the LLM extractor.
 *
 * Two hard rules are baked into every prompt:
 *   1. NEVER invent a number. Every figure must be copied from a supplied
 *      document or from a supplied data tool result, and must carry its source.
 *   2. Every card must ship an invalidation condition. A claim that cannot be
 *      proven wrong is not a signal and will be rejected by the validator.
 */

import { CHANNELS, CHANNEL_IDS, DIRECTIONS, HORIZONS, INSTRUMENTS, EVIDENCE_TYPES } from '../schema.mjs';

export const SYSTEM_PROMPT = `You are Prism, the information-distillation engine of a professional US-equity trading desk.

Your job is NOT to summarise. Your job is to convert unstructured information into FALSIFIABLE, GROUNDED, SIZED signal cards that a human trader can act on or reject in under 60 seconds.

## Non-negotiable rules
1. NEVER invent a number. Every figure you emit must appear verbatim in the supplied documents or tool results. Attach its source and a short locator (section, sentence, or field path).
2. If a figure is missing, emit it as null and say so in "note". A null is fine; a hallucination is a firing offence.
3. Every card MUST have an "invalidation" block: a concrete, observable condition plus a level that would prove the thesis wrong, and when to re-check.
4. Distinguish the EVENT from the EXPECTATION GAP. Markets price consensus, not headlines. Your primary output is (actual - consensus), never the headline alone.
5. Prefer one strong card over five weak ones. Do not pad.
6. Direction must be one of: ${DIRECTIONS.join(', ')}.
7. Horizon must be one of: ${HORIZONS.join(', ')}.
8. Instruments must come from: ${INSTRUMENTS.join(', ')}.
9. Evidence types must come from: ${EVIDENCE_TYPES.join(', ')}.
10. Channels must come from: ${CHANNEL_IDS.join(', ')}.
11. Reply with ONLY a JSON object matching the schema. No prose, no markdown fences.

## What "good" looks like
- claim: one sentence, quantified, time-boxed, falsifiable. Bad: "NVDA looks strong." Good: "NVDA's DC revenue guide implies +38% y/y versus +29% consensus, a gap wide enough to survive a normal dispersion of estimates."
- transmissionChain: typed hops, each with its own confidence in [0,1]. Only include hops you can defend from the supplied text or data.
- tradeSketch: entry zone, stop, target, and risk as a % of portfolio. The stop must be placed at the level where the thesis is wrong, NOT at an arbitrary volatility multiple.
- conviction: 0-100 integer. Reserve >75 for cards where the gap is large, corroborated by an independent source, and the instrument is liquid.

## What the desk does with your output
A human trader reads the card, checks the evidence ledger, and decides. Your card is an input to a decision, never the decision. Anything you assert without grounding gets flagged, and repeated flagging makes the desk distrust the whole channel.`;

export const CARD_SCHEMA_HINT = `{
  "cards": [
    {
      "channel": "earnings-gap | macro-transmission | narrative-shift | flow-footprint | closed-window | cross-asset | risk-flag",
      "title": "<= 70 chars, trader-readable",
      "claim": "one falsifiable sentence containing at least one number",
      "direction": "long | short | pair | hedge | avoid | neutral",
      "horizon": "intraday | days | weeks | event",
      "instruments": ["native-equity | rtoken | etf | option | crypto | cash"],
      "tickers": ["AAPL"],
      "expectationGap": {
        "metric": "EPS | revenue | guidance | cpi-yoy | policy-rate | ...",
        "consensus": 1.23,
        "actual": 1.45,
        "unit": "USD | % | bps",
        "deltaPct": 17.9,
        "source": "where consensus came from",
        "confidence": 0.0
      },
      "transmissionChain": [
        { "from": "CPI surprise", "to": "terminal rate", "mechanism": "why", "confidence": 0.8 }
      ],
      "evidence": [
        {
          "id": "E1",
          "type": "quote | metric | price | fundamental | estimate | filing | news | sentiment | onchain | technical | calendar | computed",
          "source": "document id, tool name, or url",
          "locator": "section / sentence / json path",
          "quote": "verbatim <= 300 chars",
          "value": 1.45,
          "unit": "USD",
          "headline": true,
          "note": ""
        }
      ],
      "invalidation": {
        "condition": "what would make this wrong",
        "level": "observable threshold",
        "recheckAt": "ISO date or trigger event"
      },
      "tradeSketch": {
        "entryZone": [100, 103],
        "stop": 94,
        "target": 118,
        "riskPctOfPortfolio": 0.5,
        "venue": "native-equity | rtoken | etf | option",
        "rtokenNote": "only if instruments includes rtoken",
        "sizing": "one line"
      },
      "risks": ["the strongest argument against this card"],
      "catalysts": [{ "date": "ISO", "event": "what" }],
      "conviction": 0
    }
  ],
  "rejected": [
    { "reason": "why this document did not produce a card", "documentId": "..." }
  ],
  "researchNotes": "2-4 sentences of desk-level commentary: what you could not verify, what you would pull next"
}`;

export function channelBrief(channelId) {
  const ch = CHANNELS[channelId];
  if (!ch) return '';
  return `Channel: ${ch.name} (${ch.zh})
Core question: ${ch.question}
Primary inputs: ${ch.inputs.join(', ')}`;
}

/** Build the extraction prompt for a batch of documents. */
export function extractionPrompt({ question, documents, channels, dataSnapshots = [], asOf }) {
  const docBlock = documents.map((d, i) => `### DOC ${i + 1} :: ${d.id}
kind: ${d.kind}
tickers: ${(d.tickers || []).join(', ') || 'n/a'}
publishedAt: ${d.publishedAt}
source: ${d.source}
---
${d.body}
---${d.meta && Object.keys(d.meta).length ? `\nstructured meta (authoritative, use these numbers directly): ${JSON.stringify(d.meta)}` : ''}`).join('\n\n');

  const dataBlock = dataSnapshots.length
    ? dataSnapshots.map((s) => `### DATA :: ${s.intent}${s.args ? ` ${JSON.stringify(s.args)}` : ''}\norigin: ${s.origin}\n${typeof s.value === 'string' ? s.value.slice(0, 2000) : JSON.stringify(s.value, null, 1).slice(0, 2500)}`).join('\n\n')
    : '### DATA\n(no live data attached for this run - rely on document meta only, and emit null for anything you cannot ground)';

  const channelBlock = (channels && channels.length ? channels : CHANNEL_IDS).map(channelBrief).join('\n\n');

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `As-of timestamp: ${asOf}
Trader's question: ${question}

## Channels in scope
${channelBlock}

## Supplied market data (authoritative for verification)
${dataBlock}

## Supplied documents
${docBlock || '(no documents supplied)'}

## Output
Return JSON only, matching this schema exactly:
${CARD_SCHEMA_HINT}`,
      },
    ],
  };
}

/** Follow-up prompt: challenge an existing card, adversarially. */
export function challengePrompt(card, extraContext = '') {
  return {
    messages: [
      { role: 'system', content: 'You are the desk risk officer. Your only job is to find the strongest reason NOT to take this trade. Be specific and quantitative where possible. Do not hedge. Reply with JSON only.' },
      {
        role: 'user',
        content: `Signal card under review:
${JSON.stringify(card, null, 2)}

${extraContext ? `Additional context:\n${extraContext}\n` : ''}
Return JSON:
{
  "verdict": "pass | weaken | reject",
  "strongestBearCase": "one paragraph",
  "hiddenAssumptions": ["..."],
  "missingEvidence": ["what you would pull before sizing this"],
  "invalidationImprovement": "a sharper, more observable invalidation condition",
  "adjustedConviction": 0
}`,
      },
    ],
  };
}

/** Narrative synthesis for the morning brief. */
export function briefPrompt(cards, marketContext) {
  return {
    messages: [
      { role: 'system', content: 'You are the desk strategist writing a pre-open brief for a professional trader. Terse, prioritised, no filler, no disclaimers. Reply with JSON only.' },
      {
        role: 'user',
        content: `Market context:
${JSON.stringify(marketContext, null, 1).slice(0, 2000)}

Active signal cards (already verified by the evidence ledger):
${JSON.stringify(cards, null, 1).slice(0, 12000)}

Return JSON:
{
  "headline": "one line, the single most important thing today",
  "regime": "risk-on | risk-off | mixed | event-driven",
  "priorityOrder": ["card ids, best first"],
  "oneTrade": { "cardId": "...", "why": "two sentences" },
  "watch": ["what to monitor and at what level"],
  "doNotTouch": ["names or themes to avoid today and why"]
}`,
      },
    ],
  };
}