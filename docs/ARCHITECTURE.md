# Architecture / 架构

Prism Desk 是一条**单向管线**：信息进，可证伪的判断出。每个阶段都有独立的模块、独立的测试，以及**可流式观测的 trace 事件**。管线末端还有一条**回路**（REVIEW）：卡片到期之后回头判分。

```
                    ┌──────────────────────────────────────────────────────────┐
   natural language │  PLAN  ->  INGEST  ->  EXTRACT  ->  VERIFY  ->  SCORE  ->  PRESENT
   question (中/EN) └──────────────────────────────────────────────────────────┘
        │                │          │           │           │          │           │
        │                │          │           │           │          │           └─ brief / board / web
        │                │          │           │           │          └─ 5-factor rubric + written reasons
        │                │          │           │           └─ EVIDENCE LEDGER (pass / fail / unverifiable)
        │                │          │           └─ rules extractor ⊕ LLM extractor -> reconcile
        │                │          └─ corpus + Bitget MCP + Signal Skills + real price book
        │                └─ channels, data intents, tickers, US cash session state
        └─ src/desk/pipeline.mjs : planQuestion()
```

前六个阶段是**正向路径**。第七个是**回路**：

```
   PRESENT ──(卡片带着失效条件与复检时点上板)──► … 窗口关闭 … ──► REVIEW
      ▲                                                            │
      └──── 只报告；永不自动回写打分规则（改规则必须是一次人类 commit） ────┘
```

`REVIEW`（`src/review/`）拿真实价格回头裁决已到期的卡片，详见下文 §7 与 [`REVIEW-LOOP.md`](REVIEW-LOOP.md)。

设计上的三条硬约束：

1. **零依赖。** 只用 Node ≥ 20 标准库。没有 `npm install`，没有构建步骤，评委 clone 下来就能跑。Web 前端是原生 HTML/CSS/JS。
2. **确定性优先。** 不配 LLM key 时，系统走纯规则路径，**同样的输入必然产出同样的输出**。这让 211 个测试和 60 项验证检查成为可能。
3. **LLM 不享有豁免权。** 配了 key 之后，LLM 抽取的卡片和规则抽取的卡片走**同一个证据账本、同一套打分规则**。模型说错数字，账本照样拦。

---

## 阶段详解

### 1. PLAN — `src/desk/pipeline.mjs`

`planQuestion(text)` 把一句自然语言（中/英）变成一个研究计划：

- **channels** — 路由到 7 个频道中的一个或多个
- **intents** — 需要哪些数据（`quote`, `news`, `earningsCalendar`, `analystEstimates`, `signal:sentiment-analyst`, `signal:macro-analyst`, …）
- **docKinds** — 需要哪几类文档（`earnings-release`, `macro-print`, `fomc-statement`, `guidance`, …）
- **tickers** — 显式解析；解析不到时走 issuer-in-scope 回退，并**在 trace 里明说这是回退**（事件 `plan:ticker-fallback`）
- **session** — 当前美股现金盘状态（`open` / `pre-market` / `after-hours` / `closed`），closed-window 频道的前提

> LUI 流畅性是评分项，所以路由本身被当成产品功能来测：`tests/extract.test.mjs` 里有一批中英文路由断言（例如 `周末休市期间 rToken 怎么定价` 必须路由到 `closed-window`）。误路由是真缺陷，不是小事。

### 2. INGEST — `src/ingest/`

| 模块 | 作用 |
|---|---|
| `corpus.mjs` | 加载 `data/corpus/*.json`，提供 `between(from, to)` 时间窗查询 |
| `mcp-client.mjs` | MCP 传输层（JSON-RPC），带超时与 TTL 缓存 |
| `bitget-market.mjs` | Bitget MCP Server：美股 / ETF 只读行情、财报日历、分析师预期 |
| `bitget-signal.mjs` | Bitget Signal Skills：sentiment-analyst、macro-analyst 等。哪个频道调用哪个 Skill 由 `SKILL_TRIGGERS`（`src/desk/pipeline.mjs`）单点定义，`/api/capabilities` 也读它，所以不会声明一个从不调用的 Skill |
| `chainbase.mjs` | 可选外部 Partner 源 Chainbase AgentKey（行情 / 链上 / 新闻 / 社媒）。无 key -> `disabled` 且不发任何请求；有 key 无端点 -> `error` 并说明原因；工具名一律走 `tools/list` 发现 + 模糊解析 |
| `prices.mjs` | 真实日 OHLCV 价格库（`data/prices/*.csv`），供账本复算与事件研究使用 |
| `fixtures.mjs` | 离线录制响应（`data/fixtures/mcp/`） |
| `index.mjs` | `initHub()`：把上面这些装成一个 hub，并按 `PRISM_DATA_MODE` 决定 live / offline |

**三种数据模式**：

- `auto`（默认）— 先试真实端点，失败则透明降级到 fixture
- `live` — 强制真实端点，拿不到就报错
- `offline` — 完全不联网

每个快照都带 `origin`（`live` / `fixture` / `local`），trace 与卡片档案里都会显示。**评委能一眼看出哪些数字来自真实端点。**

### 3. EXTRACT — `src/extract/`

**双抽取器 + 对账。**

- `lexicon.mjs` — 领域词典。最关键的分类是**指引立场**，优先级为 `GUIDANCE_PRIORITY = [withdraw, lower, raise, reiterate]`。`withdraw`（撤回指引）是打分里惩罚最重的立场，因为它意味着管理层主动放弃了可预测性 —— 这与"指引下调"是完全不同的信息，不能被混为一谈。另有 `TRANSMISSION`（宏观传导词典）、`MACRO_KINDS`、`toneScore`、`riskLanguageHits`、`classifyPolicy`。
- `rules.mjs` — 确定性规则抽取器。入口是 `extractFromDocument(doc)` / `extractFromDocuments(docs)`，按文档 kind 分派到：

  - `fromEarnings(doc, asOf)` — 财报预期差（earnings-gap）
  - `fromMacro(doc, asOf)` — 宏观传导链路（macro-transmission）
  - `fromNews(doc, asOf)` — 叙事转向（narrative-shift）与反向风险旗（risk-flag）
  - `fromRisk(doc, asOf)` — 不利语言与比率异常（risk-flag）
  - `fromSessionContext(asOf)` — 休市窗口定价（closed-window），内部调 `measureGapBehaviour(symbol, asOf)` 从**真实价格库**算出跳空先验
  - `fromDataSnapshots(snapshots, asOf)` — 资金足迹与跨资产联动，分派到 `fromInsider` / `fromInstitutional` / `fromCryptoSignal`
- `prompts.mjs` + `llm.mjs` — 可选的 LLM 抽取路径，输出受 schema 约束。
- `index.mjs` — `Extractor`：并行跑两路、对账去重；`hydrate()` **强制钳制模型输出**（越界的 direction / horizon / instruments / conviction 会被改写成合法值，超长 quote 会被截断）。有测试专门钉住这个行为：`hydrate coerces out-of-range model values instead of trusting them`。
- `stampTime()` — 给每张卡打上 `informationAt`（**源文档发布时间**）与运行时的 `as-of`。这是 freshness 衰减的基准，也是 `--as-of` 场景复现能真正生效的原因。

### 4. VERIFY — `src/verify/ledger.mjs`（证据账本）

**这是本项目的反幻觉核心。** 卡片里的每一个数字都必须对回一个出处，否则不算数。

按证据类型分派核验策略：

| 证据类型 | 核验方式 |
|---|---|
| `quote` | 回到源文档做精确 / 归一化匹配，记录**字符偏移** `@index` |
| `metric` / `estimate` | 先在数据快照里按字段路径找（`$.fearGreed.value`），再退回文档 `meta$.actual` / `meta$.consensus`，最后在正文里找数字；数值比对用**相对容差 2%**（`PRISM_VERIFY_TOL`） |
| `computed` | **重新执行声明的 recipe**（例如 `gap-study on SPY`），看能否复现卡片里写的数字。复现不了 → `unverifiable` |
| `calendar` | 对回 session clock 的计算结果 |
| 其它 / 无策略 | `unverifiable`，并在档案里写明原因 |

三种裁决：`pass` ✅ / `fail` ❌ / `unverifiable` ⚠️。

**隔离规则：** 若某张卡的**头条证据（`headline: true`）fail**，且 `PRISM_STRICT_VERIFY=true`（默认），整张卡进隔离区，**永不发布**。`unverifiable` 不会触发隔离，但会**扣 corroboration 分**，并在卡片档案里如实显示 —— 系统承认"这个数字我没能独立核对"，而不是悄悄放行。

账本汇总每次运行都会输出。**两个常被引用的实测值来自不同的运行**，而且恰好都是 26 items，极易混淆，所以并列写清：

| 命令 | as-of | 账本实测 |
|---|---|---|
| `node prism.mjs demo --only=full-sweep` | 2025-09-19T20:00Z（场景钉死） | `26 items · pass 23 · fail 0 · unverifiable 3 · 88.5%` · 9 张卡全部发布 |
| `node prism.mjs doctor` 的 smoke run | 2025-09-13T15:00Z（钉死） | `26 items · pass 22 · fail 0 · unverifiable 4 · 84.6%` · 9 张卡（8 发布，1 低于阈值） |

问题文本与时点不同，卡片组合就不同 —— 两边都是 26 items 属于巧合。3 个 unverifiable 是 HLXN / CRVS / ASTR 三张财报卡的 consensus `estimate`（`E2`），账本给出的理由原文是 `no document or snapshot available to check this number against`；doctor 多出的第 4 个是 ASTR 闭窗卡的 `computed` `E3`（44.9/D，低于发布阈值，理由是 `computed claim without a re-executable recipe`）。两轮 `fail` 均为 0、`quarantined` 均为 0：unverifiable 不触发隔离，只扣 corroboration 分并如实显示。

> 评测集的 ledger 部分**故意掺入了编造的数字**（`data/eval/extraction-eval.json`），用来证明账本真的会拦截，而不是永远绿灯。

### 5. SCORE — `src/score/rubric.mjs`

五个因子，显式权重，**每个因子都返回一句人类可读的理由**（不是只有一个数字）：

| 因子 | 权重 | 在测什么 |
|---|---:|---|
| `surprise` | **0.30** | 预期差幅度。权重最高 —— 因为价格重定价的是"实际 vs 一致预期"的差，不是头条的好坏。consensus 置信度会调整分值；指引方向与 print 同向会加分 |
| `corroboration` | 0.22 | 账本通过率 + 独立来源数 + 多模态证据（metric/quote/computed 混用比单一类型更可信）+ 头条是否过账；每项 unverifiable 扣分 |
| `asymmetry` | 0.20 | 盈亏比 + 失效条件是否给了**可观测水平**（有具体价位/数值 vs 只有"感觉不对"） |
| `tradability` | 0.18 | 工具流动性 × 市值覆盖 + 是否给了可执行价位 + 仓位是否明确；rToken-only、intraday 等会额外扣分 |
| `freshness` | 0.10 | 按**信息发布时间** `informationAt` 对该频道的半衰期做指数衰减 |

工具流动性表（`LIQUIDITY`）：`native-equity 1.0` · `etf 0.95` · `option 0.7` · `crypto 0.6` · **`rtoken 0.45`** · `cash 1.0`。
rToken 流动性给 0.45 是刻意保守：代币化股票的盘口比原生股薄得多，且 mint/redeem 套利可能在你之前就抹平错位。

**freshness 为什么按 `informationAt` 而不是 `createdAt`：** 一张今天生成、但引用十天前信息的卡片，本质上是旧信息。按运行时墙上时钟算，`--as-of` 历史场景复现会完全失真（所有卡片都"刚刚生成"，freshness 永远满分）。改成按源文档时间戳之后，`--as-of` 才真正有意义，freshness 也才成为一个真实起作用的因子。

各频道的信息半衰期（小时）：

| 频道 | 半衰期 | 直觉 |
|---|---:|---|
| `closed-window` 休市窗口定价 | **16** | 下一个现金开盘就作废 |
| `cross-asset` 跨资产联动 | 96 (4d) | 情绪/资金 regime 变化较快 |
| `macro-transmission` 宏观传导链路 | 120 (5d) | 到下一个数据点为止 |
| `narrative-shift` 叙事转向 | 168 (7d) | 叙事以周为单位 |
| `earnings-gap` 财报预期差 | 240 (10d) | 财报后漂移窗口 |
| `risk-flag` 反向风险旗 | 504 (21d) | 结构性风险衰减慢 |
| `flow-footprint` 资金足迹 | 720 (30d) | 13F 本身就是 45 天滞后快照 |

**等级与门槛：** `A ≥ 75` · `B ≥ 62` · `C ≥ 48` · `D ≥ 35` · `F < 35`；发布门槛 **45/100**（`PRISM_MIN_SCORE`）。低于门槛的卡片不进看板，但会出现在简报的 "Below publish threshold" 区，**保持可见**，不静默丢弃。

### 6. PRESENT — `src/desk/board.mjs` · `src/desk/brief.mjs` · `web/`

**Signal Board** 做三件人类否则要手工做的家务：

1. **DEDUPE / SUPERSEDE** — 同一主体、同一论点、来自更新文档的卡片会**取代**旧卡片（旧卡标记 `superseded` 并记录 `supersededBy`），而不是并排堆着。
2. **CONFLICT** — 同一 ticker 上两张方向相反的 active 卡片会被**显式暴露**，绝不静默净冲。
3. **EXPIRE** — 卡片有 `expiresAt`，过期即退役（`expired`）。**过期信号比没有信号更糟。**

卡片状态：`draft` → `active` → `superseded` / `expired` / `quarantined`，以及**只有复盘才会写入**的两个终结态 `invalidated`（失效条件确实被触发）/ `realized`（主张在自己的窗口内兑现）。状态持久化到 `data/state/board.json`（gitignored，运行时生成；可由 `npm run seed` 逐字节重建，见 §复盘）。

**渲染层：** `brief.mjs` 产出 markdown 简报与 CSV 导出；`web/` 是零构建的原生前端，通过 `POST /api/ask`（SSE）实时展示每个阶段的 trace。SSE 响应带 `X-Accel-Buffering: no`，否则反向代理会把整条 trace 缓冲成一次性输出（见 [`DEPLOY.md`](DEPLOY.md) §5）。

---

### 7. REVIEW — `src/review/adjudicate.mjs` · `src/review/report.mjs`

一张写明了失效条件的卡片，在窗口关闭**之前**是一个承诺，关闭**之后**就是一个可以判分的测试。这一阶段判分。

**三条轴，永远分开算：**

| 轴 | 测什么 | 参与裁决 |
|---|---|---|
| ① 失效条件 | 收盘价有没有穿越卡片**自己写下的**数值水平，且在 `recheckAt` 复检日仍成立 | ✅ 优先 |
| ② 风险路径 | `tradeSketch` 的止损 / 目标位在窗口内有没有被摸到 | ❌ 只报告 |
| ③ 实现超额 | 卡片自己窗口内、相对 SPY 的**带符号超额收益**（±1% 实质性带内记 `inconclusive`） | ✅ ① 未触发时用 |

② 永不裁决，因为「这笔交易会不会疼」和「这个判断对不对」是两个问题——一张被止损扫掉但方向正确的卡，如果让 ② 裁决就会被记成失败，而它**最该被学到的一课**是"失效条件太紧"。

**四个关键实现决定：**

1. **窗口锚定 `createdAt`**（发行时刻），不是 `informationAt`。卡片上每个价位都是以发行时的价格敲定的。
2. **重述合并**：按 `claimKey` 折叠，`claimKey` 里包含**测量窗口**（含是否被价格库末端截断）——被截断的窗口和跑满到期日的窗口是两个不同的测试。
3. **不可测是一个裁决，不是一个缺口**：引用了价格库里没有的序列 → `unmeasurable`，不计入胜负分母，也不悄悄丢掉。
4. **同 bar 并列判止损**：日线 OHLC 无法排序盘中事件，同时触及止损与目标时假定止损先到——这个偏向**压低**命中率。

🔴 **它拒绝做的事：自动修改打分规则。** 只报告。样本非独立（一批主张共享文档、日期与基准），自动调权等于把噪声拟合进规则，而且之后没人能分辨规则是被证据改的还是被运气改的。**默认只读**，`--persist` 才写回，且只重分类**已终结**状态的卡片，永不改动 `active` 卡。

**可复现性。** `data/state/board.json` 是 gitignored 的运行时状态，所以全新 clone 上的看板是空的、复盘会裁决 0 条主张。为此看板 fixture 是**提交的**：

```bash
npm run seed         # scripts/build-seed.mjs：11 个固定 as-of × 6 个场景 = 66 次运行
npm run review:seed  # 从 data/fixtures/board-seed.json 复现 docs/reports/review.md
```

连续两次 `npm run seed` 产出的文件 **SHA-256 相同（实测）**。要做到这一点修掉了三个真实漏洞：卡片 id 曾用 `Date.now()` 打戳（`--as-of` 冻结了 `createdAt` 却没冻结身份）、账本 `verifiedAt` 曾用墙上时钟、`npm test` 曾把卡片写进真看板。现在 id 由 `stampTime()` 按运行时钟重打（`rebaseCardId`），`verifiedAt` 取 `card.createdAt`，测试与验证脚本各自钉死到自己的 scratch 状态文件。

**另外还有三处同类的可复现性缺陷。** 第四处是 demo 本身：六个场景在 `server.mjs` 的 `SCENARIOS` 里各自带一个钉死的 `asOf`（`closed-window` 是 2025-09-13T15:00Z 那个周六下午，其余五个是 2025-09-19T20:00Z）。内置语料与价格库是固定的 2025 年 9 月窗口，让桌面时钟默认取"现在"，等于同一条命令在不同日期产出不同卡片。钉死之后 `node prism.mjs demo` 不带参数即可逐字重建 `docs/DEMO-TRANSCRIPT.md`（仅生成时间戳与 6 处 `ms` 耗时不同，实测）；命令行 `--as-of` 与 Web 时钟框仍优先于场景默认值（`tests/server.test.mjs` 有一条断言钉住"每个场景都必须带 as-of"，防止将来被悄悄改掉）。

第五处更隐蔽：`tests/review.test.mjs` 里那条"跑一遍真实看板"的测试原本写着 `{ skip: !existsSync('data/state/board.json') }`。而 `data/state/` 是 gitignored 的 —— 也就是说**全新 clone 上它永远跳过**，`npm test` 实际是 177 通过 + 1 跳过，而所有文档都写着 178/178。跳过的检查不等于通过的检查。现在它改为跑**已提交的** `data/fixtures/board-seed.json`（即 `npm run review:seed` 用的那份看板），并断言 `decided > 0` 以免退化成空测试，所以现在 **179 / 179 · 0 跳过**在干净 checkout 上也是真的（实测；比当时多出的那一条，钉住"提交材料清单不得指向仓库里不存在的文件"）。

第六处是**会话时钟**：`planQuestion()` 里写的是 `sessionState()`（无参 → 取机器当前时间），而 `rules.mjs` 早就写的是 `sessionState(asOf)`。于是 `--as-of` 冻结了卡片、账本与 freshness，却没冻结简报抬头上的美股现金盘状态：钉死在 2025-09-13T15:00Z（周六下午）的 `closed-window` 场景，第一行印的是 `US cash session pre-market · Wed` —— 而这个频道存在的全部前提就是"现金盘关着"。同时 `nyMinutes` 是墙上时钟，每重新导出一次静态 demo，录制包就变一个数。现在 `planQuestion(question, { asOf })` 把已经钉死的时钟传下去，`closed-window` 抬头变成 `closed (weekend) · Sat`；`tests/wiring.test.mjs` 钉住"冻结时钟必须冻结会话"，`tests/static-demo.test.mjs` 钉住"录制包里的 session 必须等于场景 as-of 的 session，且 closed-window 必须落在周末"。

详见 [`REVIEW-LOOP.md`](REVIEW-LOOP.md)。

---

## 7 个信号频道

| id | 中文 | 触发条件 | 典型方向 | 半衰期 |
|---|---|---|---|---:|
| `earnings-gap` | 财报预期差 | 有 consensus 与 actual 的财报文档 | LONG / SHORT | 240h |
| `macro-transmission` | 宏观传导链路 | 宏观数据点 vs 一致预期 | PAIR（多空配对） | 120h |
| `narrative-shift` | 叙事转向 | 新闻/分析师报告的语气与主题变化 | LONG / SHORT | 168h |
| `flow-footprint` | 资金足迹 | 内部人交易、13F 机构持仓 | LONG / neutral | 720h |
| `closed-window` | 休市窗口定价 | 现金盘关闭 + 有盘外落地的信息 | WATCH / neutral | 16h |
| `cross-asset` | 跨资产联动 | 加密侧 regime（F&G、funding、ETF flow） | WATCH | 96h |
| `risk-flag` | 反向风险旗 | 不利语言、比率异常、指引撤回 | AVOID | 504h |

> `macro-transmission` 输出 **PAIR** 而不是单边：宏观数据的影响是相对的（谁受益、谁受损），单边表述会丢掉一半信息。排序由**实测 252 日 OLS beta** 计算（`src/research/factors.mjs`），不是主观断言。

---

## 研究模块 — `src/research/`

不是装饰，是**打分权重的实证依据**：

- `transmission.mjs` — 宏观传导事件研究：25 个真实宏观事件，测 surprise 与后续收益的相关性。**结论支撑了 `surprise` 权重 0.30**（大 surprise 分桶的 ρ 明显高于中 surprise 分桶，单调）。
- `gap-study.mjs` — 隔夜跳空事件研究：15,478 个真实跳空。**结论支撑 closed-window 频道的先验**（继续 48.8% / 回补 46.4%，接近对称 —— 所以系统不会把"跳空必继续"当成规律）。
- `factors.mjs` — 252 日滚动 OLS beta，供 macro-transmission 排序。
- `report.mjs` — 生成 `docs/reports/*.md`。

详见 [`VALIDATION.md`](VALIDATION.md)。

---

## 复盘模块 — `src/review/`

研究模块回答「权重应该定成多少」，复盘模块回答「**我们按这些权重发出的判断，后来对了吗**」。

- `adjudicate.mjs` — `runReview()`：三轴裁决、重述合并、校准分档（按 grade / channel / direction、发布门槛上下、Spearman rho）、findings 生成（**每条 finding 必须带产生它的测量值**，否则不予输出）
- `report.mjs` — `renderReviewReport()`：markdown 报表，caveat 与结论**同页**，不放在附录

CLI `node prism.mjs review`（`--board` / `--as-of` / `--materiality` / `--json` / `--out` / `--persist`）、HTTP `GET /api/review` 与 `GET /api/export/review.md`（均只读）、Web 左栏 **Signal review** 面板。

---

## 测试与验证

```bash
npm test          # 211 tests (node:test)，覆盖 schema / ledger / rubric / extract / util / research / server / static-demo
npm run validate  # 60 项检查 -> docs/reports/validation.md
npm run replay    # 重跑两份事件研究 -> docs/reports/{transmission,gap}-study.md
```

`scripts/validate.mjs` 的 **60 项检查分七个 suite**（当前 60/60 全绿，报表见 `docs/reports/validation.md`）：

| suite | checks | 在验证什么 |
|---|---:|---|
| `extraction` | 10 | 每份带标签的文档是否被读成**正确的频道 / 方向 / 幅度**；含 `earn-beat-withdraw`（超预期但撤回指引**不算做多**）与阴性对照（平淡文档必须产出 **0 张卡**） |
| `ledger` | 9 | 账本对已知裁决的证据是否给对判决，**包括故意掺入的编造数字是否真被隔离** |
| `invariants` | 13 | schema 完整性、卡片字段合法性、rubric 边界、确定性等结构不变量 |
| `determinism` | 2 | 同样输入跑两遍产出**逐字节相同**的结果 |
| `studies` | 6 | 研究质量：样本量足够、报告 **clustered t**（不只是 naive t）、传导研究按 surprise 分桶且**单调** |
| `review` | 12 | 复盘的方法学不变量：每张卡都被裁决、重述被折叠、**三条轴分开报告**、不可测与非方向性**不进胜负分母**、单名按基准调整、窗口锚定**发行时刻**、每条裁决带书面依据、**每条 finding 都引用产生它的数字**、样本过小被标成 BLOCKER、报表渲染后 caveat 仍在、同日期同看板给出同裁决、**默认只读不改存储状态** |
| `data` | 8 | 25 个价格序列可解析且日期有序、open/close 落在 `[low, high]` 内 ≥99.9%、跨多年覆盖、25 个宏观事件字段齐全、14 份语料披露出处、**每个借用真实价格序列的虚构主体都披露了 `priceProxy`**、12 个 fixture 结构合法、零网络可启动 |

---

## 目录

```
src/
  config.mjs        环境与默认值（weights / 门槛 / 容差 / 路径）
  schema.mjs        卡片、证据、频道的 schema 与校验；CHANNELS 定义
  util/             http json csv num stats time log
  ingest/           corpus mcp-client bitget-market bitget-signal chainbase prices fixtures index
  extract/          lexicon rules prompts llm index
  verify/ledger.mjs 证据账本
  score/rubric.mjs  五因子打分
  desk/             pipeline(PLAN) board(状态机) brief(渲染)
  research/         transmission gap-study factors report
  review/           adjudicate(三轴裁决) report(markdown)
server.mjs          HTTP + SSE
prism.mjs           CLI（默认命令是 serve）
web/                index.html app.js styles.css（零构建）
scripts/            validate replay build-seed fetch-prices record-fixtures xpost
```
