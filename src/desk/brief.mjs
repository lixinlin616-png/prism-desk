/**
 * Presentation layer: turns a set of verified, scored cards into the artifacts
 * a trader actually consumes - a pre-open brief, a card dossier, and exports.
 */

import { CHANNELS } from '../schema.mjs';
import { fmtPct, round } from '../util/num.mjs';
import { fmtClock } from '../util/time.mjs';
import { toCsv } from '../util/csv.mjs';

function badge(direction) {
  return { long: 'LONG', short: 'SHORT', pair: 'PAIR', hedge: 'HEDGE', avoid: 'AVOID', neutral: 'WATCH' }[direction] || String(direction).toUpperCase();
}

/** One card as a markdown block - the unit everything else is built from. */
export function renderCard(card, { showEvidence = true, showBreakdown = false } = {}) {
  const L = [];
  const ch = CHANNELS[card.channel] || { name: card.channel, zh: '' };
  L.push(`### ${badge(card.direction)} · ${card.title || card.claim}`);
  L.push(`\`${card.id}\` · ${ch.name} (${ch.zh}) · score **${card.score?.total ?? 'n/a'}/100** (${card.score?.grade ?? '-'}) · conviction ${card.conviction} · horizon ${card.horizon} · tickers ${(card.tickers || []).join(', ') || 'n/a'}`);
  L.push('');
  L.push(`**Claim.** ${card.claim}`);
  if (card.expectationGap) {
    const g = card.expectationGap;
    const bits = [`metric ${g.metric ?? 'n/a'}`, `consensus ${g.consensus ?? 'n/a'}`, `actual ${g.actual ?? 'n/a'}`];
    if (g.deltaPct !== null && g.deltaPct !== undefined) bits.push(`gap ${fmtPct(g.deltaPct, 2)}`);
    if (g.sigma !== null && g.sigma !== undefined) bits.push(`${round(g.sigma, 2)} sigma`);
    if (g.guidanceStance) bits.push(`guidance ${g.guidanceStance}`);
    L.push('');
    L.push(`**Expectation gap.** ${bits.join(' · ')}`);
  }
  if (card.transmissionChain?.length) {
    L.push('');
    L.push('**Transmission chain.**');
    card.transmissionChain.forEach((h, i) => {
      L.push(`${i + 1}. \`${h.from}\` → \`${h.to}\` — ${h.mechanism} _(confidence ${round(h.confidence ?? 0.5, 2)}${h.measuredBy ? `, measured by ${h.measuredBy}` : ''})_`);
      if (h.topExposed?.length) L.push(`   - most exposed: ${h.topExposed.join(', ')}`);
    });
  }
  if (card.tradeSketch) {
    const ts = card.tradeSketch;
    L.push('');
    const parts = [];
    if (ts.pair) parts.push(`pair long ${ts.pair.long} / short ${ts.pair.short}`);
    if (ts.entryZone) parts.push(`entry ${Array.isArray(ts.entryZone) ? ts.entryZone.join('-') : ts.entryZone}`);
    if (ts.stop !== null && ts.stop !== undefined) parts.push(`stop ${ts.stop}`);
    if (ts.target !== null && ts.target !== undefined) parts.push(`target ${ts.target}`);
    if (ts.riskPctOfPortfolio) parts.push(`risk ${ts.riskPctOfPortfolio}% of portfolio`);
    if (ts.venue) parts.push(`venue ${ts.venue}`);
    L.push(`**Trade sketch.** ${parts.join(' · ') || 'structure only'}`);
    if (ts.sizing) L.push(`- sizing: ${ts.sizing}`);
    if (ts.rtokenNote) L.push(`- rToken: ${ts.rtokenNote}`);
  }
  if (card.invalidation?.condition) {
    L.push('');
    L.push(`**What would make this wrong.** ${card.invalidation.condition}${card.invalidation.level ? ` Observable level: \`${card.invalidation.level}\`.` : ''}${card.invalidation.recheckAt ? ` Recheck: ${card.invalidation.recheckAt}.` : ''}`);
  }
  if (card.risks?.length) {
    L.push('');
    L.push('**Bear case.**');
    for (const r of card.risks) L.push(`- ${r}`);
  }
  if (showEvidence && card.evidence?.length) {
    L.push('');
    L.push('**Evidence ledger.**');
    for (const e of card.evidence) {
      const mark = { pass: '✅', fail: '❌', unverifiable: '⚠️', pending: '⏳' }[e.verified] || '·';
      L.push(`- ${mark} \`${e.id}\` ${e.type}${e.headline ? ' (headline)' : ''} — ${e.source}${e.locator ? ` @ ${e.locator}` : ''}`);
      if (e.quote) L.push(`  > ${String(e.quote).slice(0, 300)}`);
      if (e.checkedAgainst) L.push(`  - checked against: ${e.checkedAgainst}`);
      if (e.note) L.push(`  - note: ${e.note}`);
    }
  }
  if (showBreakdown && card.scoreBreakdown) {
    L.push('');
    L.push('**Score breakdown.**');
    L.push('| factor | score | weight | contribution | why |');
    L.push('|---|---:|---:|---:|---|');
    for (const [f, b] of Object.entries(card.scoreBreakdown)) {
      L.push(`| ${f} | ${b.score} | ${b.weight} | ${b.contribution} | ${String(b.reason).replace(/\|/g, '/')} |`);
    }
    for (const p of card.score?.penalties || []) L.push(`| penalty | -${p.amount} | — | -${p.amount} | ${p.reason.replace(/\|/g, '/')} |`);
  }
  if (card.conflicts?.length) {
    L.push('');
    L.push('**Conflicts.**');
    for (const c of card.conflicts) L.push(`- ${c.type}: ${c.detail}${c.resolution ? ` → ${c.resolution}` : ''}`);
  }
  L.push('');
  L.push(`_expires ${fmtClock(card.expiresAt)} · extractor ${card.provenance?.extractor}${card.provenance?.llmModel ? ` (${card.provenance.llmModel})` : ''} · sources ${(card.provenance?.documents || []).join(', ') || 'n/a'}_`);
  return L.join('\n');
}

/** The pre-open brief: headline, ranked cards, what to watch, what to skip. */
export function renderBrief({ cards, quarantined = [], belowThreshold = [], context = {}, ledger = {}, coverage = null }) {
  const L = [];
  const session = context.session || {};
  L.push(`# Prism Desk brief`);
  L.push('');
  L.push(`**As of** ${fmtClock(context.asOf)} · **US cash session** ${session.state || 'unknown'}${session.reason ? ` (${session.reason})` : ''} · **data** ${context.dataMode || 'n/a'} · **extractor** ${context.llm?.available ? `hybrid (${context.llm.model})` : 'deterministic rules'}`);
  if (context.question) L.push(`**Question** ${context.question}`);
  L.push('');

  const plan = context.plan || null;
  if (plan?.offDomain) {
    L.push('## Outside what this desk covers');
    L.push('');
    L.push('I could not map that to an issuer, an event or any of the seven research channels, so I will not dress a seven-channel scan up as an answer. Prism covers US-equity and tokenized-equity research - earnings expectation gaps, macro transmission, insider and 13F flows, the weekend rToken window, narrative shifts and risk flags. Try one of:');
    L.push('');
    L.push('- `Walk me through the earnings expectation gaps in scope.`');
    L.push('- `The August CPI came in cool - map the transmission and who is most exposed.`');
    L.push('- `Any insider selling clusters or 13F changes I should know about?`');
    L.push('- `周末休市期间 rToken 怎么定价？`');
    L.push('');
    L.push('A clearly-labelled scan of what is currently in scope follows anyway, so the question is not answered with silence.');
    L.push('');
  } else if (plan?.widened) {
    L.push('## How I read this question');
    L.push('');
    L.push('No channel keyword matched, so the desk opened all seven and let the corpus decide. **Read what follows as a scan of what is currently in scope, not as an answer to a specific ask.** Name a ticker, an event or a channel (earnings / CPI / insider flows / weekend rToken window / risk) and the desk will narrow to it.');
    L.push('');
  }
  if (plan?.intentsMissing?.length) {
    L.push('## Data I asked for and did not get');
    L.push('');
    for (const m of plan.intentsMissing) L.push(`- ⚠️ \`${m.intent}\` — ${m.reason}`);
    const missingSkills = (plan.skills || []).filter((s) => !s.served);
    for (const s of missingSkills) L.push(`- ⚠️ bitget-signal \`${s.skill}\` — ${s.reason}`);
    L.push('');
    L.push('Cards below are built from what *did* arrive. Nothing here was filled in to cover a gap.');
    L.push('');
  }

  if (coverage?.silent?.length) {
    const noDocs = coverage.noDocuments ?? [];
    const readButSilent = coverage.readButSilent ?? coverage.silent.filter((t) => !noDocs.includes(t));
    L.push('## Asked about, but silent');
    L.push('');
    if (noDocs.length) {
      L.push(`**${noDocs.join(', ')}** - the corpus in scope holds no document naming ${noDocs.length === 1 ? 'it' : 'them'}, so nothing was read and nothing can be said. That is a coverage gap, not a verdict on the name. Paste a document (\`POST /api/corpus\`) or run against live data, then ask again.`);
      L.push('');
    }
    if (readButSilent.length) {
      L.push(`No card was produced for **${readButSilent.join(', ')}**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.`);
      L.push('');
    }
  }

  if (!cards.length) {
    L.push('## Nothing tradeable');
    L.push('');
    L.push('No card cleared both the evidence ledger and the publish threshold. That is a result, not a failure - the desk would rather show you an empty board than a fabricated one.');
    if (quarantined.length) {
      L.push('');
      L.push(`### Quarantined (${quarantined.length})`);
      for (const c of quarantined) L.push(`- ❌ \`${c.id}\` ${c.title} — headline evidence failed verification`);
    }
    if (belowThreshold.length) {
      L.push('');
      L.push(`### Below threshold (${belowThreshold.length})`);
      for (const c of belowThreshold) L.push(`- ⏸ \`${c.id}\` ${c.title} — score ${c.score?.total ?? c.conviction}`);
    }
    return finish(L, ledger, context, coverage);
  }

  const top = cards[0];
  L.push('## Headline');
  L.push('');
  L.push(`**${top.title || top.claim}** — ${badge(top.direction)}, score ${top.score?.total}/100.`);
  L.push('');

  const byChannel = new Map();
  for (const c of cards) {
    if (!byChannel.has(c.channel)) byChannel.set(c.channel, []);
    byChannel.get(c.channel).push(c);
  }

  L.push('## Ranked cards');
  L.push('');
  L.push('| # | direction | channel | tickers | score | grade | horizon | verified |');
  L.push('|---:|---|---|---|---:|---|---|---|');
  cards.forEach((c, i) => {
    const ch = CHANNELS[c.channel]?.zh || c.channel;
    L.push(`| ${i + 1} | ${badge(c.direction)} | ${ch} | ${(c.tickers || []).join(' ')} | ${c.score?.total ?? '-'} | ${c.score?.grade ?? '-'} | ${c.horizon} | ${round((c.verification?.passRate ?? 0), 0)}% |`);
  });
  L.push('');

  L.push('## Dossiers');
  for (const c of cards.slice(0, 6)) {
    L.push('');
    L.push(renderCard(c, { showEvidence: true, showBreakdown: cards.indexOf(c) === 0 }));
    L.push('');
    L.push('---');
  }

  if (quarantined.length) {
    L.push('');
    L.push('## Quarantined by the evidence ledger');
    L.push('');
    L.push('These cards were produced by an extractor but a headline claim could not be grounded in a document or a data snapshot. They are shown, not hidden, so you can see what the desk refused to believe.');
    L.push('');
    for (const c of quarantined) L.push(`- ❌ \`${c.id}\` **${c.title}** — ${c.claim?.slice(0, 160)}`);
  }

  if (belowThreshold.length) {
    L.push('');
    L.push('## Below publish threshold');
    L.push('');
    for (const c of belowThreshold) L.push(`- ⏸ \`${c.id}\` ${c.title} — score ${c.score?.total ?? '-'} (${c.score?.grade ?? '-'})`);
  }

  const conflicts = cards.filter((c) => (c.conflicts || []).length);
  if (conflicts.length) {
    L.push('');
    L.push('## Open conflicts');
    L.push('');
    for (const c of conflicts) for (const x of c.conflicts) L.push(`- ⚠️ ${x.detail}`);
  }

  return finish(L, ledger, context, coverage);
}

function finish(L, ledger, context, coverage) {
  L.push('');
  L.push('## Ledger');
  L.push('');
  L.push(`Items checked ${ledger.itemsChecked ?? 0} · pass ${ledger.pass ?? 0} · fail ${ledger.fail ?? 0} · unverifiable ${ledger.unverifiable ?? 0} · pass rate ${ledger.passRate ?? 0}% · cards quarantined ${ledger.cardsQuarantined ?? 0}`);
  L.push('');
  L.push('_Prism produces research inputs. A human takes the trade._');
  return {
    markdown: L.join('\n'),
    generatedAt: new Date().toISOString(),
    context,
    ledger,
    coverage: coverage ?? null,
  };
}

/** Flat CSV of the board - what you paste into a spreadsheet or a review deck. */
export function boardCsv(cards) {
  return toCsv(cards.map((c) => ({
    id: c.id,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    status: c.status,
    channel: c.channel,
    direction: c.direction,
    horizon: c.horizon,
    tickers: (c.tickers || []).join(' '),
    instruments: (c.instruments || []).join(' '),
    score: c.score?.total ?? '',
    grade: c.score?.grade ?? '',
    conviction: c.conviction ?? '',
    verifiedPct: c.verification?.passRate ?? '',
    quarantined: c.verification?.quarantined ? 'yes' : 'no',
    gapMetric: c.expectationGap?.metric ?? '',
    gapDeltaPct: c.expectationGap?.deltaPct ?? '',
    gapSigma: c.expectationGap?.sigma ?? '',
    extractor: c.provenance?.extractor ?? '',
    claim: c.claim ?? '',
    invalidation: c.invalidation?.condition ?? '',
    conflicts: (c.conflicts || []).length,
  })), undefined);
}

export function cardJson(card) {
  return JSON.stringify(card, null, 2);
}

export default renderBrief;