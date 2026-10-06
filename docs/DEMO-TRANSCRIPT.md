# Prism Desk - demo transcript

Generated 2026-10-06T11:22:14.633Z - data mode `offline`, extractor `rules`, LLM not configured (deterministic rule extractor).

Corpus 14 documents / 2599 words. Price book 25 symbols, 41386 bars, 2019-01-02 to 2025-09-30.

---

## Scenario: Full desk sweep / 全频道扫描

> Full desk sweep across every channel - what is actually tradeable right now?

_as-of 2025-09-19T20:00:00.000Z - channels earnings-gap, macro-transmission, narrative-shift, flow-footprint, closed-window, cross-asset, risk-flag - 57ms - extractor rules_

**What it demonstrates.** Exercises all seven channels in one pass. Best first thing to run.

# Prism Desk brief

**As of** 2025-09-19 20:00 UTC · **US cash session** pre-market · **data** offline · **extractor** deterministic rules
**Question** Full desk sweep across every channel - what is actually tradeable right now?

## Asked about, but silent

No card was produced for **CAT**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

## Headline

**HLXN: EPS miss, guide lower** — SHORT, score 75.5/100.

## Ranked cards

| # | direction | channel | tickers | score | grade | horizon | verified |
|---:|---|---|---|---:|---|---|---|
| 1 | SHORT | 财报预期差 | HLXN | 75.5 | A | days | 75% |
| 2 | LONG | 财报预期差 | CRVS | 70.6 | B | days | 75% |
| 3 | PAIR | 宏观传导链路 | AMD TSLA COIN PFE XOM WMT | 68 | B | days | 100% |
| 4 | SHORT | 财报预期差 | ASTR | 63.4 | B | intraday | 75% |
| 5 | PAIR | 宏观传导链路 | COIN TSLA PLTR PFE XOM WMT | 61.3 | C | days | 100% |
| 6 | AVOID | 反向风险旗 | BLWF | 59.4 | C | weeks | 100% |
| 7 | LONG | 叙事转向 | NWCL | 54.9 | C | weeks | 100% |
| 8 | SHORT | 叙事转向 | HLXN | 53.3 | C | weeks | 100% |
| 9 | WATCH | 跨资产联动 | BTC ETH | 49 | C | intraday | 100% |

## Dossiers

### SHORT · HLXN: EPS miss, guide lower
`SIG-MFR9KE80-008` · Earnings Expectation Gap (财报预期差) · score **75.5/100** (A) · conviction 60 · horizon days · tickers HLXN

**Claim.** HLXN EPS 1.61 vs 1.94 consensus (-17.0% surprise, very large) guidance lower - the expectation gap, not the headline, is what reprices the name.

**Expectation gap.** metric EPS · consensus 1.94 · actual 1.61 · gap -17.01% · guidance lower

**Trade sketch.** entry 464.21-468.87 · stop 482.87 · target 433.88 · risk 0.3% of portfolio · venue native-equity
- sizing: Scale in thirds; full size only if the gap holds into the second session.
- rToken: HLXN rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).

**What would make this wrong.** HLXN reclaims the pre-print close within two sessions and holds, showing the miss was already discounted. Observable level: `466.54`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- A miss into an oversold tape often rallies - direction is not the same as timing.
- Guidance lexicon classified the stance as "lower" from 6 term hits; a single ambiguous sentence can flip this.
- Consensus provenance is the document meta; a stale consensus makes the gap illusory.

**Evidence ledger.**
- ✅ `E1` metric (headline) — hlxn-q2-release @ meta.actual
  > EPS reported: 1.61
  - checked against: hlxn-q2-release meta$.actual
- ⚠️ `E2` estimate (headline) — demo street consensus @ meta.consensus
  > EPS consensus: 1.94
  - note: no document or snapshot available to check this number against
- ✅ `E3` quote — hlxn-q2-release @ chars 0-227 (matched "revenue")
  > Helion Dynamics reported second quarter revenue of 15.2 billion dollars, below the 16.4 billion consensus and down 4 percent year over year, with adjusted earnings per share of 1.61 dollars against expectations of 1.94 dollars.
  - checked against: hlxn-q2-release (exact @0)
- ✅ `E4` quote — hlxn-q2-release @ chars 392-690 (matched "lower")
  > The company lowered its full-year outlook and now expects revenue growth in a range of negative 2 percent to positive 1 percent, reduced from the prior guidance of 3 to 5 percent growth, citing softening demand in construction equipment and a slower-than-expected recovery in industrial automation.
  - checked against: hlxn-q2-release (exact @392)
  - note: guidance stance: lower

**Score breakdown.**
| factor | score | weight | contribution | why |
|---|---:|---:|---:|---|
| surprise | 97.3 | 0.3 | 29.19 | -17% consensus gap -> base 82; consensus confidence 0.9 adjusts +7.5; guidance "lower" confirms the print (+8) |
| corroboration | 75.5 | 0.22 | 16.61 | 3/4 items verified (75%) -> 47; +14 independent sources (2); +12 multi-modal evidence (metric/estimate/quote); +8 headline evidence cleared the ledger; -5 for 1 unverifiable item(s) |
| tradability | 62.5 | 0.18 | 11.25 | best instrument native-equity (liquidity 1) x large-cap coverage 0.55 -> 39; +16 executable levels supplied; +8 sized at 0.3% portfolio risk |
| asymmetry | 66 | 0.2 | 13.2 | reward/risk 2:1 -> 60; +6 invalidation has an observable level, not just a vibe |
| freshness | 52.2 | 0.1 | 5.22 | underlying information is 225h old (source stamped 2025-09-10T11:00) against a 240h half-life for earnings-gap -> decay weight 0.522 |

_expires 2025-09-24 20:00 UTC · extractor rules · sources hlxn-q2-release_

---

### LONG · CRVS: EPS beat, guide raise
`SIG-MFR9KE80-010` · Earnings Expectation Gap (财报预期差) · score **70.6/100** (B) · conviction 84 · horizon days · tickers CRVS

**Claim.** CRVS EPS 1.42 vs 1.24 consensus (+14.5% surprise, large) guidance raise - the expectation gap, not the headline, is what reprices the name.

**Expectation gap.** metric EPS · consensus 1.24 · actual 1.42 · gap +14.52% · guidance raise

**Trade sketch.** entry 176.67-179.32 · stop 170.49 · target 189.04 · risk 0.42% of portfolio · venue native-equity
- sizing: Scale in thirds; full size only if the gap holds into the second session.
- rToken: CRVS rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).

**What would make this wrong.** Post-print follow-through fails: CRVS gives back the gap and closes below the prior close, or management walks back the guide on the next appearance. Observable level: `176.67`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- A beat already discounted shows up as a sell-the-news reaction regardless of the number.
- Guidance lexicon classified the stance as "raise" from 5 term hits; a single ambiguous sentence can flip this.
- Consensus provenance is the document meta; a stale consensus makes the gap illusory.

**Evidence ledger.**
- ✅ `E1` metric (headline) — crvs-q2-release @ meta.actual
  > EPS reported: 1.42
  - checked against: crvs-q2-release meta$.actual
- ⚠️ `E2` estimate (headline) — demo street consensus @ meta.consensus
  > EPS consensus: 1.24
  - note: no document or snapshot available to check this number against
- ✅ `E3` quote — crvs-q2-release @ chars 0-142 (matched "outlook")
  > Corvus Semiconductor today reported second quarter fiscal 2025 results that exceeded the company's prior outlook on both revenue and earnings.
  - checked against: crvs-q2-release (exact @0)
- ✅ `E4` quote — crvs-q2-release @ chars 803-1021 (matched "raise")
  > For the third quarter the company raised its outlook and now expects revenue of approximately 10.9 billion dollars, plus or minus 2 percent, above the 10.2 billion consensus, with non-GAAP gross margin of 72.5 percent.
  - checked against: crvs-q2-release (exact @803)
  - note: guidance stance: raise

_expires 2025-09-24 20:00 UTC · extractor rules · sources crvs-q2-release_

---

### PAIR · CPI Y/Y (AUG 2025) cool: Cooler inflation pulls the terminal policy rate lower
`SIG-MFR9KE80-003` · Macro Transmission Chain (宏观传导链路) · score **68/100** (B) · conviction 60 · horizon days · tickers AMD, TSLA, COIN, PFE, XOM, WMT

**Claim.** CPI y/y (Aug 2025) printed 2.9 vs 3.1 consensus (-1.33 sigma). Cooler inflation pulls the terminal policy rate lower, cutting the discount rate and re-rating long-dated cash flows. Measured exposure ranking puts AMD, TSLA, COIN most exposed and PFE, XOM, WMT best positioned.

**Expectation gap.** metric CPI y/y (Aug 2025) · consensus 3.1 · actual 2.9 · gap -6.45% · -1.33 sigma

**Transmission chain.**
1. `CPI y/y (Aug 2025) surprise to the downside` → `energyWeight` — Disinflation removes the commodity bid _(confidence 0.61, measured by energyBeta (OLS beta, trailing 252 sessions))_
   - most exposed: AMD 0.928, TSLA 0.912, COIN 0.888, XOM 0.854, PLTR 0.768
2. `CPI y/y (Aug 2025) surprise to the downside` → `duration` — Long-duration growth re-rates higher as the discount rate falls _(confidence 0.61, measured by growthBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PFE 0.251, XOM 0.334, WMT 0.484, JPM 0.748, MSFT 0.81
3. `CPI y/y (Aug 2025) surprise to the downside` → `rateBeta` — Rate-sensitive proxies rally with the bond complex _(confidence 0.61, measured by rateBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PLTR -0.518, COIN -0.359, JPM -0.24, NVDA -0.169, AMZN -0.056
4. `CPI y/y (Aug 2025) surprise to the downside` → `leverage` — Cheaper refinancing for levered balance sheets _(confidence 0.61, measured by smallBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PFE 0.401, WMT 0.415, XOM 0.435, NFLX 0.515, MSFT 0.573

**Trade sketch.** pair long PFE / short AMD · risk 0.5% of portfolio · venue native-equity
- sizing: Dollar-neutral pair; size to the spread, not to either leg.
- rToken: If the print lands while the cash market is shut, the rToken leg prices it first - see the closed-window card generated for the same event.

**What would make this wrong.** The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime. Observable level: `pair spread vs SPY < 50bp after 2 sessions`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- Single macro prints have a poor signal-to-noise ratio; one observation is not a regime.
- Exposures are trailing-252 OLS betas and rotate. A name that was duration-sensitive last quarter may not be now (asOf 2025-09-19).
- Positioning matters: if everyone is already positioned for this transmission, the trade is crowded and the realised move inverts.

**Evidence ledger.**
- ✅ `E1` metric (headline) — cpi-2025-08 @ meta.actual
  > CPI Y/Y (AUG 2025) actual 2.9% vs consensus 3.1
  - checked against: cpi-2025-08 meta$.actual
- ✅ `E2` quote — cpi-2025-08 @ chars 0-230 (matched "percent")
  > The consumer price index rose 2.9 percent over the twelve months to August, below the 3.1 percent consensus but above the 2.7 percent prior reading, and the monthly increase of 0.4 percent was hotter than the 0.3 percent expected.
  - checked against: cpi-2025-08 (exact @0)

_expires 2025-09-24 20:00 UTC · extractor rules · sources cpi-2025-08_

---

### SHORT · ASTR: EPS miss, guide withdraw
`SIG-MFR9KE80-002` · Earnings Expectation Gap (财报预期差) · score **63.4/100** (B) · conviction 36 · horizon intraday · tickers ASTR

**Claim.** ASTR EPS 0.58 vs 0.61 consensus (-4.9% surprise, meaningful) guidance withdraw - the expectation gap, not the headline, is what reprices the name.

**Expectation gap.** metric EPS · consensus 0.61 · actual 0.58 · gap -4.92% · guidance withdraw

**Trade sketch.** entry 101.82-102.84 · stop 105.91 · target 95.17 · risk 0.25% of portfolio · venue native-equity
- sizing: Scale in thirds; full size only if the gap holds into the second session.
- rToken: ASTR rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).

**What would make this wrong.** ASTR reclaims the pre-print close within two sessions and holds, showing the miss was already discounted. Observable level: `102.33`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- A miss into an oversold tape often rallies - direction is not the same as timing.
- Guidance lexicon classified the stance as "withdraw" from 3 term hits; a single ambiguous sentence can flip this.
- Consensus provenance is the document meta; a stale consensus makes the gap illusory.

**Evidence ledger.**
- ✅ `E1` metric (headline) — astr-guidance-withdrawal @ meta.actual
  > EPS reported: 0.58
  - checked against: astr-guidance-withdrawal meta$.actual
- ⚠️ `E2` estimate (headline) — demo street consensus @ meta.consensus
  > EPS consensus: 0.61
  - note: no document or snapshot available to check this number against
- ✅ `E3` quote — astr-guidance-withdrawal @ chars 159-387 (matched "guidance")
  > The company withdrew its full-year outlook, stating that it is unable to provide guidance at this time because of unusual uncertainty around consumer demand and the effect of newly announced import levies on landed product cost.
  - checked against: astr-guidance-withdrawal (exact @159)
- ✅ `E4` quote — astr-guidance-withdrawal @ chars 159-387 (matched "withdrew")
  > The company withdrew its full-year outlook, stating that it is unable to provide guidance at this time because of unusual uncertainty around consumer demand and the effect of newly announced import levies on landed product cost.
  - checked against: astr-guidance-withdrawal (exact @159)
  - note: guidance stance: withdraw

_expires 2025-09-20 04:00 UTC · extractor rules · sources astr-guidance-withdrawal_

---

### PAIR · NONFARM PAYROLLS (AUG 2025) cool: A cooling labor market raises easing odds but also recession risk - a two-sided shock.
`SIG-MFR9KE80-012` · Macro Transmission Chain (宏观传导链路) · score **61.3/100** (C) · conviction 55 · horizon days · tickers COIN, TSLA, PLTR, PFE, XOM, WMT

**Claim.** Nonfarm payrolls (Aug 2025) printed 22 vs 75 consensus (-0.88 sigma). A cooling labor market raises easing odds but also recession risk - a two-sided shock. Measured exposure ranking puts COIN, TSLA, PLTR most exposed and PFE, XOM, WMT best positioned.

**Expectation gap.** metric Nonfarm payrolls (Aug 2025) · consensus 75 · actual 22 · gap -70.67% · -0.88 sigma

**Transmission chain.**
1. `Nonfarm payrolls (Aug 2025) surprise to the downside` → `cyclical` — Demand-sensitive cyclicals take the growth scare _(confidence 0.56, measured by mktBeta (OLS beta, trailing 252 sessions))_
   - most exposed: COIN 2.321, TSLA 2.291, PLTR 2.013, AMD 1.882, NVDA 1.846
2. `Nonfarm payrolls (Aug 2025) surprise to the downside` → `duration` — Rate-cut expectations lift long-duration growth _(confidence 0.56, measured by growthBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PFE 0.251, XOM 0.334, WMT 0.484, JPM 0.748, MSFT 0.81

**Trade sketch.** pair long PFE / short COIN · risk 0.5% of portfolio · venue native-equity
- sizing: Dollar-neutral pair; size to the spread, not to either leg.
- rToken: If the print lands while the cash market is shut, the rToken leg prices it first - see the closed-window card generated for the same event.

**What would make this wrong.** The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime. Observable level: `pair spread vs SPY < 50bp after 2 sessions`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- Single macro prints have a poor signal-to-noise ratio; one observation is not a regime.
- Exposures are trailing-252 OLS betas and rotate. A name that was duration-sensitive last quarter may not be now (asOf 2025-09-19).
- Positioning matters: if everyone is already positioned for this transmission, the trade is crowded and the realised move inverts.

**Evidence ledger.**
- ✅ `E1` metric (headline) — nfp-2025-08 @ meta.actual
  > NONFARM PAYROLLS (AUG 2025) actual 22 vs consensus 75
  - checked against: nfp-2025-08 meta$.actual
- ✅ `E2` quote — nfp-2025-08 @ chars 0-150 (matched "employment")
  > Nonfarm payroll employment rose by 22,000 in August, well below the 75,000 economists had expected and sharply lower than the 79,000 recorded in July.
  - checked against: nfp-2025-08 (exact @0)

_expires 2025-09-24 20:00 UTC · extractor rules · sources nfp-2025-08_

---

### AVOID · BLWF: 14 contrarian risk flag(s)
`SIG-MFR9KE80-011` · Contrarian Risk Flag (反向风险旗) · score **59.4/100** (C) · conviction 75 · horizon weeks · tickers BLWF

**Claim.** BLWF carries 11 adverse-language flag(s) (material weakness, restatement, delayed filing, investigation) and 3 accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.

**What would make this wrong.** The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters. Observable level: `flags -> 0 for 2 quarters`. Recheck: 2025-12-18T20:00:00.000Z.

**Bear case.**
- Risk language is often boilerplate; a single 10-K can carry 20 of these terms with nothing behind them.
- Ratio flags need at least two periods of context - one quarter of divergence is noise.

**Evidence ledger.**
- ✅ `E1` filing (headline) — blwf-10q-excerpt @ chars 33-246 (matched "customer concentration")
  > The company's ability to sustain revenue growth depends on a small number of products, and it faces customer concentration with three wholesale distributors accounting for a substantial majority of domestic sales.
  - checked against: blwf-10q-excerpt (exact @33)
  - note: risk terms: material weakness, restatement, delayed filing, investigation, subpoena, goodwill impairment, covenant, customer concentration, declining retention, churn, days sales outstanding increased
- ✅ `E2` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Receivables growing faster than revenue
  - checked against: blwf-10q-excerpt meta.ratioChecks
- ✅ `E3` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Positive net income but negative free cash flow
  - checked against: blwf-10q-excerpt meta.ratioChecks
- ✅ `E4` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Inventory building faster than sales
  - checked against: blwf-10q-excerpt meta.ratioChecks

_expires 2025-10-10 20:00 UTC · extractor rules · sources blwf-10q-excerpt_

---

## Ledger

Items checked 26 · pass 23 · fail 0 · unverifiable 3 · pass rate 88.5% · cards quarantined 0

_Prism produces research inputs. A human takes the trade._

---

## Scenario: Earnings expectation gaps / 财报预期差

> Walk me through the earnings expectation gaps in scope. Which print is wide enough versus consensus to actually reprice the name, and which is already discounted?

_as-of 2025-09-19T20:00:00.000Z - channels earnings-gap, risk-flag - 30ms - extractor rules_

**What it demonstrates.** Shows consensus-vs-actual, guidance stance classification and the beat-but-ugly case.

# Prism Desk brief

**As of** 2025-09-19 20:00 UTC · **US cash session** pre-market · **data** offline · **extractor** deterministic rules
**Question** Walk me through the earnings expectation gaps in scope. Which print is wide enough versus consensus to actually reprice the name, and which is already discounted?

## Asked about, but silent

No card was produced for **CAT**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

## Headline

**HLXN: EPS miss, guide lower** — SHORT, score 75.5/100.

## Ranked cards

| # | direction | channel | tickers | score | grade | horizon | verified |
|---:|---|---|---|---:|---|---|---|
| 1 | SHORT | 财报预期差 | HLXN | 75.5 | A | days | 75% |
| 2 | LONG | 财报预期差 | CRVS | 70.6 | B | days | 75% |
| 3 | SHORT | 财报预期差 | ASTR | 63.4 | B | intraday | 75% |
| 4 | AVOID | 反向风险旗 | BLWF | 59.4 | C | weeks | 100% |

## Dossiers

### SHORT · HLXN: EPS miss, guide lower
`SIG-MFR9KE80-021` · Earnings Expectation Gap (财报预期差) · score **75.5/100** (A) · conviction 60 · horizon days · tickers HLXN

**Claim.** HLXN EPS 1.61 vs 1.94 consensus (-17.0% surprise, very large) guidance lower - the expectation gap, not the headline, is what reprices the name.

**Expectation gap.** metric EPS · consensus 1.94 · actual 1.61 · gap -17.01% · guidance lower

**Trade sketch.** entry 464.21-468.87 · stop 482.87 · target 433.88 · risk 0.3% of portfolio · venue native-equity
- sizing: Scale in thirds; full size only if the gap holds into the second session.
- rToken: HLXN rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).

**What would make this wrong.** HLXN reclaims the pre-print close within two sessions and holds, showing the miss was already discounted. Observable level: `466.54`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- A miss into an oversold tape often rallies - direction is not the same as timing.
- Guidance lexicon classified the stance as "lower" from 6 term hits; a single ambiguous sentence can flip this.
- Consensus provenance is the document meta; a stale consensus makes the gap illusory.

**Evidence ledger.**
- ✅ `E1` metric (headline) — hlxn-q2-release @ meta.actual
  > EPS reported: 1.61
  - checked against: hlxn-q2-release meta$.actual
- ⚠️ `E2` estimate (headline) — demo street consensus @ meta.consensus
  > EPS consensus: 1.94
  - note: no document or snapshot available to check this number against
- ✅ `E3` quote — hlxn-q2-release @ chars 0-227 (matched "revenue")
  > Helion Dynamics reported second quarter revenue of 15.2 billion dollars, below the 16.4 billion consensus and down 4 percent year over year, with adjusted earnings per share of 1.61 dollars against expectations of 1.94 dollars.
  - checked against: hlxn-q2-release (exact @0)
- ✅ `E4` quote — hlxn-q2-release @ chars 392-690 (matched "lower")
  > The company lowered its full-year outlook and now expects revenue growth in a range of negative 2 percent to positive 1 percent, reduced from the prior guidance of 3 to 5 percent growth, citing softening demand in construction equipment and a slower-than-expected recovery in industrial automation.
  - checked against: hlxn-q2-release (exact @392)
  - note: guidance stance: lower

**Score breakdown.**
| factor | score | weight | contribution | why |
|---|---:|---:|---:|---|
| surprise | 97.3 | 0.3 | 29.19 | -17% consensus gap -> base 82; consensus confidence 0.9 adjusts +7.5; guidance "lower" confirms the print (+8) |
| corroboration | 75.5 | 0.22 | 16.61 | 3/4 items verified (75%) -> 47; +14 independent sources (2); +12 multi-modal evidence (metric/estimate/quote); +8 headline evidence cleared the ledger; -5 for 1 unverifiable item(s) |
| tradability | 62.5 | 0.18 | 11.25 | best instrument native-equity (liquidity 1) x large-cap coverage 0.55 -> 39; +16 executable levels supplied; +8 sized at 0.3% portfolio risk |
| asymmetry | 66 | 0.2 | 13.2 | reward/risk 2:1 -> 60; +6 invalidation has an observable level, not just a vibe |
| freshness | 52.2 | 0.1 | 5.22 | underlying information is 225h old (source stamped 2025-09-10T11:00) against a 240h half-life for earnings-gap -> decay weight 0.522 |

_expires 2025-09-24 20:00 UTC · extractor rules · sources hlxn-q2-release_

---

### LONG · CRVS: EPS beat, guide raise
`SIG-MFR9KE80-023` · Earnings Expectation Gap (财报预期差) · score **70.6/100** (B) · conviction 84 · horizon days · tickers CRVS

**Claim.** CRVS EPS 1.42 vs 1.24 consensus (+14.5% surprise, large) guidance raise - the expectation gap, not the headline, is what reprices the name.

**Expectation gap.** metric EPS · consensus 1.24 · actual 1.42 · gap +14.52% · guidance raise

**Trade sketch.** entry 176.67-179.32 · stop 170.49 · target 189.04 · risk 0.42% of portfolio · venue native-equity
- sizing: Scale in thirds; full size only if the gap holds into the second session.
- rToken: CRVS rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).

**What would make this wrong.** Post-print follow-through fails: CRVS gives back the gap and closes below the prior close, or management walks back the guide on the next appearance. Observable level: `176.67`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- A beat already discounted shows up as a sell-the-news reaction regardless of the number.
- Guidance lexicon classified the stance as "raise" from 5 term hits; a single ambiguous sentence can flip this.
- Consensus provenance is the document meta; a stale consensus makes the gap illusory.

**Evidence ledger.**
- ✅ `E1` metric (headline) — crvs-q2-release @ meta.actual
  > EPS reported: 1.42
  - checked against: crvs-q2-release meta$.actual
- ⚠️ `E2` estimate (headline) — demo street consensus @ meta.consensus
  > EPS consensus: 1.24
  - note: no document or snapshot available to check this number against
- ✅ `E3` quote — crvs-q2-release @ chars 0-142 (matched "outlook")
  > Corvus Semiconductor today reported second quarter fiscal 2025 results that exceeded the company's prior outlook on both revenue and earnings.
  - checked against: crvs-q2-release (exact @0)
- ✅ `E4` quote — crvs-q2-release @ chars 803-1021 (matched "raise")
  > For the third quarter the company raised its outlook and now expects revenue of approximately 10.9 billion dollars, plus or minus 2 percent, above the 10.2 billion consensus, with non-GAAP gross margin of 72.5 percent.
  - checked against: crvs-q2-release (exact @803)
  - note: guidance stance: raise

_expires 2025-09-24 20:00 UTC · extractor rules · sources crvs-q2-release_

---

### SHORT · ASTR: EPS miss, guide withdraw
`SIG-MFR9KE80-015` · Earnings Expectation Gap (财报预期差) · score **63.4/100** (B) · conviction 36 · horizon intraday · tickers ASTR

**Claim.** ASTR EPS 0.58 vs 0.61 consensus (-4.9% surprise, meaningful) guidance withdraw - the expectation gap, not the headline, is what reprices the name.

**Expectation gap.** metric EPS · consensus 0.61 · actual 0.58 · gap -4.92% · guidance withdraw

**Trade sketch.** entry 101.82-102.84 · stop 105.91 · target 95.17 · risk 0.25% of portfolio · venue native-equity
- sizing: Scale in thirds; full size only if the gap holds into the second session.
- rToken: ASTR rToken trades through the cash close - if the print lands outside RTH the rToken is the only venue that can price it (see closed-window channel).

**What would make this wrong.** ASTR reclaims the pre-print close within two sessions and holds, showing the miss was already discounted. Observable level: `102.33`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- A miss into an oversold tape often rallies - direction is not the same as timing.
- Guidance lexicon classified the stance as "withdraw" from 3 term hits; a single ambiguous sentence can flip this.
- Consensus provenance is the document meta; a stale consensus makes the gap illusory.

**Evidence ledger.**
- ✅ `E1` metric (headline) — astr-guidance-withdrawal @ meta.actual
  > EPS reported: 0.58
  - checked against: astr-guidance-withdrawal meta$.actual
- ⚠️ `E2` estimate (headline) — demo street consensus @ meta.consensus
  > EPS consensus: 0.61
  - note: no document or snapshot available to check this number against
- ✅ `E3` quote — astr-guidance-withdrawal @ chars 159-387 (matched "guidance")
  > The company withdrew its full-year outlook, stating that it is unable to provide guidance at this time because of unusual uncertainty around consumer demand and the effect of newly announced import levies on landed product cost.
  - checked against: astr-guidance-withdrawal (exact @159)
- ✅ `E4` quote — astr-guidance-withdrawal @ chars 159-387 (matched "withdrew")
  > The company withdrew its full-year outlook, stating that it is unable to provide guidance at this time because of unusual uncertainty around consumer demand and the effect of newly announced import levies on landed product cost.
  - checked against: astr-guidance-withdrawal (exact @159)
  - note: guidance stance: withdraw

_expires 2025-09-20 04:00 UTC · extractor rules · sources astr-guidance-withdrawal_

---

### AVOID · BLWF: 14 contrarian risk flag(s)
`SIG-MFR9KE80-024` · Contrarian Risk Flag (反向风险旗) · score **59.4/100** (C) · conviction 75 · horizon weeks · tickers BLWF

**Claim.** BLWF carries 11 adverse-language flag(s) (material weakness, restatement, delayed filing, investigation) and 3 accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.

**What would make this wrong.** The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters. Observable level: `flags -> 0 for 2 quarters`. Recheck: 2025-12-18T20:00:00.000Z.

**Bear case.**
- Risk language is often boilerplate; a single 10-K can carry 20 of these terms with nothing behind them.
- Ratio flags need at least two periods of context - one quarter of divergence is noise.

**Evidence ledger.**
- ✅ `E1` filing (headline) — blwf-10q-excerpt @ chars 33-246 (matched "customer concentration")
  > The company's ability to sustain revenue growth depends on a small number of products, and it faces customer concentration with three wholesale distributors accounting for a substantial majority of domestic sales.
  - checked against: blwf-10q-excerpt (exact @33)
  - note: risk terms: material weakness, restatement, delayed filing, investigation, subpoena, goodwill impairment, covenant, customer concentration, declining retention, churn, days sales outstanding increased
- ✅ `E2` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Receivables growing faster than revenue
  - checked against: blwf-10q-excerpt meta.ratioChecks
- ✅ `E3` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Positive net income but negative free cash flow
  - checked against: blwf-10q-excerpt meta.ratioChecks
- ✅ `E4` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Inventory building faster than sales
  - checked against: blwf-10q-excerpt meta.ratioChecks

_expires 2025-10-10 20:00 UTC · extractor rules · sources blwf-10q-excerpt_

---

## Ledger

Items checked 42 · pass 36 · fail 0 · unverifiable 6 · pass rate 85.7% · cards quarantined 0

_Prism produces research inputs. A human takes the trade._

---

## Scenario: CPI transmission / CPI 传导链路

> The August CPI print came in cool on the headline but hot on core. Map the transmission chain and tell me who is most exposed cross-sectionally.

_as-of 2025-09-19T20:00:00.000Z - channels macro-transmission - 30ms - extractor rules_

**What it demonstrates.** The ranking is computed from measured 252-session OLS betas, not asserted.

# Prism Desk brief

**As of** 2025-09-19 20:00 UTC · **US cash session** pre-market · **data** offline · **extractor** deterministic rules
**Question** The August CPI print came in cool on the headline but hot on core. Map the transmission chain and tell me who is most exposed cross-sectionally.

## Asked about, but silent

No card was produced for **CAT, ASTR**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

## Headline

**CPI Y/Y (AUG 2025) cool: Cooler inflation pulls the terminal policy rate lower** — PAIR, score 68/100.

## Ranked cards

| # | direction | channel | tickers | score | grade | horizon | verified |
|---:|---|---|---|---:|---|---|---|
| 1 | PAIR | 宏观传导链路 | AMD TSLA COIN PFE XOM WMT | 68 | B | days | 100% |
| 2 | PAIR | 宏观传导链路 | COIN TSLA PLTR PFE XOM WMT | 61.3 | C | days | 100% |

## Dossiers

### PAIR · CPI Y/Y (AUG 2025) cool: Cooler inflation pulls the terminal policy rate lower
`SIG-MFR9KE80-028` · Macro Transmission Chain (宏观传导链路) · score **68/100** (B) · conviction 60 · horizon days · tickers AMD, TSLA, COIN, PFE, XOM, WMT

**Claim.** CPI y/y (Aug 2025) printed 2.9 vs 3.1 consensus (-1.33 sigma). Cooler inflation pulls the terminal policy rate lower, cutting the discount rate and re-rating long-dated cash flows. Measured exposure ranking puts AMD, TSLA, COIN most exposed and PFE, XOM, WMT best positioned.

**Expectation gap.** metric CPI y/y (Aug 2025) · consensus 3.1 · actual 2.9 · gap -6.45% · -1.33 sigma

**Transmission chain.**
1. `CPI y/y (Aug 2025) surprise to the downside` → `energyWeight` — Disinflation removes the commodity bid _(confidence 0.61, measured by energyBeta (OLS beta, trailing 252 sessions))_
   - most exposed: AMD 0.928, TSLA 0.912, COIN 0.888, XOM 0.854, PLTR 0.768
2. `CPI y/y (Aug 2025) surprise to the downside` → `duration` — Long-duration growth re-rates higher as the discount rate falls _(confidence 0.61, measured by growthBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PFE 0.251, XOM 0.334, WMT 0.484, JPM 0.748, MSFT 0.81
3. `CPI y/y (Aug 2025) surprise to the downside` → `rateBeta` — Rate-sensitive proxies rally with the bond complex _(confidence 0.61, measured by rateBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PLTR -0.518, COIN -0.359, JPM -0.24, NVDA -0.169, AMZN -0.056
4. `CPI y/y (Aug 2025) surprise to the downside` → `leverage` — Cheaper refinancing for levered balance sheets _(confidence 0.61, measured by smallBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PFE 0.401, WMT 0.415, XOM 0.435, NFLX 0.515, MSFT 0.573

**Trade sketch.** pair long PFE / short AMD · risk 0.5% of portfolio · venue native-equity
- sizing: Dollar-neutral pair; size to the spread, not to either leg.
- rToken: If the print lands while the cash market is shut, the rToken leg prices it first - see the closed-window card generated for the same event.

**What would make this wrong.** The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime. Observable level: `pair spread vs SPY < 50bp after 2 sessions`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- Single macro prints have a poor signal-to-noise ratio; one observation is not a regime.
- Exposures are trailing-252 OLS betas and rotate. A name that was duration-sensitive last quarter may not be now (asOf 2025-09-19).
- Positioning matters: if everyone is already positioned for this transmission, the trade is crowded and the realised move inverts.

**Evidence ledger.**
- ✅ `E1` metric (headline) — cpi-2025-08 @ meta.actual
  > CPI Y/Y (AUG 2025) actual 2.9% vs consensus 3.1
  - checked against: cpi-2025-08 meta$.actual
- ✅ `E2` quote — cpi-2025-08 @ chars 0-230 (matched "percent")
  > The consumer price index rose 2.9 percent over the twelve months to August, below the 3.1 percent consensus but above the 2.7 percent prior reading, and the monthly increase of 0.4 percent was hotter than the 0.3 percent expected.
  - checked against: cpi-2025-08 (exact @0)

**Score breakdown.**
| factor | score | weight | contribution | why |
|---|---:|---:|---:|---|
| surprise | 65.4 | 0.3 | 19.62 | -1.33 sigma surprise -> base 65; consensus confidence 0.6333333333333335 adjusts +0.8 |
| corroboration | 80.9 | 0.22 | 17.8 | 2/2 items verified (100%) -> 62; single source: no independent corroboration (+0); +6 two evidence modalities; +8 headline evidence cleared the ledger; +4.9 transmission chain (mean hop confidence 0.61) |
| tradability | 83.5 | 0.18 | 15.03 | best instrument native-equity (liquidity 1) x large-cap coverage 0.85 -> 60; +16 executable levels supplied; +8 sized at 0.5% portfolio risk |
| asymmetry | 62 | 0.2 | 12.4 | Market-neutral pair PFE/AMD: asymmetry comes from spread convergence, capped at 62 because the legs can diverge indefinitely. |
| freshness | 31.6 | 0.1 | 3.16 | underlying information is 199.5h old (source stamped 2025-09-11T12:30) against a 120h half-life for macro-transmission -> decay weight 0.316 |

_expires 2025-09-24 20:00 UTC · extractor rules · sources cpi-2025-08_

---

### PAIR · NONFARM PAYROLLS (AUG 2025) cool: A cooling labor market raises easing odds but also recession risk - a two-sided shock.
`SIG-MFR9KE80-037` · Macro Transmission Chain (宏观传导链路) · score **61.3/100** (C) · conviction 55 · horizon days · tickers COIN, TSLA, PLTR, PFE, XOM, WMT

**Claim.** Nonfarm payrolls (Aug 2025) printed 22 vs 75 consensus (-0.88 sigma). A cooling labor market raises easing odds but also recession risk - a two-sided shock. Measured exposure ranking puts COIN, TSLA, PLTR most exposed and PFE, XOM, WMT best positioned.

**Expectation gap.** metric Nonfarm payrolls (Aug 2025) · consensus 75 · actual 22 · gap -70.67% · -0.88 sigma

**Transmission chain.**
1. `Nonfarm payrolls (Aug 2025) surprise to the downside` → `cyclical` — Demand-sensitive cyclicals take the growth scare _(confidence 0.56, measured by mktBeta (OLS beta, trailing 252 sessions))_
   - most exposed: COIN 2.321, TSLA 2.291, PLTR 2.013, AMD 1.882, NVDA 1.846
2. `Nonfarm payrolls (Aug 2025) surprise to the downside` → `duration` — Rate-cut expectations lift long-duration growth _(confidence 0.56, measured by growthBeta (OLS beta, trailing 252 sessions))_
   - most exposed: PFE 0.251, XOM 0.334, WMT 0.484, JPM 0.748, MSFT 0.81

**Trade sketch.** pair long PFE / short COIN · risk 0.5% of portfolio · venue native-equity
- sizing: Dollar-neutral pair; size to the spread, not to either leg.
- rToken: If the print lands while the cash market is shut, the rToken leg prices it first - see the closed-window card generated for the same event.

**What would make this wrong.** The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime. Observable level: `pair spread vs SPY < 50bp after 2 sessions`. Recheck: 2025-09-21T20:00:00.000Z.

**Bear case.**
- Single macro prints have a poor signal-to-noise ratio; one observation is not a regime.
- Exposures are trailing-252 OLS betas and rotate. A name that was duration-sensitive last quarter may not be now (asOf 2025-09-19).
- Positioning matters: if everyone is already positioned for this transmission, the trade is crowded and the realised move inverts.

**Evidence ledger.**
- ✅ `E1` metric (headline) — nfp-2025-08 @ meta.actual
  > NONFARM PAYROLLS (AUG 2025) actual 22 vs consensus 75
  - checked against: nfp-2025-08 meta$.actual
- ✅ `E2` quote — nfp-2025-08 @ chars 0-150 (matched "employment")
  > Nonfarm payroll employment rose by 22,000 in August, well below the 75,000 economists had expected and sharply lower than the 79,000 recorded in July.
  - checked against: nfp-2025-08 (exact @0)

_expires 2025-09-24 20:00 UTC · extractor rules · sources nfp-2025-08_

---

## Ledger

Items checked 46 · pass 40 · fail 0 · unverifiable 6 · pass rate 87% · cards quarantined 0

_Prism produces research inputs. A human takes the trade._

---

## Scenario: Weekend rToken window / 周末 rToken 窗口

> A tariff framework just landed on a Saturday afternoon. The cash market is shut for 47 hours but the rToken still trades. How should I think about pricing that gap?

_as-of 2025-09-13T15:00:00.000Z - channels closed-window, cross-asset - 32ms - extractor rules_

**What it demonstrates.** The core S2 scenario: 7x24 tokenized equity versus a 6.5-hour cash session.

# Prism Desk brief

**As of** 2025-09-13 15:00 UTC · **US cash session** pre-market · **data** offline · **extractor** deterministic rules
**Question** A tariff framework just landed on a Saturday afternoon. The cash market is shut for 47 hours but the rToken still trades. How should I think about pricing that gap?

## Asked about, but silent

No card was produced for **CAT**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

## Headline

**closed window: SPY has no cash price discovery** — WATCH, score 58.3/100.

## Ranked cards

| # | direction | channel | tickers | score | grade | horizon | verified |
|---:|---|---|---|---:|---|---|---|
| 1 | WATCH | 休市窗口定价 | SPY | 58.3 | C | intraday | 100% |
| 2 | WATCH | 跨资产联动 | BTC ETH | 49 | C | intraday | 100% |

## Dossiers

### WATCH · closed window: SPY has no cash price discovery
`SIG-MFIE7HC0-052` · Closed-Window Pricing (休市窗口定价) · score **58.3/100** (C) · conviction 55 · horizon intraday · tickers SPY

**Claim.** The US cash session is closed (weekend) but the SPY rToken still trades. Information from "Weekend wire: new tariff framework announced outside market hours" can only be priced on the rToken until the next open. Across 44 comparable historical gaps in SPY, the gap direction continued 45.5% of the time and reverted 45.5% of the time; the median |gap| was 1.23%.

**Trade sketch.** risk 0.25% of portfolio · venue rtoken
- sizing: Half the size you would take in the native share; the exit is the constraint, not the entry.
- rToken: Only the rToken trades. Size for the fact that you cannot exit into a cash market and that rToken liquidity is materially thinner than the native share.

**What would make this wrong.** The rToken premium/dislocation to the last cash close collapses before the open, meaning the information was already fully priced by the token market. Observable level: `rToken vs last cash close within 0.3%`. Recheck: at the next cash open.

**Bear case.**
- rToken liquidity is thin; the observable price may be a stale print rather than a real clearing level.
- Mint/redeem arbitrage can compress the dislocation faster than the information warrants.
- Historical gap behaviour on the NATIVE share is not the same process as rToken pricing; 44 observations is a prior, not a law.

**Evidence ledger.**
- ✅ `E1` calendar (headline) — session-clock @ computed
  > US cash session state at 2025-09-13T15:00:00.000Z: closed
  - checked against: session clock
- ✅ `E2` news — weekend-policy-shock @ document
  > Weekend wire: new tariff framework announced outside market hours
  - checked against: weekend-policy-shock title (exact)
- ✅ `E3` computed — price-book @ gap study on SPY
  > 44 historical overnight gaps: continued 45.5%, reverted 45.5%, median |gap| 1.23%
  - checked against: recomputed gap study on SPY: 44 gaps, continued 45.5%
  - note: engine re-executed the recipe and reproduced the figure

**Score breakdown.**
| factor | score | weight | contribution | why |
|---|---:|---:|---:|---|
| surprise | 52 | 0.3 | 15.6 | Structural channel - the surprise is the session/liquidity regime itself, not a data print. |
| corroboration | 96 | 0.22 | 21.12 | 3/3 items verified (100%) -> 62; +14 independent sources (3); +12 multi-modal evidence (calendar/news/computed); +8 headline evidence cleared the ledger |
| tradability | 27.5 | 0.18 | 4.95 | best instrument rtoken (liquidity 0.45) x large-cap coverage 1 -> 32; +8 sized at 0.25% portfolio risk; -8 rToken-only: thinner book, and mint/redeem arb can close the gap without you; -4 intraday horizon demands fast execution |
| asymmetry | 35 | 0.2 | 7 | Trade sketch is missing at least one of entry / stop / target. |
| freshness | 96.1 | 0.1 | 9.61 | underlying information is 0.9h old (source stamped 2025-09-13T14:05) against a 16h half-life for closed-window -> decay weight 0.961 |

_expires 2025-09-13 23:00 UTC · extractor rules · sources weekend-policy-shock_

---

### WATCH · Crypto regime: Fear & Greed 41 (Fear) | BTC funding 0.0081 | US spot BTC ETF flow -184000000
`SIG-MFIE7HC0-053` · Cross-Asset Linkage (跨资产联动) · score **49/100** (C) · conviction 28 · horizon intraday · tickers BTC, ETH

**Claim.** Crypto-side positioning reads Fear & Greed 41 (Fear), BTC funding 0.0081, US spot BTC ETF flow -184000000. Because tokenized US equities settle on crypto rails, an unremarkable crypto regime changes who is awake to trade the rToken when US macro lands outside cash hours.

**What would make this wrong.** Fear & Greed returns inside the 35-65 band and funding normalises, i.e. the crypto complex stops driving marginal rToken liquidity. Observable level: `F&G in [35,65]`. Recheck: 2025-09-14T15:00:00.000Z.

**Bear case.**
- Crypto sentiment is a liquidity proxy, not an equity fundamental.
- The correlation between crypto regime and rToken mispricing is stable in stress and absent in calm.

**Evidence ledger.**
- ✅ `E1` sentiment (headline) — fixture @ sentiment-analyst
  > Fear & Greed 41 (Fear); BTC funding 0.0081; US spot BTC ETF flow -184000000
  - checked against: fixture $.fearGreed.value

_expires 2025-09-13 23:00 UTC · extractor rules · sources n/a_

---

## Below publish threshold

- ⏸ `SIG-MFIE7HC0-051` closed window: ASTR has no cash price discovery — score 44.9 (D)

## Ledger

Items checked 53 · pass 46 · fail 0 · unverifiable 7 · pass rate 86.8% · cards quarantined 0

_Prism produces research inputs. A human takes the trade._

---

## Scenario: Insider and 13F flows / 内部人与 13F 资金

> Any insider selling clusters or 13F position changes I should know about?

_as-of 2025-09-19T20:00:00.000Z - channels flow-footprint - 32ms - extractor rules_

**What it demonstrates.** Aggregates are recomputed from the raw snapshot by the evidence ledger.

# Prism Desk brief

**As of** 2025-09-19 20:00 UTC · **US cash session** pre-market · **data** offline · **extractor** deterministic rules
**Question** Any insider selling clusters or 13F position changes I should know about?

## Asked about, but silent

No card was produced for **CAT, ASTR**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

## Headline

**HLXN: 4 insider sale(s) vs 1 purchase(s)** — WATCH, score 52.1/100.

## Ranked cards

| # | direction | channel | tickers | score | grade | horizon | verified |
|---:|---|---|---|---:|---|---|---|
| 1 | WATCH | 资金足迹 | HLXN | 52.1 | C | weeks | 100% |
| 2 | WATCH | 资金足迹 | NWCL | 47.6 | D | weeks | 100% |

## Dossiers

### WATCH · HLXN: 4 insider sale(s) vs 1 purchase(s)
`SIG-MFR9KE80-067` · Flow Footprint (资金足迹) · score **52.1/100** (C) · conviction 58 · horizon weeks · tickers HLXN

**Claim.** Insider activity in HLXN shows 4 dispositions against 1 acquisitions in the reported window. Clustered selling is a weak but persistent negative; isolated selling is usually tax planning.

**What would make this wrong.** A cluster of open-market purchases by two or more officers, or disclosure that the sales were executed under a pre-existing 10b5-1 plan adopted before the information event. Observable level: `>= 2 open-market buys`. Recheck: 2025-11-03T20:00:00.000Z.

**Bear case.**
- 10b5-1 plans make scheduled selling look like informed selling.
- Insider data lags the transaction by up to two business days (and 45 days for some filers).

**Evidence ledger.**
- ✅ `E1` computed (headline) — fixture @ insiderTrades(HLXN)
  > 4 sells / 1 buys, aggregate disposition value 18,806,970
  - checked against: recounted insiderTrades(HLXN): 4 sells / 1 buys

**Score breakdown.**
| factor | score | weight | contribution | why |
|---|---:|---:|---:|---|
| surprise | 46 | 0.3 | 13.8 | Flow channel has no consensus series; scaled from 4 net transaction(s) pointing the same way. |
| corroboration | 70 | 0.22 | 15.4 | 1/1 items verified (100%) -> 62; single source: no independent corroboration (+0); +8 headline evidence cleared the ledger |
| tradability | 38.5 | 0.18 | 6.93 | best instrument native-equity (liquidity 1) x large-cap coverage 0.55 -> 39; no trade sketch: the trader has to build the execution plan from scratch (+0) |
| asymmetry | 30 | 0.2 | 6 | No trade sketch - asymmetry unknown, floored at 30 rather than rewarded. |
| freshness | 100 | 0.1 | 10 | underlying information is 0h old (source stamped 2025-09-19T20:00) against a 720h half-life for flow-footprint -> decay weight 1 |

_expires 2025-10-10 20:00 UTC · extractor rules · sources n/a_

---

### WATCH · NWCL: 13F shows 3 builder(s) vs 2 trimmer(s)
`SIG-MFR9KE80-069` · Flow Footprint (资金足迹) · score **47.6/100** (D) · conviction 30 · horizon weeks · tickers NWCL

**Claim.** Of 6 reporting 13F holders of NWCL, 3 increased by more than 5% and 2 trimmed by more than 5%. 13F is a 45-day-lagged snapshot, so this confirms a thesis rather than starting one.

**What would make this wrong.** The next 13F cycle reverses the direction of the majority of the top-10 holders. Observable level: `sign flip`. Recheck: 2025-11-03T20:00:00.000Z.

**Bear case.**
- 13F omits shorts, non-US holdings and everything filed confidentially.
- The data is up to 45 days stale on the day it lands.

**Evidence ledger.**
- ✅ `E1` computed (headline) — fixture @ institutionalHoldings(NWCL)
  > 3 increased / 2 decreased out of 6 filers
  - checked against: recounted institutionalHoldings(NWCL): 3 up / 2 down, net 1

_expires 2025-10-10 20:00 UTC · extractor rules · sources n/a_

---

## Ledger

Items checked 55 · pass 48 · fail 0 · unverifiable 7 · pass rate 87.3% · cards quarantined 0

_Prism produces research inputs. A human takes the trade._

---

## Scenario: Bear case hunt / 反向风险扫描

> Run the contrarian screen. Where is the language softening and where do the accounting ratios diverge from the narrative?

_as-of 2025-09-19T20:00:00.000Z - channels narrative-shift, risk-flag - 30ms - extractor rules_

**What it demonstrates.** Adverse-language and ratio-anomaly flags. Demo issuers are fictional by design.

# Prism Desk brief

**As of** 2025-09-19 20:00 UTC · **US cash session** pre-market · **data** offline · **extractor** deterministic rules
**Question** Run the contrarian screen. Where is the language softening and where do the accounting ratios diverge from the narrative?

## Asked about, but silent

No card was produced for **CAT, ASTR**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

## Headline

**BLWF: 14 contrarian risk flag(s)** — AVOID, score 59.4/100.

## Ranked cards

| # | direction | channel | tickers | score | grade | horizon | verified |
|---:|---|---|---|---:|---|---|---|
| 1 | AVOID | 反向风险旗 | BLWF | 59.4 | C | weeks | 100% |
| 2 | LONG | 叙事转向 | NWCL | 54.9 | C | weeks | 100% |
| 3 | SHORT | 叙事转向 | HLXN | 53.3 | C | weeks | 100% |

## Dossiers

### AVOID · BLWF: 14 contrarian risk flag(s)
`SIG-MFR9KE80-080` · Contrarian Risk Flag (反向风险旗) · score **59.4/100** (C) · conviction 75 · horizon weeks · tickers BLWF

**Claim.** BLWF carries 11 adverse-language flag(s) (material weakness, restatement, delayed filing, investigation) and 3 accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.

**What would make this wrong.** The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters. Observable level: `flags -> 0 for 2 quarters`. Recheck: 2025-12-18T20:00:00.000Z.

**Bear case.**
- Risk language is often boilerplate; a single 10-K can carry 20 of these terms with nothing behind them.
- Ratio flags need at least two periods of context - one quarter of divergence is noise.

**Evidence ledger.**
- ✅ `E1` filing (headline) — blwf-10q-excerpt @ chars 33-246 (matched "customer concentration")
  > The company's ability to sustain revenue growth depends on a small number of products, and it faces customer concentration with three wholesale distributors accounting for a substantial majority of domestic sales.
  - checked against: blwf-10q-excerpt (exact @33)
  - note: risk terms: material weakness, restatement, delayed filing, investigation, subpoena, goodwill impairment, covenant, customer concentration, declining retention, churn, days sales outstanding increased
- ✅ `E2` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Receivables growing faster than revenue
  - checked against: blwf-10q-excerpt meta.ratioChecks
- ✅ `E3` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Positive net income but negative free cash flow
  - checked against: blwf-10q-excerpt meta.ratioChecks
- ✅ `E4` fundamental — blwf-10q-excerpt @ meta.ratioChecks
  > Inventory building faster than sales
  - checked against: blwf-10q-excerpt meta.ratioChecks

**Score breakdown.**
| factor | score | weight | contribution | why |
|---|---:|---:|---:|---|
| surprise | 76 | 0.3 | 22.8 | No consensus gap (risk channel); 4 adverse flag(s) counted. |
| corroboration | 76 | 0.22 | 16.72 | 4/4 items verified (100%) -> 62; single source: no independent corroboration (+0); +6 two evidence modalities; +8 headline evidence cleared the ledger |
| tradability | 38.5 | 0.18 | 6.93 | best instrument native-equity (liquidity 1) x large-cap coverage 0.55 -> 39; no trade sketch: the trader has to build the execution plan from scratch (+0) |
| asymmetry | 30 | 0.2 | 6 | No trade sketch - asymmetry unknown, floored at 30 rather than rewarded. |
| freshness | 69.7 | 0.1 | 6.97 | underlying information is 262.3h old (source stamped 2025-09-08T21:40) against a 504h half-life for risk-flag -> decay weight 0.697 |

_expires 2025-10-10 20:00 UTC · extractor rules · sources blwf-10q-excerpt_

---

### LONG · NWCL: narrative turning constructive
`SIG-MFR9KE80-076` · Narrative Shift (叙事转向) · score **54.9/100** (C) · conviction 80 · horizon weeks · tickers NWCL

**Claim.** demo wire (synthetic scenario) coverage of NWCL scores 1 on the desk tone scale from 8 weighted term hits (8 positive / 0 negative), with 2 of 2 adjacent documents agreeing.

**What would make this wrong.** Two or more subsequent documents on NWCL score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions. Observable level: `tone sign flip on >= 2 documents`. Recheck: 2025-09-24T20:00:00.000Z.

**Bear case.**
- Narrative is the slowest channel and the easiest to over-fit to a single article.
- Lexicon tone is not sentiment: sarcasm, negation and quoted speech all read as plain terms.
- If the narrative is already consensus, the shift is priced and the card has no edge.

**Evidence ledger.**
- ✅ `E1` news (headline) — nwcl-news-agentic-platform @ chars 249-419 (matched "strong demand")
  > Management said the deals carry strong demand signals and accelerate the platform's roadmap by two quarters, with the first production workloads expected before year end.
  - checked against: nwcl-news-agentic-platform (exact @249)
- ✅ `E2` news — nwcl-analyst-upgrade @ corroborating document
  > Desk note: NWCL upgrade - regulated verticals re-rate the platform multiple
  - checked against: nwcl-analyst-upgrade title (exact)
  - note: tone 1
- ✅ `E3` news — nwcl-news-expansion @ corroborating document
  > Northwind Cloud (NWCL) expands sovereign cloud footprint, adds two markets
  - checked against: nwcl-news-expansion title (exact)
  - note: tone 1

_expires 2025-10-10 20:00 UTC · extractor rules · sources nwcl-news-agentic-platform, nwcl-analyst-upgrade, nwcl-news-expansion_

---

### SHORT · HLXN: narrative turning negative
`SIG-MFR9KE80-074` · Narrative Shift (叙事转向) · score **53.3/100** (C) · conviction 74 · horizon weeks · tickers HLXN

**Claim.** demo wire (synthetic scenario) coverage of HLXN scores -1 on the desk tone scale from 12 weighted term hits (0 positive / 12 negative), with 1 of 1 adjacent documents agreeing.

**What would make this wrong.** Two or more subsequent documents on HLXN score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions. Observable level: `tone sign flip on >= 2 documents`. Recheck: 2025-09-24T20:00:00.000Z.

**Bear case.**
- Narrative is the slowest channel and the easiest to over-fit to a single article.
- Lexicon tone is not sentiment: sarcasm, negation and quoted speech all read as plain terms.
- If the narrative is already consensus, the shift is priced and the card has no edge.

**Evidence ledger.**
- ✅ `E1` news (headline) — hlxn-news-downgrade @ chars 0-215 (matched "weak demand")
  > Two sell-side firms downgraded Helion Dynamics following the company's decision to reduce fourth-quarter production rates, citing weak demand in construction equipment and a slowdown in industrial automation orders.
  - checked against: hlxn-news-downgrade (exact @0)
- ✅ `E2` news — hlxn-q2-release @ corroborating document
  > Helion Dynamics (HLXN) Q2 results: revenue miss, guidance lowered, backlog down
  - checked against: hlxn-q2-release title (exact)
  - note: tone -1

_expires 2025-10-10 20:00 UTC · extractor rules · sources hlxn-news-downgrade, hlxn-q2-release_

---

## Ledger

Items checked 64 · pass 57 · fail 0 · unverifiable 7 · pass rate 89.1% · cards quarantined 0

_Prism produces research inputs. A human takes the trade._

---

## Accumulated board

```
total 23 cards | active 10 | quarantined 0 | expired 2 | conflicts 0 | avg active score 60.6
```

id,createdAt,expiresAt,status,channel,direction,horizon,tickers,instruments,score,grade,conviction,verifiedPct,quarantined,gapMetric,gapDeltaPct,gapSigma,extractor,claim,invalidation,conflicts
SIG-MFR9KE80-008,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,superseded,earnings-gap,short,days,HLXN,native-equity rtoken,75.5,A,60,75,no,EPS,-17.01,,rules,"HLXN EPS 1.61 vs 1.94 consensus (-17.0% surprise, very large) guidance lower - the expectation gap, not the headline, is what reprices the name.","HLXN reclaims the pre-print close within two sessions and holds, showing the miss was already discounted.",0
SIG-MFR9KE80-021,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,active,earnings-gap,short,days,HLXN,native-equity rtoken,75.5,A,60,75,no,EPS,-17.01,,rules,"HLXN EPS 1.61 vs 1.94 consensus (-17.0% surprise, very large) guidance lower - the expectation gap, not the headline, is what reprices the name.","HLXN reclaims the pre-print close within two sessions and holds, showing the miss was already discounted.",0
SIG-MFR9KE80-010,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,superseded,earnings-gap,long,days,CRVS,native-equity rtoken,70.6,B,84,75,no,EPS,14.52,,rules,"CRVS EPS 1.42 vs 1.24 consensus (+14.5% surprise, large) guidance raise - the expectation gap, not the headline, is what reprices the name.","Post-print follow-through fails: CRVS gives back the gap and closes below the prior close, or management walks back the guide on the next appearance.",0
SIG-MFR9KE80-023,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,active,earnings-gap,long,days,CRVS,native-equity rtoken,70.6,B,84,75,no,EPS,14.52,,rules,"CRVS EPS 1.42 vs 1.24 consensus (+14.5% surprise, large) guidance raise - the expectation gap, not the headline, is what reprices the name.","Post-print follow-through fails: CRVS gives back the gap and closes below the prior close, or management walks back the guide on the next appearance.",0
SIG-MFR9KE80-003,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,superseded,macro-transmission,pair,days,AMD TSLA COIN PFE XOM WMT,native-equity etf rtoken,68,B,60,100,no,CPI y/y (Aug 2025),-6.45,-1.33,rules,"CPI y/y (Aug 2025) printed 2.9 vs 3.1 consensus (-1.33 sigma). Cooler inflation pulls the terminal policy rate lower, cutting the discount rate and re-rating long-dated cash flows. Measured exposure ranking puts AMD, TSLA, COIN most exposed and PFE, XOM, WMT best positioned.","The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime.",0
SIG-MFR9KE80-028,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,active,macro-transmission,pair,days,AMD TSLA COIN PFE XOM WMT,native-equity etf rtoken,68,B,60,100,no,CPI y/y (Aug 2025),-6.45,-1.33,rules,"CPI y/y (Aug 2025) printed 2.9 vs 3.1 consensus (-1.33 sigma). Cooler inflation pulls the terminal policy rate lower, cutting the discount rate and re-rating long-dated cash flows. Measured exposure ranking puts AMD, TSLA, COIN most exposed and PFE, XOM, WMT best positioned.","The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime.",0
SIG-MFR9KE80-002,2025-09-19T20:00:00.000Z,2025-09-20T04:00:00.000Z,superseded,earnings-gap,short,intraday,ASTR,native-equity rtoken,63.4,B,36,75,no,EPS,-4.92,,rules,"ASTR EPS 0.58 vs 0.61 consensus (-4.9% surprise, meaningful) guidance withdraw - the expectation gap, not the headline, is what reprices the name.","ASTR reclaims the pre-print close within two sessions and holds, showing the miss was already discounted.",0
SIG-MFR9KE80-015,2025-09-19T20:00:00.000Z,2025-09-20T04:00:00.000Z,active,earnings-gap,short,intraday,ASTR,native-equity rtoken,63.4,B,36,75,no,EPS,-4.92,,rules,"ASTR EPS 0.58 vs 0.61 consensus (-4.9% surprise, meaningful) guidance withdraw - the expectation gap, not the headline, is what reprices the name.","ASTR reclaims the pre-print close within two sessions and holds, showing the miss was already discounted.",0
SIG-MFR9KE80-012,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,superseded,macro-transmission,pair,days,COIN TSLA PLTR PFE XOM WMT,native-equity etf rtoken,61.3,C,55,100,no,Nonfarm payrolls (Aug 2025),-70.67,-0.88,rules,"Nonfarm payrolls (Aug 2025) printed 22 vs 75 consensus (-0.88 sigma). A cooling labor market raises easing odds but also recession risk - a two-sided shock. Measured exposure ranking puts COIN, TSLA, PLTR most exposed and PFE, XOM, WMT best positioned.","The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime.",0
SIG-MFR9KE80-037,2025-09-19T20:00:00.000Z,2025-09-24T20:00:00.000Z,active,macro-transmission,pair,days,COIN TSLA PLTR PFE XOM WMT,native-equity etf rtoken,61.3,C,55,100,no,Nonfarm payrolls (Aug 2025),-70.67,-0.88,rules,"Nonfarm payrolls (Aug 2025) printed 22 vs 75 consensus (-0.88 sigma). A cooling labor market raises easing odds but also recession risk - a two-sided shock. Measured exposure ranking puts COIN, TSLA, PLTR most exposed and PFE, XOM, WMT best positioned.","The transmission does not show up cross-sectionally: within two sessions the least-exposed basket does not underperform the benchmark, meaning the print was already priced or the channel is inactive in this regime.",0
SIG-MFR9KE80-011,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,superseded,risk-flag,avoid,weeks,BLWF,native-equity,59.4,C,75,100,no,,,,rules,"BLWF carries 11 adverse-language flag(s) (material weakness, restatement, delayed filing, investigation) and 3 accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.","The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters.",0
SIG-MFR9KE80-024,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,superseded,risk-flag,avoid,weeks,BLWF,native-equity,59.4,C,75,100,no,,,,rules,"BLWF carries 11 adverse-language flag(s) (material weakness, restatement, delayed filing, investigation) and 3 accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.","The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters.",0
SIG-MFR9KE80-080,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,active,risk-flag,avoid,weeks,BLWF,native-equity,59.4,C,75,100,no,,,,rules,"BLWF carries 11 adverse-language flag(s) (material weakness, restatement, delayed filing, investigation) and 3 accounting-ratio flag(s). This is a do-not-own / hedge signal, not a short recommendation on its own.","The flagged item is explicitly resolved by the company (restatement cleared, weakness remediated, provision released) and the ratio normalises for two consecutive quarters.",0
SIG-MFIE7HC0-052,2025-09-13T15:00:00.000Z,2025-09-13T23:00:00.000Z,expired,closed-window,neutral,intraday,SPY,rtoken,58.3,C,55,100,no,,,,rules,"The US cash session is closed (weekend) but the SPY rToken still trades. Information from ""Weekend wire: new tariff framework announced outside market hours"" can only be priced on the rToken until the next open. Across 44 comparable historical gaps in SPY, the gap direction continued 45.5% of the time and reverted 45.5% of the time; the median |gap| was 1.23%.","The rToken premium/dislocation to the last cash close collapses before the open, meaning the information was already fully priced by the token market.",0
SIG-MFR9KE80-007,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,superseded,narrative-shift,long,weeks,NWCL,native-equity rtoken,54.9,C,80,100,no,,,,rules,"demo wire (synthetic scenario) coverage of NWCL scores 1 on the desk tone scale from 8 weighted term hits (8 positive / 0 negative), with 2 of 2 adjacent documents agreeing.","Two or more subsequent documents on NWCL score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions.",0
SIG-MFR9KE80-076,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,active,narrative-shift,long,weeks,NWCL,native-equity rtoken,54.9,C,80,100,no,,,,rules,"demo wire (synthetic scenario) coverage of NWCL scores 1 on the desk tone scale from 8 weighted term hits (8 positive / 0 negative), with 2 of 2 adjacent documents agreeing.","Two or more subsequent documents on NWCL score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions.",0
SIG-MFR9KE80-005,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,superseded,narrative-shift,short,weeks,HLXN,native-equity rtoken,53.3,C,74,100,no,,,,rules,"demo wire (synthetic scenario) coverage of HLXN scores -1 on the desk tone scale from 12 weighted term hits (0 positive / 12 negative), with 1 of 1 adjacent documents agreeing.","Two or more subsequent documents on HLXN score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions.",0
SIG-MFR9KE80-074,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,active,narrative-shift,short,weeks,HLXN,native-equity rtoken,53.3,C,74,100,no,,,,rules,"demo wire (synthetic scenario) coverage of HLXN scores -1 on the desk tone scale from 12 weighted term hits (0 positive / 12 negative), with 1 of 1 adjacent documents agreeing.","Two or more subsequent documents on HLXN score with the opposite sign, or price makes a lower low (for the constructive read) within five sessions.",0
SIG-MFR9KE80-067,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,active,flow-footprint,neutral,weeks,HLXN,native-equity,52.1,C,58,100,no,,,,rules,Insider activity in HLXN shows 4 dispositions against 1 acquisitions in the reported window. Clustered selling is a weak but persistent negative; isolated selling is usually tax planning.,"A cluster of open-market purchases by two or more officers, or disclosure that the sales were executed under a pre-existing 10b5-1 plan adopted before the information event.",0
SIG-MFR9KE80-013,2025-09-19T20:00:00.000Z,2025-09-20T04:00:00.000Z,superseded,cross-asset,neutral,intraday,BTC ETH,rtoken crypto,49,C,28,100,no,,,,rules,"Crypto-side positioning reads Fear & Greed 41 (Fear), BTC funding 0.0081, US spot BTC ETF flow -184000000. Because tokenized US equities settle on crypto rails, an unremarkable crypto regime changes who is awake to trade the rToken when US macro lands outside cash hours.","Fear & Greed returns inside the 35-65 band and funding normalises, i.e. the crypto complex stops driving marginal rToken liquidity.",0
SIG-MFIE7HC0-053,2025-09-13T15:00:00.000Z,2025-09-13T23:00:00.000Z,expired,cross-asset,neutral,intraday,BTC ETH,rtoken crypto,49,C,28,100,no,,,,rules,"Crypto-side positioning reads Fear & Greed 41 (Fear), BTC funding 0.0081, US spot BTC ETF flow -184000000. Because tokenized US equities settle on crypto rails, an unremarkable crypto regime changes who is awake to trade the rToken when US macro lands outside cash hours.","Fear & Greed returns inside the 35-65 band and funding normalises, i.e. the crypto complex stops driving marginal rToken liquidity.",0
SIG-MFR9KE80-069,2025-09-19T20:00:00.000Z,2025-10-10T20:00:00.000Z,active,flow-footprint,neutral,weeks,NWCL,native-equity,47.6,D,30,100,no,,,,rules,"Of 6 reporting 13F holders of NWCL, 3 increased by more than 5% and 2 trimmed by more than 5%. 13F is a 45-day-lagged snapshot, so this confirms a thesis rather than starting one.",The next 13F cycle reverses the direction of the majority of the top-10 holders.,0
SIG-MFIE7HC0-051,2025-09-13T15:00:00.000Z,2025-09-13T23:00:00.000Z,draft,closed-window,neutral,intraday,ASTR,rtoken,44.9,D,55,66.7,no,,,,rules,"The US cash session is closed (weekend) but the ASTR rToken still trades. Information from ""Aster Retail Group (ASTR) withdraws full-year outlook ahead of holiday peak"" can only be priced on the rToken until the next open. No comparable historical gap in ASTR is recorded in the bundled price book, so there is no empirical prior for this name; read the closed-window argument as structural rather than statistical.","The rToken premium/dislocation to the last cash close collapses before the open, meaning the information was already fully priced by the token market.",0
