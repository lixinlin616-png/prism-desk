#!/usr/bin/env node
/**
 * Prism Desk CLI.
 *
 * The server and the web UI are the demo surface; this is the same pipeline
 * driven from a terminal, which is how the desk is scripted, tested and
 * reproduced. Every command works with no network access and no npm install.
 *
 *   node prism.mjs ask "the August CPI came in cool on the headline but hot on core - who is most exposed?"
 *   node prism.mjs demo --out=demo-run.md
 *   node prism.mjs board --status=active
 *   node prism.mjs card SIG-XXXX
 *   node prism.mjs study transmission
 *   node prism.mjs doctor
 *   node prism.mjs serve
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from './src/config.mjs';
import { logger } from './src/util/log.mjs';
import { toDateStr } from './src/util/time.mjs';
import { Pipeline } from './src/desk/pipeline.mjs';
import { boardCsv, renderCard } from './src/desk/brief.mjs';
import { CHANNEL_IDS } from './src/schema.mjs';
import { runTransmissionStudy } from './src/research/transmission.mjs';
import { runGapStudy } from './src/research/gap-study.mjs';
import { renderTransmissionReport, renderGapReport } from './src/research/report.mjs';
import { runReview } from './src/review/adjudicate.mjs';
import { renderReviewReport } from './src/review/report.mjs';
import { start as startServer, SCENARIOS } from './server.mjs';
import { SKILL_TRIGGERS } from './src/desk/pipeline.mjs';

const log = logger('cli');

const HELP = `
Prism Desk - information in, falsifiable signals out.

Usage: node prism.mjs <command> [question] [options]

Commands
  serve                     start the HTTP server + web desk (default)
  ask <question>            run one research task and print the brief
  demo [--only=<id>]        run the scripted demo scenarios end to end
  board                     print the signal board
  card <id>                 print one card's full dossier
  brief                     print the most recent brief again
  corpus                    list the documents in scope
  study <transmission|gaps> run a real-price event study
  review                    adjudicate expired cards against what actually happened
  scenarios                 list the demo scenarios
  doctor                    print the data wiring and run a self-test
  help                      this message

Options
  --as-of=<ISO>             freeze the desk clock (reproduces a scenario exactly)
  --channels=<a,b>          restrict to specific channels (${CHANNEL_IDS.join(', ')})
  --tickers=<A,B>           force tickers into the plan
  --limit=<n>               max documents to pull (default 14)
  --json                    emit JSON instead of markdown
  --no-trace                hide the streamed stage trace
  --no-persist              do not write cards to the board state
  --keep-board              demo: append to the persisted board instead of
                            clearing it first (clearing is what makes
                            docs/DEMO-TRANSCRIPT.md byte-reproducible)
  --out=<file>              also write the output to a file
  --status=<s>              board filter: active | quarantined | all
  --report                  print the full markdown review report
  --materiality=<pct>       override the review materiality band (default 1.0)
  --board=<file>            adjudicate a board fixture instead of live state
  --persist                 write review verdicts back onto terminal cards

Environment
  PRISM_DATA_MODE           auto (default) | live | offline
  PRISM_LLM_BASE_URL        OpenAI-compatible endpoint, e.g. the hackathon Qwen gateway
  PRISM_LLM_API_KEY         key for that endpoint
  PRISM_LLM_MODEL           model name (default gpt-4o-mini)
  PRISM_PORT / PRISM_HOST   server bind (default 127.0.0.1:4310)
`;

function parseFlags(argv) {
  const flags = { _: [] };
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) { flags._.push(arg); continue; }
    const raw = m[2];
    // --no-trace means trace=false, not a flag literally named "no-trace".
    const key = m[1].startsWith('no-') && raw === undefined ? m[1].slice(3) : m[1];
    if (raw === undefined) flags[key] = m[1].startsWith('no-') ? false : true;
    else if (raw === 'true') flags[key] = true;
    else if (raw === 'false') flags[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) flags[key] = Number(raw);
    else flags[key] = raw;
  }
  return flags;
}

function asOfFrom(flags) {
  if (!flags['as-of']) return new Date();
  const d = new Date(flags['as-of']);
  if (Number.isNaN(d.getTime())) {
    log.warn(`could not parse --as-of="${flags['as-of']}", falling back to now`);
    return new Date();
  }
  return d;
}

function channelsFrom(flags) {
  if (!flags.channels) return null;
  const want = String(flags.channels).split(',').map((c) => c.trim()).filter(Boolean);
  const valid = want.filter((c) => CHANNEL_IDS.includes(c));
  const bad = want.filter((c) => !CHANNEL_IDS.includes(c));
  if (bad.length) log.warn(`ignoring unknown channel(s): ${bad.join(', ')}`);
  return valid.length ? valid : null;
}

function tickersFrom(flags) {
  if (!flags.tickers) return null;
  return String(flags.tickers).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
}

/** Stream the audit trace to stderr so it never pollutes a piped brief. */
function tracePrinter(enabled) {
  const seen = new Map();
  return (evt) => {
    if (!enabled) return;
    const stage = evt.stage;
    const roll = stage === 'verify' || stage === 'score';
    if (roll) seen.set(stage, (seen.get(stage) || 0) + 1);
    const detail = describe(evt);
    const label = stage.padEnd(20, ' ');
    const suffix = roll && seen.get(stage) > 1 ? `   [${seen.get(stage)} so far]` : '';
    if (roll && seen.get(stage) > 1) process.stderr.write(`\r  ${label}${detail}${suffix}`);
    else process.stderr.write(`\n  ${label}${detail}${suffix}`);
  };
}

function describe(evt) {
  switch (evt.stage) {
    case 'plan': {
      const p = evt.plan || {};
      return `channels ${(p.channels || []).join('/')} | intents ${(p.intents || []).join(',')} | tickers ${(evt.resolvedTickers || []).join(',') || 'none'}`;
    }
    case 'plan:ticker-fallback': return evt.message;
    case 'plan:widened': return evt.message;
    case 'ingest:corpus': return `${evt.count} documents (${(evt.kinds || []).join(', ')})`;
    case 'ingest:data': return evt.message || `${evt.snapshots} snapshots via ${(evt.intents || []).join(',')} [${(evt.origins || []).join('/')}]`;
    case 'extract': return `mode ${evt.mode}, ${evt.cards} candidate cards, trace ${(evt.trace || []).map((t) => `${t.stage}:${t.cards ?? 0}`).join(' -> ')}`;
    case 'verify': return `${evt.title} | pass ${evt.pass} fail ${evt.fail} unverifiable ${evt.unverifiable}${evt.quarantined ? ' | QUARANTINED' : ''}`;
    case 'verify:summary': return `ledger ${evt.itemsChecked} items, pass rate ${evt.passRate}%, ${evt.cardsQuarantined} quarantined`;
    case 'score': return `${evt.title} | ${evt.total}/100 ${evt.grade}${evt.publishable ? '' : ' (below threshold)'}`;
    case 'present': return `published ${evt.published}, quarantined ${evt.quarantined}, below threshold ${evt.belowThreshold}, ${evt.ms}ms`;
    default: return JSON.stringify(evt).slice(0, 160);
  }
}

function emit(text, flags) {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  if (flags.out) {
    const p = resolve(flags.out);
    writeFileSync(p, text, 'utf8');
    log.info(`wrote ${p}`);
  }
}

async function newDesk() {
  const desk = new Pipeline();
  await desk.ready();
  return desk;
}
// ---------------------------------------------------------------------- commands

async function cmdAsk(question, flags) {
  if (!question) { process.stderr.write('ask needs a question, e.g. node prism.mjs ask "full desk sweep"\n'); return 1; }
  const desk = await newDesk();
  const run = await desk.runTask({
    question,
    asOf: asOfFrom(flags),
    channels: channelsFrom(flags),
    tickers: tickersFrom(flags),
    limit: flags.limit ?? 14,
    persist: flags.persist !== false,
    onEvent: tracePrinter(flags.trace !== false),
  });
  if (flags.trace !== false) process.stderr.write('\n\n');
  if (flags.json) emit(JSON.stringify(run, null, 2), flags);
  else emit(run.brief.markdown, flags);
  return 0;
}

async function cmdDemo(flags) {
  const desk = await newDesk();
  /**
   * Start from an empty board, every time.
   *
   * docs/DEMO-TRANSCRIPT.md is a reproducibility claim: the README says a judge
   * can rebuild it byte-for-byte with a bare `node prism.mjs demo`. But the
   * board autosaves to data/state/board.json, so anything run beforehand -
   * `doctor`, `ask`, or simply a second `demo` - leaves cards behind, the board
   * dump at the end of the transcript grows, and the claim silently fails for
   * the one reader most likely to test it. Clearing first makes the command
   * idempotent; --keep-board opts out for anyone who wants to append to a
   * board they built by hand.
   */
  if (flags['keep-board'] !== true) {
    const before = desk.board.status().total;
    desk.board.clear();
    if (before) process.stderr.write(`demo: cleared ${before} persisted card(s) so the transcript starts from an empty board (--keep-board to opt out)\n`);
  }
  const only = flags.only ? String(flags.only).split(',').map((s) => s.trim()) : null;
  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));
  const out = [];
  out.push('# Prism Desk - demo transcript');
  out.push('');
  out.push(`Generated ${new Date().toISOString()} - data mode \`${config.mcp.mode}\`, extractor \`${desk._extractor.mode}\`, LLM ${config.llm.enabled ? config.llm.model : 'not configured (deterministic rule extractor)'}.`);
  out.push('');
  out.push(`Corpus ${desk.hub.corpus.stats().documents} documents / ${desk.hub.corpus.stats().words} words. Price book ${desk.hub.prices.stats().symbols} symbols, ${desk.hub.prices.stats().bars} bars, ${desk.hub.prices.stats().from} to ${desk.hub.prices.stats().to}.`);
  out.push('');

  for (const sc of scenarios) {
    process.stderr.write(`\n=== ${sc.id}: ${sc.label} (${sc.zh}) ===\n${sc.note}\n`);
    // An explicit --as-of always wins; otherwise the scenario's pinned clock.
    // Scenarios are pinned to the bundled data window so that `demo` replays
    // identically whenever a judge runs it (see SCENARIOS in server.mjs).
    const asOf = flags['as-of'] ? asOfFrom(flags) : (sc.asOf ? new Date(sc.asOf) : new Date());
    const run = await desk.runTask({
      question: sc.question,
      asOf,
      channels: sc.channels,
      limit: flags.limit ?? 14,
      persist: flags.persist !== false,
      onEvent: tracePrinter(flags.trace !== false),
    });
    if (flags.trace !== false) process.stderr.write('\n');
    out.push('---');
    out.push('');
    out.push(`## Scenario: ${sc.label} / ${sc.zh}`);
    out.push('');
    out.push(`> ${sc.question}`);
    out.push('');
    out.push(`_as-of ${asOf.toISOString()} - channels ${(run.plan.channels || []).join(', ')} - ${run.ms}ms - extractor ${run.mode}_`);
    out.push('');
    if (sc.note) { out.push(`**What it demonstrates.** ${sc.note}`); out.push(''); }
    out.push(run.brief.markdown);
    out.push('');
    process.stderr.write(`    -> ${run.published.length} published, ${run.quarantined.length} quarantined, ${run.belowThreshold.length} below threshold\n`);
  }

  const board = desk.board.status();
  out.push('---');
  out.push('');
  out.push('## Accumulated board');
  out.push('');
  out.push('```');
  out.push(`total ${board.total} cards | active ${board.byStatus.active ?? 0} | quarantined ${board.byStatus.quarantined ?? 0} | expired ${board.byStatus.expired ?? 0} | conflicts ${board.conflicts} | avg active score ${board.activeAvgScore}`);
  out.push('```');
  out.push('');
  out.push(boardCsv(desk.board.all({ limit: 200 })));
  emit(out.join('\n'), flags);
  return 0;
}

async function cmdBoard(flags) {
  const desk = await newDesk();
  const status = flags.status === 'all' ? null : (flags.status || 'active');
  const cards = desk.board.all({ status, limit: 400 });
  if (flags.json) { emit(JSON.stringify(cards, null, 2), flags); return 0; }
  if (!cards.length) { emit(`No ${status ?? ''} cards on the board. Run \`node prism.mjs demo\` first.`, flags); return 0; }
  const rows = [
    ['score', 'grade', 'channel', 'dir', 'tickers', 'status', 'title'],
    ...cards.map((c) => [
      String(c.score?.total ?? '-'), String(c.score?.grade ?? '-'), c.channel, c.direction,
      (c.tickers || []).join('/') || '-', c.status, (c.title || c.claim || '').slice(0, 72),
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  const out = [line(rows[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.slice(1).map(line), '', `${cards.length} cards | board ${JSON.stringify(desk.board.status())}`];
  emit(out.join('\n'), flags);
  return 0;
}

async function cmdCard(id, flags) {
  if (!id) { process.stderr.write('card needs an id, e.g. node prism.mjs card SIG-XXXX\n'); return 1; }
  const desk = await newDesk();
  const card = desk.board.get(id) ?? desk.runs.flatMap((r) => r.cards).find((c) => c.id === id);
  if (!card) { process.stderr.write(`no card ${id}. Run \`node prism.mjs board --status=all\` to list ids.\n`); return 1; }
  if (flags.json) emit(JSON.stringify(card, null, 2), flags);
  else emit(renderCard(card, { showEvidence: true, showBreakdown: true }), flags);
  return 0;
}

async function cmdBrief(flags) {
  const desk = await newDesk();
  const last = desk.lastRun();
  if (!last) { process.stderr.write('no run in this process. Use `node prism.mjs ask "..."` or `demo`.\n'); return 1; }
  emit(flags.json ? JSON.stringify(last, null, 2) : last.brief.markdown, flags);
  return 0;
}

async function cmdCorpus(flags) {
  const desk = await newDesk();
  const docs = desk.hub.corpus.all();
  if (flags.json) { emit(JSON.stringify(docs.map(({ body, ...rest }) => ({ ...rest, words: String(body || '').split(/\s+/).length })), null, 2), flags); return 0; }
  const out = [`Corpus: ${docs.length} documents, ${desk.hub.corpus.stats().words} words, ${desk.hub.corpus.stats().tickers.join(' ')}`, ''];
  for (const d of docs) {
    out.push(`  ${d.publishedAt?.slice(0, 10) ?? '----------'}  ${d.kind.padEnd(18)}  ${(d.tickers || []).join('/').padEnd(12)}  ${d.synthetic ? '[demo issuer]' : '[real]       '}  ${d.title}`);
  }
  emit(out.join('\n'), flags);
  return 0;
}

async function cmdStudy(kind, flags) {
  const desk = await newDesk();
  const which = (kind || 'transmission').toLowerCase();
  const isGap = which === 'gaps' || which === 'gap';
  const isTransmission = which === 'transmission' || which === 'macro';
  if (!isGap && !isTransmission) {
    process.stderr.write(`unknown study "${which}" - use transmission | gaps\n`);
    return 1;
  }
  const study = isGap ? runGapStudy(desk.hub.prices) : runTransmissionStudy(desk.hub.prices);
  if (flags.json) {
    emit(JSON.stringify(isGap ? study.summary : study, null, 2), flags);
    return 0;
  }
  emit(isGap ? renderGapReport(study) : renderTransmissionReport(study), flags);
  return 0;
}

function cmdScenarios(flags) {
  const out = SCENARIOS.map((s) => `${s.id.padEnd(20)} ${s.label} / ${s.zh}\n${' '.repeat(20)} ${s.note}\n${' '.repeat(20)} channels: ${(s.channels || ['all']).join(', ')}${s.asOf ? ` | as-of ${s.asOf}` : ''}`);
  emit(flags.json ? JSON.stringify(SCENARIOS, null, 2) : out.join('\n\n'), flags);
  return 0;
}

/**
 * Score the board against what actually happened.
 *
 * The board is not a log, it is a set of falsifiable claims whose falsification
 * windows have closed. This command closes the loop the rest of the desk opens:
 * every card said what would prove it wrong, so now we check whether it did.
 */
async function cmdReview(flags) {
  /**
   * --board=<file> adjudicates a committed board fixture instead of whatever
   * runtime state happens to be on disk. data/state/ is gitignored, so on a fresh
   * clone the live board is empty and the review would report nothing at all -
   * which is how docs/reports/review.md would become a claim nobody can check.
   * npm run review:seed passes data/fixtures/board-seed.json here.
   */
  if (flags.board) process.env.PRISM_STATE_FILE = resolve(String(flags.board));
  const desk = await newDesk();
  const bookStats = desk.hub.prices.stats();
  // Default to the end of the price book rather than "now": that is the latest
  // date the bundled data can actually adjudicate, and it keeps the command
  // reproducible instead of drifting with the wall clock.
  const asOf = flags['as-of'] ? asOfFrom(flags) : new Date(`${bookStats.to}T23:59:59Z`);
  const review = runReview({
    board: desk.board,
    book: desk.hub.prices,
    corpus: desk.hub.corpus,
    asOf,
    // Read-only unless asked. A review is an analysis; reclassifying stored
    // cards is a separate, deliberate act, and keeping the default read-only
    // makes `review` idempotent - a judge running it twice gets the same answer.
    persist: flags.persist === true,
    materialityPct: Number.isFinite(flags.materiality) ? Number(flags.materiality) : null,
  });

  if (flags.json) { emit(JSON.stringify(review, null, 2), flags); return 0; }

  const report = renderReviewReport(review);
  if (flags.out) {
    const p = resolve(flags.out);
    writeFileSync(p, report, 'utf8');
    log.info(`wrote ${p}`);
  }
  if (flags.report) { emit(report, { ...flags, out: null }); return 0; }

  const s = review.summary;
  const cal = review.calibration;
  const sev = { blocker: 0, warning: 1, info: 2, ok: 3 };
  const lines = [
    '# Prism Desk - signal review',
    '',
    `adjudicated as of ${toDateStr(asOf)} against ${s.benchmark}; price book ends ${s.priceBookTo}`,
    '',
    `cards            ${s.cardsOnBoard} -> ${s.distinctClaims} distinct claims (${s.restatementsCollapsed} restatements collapsed)`,
    `judged           ${s.distinctClaimsJudged} claims with a closed window (${s.provisionalClaims} still open, not judged)`,
    `decided          ${s.decided} (won ${s.hits} / lost ${s.misses}) | inconclusive ${s.inconclusive}`,
    `hit rate         ${s.hitPct === null ? 'n/a' : `${s.hitPct}%`}${s.hitPctCi95 ? ` (95% CI ${s.hitPctCi95[0]}-${s.hitPctCi95[1]}%)` : ' (n too small for an interval)'}`,
    `signed excess    mean ${s.meanSignedExcessPct}% / median ${s.medianSignedExcessPct}% vs ${s.benchmark}`,
    `falsification    fired ${s.invalidationFired} | untestable (prose only) ${s.invalidationUntestable} | stop touched ${s.stoppedOut}`,
    `not judged       unmeasurable ${s.unmeasurable} | non-directional ${s.notDirectional} | via declared proxy ${s.viaProxy}`,
    `does score rank  rho ${cal.scoreVsOutcomeRho} on n=${cal.n} across ${cal.clusters} information dates`,
    '',
    '## claims',
  ];
  for (const c of review.claims.filter((r) => r.final)) {
    lines.push(`  ${String(c.score ?? '-').padStart(5)} ${c.grade ?? '-'} ${c.channel.padEnd(19)} ${c.direction.padEnd(7)} ${c.outcome.padEnd(15)} xs=${String(c.signedExcessPct ?? '-').padStart(8)}% ${c.symbols.join('/') || '-'} x${c.restatements}`);
  }
  lines.push('', '## findings');
  for (const l of [...review.lessons].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9))) {
    lines.push(`  [${l.severity.toUpperCase().padEnd(7)}] ${l.id}`);
    lines.push(`             ${l.finding}`);
    lines.push(`             -> ${l.action}`);
  }
  lines.push('', 'Full report: node prism.mjs review --report  (or --out=docs/reports/review.md)');
  emit(lines.join('\n'), { ...flags, out: null });
  return 0;
}

async function cmdDoctor(flags) {
  const desk = await newDesk();
  const s = desk.status();
  const hub = s.hub;
  const lines = [
    '# Prism Desk - wiring self-test',
    '',
    `node            ${process.version}`,
    `data mode       ${hub.mode} (PRISM_DATA_MODE=${process.env.PRISM_DATA_MODE || 'unset -> auto'})`,
    `market provider state=${hub.market.state} url=${hub.market.url} liveTools=${hub.market.liveTools} resolved=${hub.market.resolvedIntents}/${hub.market.totalIntents} fixture-backed=${hub.market.fixtures}/${hub.market.totalIntents} intents (pack: ${hub.market.fixtureEntries} entries, ${hub.market.fixtureEntries - hub.market.fixtures} of them signal skills)`,
    hub.market.error ? `market error    ${hub.market.error}` : null,
    `signal skills   ${(hub.signal.skills || []).filter((k) => k.tool).length}/${(hub.signal.skills || []).length} resolved to live tools, ${(hub.signal.skills || []).filter((k) => k.fixture).length} fixture-backed, ${SKILL_TRIGGERS.length}/${(hub.signal.skills || []).length} wired to a channel (state=${hub.signal.state})`,
    `agentkey        state=${hub.chainbase.state} configured=${hub.chainbase.configured} resolved=${hub.chainbase.resolvedIntents}/${hub.chainbase.totalIntents}`,
    hub.chainbase.reason ? `agentkey note   ${hub.chainbase.reason}` : null,
    hub.chainbase.error ? `agentkey error  ${hub.chainbase.error}` : null,
    `corpus          ${hub.corpus.documents} documents, ${hub.corpus.words} words, tickers ${hub.corpus.tickers.join(' ')}`,
    `prices          ${hub.prices.symbols} symbols, ${hub.prices.bars} bars, ${hub.prices.from} to ${hub.prices.to}`,
    `extractor       ${s.extractor?.mode} (LLM ${hub.llm.enabled ? `${hub.llm.model} @ ${hub.llm.baseUrl}` : 'not configured - deterministic rules'})`,
    `ledger          ${s.ledger?.itemsChecked ?? 0} items checked, pass rate ${s.ledger?.passRate ?? 0}%, ${s.ledger?.cardsQuarantined ?? 0} cards quarantined`,
    `board           ${s.board?.total ?? 0} cards (${s.board?.byStatus?.active ?? 0} active), persisted=${s.board?.persisted}`,
    `publish floor   ${config.scoring.minScoreToPublish} / 100`,
    `verify tol      ${config.verify.numericTolerancePct}% relative, strict headline quarantine=${config.verify.quarantineOnHeadlineFailure}`,
    '',
    '## Smoke run',
  ].filter(Boolean);

  const run = await desk.runTask({ question: 'Full desk sweep across every channel', asOf: new Date('2025-09-13T15:00:00Z'), persist: false, onEvent: tracePrinter(flags.trace !== false) });
  if (flags.trace !== false) process.stderr.write('\n');
  const channels = [...new Set(run.cards.map((c) => c.channel))];
  lines.push(
    `cards           ${run.cards.length} (${run.published.length} published, ${run.quarantined.length} quarantined, ${run.belowThreshold.length} below threshold)`,
    `channels fired  ${channels.join(', ')}`,
    `ledger          ${run.ledger.itemsChecked} items, pass ${run.ledger.pass}, fail ${run.ledger.fail}, unverifiable ${run.ledger.unverifiable}, pass rate ${run.ledger.passRate}%`,
    `documents       ${run.documentsUsed.length} | data snapshots ${run.snapshotsUsed.length}`,
    `elapsed         ${run.ms}ms`,
    '',
    run.published.length && run.ledger.fail === 0 ? 'OK - the desk produced verified, scored, falsifiable cards.' : 'CHECK - see the trace above.',
  );
  emit(lines.join('\n'), flags);
  return run.published.length ? 0 : 1;
}

// ------------------------------------------------------------------------ main

async function main(argv) {
  const flags = parseFlags(argv);
  // --help is consumed by parseFlags as a boolean and never reaches flags._,
  // so check it before the `serve` default; otherwise --help would boot a server.
  if (flags.help) { process.stdout.write(HELP); return 0; }
  const [cmd = 'serve', ...rest] = flags._;
  const question = rest.join(' ').trim();

  switch (String(cmd).toLowerCase()) {
    case 'serve': case 'server': case 'start': await startServer(); return 0;
    case 'ask': case 'q': case 'run': return cmdAsk(question, flags);
    case 'demo': return cmdDemo(flags);
    case 'board': return cmdBoard(flags);
    case 'card': return cmdCard(rest[0], flags);
    case 'brief': return cmdBrief(flags);
    case 'corpus': return cmdCorpus(flags);
    case 'study': case 'research': return cmdStudy(rest[0], flags);
    case 'review': case 'audit': return cmdReview(flags);
    case 'scenarios': cmdScenarios(flags); return 0;
    case 'doctor': case 'status': return cmdDoctor(flags);
    case 'help': case '--help': case '-h': process.stdout.write(HELP); return 0;
    default:
      // No subcommand match: treat the whole thing as a question, which is what
      // a first-time user types.
      if (question) return cmdAsk(`${cmd} ${question}`.trim(), flags);
      process.stdout.write(HELP);
      return 1;
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => { if (code) process.exitCode = code; },
    (err) => { log.error(err.stack || err.message); process.exitCode = 1; },
  );
}

export { main, parseFlags };
