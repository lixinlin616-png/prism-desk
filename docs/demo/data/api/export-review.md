# Signal review - what the desk actually got right

Generated 2026-10-07T14:07:03.661Z by `node prism.mjs review`. Adjudicated as of 2025-09-30T23:59:59.000Z against the bundled real-price dataset; no network access required to reproduce.

## Question

Prism publishes falsifiable cards: each one names the condition that would prove it wrong, an observable level, and a recheck time. While a card is live those fields are a promise. **Once the window closes they are a test, and the test can be scored.** This report scores it.

It answers two questions that are usually blurred together:

1. **Was the call right?** Did the claim survive its own falsification condition, and did the name move in the claimed direction by a material amount relative to the benchmark?
2. **Does the rubric rank?** Is a higher score associated with a better realised outcome? If it is not, the five-factor weighting is decoration and should be changed.

## Method

- **Three axes, never merged.** (1) *Falsification* - did a close cross the numeric level the card itself named, by its own recheck date, and stay there? (2) *Risk path* - was the tradeSketch stop or target touched en route? (3) *Realised* - signed benchmark-excess return over the card's own window. The verdict comes from (1) when it fired, otherwise from (3). Axis (2) is always reported and never decides anything, because "would this trade have hurt" is not "was the claim right".
- **Anchored on issuance, not on the information date.** Every level a card carries is struck off the price at `createdAt`, so the measurement window starts there. Measuring from `informationAt` instead would judge a card against a reference price outside its own window.
- **Benchmark-excess, never raw.** Every move is measured against SPY over the identical window, so a rising tape is not mistaken for skill. Dollar-neutral pairs are measured as a raw spread, where the benchmark cancels by construction.
- **Restatements collapsed.** The board re-issues the same claim on every run, so 312 stored cards are 148 distinct claims (164 restatements collapsed). Statistics are computed on distinct claims; counting restatements separately would produce a hit rate with three significant figures and no meaning.
- **Materiality band.** A window closing inside +/-1% signed excess is reported `inconclusive`, not forced into a win/loss column.
- **Pessimistic tie-break = true.** When one daily bar touches both stop and target, daily OHLC cannot order intraday events, so the stop is assumed to have been hit first. This biases the hit rate DOWN.
- **Unmeasurable is a verdict, not a gap.** A card citing a name with no price series is reported `unmeasurable`. It is never counted as a win, a loss, or quietly dropped.

## Headline

| statistic | value |
| --- | ---: |
| cards on the board | 312 |
| distinct claims | 148 |
| claims whose window has closed | 91 |
| claims still open (provisional, not judged) | 57 |
| judged | 45 |
| decided (won / lost) | **34** |
| won | 10 |
| lost | 24 |
| inconclusive (inside the materiality band) | 11 |
| **hit rate** | **29.4%** (Wilson 95% CI 16.8-46.2%; exact Clopper-Pearson 15.1-47.5%) |
| mean signed benchmark-excess | -0.832% |
| median signed benchmark-excess | -0.745% |
| falsification condition fired | 12 |
| falsification stated in prose only (untestable) | 24 |
| stop touched during the window | 9 |
| unmeasurable (no price series) | 31 |
| non-directional (neutral / hedge) | 15 |
| measured through a declared demo proxy | 44 |
| Spearman rho, score vs realised excess | **-0.137** (n=45) |

## Calibration - does the score rank?

Measured on 45 claims with a finite realised excess, drawn from 6 distinct information dates. **Those claims are not independent observations** - they share documents, dates and a benchmark - so every figure below is descriptive. Read the shape, not the decimals.

### By score band

| grade | band | claims | decided | won | hit rate | mean signed excess |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | >=75 | 10 | 9 | 2 | 22.2% | -1.358% |
| B | 62-75 | 28 | 19 | 5 | 26.3% | -0.378% |
| C | 48-62 | 7 | 6 | 3 | 50% | -1.896% |
| D | 35-48 | 0 | 0 | 0 | - | - |
| F | <35 | 0 | 0 | 0 | - | - |

### By channel

| channel | claims | decided | won | hit rate | mean signed excess |
| --- | ---: | ---: | ---: | ---: | ---: |
| earnings-gap | 24 | 17 | 4 | 23.5% | -0.615% |
| macro-transmission | 18 | 11 | 2 | 18.2% | -1.189% |
| narrative-shift | 13 | 4 | 2 | 50% | -3.755% |
| flow-footprint | 13 | 0 | 0 | - | - |
| risk-flag | 11 | 2 | 2 | 100% | 5.947% |
| cross-asset | 10 | 0 | 0 | - | - |
| closed-window | 2 | 0 | 0 | - | - |

### By direction

| direction | claims | decided | won | hit rate | mean signed excess |
| --- | ---: | ---: | ---: | ---: | ---: |
| neutral | 43 | 0 | 0 | - | - |
| pair | 18 | 11 | 2 | 18.2% | -1.189% |
| short | 17 | 12 | 1 | 8.3% | -2.876% |
| long | 11 | 9 | 5 | 55.6% | 1.122% |
| avoid | 2 | 2 | 2 | 100% | 5.947% |

### Does the publish floor earn its place?

| cohort | claims | decided | won | hit rate | mean signed excess |
| --- | ---: | ---: | ---: | ---: | ---: |
| published (>= 45) | 45 | 34 | 10 | 29.4% | -0.832% |
| held back (< 45) | 0 | 0 | 0 | - | - |

## Per-claim audit trail

Every distinct claim whose window has closed. `xN` is how many stored cards were collapsed into it.

| score | grade | channel | direction | window | sess | instrument | falsification | risk path | signed excess | verdict | x |
| ---: | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | --- | ---: |
| 80.3 | A | earnings-gap | short | 2025-09-05 -> 2025-09-10 | 3 | CAT | held | neither | 0.808% | flat | x2 |
| 80.3 | A | earnings-gap | short | 2025-09-08 -> 2025-09-12 | 4 | CAT | FIRED | neither | -0.745% | LOST | x2 |
| 80 | A | earnings-gap | short | 2025-09-10 -> 2025-09-15 | 3 | CAT | FIRED | stop | -1.747% | LOST | x2 |
| 78.7 | A | earnings-gap | short | 2025-09-12 -> 2025-09-17 | 3 | CAT | FIRED | stop | -4.166% | LOST | x2 |
| 78.3 | A | earnings-gap | short | 2025-09-12 -> 2025-09-18 | 4 | CAT | FIRED | stop | -7.475% | LOST | x2 |
| 76.8 | A | earnings-gap | short | 2025-09-16 -> 2025-09-19 | 3 | CAT | FIRED | stop | -5.31% | LOST | x2 |
| 76.3 | A | earnings-gap | short | 2025-09-17 -> 2025-09-22 | 3 | CAT | FIRED | stop | -3.595% | LOST | x2 |
| 75.6 | A | earnings-gap | long | 2025-09-05 -> 2025-09-10 | 3 | NVDA | held | target | 5.405% | WON | x2 |
| 75.6 | A | earnings-gap | long | 2025-09-08 -> 2025-09-12 | 4 | NVDA | held | target | 4.328% | WON | x2 |
| 75.5 | A | earnings-gap | short | 2025-09-19 -> 2025-09-24 | 3 | CAT | FIRED | stop | -1.088% | LOST | x2 |
| 74.9 | B | earnings-gap | long | 2025-09-10 -> 2025-09-15 | 3 | NVDA | held | neither | -1.097% | LOST | x2 |
| 74.8 | B | macro-transmission | pair | 2025-09-05 -> 2025-09-10 | 3 | PFE/AMD | untestable | n/a | -3.402% | LOST | x2 |
| 74.8 | B | macro-transmission | pair | 2025-09-08 -> 2025-09-12 | 4 | PFE/AMD | untestable | n/a | -3.75% | LOST | x2 |
| 74.8 | B | macro-transmission | pair | 2025-09-10 -> 2025-09-15 | 3 | PFE/AMD | untestable | n/a | -1.728% | LOST | x2 |
| 74.2 | B | earnings-gap | short | 2025-09-23 -> 2025-09-26 | 3 | CAT | held | neither | 0.957% | flat | x2 |
| 73.7 | B | earnings-gap | long | 2025-09-12 -> 2025-09-17 | 3 | NVDA | FIRED | stop | -4.504% | LOST | x2 |
| 73.3 | B | earnings-gap | long | 2025-09-12 -> 2025-09-18 | 4 | NVDA | FIRED | stop | -1.626% | LOST | x2 |
| 73.2 | B | macro-transmission | pair | 2025-09-12 -> 2025-09-17 | 3 | PFE/AMD | untestable | n/a | 0.191% | flat | x2 |
| 72.3 | B | macro-transmission | pair | 2025-09-12 -> 2025-09-18 | 4 | PFE/AMD | untestable | n/a | 0.792% | flat | x2 |
| 71.9 | B | earnings-gap | long | 2025-09-16 -> 2025-09-19 | 3 | NVDA | held | stop | 0.463% | flat | x2 |
| 71.7 | B | earnings-gap | short | - | - | WMT | untestable | n/a | - | n/m | x2 |
| 71.7 | B | earnings-gap | short | - | - | WMT | untestable | n/a | - | n/m | x2 |
| 71.7 | B | earnings-gap | short | 2025-09-10 -> 2025-09-11 | 1 | WMT | FIRED | neither | -1.4% | LOST | x2 |
| 71.7 | B | earnings-gap | short | - | - | WMT | untestable | n/a | - | n/m | x12 |
| 71.4 | B | earnings-gap | long | 2025-09-17 -> 2025-09-22 | 3 | NVDA | held | target | 6.66% | WON | x2 |
| 70.6 | B | earnings-gap | long | 2025-09-19 -> 2025-09-24 | 3 | NVDA | held | neither | 0.562% | flat | x2 |
| 69.8 | B | macro-transmission | pair | 2025-09-16 -> 2025-09-19 | 3 | PFE/AMD | untestable | n/a | 1.229% | WON | x2 |
| 69.5 | B | macro-transmission | pair | 2025-09-05 -> 2025-09-10 | 3 | PFE/COIN | untestable | n/a | -3.343% | LOST | x2 |
| 69.4 | B | earnings-gap | long | 2025-09-23 -> 2025-09-26 | 3 | NVDA | FIRED | neither | 0.075% | LOST | x2 |
| 69.1 | B | macro-transmission | pair | 2025-09-17 -> 2025-09-22 | 3 | PFE/AMD | untestable | n/a | -0.219% | flat | x2 |
| 68.8 | B | earnings-gap | short | 2025-09-17 -> 2025-09-18 | 1 | WMT | held | neither | 1.11% | WON | x2 |
| 68 | B | macro-transmission | pair | 2025-09-19 -> 2025-09-24 | 3 | PFE/AMD | untestable | n/a | -0.983% | flat | x2 |
| 66.7 | B | macro-transmission | pair | 2025-09-23 -> 2025-09-26 | 3 | PFE/AMD | untestable | n/a | -0.319% | flat | x2 |
| 66.6 | B | macro-transmission | pair | 2025-09-08 -> 2025-09-12 | 4 | PFE/COIN | untestable | n/a | -4.833% | LOST | x2 |
| 66.4 | B | earnings-gap | short | 2025-09-23 -> 2025-09-24 | 1 | WMT | FIRED | neither | -0.523% | LOST | x2 |
| 64.8 | B | macro-transmission | pair | 2025-09-10 -> 2025-09-15 | 3 | PFE/COIN | untestable | n/a | -3.073% | LOST | x2 |
| 63.6 | B | macro-transmission | pair | 2025-09-12 -> 2025-09-17 | 3 | PFE/COIN | untestable | n/a | 0.761% | flat | x2 |
| 63.2 | B | macro-transmission | pair | 2025-09-12 -> 2025-09-18 | 4 | PFE/COIN | untestable | n/a | -2.523% | LOST | x2 |
| 62.5 | B | risk-flag | avoid | 2025-09-05 -> 2025-09-26 | 15 | PFE | untestable | n/a | 6.754% | WON | x3 |
| 62.5 | B | risk-flag | avoid | 2025-09-08 -> 2025-09-29 | 15 | PFE | untestable | n/a | 5.14% | WON | x3 |
| 62.1 | B | macro-transmission | pair | 2025-09-16 -> 2025-09-19 | 3 | PFE/COIN | untestable | n/a | -1.947% | LOST | x2 |
| 61.8 | C | macro-transmission | pair | 2025-09-17 -> 2025-09-22 | 3 | PFE/COIN | untestable | n/a | -1.797% | LOST | x2 |
| 61.3 | C | macro-transmission | pair | 2025-09-19 -> 2025-09-24 | 3 | PFE/COIN | untestable | n/a | 3.146% | WON | x2 |
| 60.8 | C | macro-transmission | pair | 2025-09-23 -> 2025-09-26 | 3 | PFE/COIN | untestable | n/a | 0.402% | flat | x2 |
| 60.6 | C | narrative-shift | long | 2025-09-05 -> 2025-09-26 | 15 | MSFT | untestable | n/a | 1.073% | WON | x2 |
| 60.6 | C | narrative-shift | long | 2025-09-08 -> 2025-09-29 | 15 | MSFT | untestable | n/a | 1.003% | WON | x2 |
| 59.2 | C | narrative-shift | short | 2025-09-05 -> 2025-09-26 | 15 | CAT | untestable | n/a | -7.835% | LOST | x2 |
| 59.2 | C | narrative-shift | short | 2025-09-08 -> 2025-09-29 | 15 | CAT | untestable | n/a | -9.261% | LOST | x2 |
| 58.3 | C | closed-window | neutral | - | - | SPY | untestable | n/a | - | n/d | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 55.7 | C | flow-footprint | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 52.1 | C | flow-footprint | neutral | - | - | CAT | untestable | n/a | - | n/d | x1 |
| 52.1 | C | flow-footprint | neutral | - | - | CAT | untestable | n/a | - | n/d | x1 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 49 | C | cross-asset | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 47.6 | D | flow-footprint | neutral | - | - | MSFT | untestable | n/a | - | n/d | x1 |
| 47.6 | D | flow-footprint | neutral | - | - | MSFT | untestable | n/a | - | n/d | x1 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 46.7 | D | risk-flag | neutral | - | - | NVDA | untestable | n/a | - | n/d | x3 |
| 44.9 | D | closed-window | neutral | - | - | WMT | untestable | n/a | - | n/d | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |
| 41.8 | D | narrative-shift | neutral | - | - | - | untestable | n/a | - | n/m | x2 |

### Still open (57)

Windows that had not closed at the adjudication date. Shown for completeness; **not** included in any statistic above.

| score | channel | direction | expires | instrument | interim signed excess |
| ---: | --- | --- | --- | --- | ---: |
| 73.5 | earnings-gap | short | 2025-10-01 | CAT | -1.787% |
| 72.7 | earnings-gap | short | 2025-10-05 | CAT | - |
| 68.7 | earnings-gap | long | 2025-10-01 | NVDA | 4.05% |
| 67.9 | earnings-gap | long | 2025-10-05 | NVDA | - |
| 66 | macro-transmission | pair | 2025-10-01 | PFE/AMD | 2.889% |
| 65.5 | macro-transmission | pair | 2025-10-05 | PFE/AMD | - |
| 61.8 | risk-flag | avoid | 2025-10-01 | PFE | -1.562% |
| 61.2 | risk-flag | avoid | 2025-10-03 | PFE | -5.411% |
| 60.6 | narrative-shift | long | 2025-10-01 | MSFT | 1.371% |
| 60.5 | macro-transmission | pair | 2025-10-01 | PFE/COIN | -0.364% |
| 60.3 | macro-transmission | pair | 2025-10-05 | PFE/COIN | - |
| 60.2 | risk-flag | avoid | 2025-10-07 | PFE | -5.675% |
| 59.9 | risk-flag | avoid | 2025-10-08 | PFE | -4.884% |
| 59.4 | risk-flag | avoid | 2025-10-10 | PFE | -5.66% |
| 59.3 | narrative-shift | long | 2025-10-03 | MSFT | 0.245% |
| 59.1 | narrative-shift | short | 2025-10-01 | CAT | -10.683% |
| 58.6 | risk-flag | avoid | 2025-10-14 | PFE | -5.147% |
| 58 | risk-flag | avoid | 2025-10-17 | PFE | -6.58% |
| 57.3 | narrative-shift | short | 2025-10-03 | CAT | -9.24% |
| 57.3 | risk-flag | avoid | 2025-10-21 | PFE | - |
| 56.6 | narrative-shift | long | 2025-10-07 | MSFT | 0.814% |
| 55.9 | narrative-shift | long | 2025-10-08 | MSFT | 0.493% |
| 55.7 | flow-footprint | neutral | 2025-10-01 | - | - |
| 55.7 | flow-footprint | neutral | 2025-10-05 | - | - |
| 54.9 | narrative-shift | long | 2025-10-10 | MSFT | -0.37% |
| 54.8 | narrative-shift | short | 2025-10-07 | CAT | -7.342% |
| 54.2 | narrative-shift | short | 2025-10-08 | CAT | -4.816% |
| 53.5 | narrative-shift | long | 2025-10-14 | MSFT | 1.265% |
| 53.3 | narrative-shift | short | 2025-10-10 | CAT | -1.901% |
| 52.8 | narrative-shift | long | 2025-10-17 | MSFT | 0.61% |
| 52.1 | flow-footprint | neutral | 2025-10-01 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-03 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-04 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-07 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-08 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-10 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-14 | CAT | - |
| 52.1 | flow-footprint | neutral | 2025-10-17 | CAT | - |
| 52.1 | narrative-shift | long | 2025-10-21 | MSFT | - |
| 52.1 | flow-footprint | neutral | 2025-10-21 | CAT | - |
| 51.9 | narrative-shift | short | 2025-10-14 | CAT | -0.802% |
| 51.2 | narrative-shift | short | 2025-10-17 | CAT | -1.787% |
| 50.5 | narrative-shift | short | 2025-10-21 | CAT | - |
| 49 | cross-asset | neutral | 2025-10-01 | - | - |
| 47.6 | flow-footprint | neutral | 2025-10-01 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-03 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-04 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-07 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-08 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-10 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-14 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-17 | MSFT | - |
| 47.6 | flow-footprint | neutral | 2025-10-21 | MSFT | - |
| 46.7 | risk-flag | neutral | 2025-10-01 | NVDA | - |
| 46.7 | risk-flag | neutral | 2025-10-05 | NVDA | - |
| 41.8 | narrative-shift | neutral | 2025-10-01 | - | - |
| 41.8 | narrative-shift | neutral | 2025-10-05 | - | - |

## Findings and what to do about them

Each finding cites the measurement that produced it. Nothing here is applied automatically: changing the rubric in response to a nine-claim sample would be fitting noise, so the findings are written down and left for a human to act on with more data.

### [BLOCKER] `score-predictiveness`

- **Finding.** Spearman rho between card score and signed benchmark-excess return is -0.137 (n=45): higher scores realised WORSE signed excess returns - the rubric is miscalibrated in sign.
- **Evidence.** `rho=-0.137, n=45`
- **Action.** Find and repair the offending factor before publishing anything on this rubric.

### [WARNING] `coverage-gap`

- **Finding.** 31 card(s) could not be adjudicated at all - the price book has no series for the names they cite.
- **Evidence.** `unmeasurable=31 of 91`
- **Action.** Extend the price book, or stop issuing directional cards on names the desk cannot later score. A card that is unfalsifiable in practice is worse than no card.

### [WARNING] `untestable-falsification`

- **Finding.** 24 of 45 judged claims state their falsification condition in prose ("tone sign flip on >= 2 documents", "pair spread vs SPY < 50bp after 2 sessions") with no machine-testable level, so the desk's own words could not be checked and the verdict fell back to realised excess.
- **Evidence.** `untestable=24, tested=21`
- **Action.** Require every channel to emit a numeric invalidation level plus the series it refers to. A falsification condition nobody can evaluate is a rhetorical device, not a control.

### [INFO] `proxy-substitution`

- **Finding.** 44 card(s) were measured through a declared demo price proxy rather than a listed price for the issuer.
- **Evidence.** `viaProxy=44`
- **Action.** Those verdicts describe the proxy series, not the fictional issuer. Do not quote them as issuer-level results.

### [INFO] `inconclusive-share`

- **Finding.** 11 of 45 measurable cards closed inside the +/-1% materiality band and are reported inconclusive rather than forced into a win/loss column.
- **Evidence.** `inconclusive=11, decided=34, materiality=1%`
- **Action.** A high inconclusive share usually means horizons are too short for the magnitude claimed - widen the horizon, or demand a bigger expected move before publishing.

### [INFO] `axes-disagree`

- **Finding.** The risk path and the realised-excess test disagree on 0 of 12 claims that had a numeric stop/target. Both are reported separately for exactly this reason: "would the trade have hurt" and "was the thesis right" are different questions, and merging them is how a stopped-out-but-correct call gets recorded as a loss.
- **Evidence.** `with-risk-levels=12, disagree=0`
- **Action.** Quote the pair of numbers, never one of them alone.

### [INFO] `window-length`

- **Finding.** Measured windows run a median of 3 trading sessions (range 1-15).
- **Evidence.** `medianSessions=3, n=45`
- **Action.** Windows this short cannot distinguish a good thesis from a lucky fortnight; treat every hit rate here as descriptive.

### [ok] `channel-spread`

- **Finding.** Best-calibrated channel narrative-shift hit 50% (n=4); worst macro-transmission hit 18.2% (n=11).
- **Evidence.** `narrative-shift=2/4, macro-transmission=2/11`
- **Action.** Read the macro-transmission misses individually before touching its weights - a channel can be wrong for one reason or for several.

## Caveats, stated plainly

- **The sample is tiny.** 34 decided claims from 6 information dates. The Wilson 95% interval on the hit rate is 16.8-46.2% (exact Clopper-Pearson 15.1-47.5%), which is wider than any effect it could measure. **No conclusion about profitability should be drawn from this report.**
- **Claims are not independent.** Several come from the same document on the same date, and all share one benchmark and one macro regime. The rho and the hit rate are descriptions of this board, not estimates of a population parameter.
- **Demo issuers are measured through proxies.** Fictional issuers have no listed price; where they declare one, they are measured through that real proxy series, and the substitution is flagged on the row. Those verdicts describe the proxy, not the issuer.
- **Daily bars cannot order intraday events.** Stop-versus-target ties are resolved pessimistically. On intraday data the hit rate would be different, and probably higher.
- **No costs.** Nothing here nets out commission, spread, borrow or slippage, and there is no portfolio-level aggregation. A hit is a direction, not a profit.
- **Unmeasurable claims are a real defect, not a rounding error.** Cards were issued on names the desk cannot later score. That is reported as a finding above because a card that is unfalsifiable in practice is worse than no card.
- **This is not a backtest of the desk.** It audits whether published claims survived their own stated falsification tests over their own stated windows. It does not measure whether trading them would have made money.
