# Prism Desk - validation report

Generated 2026-10-07T12:58:20.271Z by `npm run validate` in 591ms.

**60/60 checks passed**. Node v24.21.0, data mode `offline`, extractor `rules`.

| suite | checks | passed |
| --- | ---: | ---: |
| extraction | 10 | 10 |
| ledger | 9 | 9 |
| invariants | 13 | 13 |
| determinism | 2 | 2 |
| studies | 6 | 6 |
| review | 12 | 12 |
| data | 8 | 8 |

## extraction

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `earn-beat-raise` | Clean beat with a raised guide should read long on earnings-gap | earnings-gap/long score-independent ok, ledger 3 pass / 0 fail / 1 unverifiable |
| PASS | `earn-miss-lower` | Clean miss with a cut guide should read short on earnings-gap | earnings-gap/short score-independent ok, ledger 3 pass / 0 fail / 1 unverifiable |
| PASS | `earn-beat-withdraw` | A beat whose guide is withdrawn is not a long - the withdrawal dominates | earnings-gap/neutral score-independent ok, ledger 3 pass / 0 fail / 1 unverifiable |
| PASS | `macro-cpi-hot` | A hot CPI print should produce a macro-transmission card with side=hot | macro-transmission/pair score-independent ok, ledger 2 pass / 0 fail / 0 unverifiable |
| PASS | `macro-nfp-cool` | A cool payrolls print should produce a macro-transmission card with side=cool | macro-transmission/pair score-independent ok, ledger 2 pass / 0 fail / 0 unverifiable |
| PASS | `fomc-hawkish` | A hawkish FOMC statement should classify as hawkish and transmit through rates | macro-transmission/pair score-independent ok, ledger 1 pass / 0 fail / 0 unverifiable |
| PASS | `risk-filing` | Adverse language plus ratio anomalies should raise a contrarian risk flag | risk-flag/avoid score-independent ok, ledger 2 pass / 0 fail / 0 unverifiable |
| PASS | `news-constructive` | Strongly positive coverage should turn the narrative channel constructive | narrative-shift/long score-independent ok, ledger 1 pass / 0 fail / 3 unverifiable |
| PASS | `news-negative` | Strongly negative coverage should turn the narrative channel defensive | narrative-shift/short score-independent ok, ledger 1 pass / 0 fail / 2 unverifiable |
| PASS | `negative-control-bland` | PRECISION CONTROL: a routine housekeeping release must produce no signal at all | 0 card(s) produced, cap 0 |

## ledger

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `metric-correct` | A number that really is in the document passes | verdict pass, checked against eval-zeph-release meta$.revenueActual, quarantine=false |
| PASS | `metric-inflated` | HALLUCINATION: the same number inflated 10x must fail and quarantine the card | verdict fail, checked against eval-zeph-release, quarantine=true |
| PASS | `metric-within-tolerance` | A 1% rounding difference is inside the 2% tolerance and still passes | verdict pass, checked against eval-zeph-release meta$.actual, quarantine=false |
| PASS | `quote-real` | A verbatim sentence from the source passes | verdict pass, checked against eval-zeph-release (exact @381), quarantine=false |
| PASS | `quote-fabricated` | HALLUCINATION: a quote the document never said must fail and quarantine | verdict fail, checked against eval-zeph-release, quarantine=true |
| PASS | `price-real` | A price claim matching the bundled OHLCV bar passes | verdict pass, checked against price-book NVDA.close @2025-09-30 = 186.58, quarantine=false |
| PASS | `price-tampered` | HALLUCINATION: a price 25% above the real close must fail | verdict fail, checked against price-book NVDA @2025-09-30, quarantine=true |
| PASS | `unsourced-number` | A number citing a document that does not exist is unverifiable, never pass | verdict unverifiable, checked against n/a, quarantine=false |
| PASS | `computed-recipe-fake` | HALLUCINATION: a computed aggregate the engine cannot reproduce must fail | verdict fail, checked against recounted insiderTrades(ZEPH): 0 sells / 0 buys, quarantine=true |

## invariants

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `produces-cards` | a full sweep produces cards | 7 cards |
| PASS | `spans-channels` | a full sweep spans multiple channels | channels: earnings-gap, macro-transmission, narrative-shift, cross-asset |
| PASS | `ledger-clean` | no evidence item fails verification on a clean run | 0 failures of 20 checks |
| PASS | `schema-valid` | every card passes the schema validator |  |
| PASS | `falsifiable` | every card states the condition that would prove it wrong |  |
| PASS | `evidenced` | every card carries at least one evidence item |  |
| PASS | `no-pending` | no evidence item is left unadjudicated |  |
| PASS | `scored` | every card carries a numeric score |  |
| PASS | `explained` | every score factor carries an auditable written reason |  |
| PASS | `publish-floor` | no card is published below the configured threshold | threshold 45, lowest published 49 |
| PASS | `quarantine-respected` | no quarantined card is marked active | 7 published, 0 quarantined among them |
| PASS | `coverage-reported` | the run reports names it stayed silent on | 1 silent name(s) reported |
| PASS | `brief-rendered` | the brief renders as markdown | 16301 chars of markdown with its heading |

## determinism

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `same-answer-twice` | the same question at the same as-of produces the same cards | two independent runs produced identical card sets (4 cards) |
| PASS | `as-of-matters` | moving the as-of date changes the answer (no time leakage) | moving the as-of clock changed the cards, so freshness and session state are live |

## studies

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `transmission-scored` | the transmission study scores a meaningful number of real events | scored 19/25 |
| PASS | `transmission-bucketed` | the transmission study conditions on surprise size | large n=4, medium n=14, small n=1 |
| PASS | `transmission-monotone` | mean rho is higher for large surprises than for medium ones | large rho 0.254 vs medium rho 0.102 - monotone, which is what the 0.30 surprise weight assumes |
| PASS | `gaps-sample` | the gap study covers a large real sample | 15478 gaps |
| PASS | `gaps-clustered` | the gap study reports date-clustered t-statistics, not only naive ones | fwd5 clustered t 5.23 vs naive t 8.45 - the clustered figure is the one quoted elsewhere |
| PASS | `gaps-weekend-split` | the gap study separates the weekend window from ordinary overnights | Monday n=3143 vs Tue-Fri n=12335 |

## review

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `runs` | the review adjudicates every card it is given | 7 cards -> 7 distinct claims (0 restatements collapsed), 1 decided |
| PASS | `dedupes` | restatements of one claim collapse into a single observation | 7 stored cards are 7 distinct claims - without this the hit rate would carry false precision |
| PASS | `three-axes` | every judged claim reports falsification, risk path and realised excess separately | 3 judged claims, each carrying all three axes so "was the thesis right" is never confused with "would the trade have hurt" |
| PASS | `honest-denominator` | unmeasurable and non-directional claims never enter the win/loss denominator | 1 decided = 0 won + 1 lost; 2 unmeasurable and 0 non-directional are reported separately, not counted as losses |
| PASS | `benchmark-adjusted` | single-name claims are measured against the benchmark, not in raw terms | excess is against SPY, so a rising tape is not credited to the desk as skill |
| PASS | `anchored-on-issuance` | the measurement window is anchored on issuance, not on the information date | all 3 judged claims open their window at or before issuance and at or after the information date, so the levels a card was struck at sit inside its own window |
| PASS | `auditable` | every adjudicated claim carries a written basis | 7 claims, each with a human-readable basis naming the test that produced the verdict |
| PASS | `lessons-cite-numbers` | every finding cites the measurement that produced it | 7 findings, each with a numeric evidence string and a concrete action |
| PASS | `small-sample-flagged` | a sample too small to support a conclusion is flagged as a blocker | 1 decided claims - the report leads with a sample-too-small blocker rather than quoting the hit rate as a result |
| PASS | `report-renders` | the review report renders as markdown with its caveats intact | 10787 characters; states plainly that it is not a backtest and that no costs are netted out |
| PASS | `deterministic` | the same board at the same date gives the same verdicts | verdicts are reproducible, so a judge can regenerate this report from a clean clone |
| PASS | `read-only-by-default` | reviewing never mutates stored card state unless asked | the default pass is read-only, so running the review cannot corrupt the demo board |

## data

| | id | check | detail |
| --- | --- | --- | --- |
| PASS | `prices-parse` | all 25 bundled price series parse, are date-sorted and structurally possible |  |
| PASS | `prices-vendor-noise` | open/close stay inside [low, high] for at least 99.9% of bars | 8/41386 bars (0.019%) violate the range: CAT.csv 2023-06-05 (o226.99 h226.28 l220.75 c222.47); IWM.csv 2023-06-05 (o181.26 h180.8199 l178.44 c179.58); JPM.csv 2023-06-05 (o140.11 h139.31 l138.13 c139.09) |
| PASS | `prices-coverage` | the price book spans multiple years | 25 symbols, 41386 bars, 2019-01-02 to 2025-09-30 |
| PASS | `macro-events` | 25 macro events carry date, indicator, actual and consensus |  |
| PASS | `corpus-shape` | 14 corpus documents are well formed and disclose their provenance |  |
| PASS | `price-proxy-disclosed` | every fictional issuer that borrows a real price series discloses the proxy | BLWF->PFE, CRVS->NVDA, CRVS->NVDA, HLXN->CAT, CRVS->NVDA, NWCL->MSFT, NWCL->MSFT, HLXN->CAT, NWCL->MSFT, ASTR->WMT |
| PASS | `fixtures` | 12 offline MCP fixtures are well formed |  |
| PASS | `offline-boot` | the hub boots with zero network access | market state offline |

## Reference run

Full desk sweep as of 2025-09-19T20:00:00Z: 7 cards, 7 published, 0 quarantined, 0 below threshold. Ledger checked 20 items with a 85% pass rate and 0 failures.

| score | grade | channel | dir | tickers | claim |
| ---: | --- | --- | --- | --- | --- |
| 75.5 | A | earnings-gap | short | HLXN | HLXN: EPS miss, guide lower |
| 70.6 | B | earnings-gap | long | CRVS | CRVS: EPS beat, guide raise |
| 68 | B | macro-transmission | pair | AMD TSLA COIN PFE XOM WMT | CPI Y/Y (AUG 2025) cool: Cooler inflation pulls the terminal policy rate lower |
| 63.4 | B | earnings-gap | short | ASTR | ASTR: EPS miss, guide withdraw |
| 54.9 | C | narrative-shift | long | NWCL | NWCL: narrative turning constructive |
| 53.3 | C | narrative-shift | short | HLXN | HLXN: narrative turning negative |
| 49 | C | cross-asset | neutral | BTC ETH | Crypto regime: Fear & Greed 41 (Fear) \| BTC funding 0.0081 \| US spot BTC ETF flow -184000000 |

## What these suites are for

- **extraction** measures recall on documents with a known correct reading, and includes a precision control: a routine housekeeping release must produce *no* card. A generator that fires on everything is not a generator.
- **ledger** is the anti-hallucination suite. Half of its cases are deliberately fabricated - a number inflated 10x, a quote nobody said, a price 25% above the real close, an aggregate the engine cannot reproduce. Each must be caught and the card quarantined. This is the single most important suite in the project.
- **invariants** assert the schema contract: every card is falsifiable, grounded, scored, and every score factor carries a written reason.
- **determinism** asserts the same question at the same as-of gives the same answer, and that moving the clock changes it - otherwise freshness scoring is theatre.
- **data** asserts the bundled dataset is internally consistent and that fictional issuers disclose the real series they proxy.

_These checks validate the machinery. They do not validate that any card would have made money._