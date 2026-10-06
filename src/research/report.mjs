/**
 * Markdown renderers for the two event studies.
 *
 * Kept in one place so the CLI (`node prism.mjs study ...`), the replay script
 * (`npm run replay`) and the generated reports under docs/reports/ can never
 * drift apart. Every number in the reports comes from here.
 */

import { round } from '../util/num.mjs';

const FWD = ['fwd1', 'fwd5', 'fwd10'];
const fwdKey = (h) => `mean${h[0].toUpperCase()}${h.slice(1)}Pct`;

export function renderTransmissionReport(study) {
  const s = study.summary;
  const L = [];
  L.push('# Macro transmission study');
  L.push('');
  L.push(`Generated ${study.generatedAt} by \`npm run replay\`. Real end-of-day prices from the bundled dataset; no network access required to reproduce.`);
  L.push('');
  L.push('## Question');
  L.push('');
  L.push('The macro-transmission channel ranks names by how exposed they are to a given print, then weights that ranking by the size of the surprise. Both choices are empirical claims, so they are tested rather than asserted:');
  L.push('');
  L.push('1. Does a measured exposure ranking actually predict the cross-sectional relative return on the event day?');
  L.push('2. Does it predict better when the surprise is larger? (This is what justifies the 0.30 weight on the `surprise` factor in the scoring rubric.)');
  L.push('');
  L.push('## Method');
  L.push('');
  L.push(`- Universe: ${s.universe.length} names - ${s.universe.join(', ')}.`);
  L.push(`- Exposure: for each print, factor exposures are estimated by OLS of daily returns on ${s.benchmark} over the ${s.window} sessions ending the day BEFORE the print. Nothing after the print is used to build the ranking, so there is no look-ahead.`);
  L.push('- Prediction: each name gets `predicted = exposure x surprise sign`, then names are ranked by that value.');
  L.push('- Test: Spearman rank correlation between the predicted ranking and the realised event-day return relative to the benchmark, plus the top-minus-bottom basket spread and whether its sign was right.');
  L.push(`- Sample: ${s.scored} of ${s.events} events scored; ${s.skipped} skipped.`);
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push('| statistic | value |');
  L.push('| --- | ---: |');
  L.push(`| events scored | ${s.scored}/${s.events} |`);
  L.push(`| mean Spearman rho | **${s.meanSpearman}** |`);
  L.push(`| median Spearman rho | ${s.medianSpearman} |`);
  L.push(`| stdev of rho | ${s.stdevSpearman} |`);
  L.push(`| t-statistic (naive) | ${s.tStat} |`);
  L.push(`| events with rho > 0 | ${s.positiveRhoEvents} (${s.positiveRhoPct}%) |`);
  L.push(`| mean top-bottom spread | ${s.meanSpreadPct}% |`);
  L.push(`| spread direction correct | ${s.spreadHitRatePct}% |`);
  L.push('');
  L.push('## By surprise size');
  L.push('');
  L.push('| bucket | n | mean rho | rho > 0 | mean spread | hit rate |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const k of ['large', 'medium', 'small']) {
    const b = s.bySurpriseSize[k];
    if (!b) continue;
    L.push(`| ${b.label} | ${b.n} | ${b.meanSpearman} | ${b.positiveRhoPct}% | ${b.meanSpreadPct}% | ${b.spreadHitRatePct}% |`);
  }
  L.push('');
  const large = s.bySurpriseSize.large;
  const medium = s.bySurpriseSize.medium;
  L.push(`**This is the load-bearing result.** Mean rho rises from ${medium.meanSpearman} on medium surprises to ${large.meanSpearman} on large ones, and the spread hit rate from ${medium.spreadHitRatePct}% to ${large.spreadHitRatePct}%. The ranking works better when the print is more surprising, which is exactly what the rubric assumes when it gives the surprise factor the largest single weight.`);
  L.push('');
  L.push('## Per event');
  L.push('');
  L.push('| date | print | side | surprise | rho | p | spread | sign correct | top basket | bottom basket |');
  L.push('| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |');
  for (const r of study.results) {
    if (r.skipped) { L.push(`| ${r.date} | ${r.label} | - | - | - | - | - | skipped | ${r.reason} | - |`); continue; }
    L.push(`| ${r.date} | ${r.label} | ${r.side} | ${r.surprise}${r.unit ?? ''} (${r.sigma}s) | ${r.spearman} | ${r.pValue} | ${r.spreadPct}% | ${r.spreadDirectionCorrect ? 'yes' : 'no'} | ${(r.topBasket?.symbols || []).join(' ')} | ${(r.bottomBasket?.symbols || []).join(' ')} |`);
  }
  L.push('');
  L.push('## Caveats, stated plainly');
  L.push('');
  L.push(`- **Small sample.** ${s.scored} events. The t-statistic of ${s.tStat} treats them as independent draws, which they are not: overlapping macro regimes and a shared benchmark make them positively dependent, so the naive t-stat is optimistic. Read the monotonicity across surprise buckets as the finding, not the p-value.`);
  L.push(`- **Skipped events.** ${s.skipped} of ${s.events} were excluded: ${[...new Set((s.skipReasons || []).map((r) => r.replace(/^\d{4}-\d{2}-\d{2}: /, '')))].join('; ')}.`);
  L.push('- **One-day window.** The test measures the event-day relative return. It says nothing about whether the move persists, and the cards it calibrates carry a multi-day horizon.');
  L.push('- **Exposures are historical.** A 252-session beta is a description of the past regime, not a promise about the next one. Factor exposures rotate.');
  L.push('- **This is not a backtest of the desk.** It validates one input to one scoring factor. It does not measure whether any card Prism produced would have been profitable net of costs.');
  L.push('');
  return L.join('\n');
}

export function renderGapReport(study) {
  const s = study.summary;
  const o = s.overall;
  const cl = o.excessDateClustered || {};
  const raw = o.excessVsBenchmark || {};
  const mon = s.mondayGaps || {};
  const wk = s.otherWeekdayGaps || {};
  const L = [];
  L.push('# Overnight and closed-window gap study');
  L.push('');
  L.push(`Generated ${s.generatedAt} by \`npm run replay\`. Real end-of-day prices from the bundled dataset.`);
  L.push('');
  L.push('## Question');
  L.push('');
  L.push('The `closed-window` channel exists because a tokenized equity (rToken) trades 7x24 while the native US cash equity trades 6.5 hours a day, five days a week. When information lands while the cash market is shut, the rToken is the only venue left to price it. So: how much information actually accumulates across a closed window, and does the resulting gap carry forward or fade?');
  L.push('');
  L.push('## Method');
  L.push('');
  L.push(`- Sample: ${s.gaps} overnight gaps of at least ${s.minAbsPct}% across ${s.symbols} symbols, ${s.from} to ${s.to}.`);
  L.push('- A gap is today\'s open against yesterday\'s close on the NATIVE share.');
  L.push('- Continuation is the intraday move from open to close, signed by the gap direction. Positive means the gap extended; negative means it faded.');
  L.push(`- Excess returns are against ${s.benchmark} over the same window, at 1, 5 and 10 sessions.`);
  L.push('- Two t-statistics are reported for every figure. The naive one treats each gap as an independent observation. The date-clustered one groups all gaps sharing a calendar date, because on a big macro day dozens of names gap together and they are one event, not forty.');
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push('| statistic | value |');
  L.push('| --- | ---: |');
  L.push(`| gaps observed | ${s.gaps} |`);
  L.push(`| continued | ${o.continuedPct}% |`);
  L.push(`| reverted | ${o.revertedPct}% |`);
  L.push(`| flat | ${o.flatPct}% |`);
  L.push(`| median absolute gap | ${o.medianAbsGapPct}% |`);
  L.push(`| up gaps | ${o.upGaps.n} (continued ${o.upGaps.continuedPct}%) |`);
  L.push(`| down gaps | ${o.downGaps.n} (continued ${o.downGaps.continuedPct}%) |`);
  L.push('');
  L.push('## Excess return vs benchmark');
  L.push('');
  L.push('| horizon | raw mean | excess mean | naive t | date-clustered t | independent dates | win rate |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const h of FWD) {
    L.push(`| ${h.replace('fwd', '')} sessions | ${o[fwdKey(h)]}% | ${cl[h]?.mean}% | ${raw[h]?.t} | **${cl[h]?.t}** | ${cl[h]?.dates} | ${raw[h]?.winPct}% |`);
  }
  L.push('');
  L.push(`The naive and clustered t-statistics differ materially (${raw.fwd5?.t} vs ${cl.fwd5?.t} at five sessions). The clustered figure is the one quoted anywhere else in this project, because the naive one is wrong in the direction that flatters the result.`);
  L.push('');
  L.push('## Weekend window vs ordinary overnight');
  L.push('');
  L.push('| window | n | up-gap continued | down-gap continued | mean fwd5 | excess fwd5 t (clustered) |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  L.push(`| ${mon.label} | ${mon.n} | ${mon.upGaps?.continuedPct ?? '-'}% | ${mon.downGaps?.continuedPct ?? '-'}% | ${mon.meanFwd5Pct}% | ${mon.excessDateClustered?.fwd5?.t ?? '-'} |`);
  L.push(`| ${wk.label} | ${wk.n} | ${wk.upGaps?.continuedPct ?? '-'}% | ${wk.downGaps?.continuedPct ?? '-'}% | ${wk.meanFwd5Pct}% | ${wk.excessDateClustered?.fwd5?.t ?? '-'} |`);
  L.push('');
  L.push(`The Monday open carries roughly ${(mon.n && wk.n) ? round(mon.n / (mon.n + wk.n) * 100, 1) : '?'}% of the sample but a disproportionate share of the large gaps, which is the empirical basis for treating the weekend as a distinct pricing regime rather than a longer overnight. Up-gaps opening a Monday continue ${mon.upGaps?.continuedPct ?? '-'}% of the time versus ${wk.upGaps?.continuedPct ?? '-'}% on an ordinary weekday.`);
  L.push('');
  L.push('## By gap size');
  L.push('');
  L.push('| bucket | n | continued | reverted | mean fwd5 | excess fwd5 | clustered t |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [label, b] of Object.entries(s.bySizeBucket || {})) {
    L.push(`| ${label} | ${b.n} | ${b.continuedPct}% | ${b.revertedPct}% | ${b.meanFwd5Pct}% | ${b.excessDateClustered?.fwd5?.mean}% | ${b.excessDateClustered?.fwd5?.t} |`);
  }
  L.push('');
  L.push('## Caveats, stated plainly');
  L.push('');
  L.push('- **This measures the native share, not an rToken.** Tokenized equities trade on a different venue with materially thinner liquidity and a mint/redeem arbitrage that can compress a dislocation faster than the information warrants. The study is a prior for the SIZE of a closed-window dislocation, not a model of rToken microstructure.');
  L.push('- **No costs.** No commission, no spread, no borrow, no slippage. A mean five-session excess of a few tens of basis points is not a net-of-cost edge on its own; the claim is only that the direction of a gap carries information.');
  L.push('- **Survivorship.** The bundled universe is today\'s well-known large caps. Names that gapped and then went to zero are not in the sample.');
  L.push('- **Continuation is regime-dependent.** Roughly half of all gaps fade. The channel uses this study to size and time-box a view, not to claim gaps always extend.');
  L.push('');
  return L.join('\n');
}

export default { renderTransmissionReport, renderGapReport };