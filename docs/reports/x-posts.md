# X post compliance report

Generated 2026-10-07T10:52:07.561Z by `node scripts/xpost.mjs`. Source of truth: `docs/X-POSTS.md`.

## Rules being enforced

| requirement | where it comes from |
| --- | --- |
| `#BitgetHackathon` present | form field 「X 传播推文链接」 |
| `@Bitget_AI` present | form field 「X 传播推文链接」 |
| substantive product introduction | 「纯转发或无实质介绍 = 提交不完整」 |
| quote-retweet of the official tweet | 「需要转发」the pinned S2 announcement |
| within the composer limit | X v3 weighted length (CJK = 2, URL = 23) |

## Posts

| id | kind | lang | weighted | limit | original copy | verdict |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `a1` | quote-rt | zh | 274 | 280 | 242 | PASS |
| `a2` | quote-rt | en | 274 | 280 | 242 | PASS |
| `zh-1` | quote-rt | zh | 244 | 280 | 213 | PASS |
| `zh-2` | thread-post | zh | 241 | 280 | 239 | PASS |
| `zh-3` | thread-post | zh | 246 | 280 | 243 | PASS |
| `zh-4` | thread-post | zh | 248 | 280 | 245 | PASS |
| `zh-5` | thread-post | zh | 278 | 280 | 275 | PASS |
| `zh-6` | thread-post | zh | 232 | 280 | 230 | PASS |
| `zh-7` | thread-post | zh | 260 | 280 | 257 | PASS |
| `zh-8` | thread-post | zh | 268 | 280 | 265 | PASS |
| `en-1` | quote-rt | en | 276 | 280 | 246 | PASS |
| `en-2` | thread-post | en | 253 | 280 | 252 | PASS |
| `en-3` | thread-post | en | 276 | 280 | 275 | PASS |
| `en-4` | thread-post | en | 267 | 280 | 266 | PASS |
| `en-5` | thread-post | en | 273 | 280 | 272 | PASS |
| `en-6` | thread-post | en | 275 | 280 | 274 | PASS |
| `en-7` | thread-post | en | 272 | 280 | 270 | PASS |

## Failures

_none_

## Suite-level checks

- ok   `posts-found` - the doc contains parseable xpost blocks (17 block(s))
- ok   `ids-unique` - every block declares a unique id (17 unique id(s))
- ok   `official-url-declared` - doc declares the official tweet to quote-retweet (https://x.com/Bitget_AI/status/2100519318824055159)
- ok   `quote-rt-exists` - at least one submittable draft quote-retweets the official tweet (a1, a2, zh-1, en-1)
- ok   `submittable-exists` - at least one draft passes every per-post check (a1, a2, zh-1, zh-2, zh-3, zh-4, zh-5, zh-6, zh-7, zh-8, en-1, en-2, en-3, en-4, en-5, en-6, en-7)
- ok   `threads-shaped` - every thread is numbered contiguously from 1 (zh=8, en=7)

## What this does not check

- That anything was posted. This validates the drafts in the repo; the URL you paste into the form is yours.
- Rendered appearance. Media attachments, link-card previews and composer line breaks are not modelled.
- The live weighting table. The ranges above are twitter-text v3 as of writing; X can change them.
