#!/usr/bin/env node
/**
 * Replay the two event studies and write their reports.
 *
 *   node scripts/replay.mjs            -> docs/reports/{transmission,gap}-study.md
 *   node scripts/replay.mjs --json     -> docs/reports/studies.json (raw numbers)
 *
 * Everything here runs on the bundled real-price dataset with no network access,
 * so a judge can regenerate every number quoted in the submission from a clean
 * clone. If a number in the docs disagrees with what this script prints, the
 * docs are wrong and this script wins.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.mjs';
import { logger } from '../src/util/log.mjs';
import { PriceBook } from '../src/ingest/prices.mjs';
import { runTransmissionStudy } from '../src/research/transmission.mjs';
import { runGapStudy } from '../src/research/gap-study.mjs';
import { renderTransmissionReport, renderGapReport } from '../src/research/report.mjs';

const log = logger('replay');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'reports');

function main() {
  const asJson = process.argv.includes('--json');
  const started = Date.now();
  const book = new PriceBook(config.paths.prices).load();
  const stats = book.stats();
  log.info(`price book: ${stats.symbols} symbols, ${stats.bars} bars, ${stats.from} to ${stats.to}`);

  const transmission = runTransmissionStudy(book);
  const gaps = runGapStudy(book);

  mkdirSync(OUT, { recursive: true });
  if (asJson) {
    const file = join(OUT, 'studies.json');
    writeFileSync(file, JSON.stringify({
      generatedAt: new Date().toISOString(),
      priceBook: stats,
      transmission: { summary: transmission.summary, results: transmission.results },
      gaps: { summary: gaps.summary },
    }, null, 2), 'utf8');
    log.info(`wrote ${file}`);
    return;
  }

  const t = join(OUT, 'transmission-study.md');
  const g = join(OUT, 'gap-study.md');
  writeFileSync(t, renderTransmissionReport(transmission), 'utf8');
  writeFileSync(g, renderGapReport(gaps), 'utf8');

  const ts = transmission.summary;
  const gs = gaps.summary;
  process.stdout.write(`
Replayed both studies in ${Date.now() - started}ms.

Transmission  ${ts.scored}/${ts.events} events | mean rho ${ts.meanSpearman} | t ${ts.tStat} | rho>0 ${ts.positiveRhoPct}%
              large surprises rho ${ts.bySurpriseSize.large.meanSpearman} vs medium ${ts.bySurpriseSize.medium.meanSpearman}
              spread ${ts.meanSpreadPct}% mean, direction correct ${ts.spreadHitRatePct}%
Gaps          ${gs.gaps} gaps / ${gs.symbols} symbols / ${gs.from} to ${gs.to}
              continued ${gs.overall.continuedPct}% | reverted ${gs.overall.revertedPct}%
              excess fwd5 ${gs.overall.excessDateClustered.fwd5.mean}% (clustered t ${gs.overall.excessDateClustered.fwd5.t}, naive t ${gs.overall.excessVsBenchmark.fwd5.t})
              Monday up-gap continuation ${gs.mondayGaps.upGaps?.continuedPct}% vs weekday ${gs.otherWeekdayGaps.upGaps?.continuedPct}%

Reports:
  ${t}
  ${g}
`);
}

main();