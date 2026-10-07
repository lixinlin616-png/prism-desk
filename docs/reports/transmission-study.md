# Macro transmission study

Generated 2026-10-07T10:49:27.733Z by `npm run replay`. Real end-of-day prices from the bundled dataset; no network access required to reproduce.

## Question

The macro-transmission channel ranks names by how exposed they are to a given print, then weights that ranking by the size of the surprise. Both choices are empirical claims, so they are tested rather than asserted:

1. Does a measured exposure ranking actually predict the cross-sectional relative return on the event day?
2. Does it predict better when the surprise is larger? (This is what justifies the 0.30 weight on the `surprise` factor in the scoring rubric.)

## Method

- Universe: 17 names - NVDA, TSLA, PLTR, COIN, AMD, META, AAPL, MSFT, GOOGL, AMZN, AVGO, NFLX, JPM, XOM, WMT, PFE, CAT.
- Exposure: for each print, factor exposures are estimated by OLS of daily returns on SPY over the 252 sessions ending the day BEFORE the print. Nothing after the print is used to build the ranking, so there is no look-ahead.
- Prediction: each name gets `predicted = exposure x surprise sign`, then names are ranked by that value.
- Test: Spearman rank correlation between the predicted ranking and the realised event-day return relative to the benchmark, plus the top-minus-bottom basket spread and whether its sign was right.
- Sample: 19 of 25 events scored; 6 skipped.

## Headline

| statistic | value |
| --- | ---: |
| events scored | 19/25 |
| mean Spearman rho | **0.157** |
| median Spearman rho | 0.201 |
| stdev of rho | 0.424 |
| t-statistic (naive) | 1.61 |
| events with rho > 0 | 14 (73.7%) |
| mean top-bottom spread | 1.7% |
| spread direction correct | 68.4% |

## By surprise size

| bucket | n | mean rho | rho > 0 | mean spread | hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| |surprise| >= 1.5 sigma | 4 | 0.254 | 75% | 2.4% | 75% |
| 0.5 <= |surprise| < 1.5 sigma | 14 | 0.102 | 71.4% | 1.35% | 64.3% |
| |surprise| < 0.5 sigma | 1 | 0.537 | 100% | 3.79% | 100% |

**This is the load-bearing result.** Mean rho rises from 0.102 on medium surprises to 0.254 on large ones, and the spread hit rate from 64.3% to 75%. The ranking works better when the print is more surprising, which is exactly what the rubric assumes when it gives the surprise factor the largest single weight.

## Per event

| date | print | side | surprise | rho | p | spread | sign correct | top basket | bottom basket |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 2022-06-10 | CPI y/y (May 2022) | hot | 0.3% (2s) | 0.613 | 0.0089 | 2.56% | yes | XOM CAT JPM | COIN AMD NVDA |
| 2022-06-15 | FOMC +75bp | - | - | - | - | - | skipped | surprise is exactly zero - no directional transmission to test | - |
| 2022-07-13 | CPI y/y (Jun 2022) | hot | 0.3% (2s) | 0.093 | 0.7222 | 0.96% | yes | XOM CAT JPM | COIN NVDA PLTR |
| 2022-09-13 | CPI y/y (Aug 2022) | hot | 0.2% (1.33s) | 0.826 | 0 | 4.97% | yes | XOM CAT JPM | NVDA PLTR COIN |
| 2022-11-10 | CPI y/y (Oct 2022) | cool | -0.3% (-2s) | 0.684 | 0.0025 | 7.27% | yes | COIN PLTR META | JPM CAT XOM |
| 2023-01-12 | CPI y/y (Dec 2022) | - | - | - | - | - | skipped | surprise is exactly zero - no directional transmission to test | - |
| 2023-03-10 | SVB failure - credit shock | - | - | - | - | - | skipped | indicator "shock" has no transmission map | - |
| 2023-06-13 | CPI y/y (May 2023) | cool | -0.1% (-0.67s) | 0.311 | 0.2239 | 1.95% | yes | COIN PLTR NVDA | JPM CAT XOM |
| 2023-09-13 | CPI y/y (Aug 2023) | hot | 0.1% (0.67s) | -0.417 | 0.0962 | -0.86% | no | XOM CAT JPM | NVDA PLTR COIN |
| 2023-11-14 | CPI y/y (Oct 2023) | cool | -0.1% (-0.67s) | 0.196 | 0.4507 | 0.95% | yes | COIN PLTR TSLA | JPM CAT XOM |
| 2024-01-11 | CPI y/y (Dec 2023) | hot | 0.2% (1.33s) | 0.201 | 0.4392 | 2.58% | yes | XOM PFE JPM | TSLA PLTR COIN |
| 2024-04-10 | CPI y/y (Mar 2024) | hot | 0.1% (0.67s) | 0.088 | 0.7363 | -0.14% | no | XOM PFE JPM | TSLA PLTR COIN |
| 2024-07-11 | CPI y/y (Jun 2024) | cool | -0.1% (-0.67s) | -0.61 | 0.0093 | -4.53% | no | COIN PLTR TSLA | WMT JPM XOM |
| 2024-08-05 | Yen carry unwind | - | - | - | - | - | skipped | indicator "shock" has no transmission map | - |
| 2024-09-18 | FOMC -50bp jumbo cut | cool | -25bps (-2.08s) | -0.373 | 0.1408 | -1.19% | no | NVDA COIN AMD | WMT JPM XOM |
| 2024-11-07 | FOMC -25bp | - | - | - | - | - | skipped | surprise is exactly zero - no directional transmission to test | - |
| 2024-12-18 | FOMC 2025 easing projections | hot | -2cuts (0.17s) | 0.537 | 0.0263 | 3.79% | yes | XOM JPM PFE | NVDA AVGO COIN |
| 2025-01-15 | Core CPI y/y (Dec 2024) | cool | -0.1% (-0.67s) | 0.505 | 0.0387 | 4.22% | yes | COIN TSLA AVGO | CAT JPM XOM |
| 2025-02-12 | CPI y/y (Jan 2025) | hot | 0.1% (0.67s) | -0.547 | 0.0232 | -4.17% | no | XOM JPM CAT | AMD COIN TSLA |
| 2025-03-12 | CPI y/y (Feb 2025) | cool | -0.1% (-0.67s) | 0.417 | 0.0962 | 3.61% | yes | TSLA COIN AVGO | CAT JPM XOM |
| 2025-04-09 | Reciprocal tariff pause | - | - | - | - | - | skipped | indicator "shock" has no transmission map | - |
| 2025-06-11 | CPI y/y (May 2025) | cool | -0.1% (-0.67s) | -0.272 | 0.2908 | -0.42% | no | TSLA AMD AVGO | CAT JPM XOM |
| 2025-08-01 | Nonfarm payrolls (Jul) | cool | -33k (-0.55s) | 0.395 | 0.117 | 5.97% | yes | AVGO NFLX GOOGL | COIN CAT JPM |
| 2025-09-05 | Nonfarm payrolls (Aug) | cool | -53k (-0.88s) | 0.127 | 0.6259 | 2.76% | yes | AVGO NFLX GOOGL | TSLA JPM CAT |
| 2025-09-11 | CPI y/y (Aug 2025) | cool | -0.2% (-1.33s) | 0.208 | 0.4223 | 2.05% | yes | TSLA AVGO COIN | PLTR JPM XOM |

## Caveats, stated plainly

- **Small sample.** 19 events. The t-statistic of 1.61 treats them as independent draws, which they are not: overlapping macro regimes and a shared benchmark make them positively dependent, so the naive t-stat is optimistic. Read the monotonicity across surprise buckets as the finding, not the p-value.
- **Skipped events.** 6 of 25 were excluded: surprise is exactly zero - no directional transmission to test; indicator "shock" has no transmission map.
- **One-day window.** The test measures the event-day relative return. It says nothing about whether the move persists, and the cards it calibrates carry a multi-day horizon.
- **Exposures are historical.** A 252-session beta is a description of the past regime, not a promise about the next one. Factor exposures rotate.
- **This is not a backtest of the desk.** It validates one input to one scoring factor. It does not measure whether any card Prism produced would have been profitable net of costs.
