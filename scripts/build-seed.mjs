#!/usr/bin/env node
/**
 * Build the committed board fixture that docs/reports/review.md is made from.
 *
 * The problem this solves: data/state/board.json is gitignored runtime state, so
 * a fresh clone has an EMPTY board and `node prism.mjs review` adjudicates
 * nothing. The review report would then be a claim nobody can reproduce, which
 * is precisely the failure mode this project exists to avoid.
 *
 * So the board the review runs against is a committed fixture, rebuilt from a
 * FIXED replay schedule:
 *
 *   npm run seed          -> data/fixtures/board-seed.json
 *   npm run review:seed   -> docs/reports/review.md, from that fixture
 *
 * Determinism. Every scenario run is given an explicit asOf, so card ids,
 * createdAt, expiresAt and status all derive from the schedule instead of the
 * wall clock. Running this twice yields byte-identical output: savedAt is pinned
 * to the last replay date rather than to Date.now(). Without that pin the
 * fixture changed on every rebuild and the review report with it.
 *
 * The schedule deliberately spans the corpus window (2025-09-05 .. 2025-09-17)
 * and runs past it to the end of the price book (2025-09-30), so most claims
 * have a closed window the bundled real prices can actually adjudicate.
 */

import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../src/desk/pipeline.mjs';
import { SCENARIOS } from '../server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'fixtures', 'board-seed.json');

/** Fixed replay schedule. Changing it changes the review; that is the point. */
const REPLAY_DATES = [
  '2025-09-05T20:00:00Z', // Friday after the US close
  '2025-09-08T12:30:00Z', // Monday mid-session
  '2025-09-10T20:00:00Z',
  '2025-09-12T20:00:00Z',
  '2025-09-13T15:00:00Z', // Saturday - the closed-window scenario's own date
  '2025-09-16T12:30:00Z', // CPI release day, mid-session
  '2025-09-17T18:00:00Z', // FOMC statement day
  '2025-09-19T20:00:00Z', // the as-of used by the validation harness
  '2025-09-23T20:00:00Z',
  '2025-09-26T20:00:00Z',
  '2025-09-30T20:00:00Z', // last bar in the bundled price book
];

async function main() {
  // Offline, and pointed at the fixture rather than the live board, so building
  // the seed cannot corrupt whatever a demo left behind in data/state/.
  process.env.PRISM_DATA_MODE = process.env.PRISM_DATA_MODE || 'offline';
  process.env.PRISM_STATE_FILE = OUT;
  if (existsSync(OUT)) rmSync(OUT);

  const desk = new Pipeline();
  await desk.ready();

  let runs = 0;
  for (const iso of REPLAY_DATES) {
    for (const sc of SCENARIOS) {
      await desk.runTask({
        question: sc.question,
        // Always explicit, and never the scenario's own pinned asOf: replaying
        // every scenario at every schedule date is what gives the review enough
        // closed windows to adjudicate. Falling back to a pin (or to now) would
        // make createdAt depend on when the seed was built, and the whole point
        // is that it must not.
        asOf: new Date(iso),
        channels: sc.channels,
        limit: 14,
        persist: true,
      });
      runs += 1;
    }
  }

  // Pin the one volatile field and record how this file came to exist.
  const rawState = JSON.parse(readFileSync(OUT, 'utf8'));
  const seeded = {
    savedAt: REPLAY_DATES[REPLAY_DATES.length - 1],
    provenance: {
      builtBy: 'scripts/build-seed.mjs',
      dataMode: process.env.PRISM_DATA_MODE,
      extractor: desk._extractor?.mode ?? 'rules',
      replayDates: REPLAY_DATES,
      scenarios: SCENARIOS.map((s) => s.id),
      runs,
      note: 'Committed fixture. node prism.mjs review --board=data/fixtures/board-seed.json reproduces docs/reports/review.md from a fresh clone.',
    },
    cards: rawState.cards,
    history: rawState.history,
  };
  writeFileSync(OUT, JSON.stringify(seeded, null, 2) + '\n', 'utf8');

  const byStatus = {};
  for (const c of seeded.cards) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  process.stdout.write(
    'board seed: ' + OUT + '\n'
    + '  replay dates   ' + REPLAY_DATES.length + ' (' + REPLAY_DATES[0] + ' .. '
    + REPLAY_DATES[REPLAY_DATES.length - 1] + ')\n'
    + '  scenario runs  ' + runs + '\n'
    + '  cards          ' + seeded.cards.length + '\n'
    + '  by status      ' + Object.entries(byStatus).map(([k, v]) => k + '=' + v).join(', ') + '\n'
    + '  history events ' + seeded.history.length + '\n'
    + '\nnext: npm run review:seed\n');
}

main().catch((err) => {
  process.stderr.write(((err && err.stack) || String(err)) + '\n');
  process.exitCode = 1;
});
