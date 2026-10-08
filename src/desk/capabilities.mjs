/**
 * The ONE builder for the /api/capabilities payload.
 *
 * server.mjs and scripts/export-static.mjs used to each hand-roll this object.
 * They drifted: the published GitHub Pages demo - the artefact a judge actually
 * opens - shipped a capabilities payload with no `fixture`, no `wired` and no
 * `invokedBy`, so its left rail read "signal skills 0/5" while the live backend
 * told the truth, and the optional AgentKey source was invisible entirely. Two
 * copies of one payload is how a demo comes to contradict the repo it was
 * exported from, so there is now exactly one, and a test compares the recorded
 * bundle against it.
 *
 * Every field here is a statement about wiring, not about aspiration:
 *   resolved   -> a live tool name this intent/skill actually mapped to
 *   fixture    -> bundled offline data exists, so it answers with no network
 *   wired      -> some channel really calls this skill (SKILL_TRIGGERS is the
 *                 single source of truth shared with the ingest loop)
 *   invokedBy  -> which channels call it, so "5 skills" can be audited
 */

import { CHANNELS, CHANNEL_IDS } from '../schema.mjs';
import { INTENTS, INTENT_DOCS } from '../ingest/bitget-market.mjs';
import { SIGNAL_SKILLS, SIGNAL_SKILL_IDS } from '../ingest/bitget-signal.mjs';
import { AGENTKEY_INTENTS, AGENTKEY_INTENT_DOCS } from '../ingest/chainbase.mjs';
import { SKILL_TRIGGERS } from './pipeline.mjs';

/**
 * @param {import('../ingest/index.mjs').DataHub} hub
 * @returns {object} the /api/capabilities body
 */
export function capabilitiesPayload(hub) {
  const provenance = hub.market.provenance?.() ?? {};
  const provenanceSummary = hub.market.provenanceSummary?.() ?? null;
  return {
    ok: true,
    channels: CHANNEL_IDS.map((id) => ({ id, ...CHANNELS[id] })),
    intents: INTENTS.map((id) => {
      const prov = provenance[id] ?? null;
      return {
        id,
        description: INTENT_DOCS[id],
        resolved: hub.market.resolution.get(id) ?? null,
        fixture: hub.market.fixtures.has(id),
        // `fixture: false` used to be the entire statement, which read as "not
        // wired" for ten intents and hid the two that are computed from real
        // data. This is the whole statement now.
        provenance: prov?.kind ?? 'unserved',
        source: prov?.source ?? null,
        synthetic: prov?.synthetic ?? null,
        detail: prov?.detail ?? null,
      };
    }),
    intentProvenance: provenanceSummary,
    skills: SIGNAL_SKILL_IDS.map((id) => {
      const trigger = SKILL_TRIGGERS.find((t) => t.skill === id) ?? null;
      return {
        id,
        ...SIGNAL_SKILLS[id],
        resolved: hub.signal.resolution.get(id) ?? null,
        fixture: hub.signal.fixtures.has(`signal:${id}`),
        wired: Boolean(trigger),
        invokedBy: trigger ? trigger.channels : [],
        why: trigger ? trigger.why : 'declared by bitget-signal but not called by any channel yet',
      };
    }),
    // Optional external partner source, reported with its real state so a judge
    // can tell "wired and serving" from "configured but no key" from "absent".
    agentKey: {
      provider: 'chainbase-agentkey',
      state: hub.chainbase.state,
      configured: hub.chainbase.configured,
      reason: hub.chainbase.reason ?? null,
      intents: AGENTKEY_INTENTS.map((id) => ({
        id,
        description: AGENTKEY_INTENT_DOCS[id],
        resolved: hub.chainbase.resolution.get(id) ?? null,
      })),
    },
    corpus: hub.corpus.stats(),
    prices: hub.prices.stats(),
  };
}

export default capabilitiesPayload;
