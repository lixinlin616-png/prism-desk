# Prism demo corpus

Everything in this folder is *input*, not truth. It is what the desk is asked to
read. Two categories, deliberately kept apart:

## 1. Macro documents — real public data

`macro-2025-09.json` contains real US macro releases (BLS CPI, BLS employment
situation, FOMC decisions) with figures transcribed from the public releases.
The realised price reactions in `data/prices/` corroborate the dates: the
2025-09-11 CPI print, the 2025-09-05 payroll print and the 2025-09-17 FOMC all
line up with the moves you can verify in the dataset.

The *prose* in those documents is a reconstruction written for the demo, not a
verbatim copy of the release. The numbers are the real published numbers.

## 2. Issuer documents — fictional by design

`issuers-demo.json` is about **companies that do not exist**: Corvus
Semiconductor (CRVS), Helion Dynamics (HLXN), Aster Retail Group (ASTR),
Bellwether Pharma (BLWF) and Northwind Cloud (NWCL).

This is deliberate. Prism's `risk-flag` channel publishes adverse claims —
adverse language, accounting anomalies, guidance withdrawals. Generating those
about real, identifiable public companies from a demo dataset would be
irresponsible and potentially defamatory, so the demo does not do it. Every
issuer-level document here carries `"synthetic": true`.

Because the issuers are fictional they have no listed price. Each document
therefore declares a `meta.priceProxy` — a real symbol whose price series is
used to compute illustrative trade levels. The proxy is **disclosed on the card
itself** (`tradeSketch.pricingProxy`), so Prism never implies it observed a
price it did not.

| fictional issuer | ticker | price proxy |
|---|---|---|
| Corvus Semiconductor | CRVS | NVDA |
| Helion Dynamics | HLXN | CAT |
| Aster Retail Group | ASTR | WMT |
| Bellwether Pharma | BLWF | PFE |
| Northwind Cloud | NWCL | MSFT |

## Using real documents instead

Point Prism at your own material and none of the above matters:

```bash
node prism.mjs ask "what changed in this call?" --file ./my-transcript.md
```

or drop a file into this folder using front matter:

```markdown
---
id: my-doc
kind: earnings-call
tickers: [NVDA]
title: NVDA FY26 Q2 call
publishedAt: 2025-08-27T21:00:00Z
source: company IR
---
<paste the transcript here>
```

In production the same loader is fed by `bitget-mcp-server` news and by the
`bitget-signal` `news-briefing` skill, so the corpus is a cache, not a
boundary.