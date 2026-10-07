#!/usr/bin/env node
/**
 * X post compliance checker.
 *
 * The hackathon rules make the X post a hard gate: a submission missing a
 * compliant post is invalid and never reaches the judges. The requirements are
 * entirely mechanical - one hashtag, one mention, a substantive product
 * introduction (not a bare retweet), a quote-retweet of one specific official
 * tweet, and a length limit that is NOT a plain character count. Mechanical
 * requirements belong in code, not in someone's eyes at 2am before a deadline.
 *
 * Single source of truth: the fenced **xpost** blocks inside docs/X-POSTS.md.
 * This script parses that file, so a draft cannot drift away from what is
 * checked - editing the doc edits the test.
 *
 *   node scripts/xpost.mjs            table + docs/reports/x-posts.md
 *   node scripts/xpost.mjs --json     machine-readable verdicts
 *
 * Length uses X's own v3 weighting: most characters weigh 1, CJK and fullwidth
 * weigh 2, and any URL weighs a flat 23. Counting a Chinese draft in plain
 * characters is how you write a post the composer then refuses to send.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs', 'X-POSTS.md');
const OUT = join(ROOT, 'docs', 'reports', 'x-posts.md');

/** The tweet the rules require every submission to quote-retweet. */
const OFFICIAL_TWEET = 'https://x.com/Bitget_AI/status/2100519318824055159';
const REQUIRED_HASHTAG = '#BitgetHackathon';
const REQUIRED_MENTION = '@Bitget_AI';
const DEFAULT_LIMIT = 280;
/** Weighted units a post must retain once the mandatory tokens are removed. */
const MIN_SUBSTANCE = 40;

// ---------------------------------------------------------------- weighting
//
// twitter-text v3 scores weights of 100/200 against a 28000 budget, so a "280
// character" post is 280 units of weight 100. The ranges below are the CJK,
// Hangul, Kana, fullwidth and emoji blocks that weigh 200.

const W200 = [
  [0x1100, 0x11ff], [0x2038, 0x203b], [0x2e80, 0x2fff], [0x3000, 0x3003],
  [0x3005, 0x303f], [0x3041, 0x3096], [0x3099, 0x30ff], [0x3105, 0x312f],
  [0x3131, 0x318e], [0x3190, 0x31ba], [0x31c0, 0x31e3], [0x31ef, 0x321e],
  [0x3220, 0x324f], [0x3280, 0x33bf], [0x3400, 0x4dbf], [0x4e00, 0xa48c],
  [0xa492, 0xa4c6], [0xa960, 0xa97c], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe10, 0xfe19], [0xfe30, 0xfe52], [0xfe54, 0xfe66], [0xfe68, 0xfe6b],
  [0xff01, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x187f7],
  [0x18800, 0x18cd5], [0x1b000, 0x1b16f], [0x1b170, 0x1b2fb],
  [0x1f000, 0x1f9ff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

const unitWeight = (cp) => (W200.some(([lo, hi]) => cp >= lo && cp <= hi) ? 200 : 100);

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const TCO_LEN = 23;

/**
 * Weighted length in X "characters". URLs become a flat 23-unit placeholder
 * first, because t.co shortens every link to the same budget no matter how long
 * the original is.
 *
 * Line endings are normalised before counting. X charges one character for a
 * line break and none for a carriage return, but this file is read from a git
 * checkout: with core.autocrlf=true every line of a multi-line post arrives as
 * CRLF, and counting the \r made the same post measure one unit longer per line.
 * Three posts sat within 4 units of the 280 limit, so the compliance gate that
 * guards a MANDATORY submission item returned FAIL on Windows and PASS on Linux
 * for identical copy - and the natural response to that FAIL is deleting real
 * content from a post that was never over the limit.
 */
export function weightedLength(text) {
  const urls = [];
  const normalised = String(text ?? '').replace(/\r\n?/g, '\n');
  const flat = normalised.replace(URL_RE, (m) => {
    urls.push(m);
    return ' '.repeat(TCO_LEN);
  });
  let units = 0;
  for (const ch of flat) units += unitWeight(ch.codePointAt(0));
  return { weighted: units / 100, urls, plain: [...normalised].length };
}

// ------------------------------------------------------------------ parsing

const BLOCK_RE = /```xpost([^\n]*)\n([\s\S]*?)```/g;
const META_RE = /<!--\s*xpost-meta\s+([^\n]*?)\s*-->/;

function parseAttrs(str) {
  const attrs = {};
  for (const tok of String(str).trim().split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf('=');
    if (i === -1) attrs[tok] = true;
    else attrs[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return attrs;
}

export function parsePosts(markdown) {
  const posts = [];
  for (const m of String(markdown).matchAll(BLOCK_RE)) {
    posts.push({ attrs: parseAttrs(m[1]), text: m[2].replace(/\s+$/, '') });
  }
  const meta = META_RE.exec(String(markdown));
  return { posts, meta: meta ? parseAttrs(meta[1]) : {} };
}

// ------------------------------------------------------------------- checks

function record(list, id, title, ok, detail, failDetail) {
  list.push({ id, title, ok: Boolean(ok), detail: ok ? detail : (failDetail || detail) });
}

function checkPost(post) {
  const f = [];
  const { attrs, text } = post;
  const limit = Number(attrs.limit ?? DEFAULT_LIMIT);
  const { weighted, urls } = weightedLength(text);

  record(f, 'length', 'fits the composer', weighted <= limit,
    weighted + '/' + limit + ' weighted',
    'over by ' + (weighted - limit) + ' weighted units');
  // Only the post you actually submit has to carry the tokens. Repeating them on
  // every reply in a thread reads as spam, so continuation posts opt out with
  // tokens=off and are still held to length, placeholders and substance.
  const wantTokens = attrs.tokens !== 'off';
  if (wantTokens) {
    record(f, 'hashtag', 'carries ' + REQUIRED_HASHTAG, text.includes(REQUIRED_HASHTAG),
      'present', 'missing required hashtag');
    record(f, 'mention', 'carries ' + REQUIRED_MENTION, text.includes(REQUIRED_MENTION),
      'present', 'missing required mention');
  }
  record(f, 'no-placeholder', 'no unfilled placeholder', !/<[^>\n]{1,60}>/.test(text),
    'clean', 'still contains a <...> placeholder');
  record(f, 'urls-https', 'every link is absolute https', urls.every((u) => /^https:\/\//i.test(u)),
    urls.length + ' link(s)', 'a link is not absolute https://');

  // "纯转发或无实质介绍 = 提交不完整". Strip the mandatory tokens; what is left
  // must still say something about the product.
  const residue = text
    .split(wantTokens ? REQUIRED_HASHTAG : '\u0000').join(' ')
    .split(wantTokens ? REQUIRED_MENTION : '\u0000').join(' ')
    .replace(URL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const substance = weightedLength(residue).weighted;
  record(f, 'substantive', 'introduces the product in its own words', substance >= MIN_SUBSTANCE,
    substance + ' weighted units of original copy',
    'only ' + substance + ' units survive once the mandatory tokens are removed - reads as a bare retweet');

  const quoteRt = attrs.quotes === 'official';
  if (attrs.kind === 'quote-rt' && !quoteRt) {
    record(f, 'quote-rt-flag', 'quote-retweet declares quotes=official', false,
      '', 'kind=quote-rt without quotes=official');
  }
  if (quoteRt) {
    record(f, 'quote-rt-not-embedded', 'does not paste the quoted URL as text',
      !text.includes(OFFICIAL_TWEET), 'attached by the platform',
      'pastes the official URL as text - quote-retweet instead, so the card renders');
  }

  return { id: String(attrs.id || '(no id)'), attrs, weighted, limit, substance, urls, checks: f };
}

// ------------------------------------------------------------------- report

function renderReport(result) {
  const L = [];
  L.push('# X post compliance report');
  L.push('');
  L.push('Generated ' + new Date().toISOString() + ' by `node scripts/xpost.mjs`. Source of truth: `docs/X-POSTS.md`.');
  L.push('');
  L.push('## Rules being enforced');
  L.push('');
  L.push('| requirement | where it comes from |');
  L.push('| --- | --- |');
  L.push('| `' + REQUIRED_HASHTAG + '` present | form field 「X 传播推文链接」 |');
  L.push('| `' + REQUIRED_MENTION + '` present | form field 「X 传播推文链接」 |');
  L.push('| substantive product introduction | 「纯转发或无实质介绍 = 提交不完整」 |');
  L.push('| quote-retweet of the official tweet | 「需要转发」the pinned S2 announcement |');
  L.push('| within the composer limit | X v3 weighted length (CJK = 2, URL = 23) |');
  L.push('');
  L.push('## Posts');
  L.push('');
  L.push('| id | kind | lang | weighted | limit | original copy | verdict |');
  L.push('| --- | --- | --- | ---: | ---: | ---: | --- |');
  for (const p of result.posts) {
    const ok = p.checks.every((c) => c.ok);
    L.push('| `' + p.id + '` | ' + (p.attrs.kind || '-') + ' | ' + (p.attrs.lang || '-') + ' | '
      + p.weighted + ' | ' + p.limit + ' | ' + p.substance + ' | ' + (ok ? 'PASS' : '**FAIL**') + ' |');
  }
  L.push('');
  L.push('## Failures');
  L.push('');
  const fails = result.posts.flatMap((p) => p.checks.filter((c) => !c.ok).map((c) => ({ id: p.id, c })));
  if (!fails.length) L.push('_none_');
  for (const x of fails) L.push('- `' + x.id + '` / `' + x.c.id + '` - ' + x.c.detail);
  L.push('');
  L.push('## Suite-level checks');
  L.push('');
  for (const c of result.suite) {
    L.push('- ' + (c.ok ? 'ok  ' : 'FAIL') + ' `' + c.id + '` - ' + c.title + ' (' + c.detail + ')');
  }
  L.push('');
  L.push('## What this does not check');
  L.push('');
  L.push('- That anything was posted. This validates the drafts in the repo; the URL you paste into the form is yours.');
  L.push('- Rendered appearance. Media attachments, link-card previews and composer line breaks are not modelled.');
  L.push('- The live weighting table. The ranges above are twitter-text v3 as of writing; X can change them.');
  return L.join('\n') + '\n';
}

// --------------------------------------------------------------------- main

export function runXPostCheck(markdown) {
  const src = markdown ?? (existsSync(DOC) ? readFileSync(DOC, 'utf8') : '');
  if (!src) throw new Error('docs/X-POSTS.md not found - nothing to check');
  const { posts, meta } = parsePosts(src);
  const findings = posts.map(checkPost);

  const suite = [];
  record(suite, 'posts-found', 'the doc contains parseable xpost blocks', posts.length > 0,
    posts.length + ' block(s)', 'no xpost blocks found');

  const ids = findings.map((p) => p.id);
  record(suite, 'ids-unique', 'every block declares a unique id',
    ids.length === new Set(ids).size && ids.every((i) => i && i !== '(no id)'),
    ids.length + ' unique id(s)', 'duplicate or missing id');

  const declared = String(meta.official || '');
  record(suite, 'official-url-declared', 'doc declares the official tweet to quote-retweet',
    declared.startsWith(OFFICIAL_TWEET), declared || '(none)',
    'xpost-meta official= must be ' + OFFICIAL_TWEET);

  const quoteRts = findings.filter((p) => p.attrs.quotes === 'official' && p.attrs.tokens !== 'off');
  record(suite, 'quote-rt-exists', 'at least one submittable draft quote-retweets the official tweet',
    quoteRts.length > 0, quoteRts.map((p) => p.id).join(', ') || '(none)',
    'the 转发 requirement is unmet - add quotes=official to one compliant draft');

  const submittable = findings.filter((p) => p.checks.every((c) => c.ok));
  record(suite, 'submittable-exists', 'at least one draft passes every per-post check',
    submittable.length > 0, submittable.map((p) => p.id).join(', ') || '(none)',
    'no draft is submittable as-is');

  const threads = {};
  for (const p of findings) if (p.attrs.thread) (threads[p.attrs.thread] ||= []).push(p);
  const threadNames = Object.keys(threads);
  record(suite, 'threads-shaped', 'every thread is numbered contiguously from 1',
    threadNames.every((t) => {
      const n = threads[t].map((p) => Number(String(p.id).split('-').pop()));
      return n.length >= 3 && [...n].sort((a, b) => a - b).every((v, i) => v === i + 1);
    }),
    threadNames.length ? threadNames.map((t) => t + '=' + threads[t].length).join(', ') : '(no threads)',
    'a thread is missing posts or skips a number');

  const ok = [...findings.flatMap((p) => p.checks), ...suite].every((c) => c.ok);
  return {
    ok, posts: findings, suite, meta,
    threads: threadNames.map((t) => ({ thread: t, posts: threads[t].length })),
  };
}

function main(argv) {
  const result = runXPostCheck();

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  process.stdout.write('X post compliance - docs/X-POSTS.md\n\n');
  process.stdout.write('  id              kind       lang  weighted  copy  verdict\n');
  for (const p of result.posts) {
    const ok = p.checks.every((c) => c.ok);
    process.stdout.write('  ' + p.id.padEnd(16) + String(p.attrs.kind || '-').padEnd(13)
      + String(p.attrs.lang || '-').padEnd(6) + (p.weighted + '/' + p.limit).padEnd(10)
      + String(p.substance).padEnd(6) + (ok ? 'PASS' : 'FAIL') + '\n');
    for (const c of p.checks.filter((x) => !x.ok)) {
      process.stdout.write('      x ' + c.id + ': ' + c.detail + '\n');
    }
  }
  process.stdout.write('\n');
  for (const c of result.suite) {
    process.stdout.write('  [' + (c.ok ? 'ok  ' : 'FAIL') + '] ' + c.id + ' - ' + c.detail + '\n');
  }
  const total = result.posts.reduce((n, p) => n + p.checks.length, 0) + result.suite.length;
  const pass = result.posts.reduce((n, p) => n + p.checks.filter((c) => c.ok).length, 0)
    + result.suite.filter((c) => c.ok).length;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderReport(result), 'utf8');
  process.stdout.write('\n' + pass + '/' + total + ' checks passed\nreport: ' + OUT + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

main(process.argv.slice(2));
