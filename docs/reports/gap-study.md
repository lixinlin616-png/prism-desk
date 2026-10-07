# Overnight and closed-window gap study

Generated 2026-10-07T10:49:27.893Z by `npm run replay`. Real end-of-day prices from the bundled dataset.

## Question

The `closed-window` channel exists because a tokenized equity (rToken) trades 7x24 while the native US cash equity trades 6.5 hours a day, five days a week. When information lands while the cash market is shut, the rToken is the only venue left to price it. So: how much information actually accumulates across a closed window, and does the resulting gap carry forward or fade?

## Method

- Sample: 15478 overnight gaps of at least 0.75% across 25 symbols, 2019-01-03 to 2025-09-30.
- A gap is today's open against yesterday's close on the NATIVE share.
- Continuation is the intraday move from open to close, signed by the gap direction. Positive means the gap extended; negative means it faded.
- Excess returns are against SPY over the same window, at 1, 5 and 10 sessions.
- Two t-statistics are reported for every figure. The naive one treats each gap as an independent observation. The date-clustered one groups all gaps sharing a calendar date, because on a big macro day dozens of names gap together and they are one event, not forty.

## Headline

| statistic | value |
| --- | ---: |
| gaps observed | 15478 |
| continued | 48.8% |
| reverted | 46.4% |
| flat | 4.8% |
| median absolute gap | 1.32% |
| up gaps | 8351 (continued 50.5%) |
| down gaps | 7127 (continued 46.8%) |

## Excess return vs benchmark

| horizon | raw mean | excess mean | naive t | date-clustered t | independent dates | win rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 sessions | 0.145% | 0.086% | 3.87 | **2.57** | 1672 | 49% |
| 5 sessions | 0.735% | 0.387% | 8.45 | **5.23** | 1668 | 50.5% |
| 10 sessions | 1.453% | 0.752% | 11.63 | **6.66** | 1663 | 50.2% |

The naive and clustered t-statistics differ materially (8.45 vs 5.23 at five sessions). The clustered figure is the one quoted anywhere else in this project, because the naive one is wrong in the direction that flatters the result.

## Weekend window vs ordinary overnight

| window | n | up-gap continued | down-gap continued | mean fwd5 | excess fwd5 t (clustered) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Monday open (~64h of accumulated information) | 3143 | 55.4% | 44% | 0.724% | 3.01 |
| Tue-Fri open (~17h overnight) | 12335 | 49.4% | 47.6% | 0.738% | 4.33 |

The Monday open carries roughly 20.3% of the sample but a disproportionate share of the large gaps, which is the empirical basis for treating the weekend as a distinct pricing regime rather than a longer overnight. Up-gaps opening a Monday continue 55.4% of the time versus 49.4% on an ordinary weekday.

## By gap size

| bucket | n | continued | reverted | mean fwd5 | excess fwd5 | clustered t |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.75-1% | 4216 | 47% | 46.4% | 0.643% | 0.4% | 4.25 |
| 1-2% | 7318 | 49.5% | 45.8% | 0.715% | 0.31% | 3 |
| 2-4% | 2949 | 49.6% | 47% | 0.857% | 0.611% | 3 |
| >=4% | 995 | 49% | 48.9% | 0.912% | 1.116% | 2.88 |

## Caveats, stated plainly

- **This measures the native share, not an rToken.** Tokenized equities trade on a different venue with materially thinner liquidity and a mint/redeem arbitrage that can compress a dislocation faster than the information warrants. The study is a prior for the SIZE of a closed-window dislocation, not a model of rToken microstructure.
- **No costs.** No commission, no spread, no borrow, no slippage. A mean five-session excess of a few tens of basis points is not a net-of-cost edge on its own; the claim is only that the direction of a gap carries information.
- **Survivorship.** The bundled universe is today's well-known large caps. Names that gapped and then went to zero are not in the sample.
- **Continuation is regime-dependent.** Roughly half of all gaps fade. The channel uses this study to size and time-box a view, not to claim gaps always extend.
