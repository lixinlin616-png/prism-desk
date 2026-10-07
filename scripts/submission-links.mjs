#!/usr/bin/env node
/**
 * Emit the "提交材料链接" block for the Base Camp S2 submission form.
 *
 * The official form has no per-track upload control: every link goes into one
 * free-text box, filled in line by line with its type. That makes it very easy
 * to paste a list that looks right and points at files that do not exist - which,
 * for a project whose entire pitch is "every number is checkable", would be the
 * worst possible own goal.
 *
 * So the link list lives HERE as data, and this script refuses to emit it unless
 * (a) every repo-relative path in it exists on disk, and (b) every hard number in
 * it still matches the generated report that is its authority. Same pattern as
 * scripts/xpost.mjs: the artefact and its check share one file, so they cannot
 * drift apart.
 *
 *   node scripts/submission-links.mjs --check
 *   node scripts/submission-links.mjs \
 *     --repo=https://github.com/<you>/prism-desk \
 *     --demo=https://<your-app>.fly.dev \
 *     --xpost=https://x.com/<you>/status/<id> \
 *     --video=https://<video-url> \
 *     --out=docs/reports/submission-links.txt
 */

import { existsSync, readFileSync as fsRead, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Placeholders only the submitter can fill. Everything else is a repo path. */
const URL_KEYS = ['repo', 'demo', 'xpost', 'video'];

/**
 * The suite size. This is the ONE number in the submission box that cannot be
 * re-read from a generated artefact, so it is declared once here and interpolated
 * everywhere it appears; `npm test` is its authority and `--check` says so out
 * loud instead of implying it was verified.
 */
export const TEST_COUNT = 208;

/**
 * The submission manifest, in the order it is printed.
 *   section  - the box sub-heading (the form asks you to annotate the type)
 *   type     - the per-line type annotation
 *   target   - a URL_KEYS entry, or a repo-relative path (-> <repo>/blob/main/<path>)
 *   what     - one line saying what the evaluator gets
 *   required - '必交' | '选交' | '支撑'
 */
export const MANIFEST = [
  {
    section: '必交 · 项目链接',
    type: '项目链接｜在线 Demo（可直接访问，无需登录 / 无需安装 / 无需 API key）',
    target: 'demo',
    required: '必交',
    what: '打开即是投研台（GitHub Pages，无需登录 / 安装 / key，不会休眠）：点任一场景可看到「提问 → 计划 → 取数 → 抽取 → 核验 → 打分 → 可用判断」全链路、逐条证据账本、看板与事后复盘。它是**静态回放**：由 npm run export:static 驱动真实离线引擎录制（含 SSE 逐帧节奏），页面左下角永久标注 static replay；自由提问会回放最接近的预录任务并明说，写入类操作直接返回 409 而不是假装成功。要能自由提问的实时后端见下一行仓库里的 node server.mjs / render.yaml',
  },
  {
    section: '必交 · 项目链接',
    type: '项目链接｜GitHub 仓库（public，含完整 README）',
    target: 'repo',
    required: '必交',
    what: `源码 + 真实价格数据 + ${TEST_COUNT} 个测试 + 60 项验证检查 + 逐字节可复现的看板 fixture；零第三方依赖，clone 后 node server.mjs 即可跑起带后端的完整版（默认 127.0.0.1:4310，端口被占会自动让位并提示 PRISM_PORT）`,
  },
  {
    section: '必交 · 运行记录（赛道三 AI Trading Desk：完整投研任务的演示或录屏）',
    type: '运行记录｜完整投研任务演示 · 讲解版（提问 → 可用判断）',
    target: 'docs/DEMO-SCRIPT.md',
    required: '必交',
    what: '七个阶段逐环节拆解：PLAN 路由 / INGEST 取数 / EXTRACT 抽取 / VERIFY 证据账本 / SCORE 五因子打分 / PRESENT 简报 / REVIEW 事后判分',
  },
  {
    section: '必交 · 运行记录（赛道三 AI Trading Desk：完整投研任务的演示或录屏）',
    type: '运行记录｜完整投研任务演示 · 原始逐字稿（机器生成，非手写）',
    target: 'docs/DEMO-TRANSCRIPT.md',
    required: '必交',
    what: '951 行，六个场景的全部原始输出。评委裸跑 `node prism.mjs demo`（无需任何参数）即可逐字重建，实测仅生成时间戳 1 行与 6 处 ms 计时不同',
  },
  {
    section: '必交 · 运行记录（赛道三 AI Trading Desk：完整投研任务的演示或录屏）',
    type: '运行记录｜演示录屏（5 分钟评委动线）',
    target: 'video',
    required: '选交',
    what: '与上面两份文字演示同一条动线；若在线 Demo 需登录才必须附，本项目 Demo 无需登录，故此项为加分。链接由参赛者提交时在表单填写，本仓库不托管视频',
  },
  {
    section: '必交 · 运行记录（赛道三 AI Trading Desk：完整投研任务的演示或录屏）',
    type: '运行记录｜事后判分报表（本项目最接近回测报告的一份，含全部 caveat）',
    target: 'docs/reports/review.md',
    required: '必交',
    what: '235 张卡 → 115 个独立主张 → 34 条决出胜负（10 胜 24 负），方向命中率 29.4%（95% CI 14.1–44.7%）；打分与实现超额的 Spearman rho = -0.138 被系统自己标为 BLOCKER',
  },
  {
    section: '必交 · 运行记录（赛道三 AI Trading Desk：完整投研任务的演示或录屏）',
    type: '运行记录｜生成上述报表的代码（官方要求"回测报告须附生成该报告的代码，不接受纯截图"）',
    target: 'prism.mjs',
    required: '必交',
    what: '入口 `npm run review:seed`（= `node prism.mjs review --board=data/fixtures/board-seed.json`）。看板 fixture 由 scripts/build-seed.mjs 用 11 个固定 as-of × 6 个场景回放生成，连续两次重建 SHA-256 相同（实测），报表除时间戳行外逐字节可复现',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜验证数据与关键指标（全部实测数字 + 逐项 caveat + 明确列出「我们没有测的」）',
    target: 'docs/VALIDATION.md',
    required: '支撑',
    what: '一页速览表把每个数字标注为 实测 / 估算 / 目标，并给出各自的复现命令',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜架构说明（七阶段管线含复盘回路 / 7 频道 / 证据账本 / 五因子打分 / 看板状态机）',
    target: 'docs/ARCHITECTURE.md',
    required: '支撑',
    what: '含两处常被混淆的账本数字的并列对照表（full-sweep 88.5% vs doctor smoke 84.6%，两轮恰好都是 26 items）',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜复盘闭环说明（三条轴 / 七个方法决定 / 为什么绝不自动调权）',
    target: 'docs/REVIEW-LOOP.md',
    required: '支撑',
    what: '解释为什么 rho = -0.138 被如实公开而不是悄悄调权：自动调权等于拟合噪声，且之后没人能分辨规则是被证据改的还是被运气改的',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜真实价格数据研究：宏观传导（25 个真实事件逐条明细）',
    target: 'docs/reports/transmission-study.md',
    required: '支撑',
    what: '跑在 25 symbols · 41,386 根真实日 K 上（2019-01-02 → 2025-09-30，Nasdaq 公开 API），是 surprise 权重 0.30 的实证依据；`npm run replay` 可重跑',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜真实价格数据研究：隔夜与休市窗口跳空（15,478 个真实跳空）',
    target: 'docs/reports/gap-study.md',
    required: '支撑',
    what: '支撑 closed-window 频道；同时报告 naive t 与按日期聚类的 clustered t，并以更保守的 clustered 为准',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜自动校验报表：结构性 / 数据完整性 / 研究质量检查（60 / 60）',
    target: 'docs/reports/validation.md',
    required: '支撑',
    what: '由 `npm run validate` 生成，可直接作为 CI 门禁（任何一项失败即退出非零）',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜项目陈述（问题定义 / 人群与非人群 / 实测数据 / 五个真实踩过的坑）',
    target: 'docs/PROJECT-STATEMENT.md',
    required: '支撑',
    what: '含报名表「项目说明」与「大模型在项目中的作用」两个字段的成稿',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜路线图（每一项都挂在一个已实测数字上，含明确的 non-goals）',
    target: 'docs/ROADMAP.md',
    required: '支撑',
    what: 'BLOCKER（打分符号反转）的四步修法，以及性价比最高的一项：把 invalidation 收紧成四字段必填',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜在线演示的生成代码（静态回放包的录制器 + 浏览器端适配器 + 防漂移测试）',
    target: 'scripts/export-static.mjs',
    required: '支撑',
    what: 'npm run export:static 用真实离线引擎跑完六个场景，把每条 /api/* 响应（含 SSE 帧间隔）录进 docs/demo/；web/static-adapter.js 在浏览器里回放，web/app.js 一行未改。tests/static-demo.test.mjs 的 14 项检查保证它与引擎不漂移：路由覆盖、场景深度相等、看板 = 已提交 fixture、复盘数字 = 已提交报表',
  },
  {
    section: '支撑材料 · 研究质量与工程可信度',
    type: '支撑｜部署说明（五条上线路径，逐项标注本环境验证到什么程度）',
    target: 'docs/DEPLOY.md',
    required: '支撑',
    what: '含只读根文件系统的 PRISM_STATE_FILE、HOST/PORT 识别、反向代理会静默缓冲 SSE 流这个本机测不出来的坑，以及第 7 节 GitHub Pages 静态回放的完整能与不能对照表',
  },
  {
    section: '必交 · X 传播',
    type: 'X 传播｜推文链接（含 #BitgetHackathon + @Bitget_AI，已引用转发官方指定推文）',
    target: 'xpost',
    required: '必交',
    what: '必交且只能由参赛者本人发布：从 docs/X-POSTS.md 取第 1 帖发到 X 并引用转发官方指定推文，发布后用 --xpost= 回填本行与报名表「X 传播推文链接」字段；17 帖草稿与 86/86 合规校验见 docs/reports/x-posts.md',
  },
  {
    section: '必交 · X 传播',
    type: 'X 传播｜草稿全文与合规校验报表（17 / 17 帖 · 86 / 86 检查）',
    target: 'docs/X-POSTS.md',
    required: '支撑',
    what: '按 X 官方 v3 权重（中文/全角 2 · 拉丁 1 · URL 固定 23）逐条校验话题标签、@提及、实质性（≥40 权重单位原创文案）、长度与是否引用转发官方推文；`npm run xpost` 可复现',
  },
];

/** The reproduce block printed at the foot of the box. */
const FOOTER = [
  '—— 本地一键复现（上面每一个数字评委都可自行验证，全部离线 / 零依赖 / 零 key）——',
  'git clone <repo-url> && cd prism-desk',
  'node prism.mjs doctor    # 数据接线自检 + smoke run（9 张卡，账本 26 items / pass 22 / fail 0）',
  'node prism.mjs demo      # 逐字重建上面那份 951 行逐字稿（as-of 由场景钉死，无需传参）',
  `npm test                 # ${TEST_COUNT} / ${TEST_COUNT} · 0 跳过（全新 clone 亦然）`,
  'npm run validate         # 60 / 60 -> docs/reports/validation.md',
  'npm run replay           # 重跑两份真实价格事件研究',
  'npm run seed             # 重建看板 fixture，连续两次 SHA-256 相同',
  'npm run review:seed      # 复现上面那份事后判分报表',
  'npm run xpost            # 复现 X 帖合规报表',
  'npm run export:static    # 重建上面那个在线演示的静态回放包 -> docs/demo/',
  'node server.mjs          # http://127.0.0.1:4310',
  '',
  '说明：demo 里的发行主体（CRVS / HLXN / ASTR / BLWF / NWCL）是虚构的，语料由我们自己撰写，',
  '这样"正确答案"才是已知且可判分的；每个虚构主体都显式披露它借用的真实价格代理，`npm run validate`',
  '强制检查这条披露。价格数据是真实的。这两件事在 doctor 输出和每张卡的证据账本里分开标注。',
];

/**
 * Every hard number the block above asserts, paired with the generated artefact
 * that is its authority. `--check` re-reads those artefacts and refuses to emit
 * the block if any number has drifted - which is exactly how "178 个测试" survived
 * one edit too long in the first draft of this file.
 *
 * Normalisation: the reports write 41386 and 15478 without thousands separators
 * and use a hyphen in 14.1-44.7%, while the submission box uses the prettier
 * 41,386 / 15,478 / en-dash form. Both sides are normalised before comparison.
 */
export const CLAIMS = [
  { says: '951 行逐字稿', from: 'docs/DEMO-TRANSCRIPT.md', kind: 'lines', expect: 951 },
  { says: '235 张卡的看板 fixture', from: 'data/fixtures/board-seed.json', kind: 'cards', expect: 235 },
  { says: '11 个固定 as-of × 6 个场景 = 66 次回放', from: 'data/fixtures/board-seed.json', kind: 'replay', expect: [11, 6, 66] },
  { says: '115 个独立主张', from: 'docs/reports/review.md', kind: 'has', expect: '| distinct claims | 115 |' },
  { says: '34 条决出胜负', from: 'docs/reports/review.md', kind: 'has', expect: '| decided (won / lost) | **34** |' },
  { says: '命中率 29.4%', from: 'docs/reports/review.md', kind: 'has', expect: '**29.4%**' },
  { says: 'rho = -0.138 (n=45)', from: 'docs/reports/review.md', kind: 'has', expect: '**-0.138** (n=45)' },
  { says: '60 项验证检查', from: 'docs/reports/validation.md', kind: 'has', expect: '**60/60 checks passed**' },
  { says: '25 symbols · 41,386 根真实日 K', from: 'docs/reports/validation.md', kind: 'has', expect: '25 symbols, 41386 bars' },
  { says: '15,478 个真实跳空', from: 'docs/reports/gap-study.md', kind: 'has', expect: '15478' },
  { says: '17 帖', from: 'docs/reports/x-posts.md', kind: 'has', expect: '(17 block(s))' },
  // The published demo is a recording, so its numbers are claims too: if the
  // bundle drifts from the reports it replays, the demo contradicts the repo.
  { says: '在线演示的复盘裁决数', from: 'docs/demo/data/api/review.json', kind: 'has', expect: '"decided":34' },
  { says: '在线演示的 Spearman rho', from: 'docs/demo/data/api/review.json', kind: 'has', expect: '"scoreVsOutcomeRho":-0.138' },
  { says: '在线演示的 full-sweep 账本', from: 'docs/demo/data/api/status.full-sweep.json', kind: 'has', expect: '"passRate": 88.5' },
  { says: '在线演示录满 6 个场景', from: 'docs/demo/data/api/ask/index.json', kind: 'has', expect: '"scenarioId": "risk"' },
];

/**
 * Numbers this script deliberately does NOT claim to verify from disk, with the
 * command that is their authority. Listing them is the point: an unchecked
 * number presented as checked is worse than one openly labelled unchecked.
 */
export const UNVERIFIED_HERE = [
  { says: `${TEST_COUNT} / ${TEST_COUNT} 测试通过`, authority: 'npm test' },
  { says: '86 / 86 X 帖合规检查', authority: 'npm run xpost' },
  { says: '~60 ms 全频道扫描耗时', authority: 'node prism.mjs demo --only=full-sweep（耗时随机器而异）' },
  { says: '看板 fixture 连续两次重建 SHA-256 相同', authority: 'npm run seed（跑两次比对哈希）' },
];

const norm = (s2) => String(s2).replace(/[,\u00a0]/g, '').replace(/[\u2013\u2014]/g, '-');

/** Re-reads every artefact CLAIMS names. Returns a list of human-readable failures. */
export function verifyClaims() {
  const bad = [];
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) {
      const p = join(ROOT, rel);
      const raw = existsSync(p) ? fsRead(p, 'utf8') : null;
      // A trailing newline terminates the last line; it does not start a new one.
      cache.set(rel, raw === null ? null : { text: raw, lines: raw.replace(/\n$/, '').split('\n').length, json: null });
      const hit = cache.get(rel);
      if (hit && rel.endsWith('.json')) { try { hit.json = JSON.parse(hit.text); } catch { hit.json = null; } }
    }
    return cache.get(rel);
  };

  for (const c of CLAIMS) {
    const art = read(c.from);
    if (!art) { bad.push(`${c.says}: source artefact ${c.from} is missing - run the generator for it first`); continue; }
    if (c.kind === 'lines') {
      if (art.lines !== c.expect) bad.push(`${c.says}: ${c.from} actually has ${art.lines} lines`);
    } else if (c.kind === 'cards') {
      const n = art.json ? (art.json.cards || []).length : -1;
      if (n !== c.expect) bad.push(`${c.says}: ${c.from} actually holds ${n} cards`);
    } else if (c.kind === 'replay') {
      const pv = (art.json && art.json.provenance) || {};
      const got = [(pv.replayDates || []).length, (pv.scenarios || []).length, pv.runs];
      if (got.join() !== c.expect.join()) bad.push(`${c.says}: ${c.from} provenance says ${got.join(' x ')} runs=${got[2]}`);
    } else if (!norm(art.text).includes(norm(c.expect))) {
      bad.push(`${c.says}: "${c.expect}" not found in ${c.from} - regenerate that report`);
    }
  }
  return bad;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
    else out._.push(a);
  }
  return out;
}

/** Every repo-relative path the manifest points at. */
export function manifestPaths() {
  return MANIFEST.map((m) => m.target).filter((t) => !URL_KEYS.includes(t));
}

/** Returns the list of manifest paths that are missing from disk. */
export function missingPaths() {
  return manifestPaths().filter((p) => !existsSync(join(ROOT, p)));
}

export function renderBlock(urls) {
  const repo = urls.repo || '<repo-url>';
  const link = (target) => (URL_KEYS.includes(target)
    ? (urls[target] || `<${target === 'repo' ? 'repo' : target}-url>`)
    : `${repo}/blob/main/${target}`);

  const lines = [];
  lines.push('【Prism Desk · 棱镜投研台】');
  lines.push('Base Camp S2 · 赛道三 AI Trading Desk → 子主题：信息提炼与信号生成');
  lines.push('把非结构化的美股 / 代币化股票信息，提炼成可证伪、有证据链的信号卡片。');
  lines.push('零第三方依赖（Node ≥ 20 标准库），clone 后 `node server.mjs` 直接可跑，全程离线可复现。');

  let section = null;
  let n = 0;
  for (const item of MANIFEST) {
    if (item.section !== section) {
      section = item.section;
      lines.push('');
      lines.push(`—— ${section} ——`);
    }
    n += 1;
    // "[支撑] 支撑｜..." says the same thing twice; drop the prefix when it
    // duplicates the requirement tag. The official vocabulary (项目链接 /
    // 运行记录 / X 传播) is kept, because the form asks you to name the type.
    const prefix = `${item.required}｜`;
    const type = item.type.startsWith(prefix) ? item.type.slice(prefix.length) : item.type;
    lines.push('');
    lines.push(`${String(n).padStart(2, '0')}. [${item.required}] ${type}`);
    lines.push(`    ${link(item.target)}`);
    lines.push(`    · ${item.what}`);
  }

  lines.push('');
  lines.push(...FOOTER.map((l) => l.replace('<repo-url>', repo)));
  return lines.join('\n') + '\n';
}

function main(argv) {
  const flags = parseArgs(argv);
  const missing = missingPaths();
  const drift = verifyClaims();

  if (missing.length || drift.length) {
    if (missing.length) {
      process.stderr.write('submission-links: the manifest points at files that do not exist:\n');
      for (const m of missing) process.stderr.write(`  MISSING  ${m}\n`);
    }
    if (drift.length) {
      process.stderr.write("submission-links: numbers in the block contradict the repo's own generated reports:\n");
      for (const d of drift) process.stderr.write(`  STALE    ${d}\n`);
    }
    process.stderr.write('Fix the manifest or regenerate the reports. Refusing to emit a block a judge could falsify.\n');
    return 1;
  }

  if (flags.check) {
    process.stdout.write('submission-links: OK\n');
    process.stdout.write(`  ${manifestPaths().length} repo paths in the manifest all exist (${MANIFEST.length} link lines)\n`);
    process.stdout.write(`  ${CLAIMS.length} hard numbers re-read from their source artefacts, none drifted\n`);
    process.stdout.write('  not verifiable from disk - the authority for each is named:\n');
    for (const u of UNVERIFIED_HERE) process.stdout.write(`    - ${u.says}  [${u.authority}]\n`);
    const unset = URL_KEYS.filter((k) => !flags[k]);
    if (unset.length) {
      process.stdout.write(`  note: ${unset.length} URL placeholder(s) not supplied yet: ${unset.map((u) => `--${u}=`).join(' ')}\n`);
    }
    return 0;
  }

  const urls = {};
  for (const k of URL_KEYS) if (flags[k] && flags[k] !== true) urls[k] = String(flags[k]).replace(/\/+$/, '');
  const text = renderBlock(urls);

  if (flags.out) {
    const p = resolve(String(flags.out));
    writeFileSync(p, text, 'utf8');
    process.stdout.write(`submission-links: wrote ${p}\n`);
  } else {
    process.stdout.write(text);
  }

  const unset = URL_KEYS.filter((k) => !urls[k]);
  if (unset.length) {
    process.stderr.write(`\nsubmission-links: ${unset.length} placeholder(s) still in the output: ${unset.map((u) => `--${u}=`).join(' ')}\n`);
    process.stderr.write('Supply them and re-run; the box is not submittable while a <...-url> remains.\n');
  }
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    const code = main(process.argv.slice(2));
    if (code) process.exitCode = code;
  } catch (err) {
    process.stderr.write(`${(err && err.stack) || err}\n`);
    process.exitCode = 1;
  }
}
