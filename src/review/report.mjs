/**
 * Markdown renderer for the post-hoc review.
 *
 * Same discipline as the two event studies: one renderer, used by the CLI
 * (`node prism.mjs review`), the API (`GET /api/export/review.md`) and the
 * generated report under docs/reports/, so the three can never drift apart.
 * Every number in the report comes from here.
 */

import { round } from '../util/num.mjs';
import { toDateStr } from '../util/time.mjs';
import { GRADE_BANDS } from './adjudicate.mjs';

const pct = (v, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : `${round(v, dp)}%`);
const num = (v, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : `${round(v, dp)}`);
const OUTCOME_ICON = {
  realized: 'WON',
  invalidated: 'LOST',
  inconclusive: 'flat',
  provisional: 'open',
  unmeasurable: 'n/m',
  'not-directional': 'n/d',
};
const icon = (o) => OUTCOME_ICON[o] ?? o;

export function renderReviewReport(review) {
  const s = review.summary;
  const cal = review.calibration;
  const L = [];

  L.push('# Signal review - what the desk actually got right');
  L.push('');
  L.push(`Generated ${s.generatedAt} by \`node prism.mjs review\`. Adjudicated as of ${s.asOf} against the bundled real-price dataset; no network access required to reproduce.`);
  L.push('');

  L.push('## Question');
  L.push('');
  L.push('Prism publishes falsifiable cards: each one names the condition that would prove it wrong, an observable level, and a recheck time. While a card is live those fields are a promise. **Once the window closes they are a test, and the test can be scored.** This report scores it.');
  L.push('');
  L.push('It answers two questions that are usually blurred together:');
  L.push('');
  L.push('1. **Was the call right?** Did the claim survive its own falsification condition, and did the name move in the claimed direction by a material amount relative to the benchmark?');
  L.push('2. **Does the rubric rank?** Is a higher score associated with a better realised outcome? If it is not, the five-factor weighting is decoration and should be changed.');
  L.push('');

  L.push('## Method');
  L.push('');
  L.push(`- **Three axes, never merged.** (1) *Falsification* - did a close cross the numeric level the card itself named, by its own recheck date, and stay there? (2) *Risk path* - was the tradeSketch stop or target touched en route? (3) *Realised* - signed benchmark-excess return over the card's own window. The verdict comes from (1) when it fired, otherwise from (3). Axis (2) is always reported and never decides anything, because "would this trade have hurt" is not "was the claim right".`);
  L.push(`- **Anchored on issuance, not on the information date.** Every level a card carries is struck off the price at \`createdAt\`, so the measurement window starts there. Measuring from \`informationAt\` instead would judge a card against a reference price outside its own window.`);
  L.push(`- **Benchmark-excess, never raw.** Every move is measured against ${s.benchmark} over the identical window, so a rising tape is not mistaken for skill. Dollar-neutral pairs are measured as a raw spread, where the benchmark cancels by construction.`);
  L.push(`- **Restatements collapsed.** The board re-issues the same claim on every run, so ${s.adjudicated} stored cards are ${s.distinctClaims} distinct claims (${s.restatementsCollapsed} restatements collapsed). Statistics are computed on distinct claims; counting restatements separately would produce a hit rate with three significant figures and no meaning.`);
  L.push(`- **Materiality band.** A window closing inside +/-${s.materialityPct}% signed excess is reported \`inconclusive\`, not forced into a win/loss column.`);
  L.push(`- **Pessimistic tie-break = ${s.pessimisticTieBreak}.** When one daily bar touches both stop and target, daily OHLC cannot order intraday events, so the stop is assumed to have been hit first. This biases the hit rate DOWN.`);
  L.push('- **Unmeasurable is a verdict, not a gap.** A card citing a name with no price series is reported `unmeasurable`. It is never counted as a win, a loss, or quietly dropped.');
  L.push('');

  L.push('## Headline');
  L.push('');
  L.push('| statistic | value |');
  L.push('| --- | ---: |');
  L.push(`| cards on the board | ${s.cardsOnBoard} |`);
  L.push(`| distinct claims | ${s.distinctClaims} |`);
  L.push(`| claims whose window has closed | ${s.distinctClaimsJudged} |`);
  L.push(`| claims still open (provisional, not judged) | ${s.provisionalClaims} |`);
  L.push(`| judged | ${s.scored} |`);
  L.push(`| decided (won / lost) | **${s.decided}** |`);
  L.push(`| won | ${s.hits} |`);
  L.push(`| lost | ${s.misses} |`);
  L.push(`| inconclusive (inside the materiality band) | ${s.inconclusive} |`);
  L.push(`| **hit rate** | **${pct(s.hitPct)}**${s.hitPctCi95 ? ` (Wilson 95% CI ${s.hitPctCi95[0]}-${s.hitPctCi95[1]}%${s.hitPctCi95ClopperPearson ? `; exact Clopper-Pearson ${s.hitPctCi95ClopperPearson[0]}-${s.hitPctCi95ClopperPearson[1]}%` : ''})` : ' (n too small for an interval)'} |`);
  L.push(`| mean signed benchmark-excess | ${pct(s.meanSignedExcessPct, 3)} |`);
  L.push(`| median signed benchmark-excess | ${pct(s.medianSignedExcessPct, 3)} |`);
  L.push(`| falsification condition fired | ${s.invalidationFired} |`);
  L.push(`| falsification stated in prose only (untestable) | ${s.invalidationUntestable} |`);
  L.push(`| stop touched during the window | ${s.stoppedOut} |`);
  L.push(`| unmeasurable (no price series) | ${s.unmeasurable} |`);
  L.push(`| non-directional (neutral / hedge) | ${s.notDirectional} |`);
  L.push(`| measured through a declared demo proxy | ${s.viaProxy} |`);
  L.push(`| Spearman rho, score vs realised excess | **${num(cal.scoreVsOutcomeRho, 3)}** (n=${cal.n}) |`);
  L.push('');

  L.push('## Calibration - does the score rank?');
  L.push('');
  L.push(`Measured on ${cal.n} claims with a finite realised excess, drawn from ${cal.clusters} distinct information dates. **Those claims are not independent observations** - they share documents, dates and a benchmark - so every figure below is descriptive. Read the shape, not the decimals.`);
  L.push('');
  L.push('### By score band');
  L.push('');
  L.push('| grade | band | claims | decided | won | hit rate | mean signed excess |');
  L.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const b of GRADE_BANDS) {
    const g = cal.byGrade[b.grade];
    if (!g) continue;
    L.push(`| ${b.grade} | ${g.band} | ${g.rows} | ${g.decided} | ${g.hits} | ${pct(g.hitPct)} | ${pct(g.meanSignedExcessPct, 3)} |`);
  }
  L.push('');
  L.push('### By channel');
  L.push('');
  L.push('| channel | claims | decided | won | hit rate | mean signed excess |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [k, v] of Object.entries(cal.byChannel).sort((a, b) => b[1].rows - a[1].rows)) {
    L.push(`| ${k} | ${v.rows} | ${v.decided} | ${v.hits} | ${pct(v.hitPct)} | ${pct(v.meanSignedExcessPct, 3)} |`);
  }
  L.push('');
  L.push('### By direction');
  L.push('');
  L.push('| direction | claims | decided | won | hit rate | mean signed excess |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [k, v] of Object.entries(cal.byDirection).sort((a, b) => b[1].rows - a[1].rows)) {
    L.push(`| ${k} | ${v.rows} | ${v.decided} | ${v.hits} | ${pct(v.hitPct)} | ${pct(v.meanSignedExcessPct, 3)} |`);
  }
  L.push('');
  L.push('### Does the publish floor earn its place?');
  L.push('');
  L.push(`| cohort | claims | decided | won | hit rate | mean signed excess |`);
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  L.push(`| published (>= ${review.settings.floor}) | ${cal.published.rows} | ${cal.published.decided} | ${cal.published.hits} | ${pct(cal.published.hitPct)} | ${pct(cal.published.meanSignedExcessPct, 3)} |`);
  L.push(`| held back (< ${review.settings.floor}) | ${cal.withheld.rows} | ${cal.withheld.decided} | ${cal.withheld.hits} | ${pct(cal.withheld.hitPct)} | ${pct(cal.withheld.meanSignedExcessPct, 3)} |`);
  L.push('');

  L.push('## Per-claim audit trail');
  L.push('');
  L.push('Every distinct claim whose window has closed. `xN` is how many stored cards were collapsed into it.');
  L.push('');
  L.push('| score | grade | channel | direction | window | sess | instrument | falsification | risk path | signed excess | verdict | x |');
  L.push('| ---: | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | --- | ---: |');
  for (const c of review.claims.filter((r) => r.final)) {
    const w = c.window ? `${c.window.from} -> ${c.window.to}` : '-';
    L.push(`| ${num(c.score, 1)} | ${c.grade ?? '-'} | ${c.channel} | ${c.direction} | ${w} | ${c.window?.sessions ?? '-'} | ${c.symbols.length ? c.symbols.join('/') : '-'} | ${c.invalidationTriggered === null ? 'untestable' : c.invalidationTriggered ? 'FIRED' : 'held'} | ${c.riskTouch} | ${pct(c.signedExcessPct, 3)} | ${icon(c.outcome)} | x${c.restatements} |`);
  }
  L.push('');
  if (review.provisional.length) {
    L.push(`### Still open (${review.provisional.length})`);
    L.push('');
    L.push('Windows that had not closed at the adjudication date. Shown for completeness; **not** included in any statistic above.');
    L.push('');
    L.push('| score | channel | direction | expires | instrument | interim signed excess |');
    L.push('| ---: | --- | --- | --- | --- | ---: |');
    for (const c of review.provisional) {
      L.push(`| ${num(c.score, 1)} | ${c.channel} | ${c.direction} | ${c.expiresAt ? toDateStr(c.expiresAt) : '-'} | ${c.symbols.length ? c.symbols.join('/') : '-'} | ${pct(c.signedExcessPct, 3)} |`);
    }
    L.push('');
  }

  L.push('## Findings and what to do about them');
  L.push('');
  L.push('Each finding cites the measurement that produced it. Nothing here is applied automatically: changing the rubric in response to a nine-claim sample would be fitting noise, so the findings are written down and left for a human to act on with more data.');
  L.push('');
  const sev = { blocker: 0, warning: 1, info: 2, ok: 3 };
  for (const l of [...review.lessons].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9))) {
    L.push(`### ${l.severity === 'ok' ? '[ok]' : `[${l.severity.toUpperCase()}]`} \`${l.id}\``);
    L.push('');
    L.push(`- **Finding.** ${l.finding}`);
    L.push(`- **Evidence.** \`${l.evidence}\``);
    L.push(`- **Action.** ${l.action}`);
    L.push('');
  }

  L.push('## Caveats, stated plainly');
  L.push('');
  L.push(`- **The sample is tiny.** ${s.decided} decided claims from ${cal.clusters} information dates. The Wilson 95% interval on the hit rate is ${s.hitPctCi95 ? `${s.hitPctCi95[0]}-${s.hitPctCi95[1]}%` : 'not computable at this n'}${s.hitPctCi95ClopperPearson ? ` (exact Clopper-Pearson ${s.hitPctCi95ClopperPearson[0]}-${s.hitPctCi95ClopperPearson[1]}%)` : ''}, which is wider than any effect it could measure. **No conclusion about profitability should be drawn from this report.**`);
  L.push('- **Claims are not independent.** Several come from the same document on the same date, and all share one benchmark and one macro regime. The rho and the hit rate are descriptions of this board, not estimates of a population parameter.');
  L.push('- **Demo issuers are measured through proxies.** Fictional issuers have no listed price; where they declare one, they are measured through that real proxy series, and the substitution is flagged on the row. Those verdicts describe the proxy, not the issuer.');
  L.push('- **Daily bars cannot order intraday events.** Stop-versus-target ties are resolved pessimistically. On intraday data the hit rate would be different, and probably higher.');
  L.push('- **No costs.** Nothing here nets out commission, spread, borrow or slippage, and there is no portfolio-level aggregation. A hit is a direction, not a profit.');
  L.push('- **Unmeasurable claims are a real defect, not a rounding error.** Cards were issued on names the desk cannot later score. That is reported as a finding above because a card that is unfalsifiable in practice is worse than no card.');
  L.push('- **This is not a backtest of the desk.** It audits whether published claims survived their own stated falsification tests over their own stated windows. It does not measure whether trading them would have made money.');
  L.push('');
  return L.join('\n');
}

export default { renderReviewReport };
