# Prism Desk · 棱镜投研台

**Bitget AI Base Camp Hackathon S2 · 赛道三 AI Trading Desk（🟧）· 子主题：信息提炼与信号生成**

> 一句话：把散落在财报、宏观数据、新闻和链上情绪里的**非结构化信息**，压缩成**可证伪、可审计、逐条带证据**的交易信号卡片。
>
> One line: Prism Desk turns unstructured information — earnings releases, macro prints, news, on-chain sentiment — into **falsifiable, auditable signal cards**, where every number is either grounded in a named source or quarantined.

零依赖（Zero-dependency）· Node ≥ 20 · 不需要 `npm install` · 离线可完整运行（runs fully offline）

---

## 仓库与演示 / Repo & demo

**在线演示（点开即用 · 无需登录 / 无需安装 / 无需 key）：** https://lixinlin616-png.github.io/prism-desk/demo/

**GitHub（public）：** https://github.com/lixinlin616-png/prism-desk

演示页发布在 GitHub Pages 上，是一份**静态回放**：`npm run export:static` 驱动真实的离线引擎跑完六个场景，把每一条 `/api/*` 响应（含 SSE 的逐帧节奏）录进 `docs/demo/data/`，浏览器端由 `web/static-adapter.js` 拦下 `window.fetch` 原样回放 —— `web/app.js` 一行都没改。所以点开 `full-sweep` 后那一轮的 9 张卡、26 条核验项 / 88.5% 通过率，以及复盘的 34 条已裁决 / 29.4% 命中 / rho −0.138，都是引擎真实产出（右侧看板栏另有 11 张 active，来自 235 张的已提交 fixture，是复盘的输入而不是某一轮的输出），与 `docs/reports/` 里已提交的报表逐条对得上（`tests/static-demo.test.mjs` 的 14 项检查专门盯这个漂移）。

有两件事静态页面**做不到**，而且它会明说、绝不假装成功：跑一个全新的自由提问（回放最接近的预录任务，并提示这是替换）、写入看板（粘贴文档 / 清空看板返回 409 并说明原因）。页面左下角有一枚永久的 `static replay` 徽标。

要一个**能自由提问**的实时后端，两条路：

```bash
git clone https://github.com/lixinlin616-png/prism-desk && cd prism-desk
node server.mjs          # -> http://127.0.0.1:4310（零依赖，不需要 npm install）
```

或者一键部署到 Render（免费，约 3 分钟）—— 仓库根目录的 `render.yaml` 会把所有字段自动填好，不用手输：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/lixinlin616-png/prism-desk)

零依赖，所以没有构建失败面：Runtime = Docker、Build Command 留空、Start Command = `node server.mjs`、Health Check = `/api/status`、环境变量 `PRISM_DATA_MODE=offline` 与 `PRISM_HOST=0.0.0.0`（蓝图里已写好）。

> 免费实例 15 分钟无流量会休眠，首次加载约 5–10 秒（要载入 41,386 根日 K 的价格库）。**提交报名表前自己先点一次把实例唤醒**，别把冷启动留给评委。另外四条上线路径（Pages / Fly / VPS+Caddy / 临时隧道）见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

---

## 为什么做这个 / Why

7×24 的代币化股票（rToken）与每天只开 6.5 小时的美股现金市场之间，存在一个结构性的信息窗口：**信息在现金市场关门时落地，rToken 是唯一能给价格发现的场所。** 但真正的问题不是"能不能读到新闻"，而是：

- 大模型读财报很快，但它会**编数字**。一个看起来合理的 EPS、一个不存在的 consensus，足以让整条推理链条变成幻觉。
- 市面上的"AI 信号"大多给结论不给**可证伪条件**，也不给**证据出处**，用户无法判断该不该信。

Prism Desk 的三条主张：

1. **预期差 > 头条**（Expectation gap beats headline）。价格重定价的是"实际 vs 一致预期"的差，不是"好/坏"。
2. **证据账本**（Evidence Ledger）。卡片里每一个数字都要对回到某份文档的字符偏移、某个数据快照的字段，或某段可复算的代码。**对不上的不进卡片，进隔离区。**
3. **每张卡都可证伪**（Every card is falsifiable）。卡片必须写明"什么情况下我错了"，并给出**可观测的价格/数值水平**和复检时间。

The same three theses in English: rank on the **expectation gap**, not the headline; ground **every number** in the Evidence Ledger or quarantine it; and ship **no card without a falsification condition** carrying an observable level and a recheck time.

---

## 30 秒上手 / Quickstart

```bash
# 1. 启动 Web 投研台（无需安装依赖）
node server.mjs
# -> http://127.0.0.1:4310

# 2. 或者跑完整的脚本化 demo（六个场景，全链路，写入 docs/DEMO-TRANSCRIPT.md）
#    六个场景各自钉死了 as-of（对齐内置语料与价格窗口），不加任何参数也能逐字复现
node prism.mjs demo --out=docs/DEMO-TRANSCRIPT.md

# 3. 或者直接问一个问题（LUI 入口，中英文都可以）
node prism.mjs ask "HLXN 这份财报到底该不该做空？"
node prism.mjs ask "CPI 低于预期，哪些标的的传导最强？"
node prism.mjs ask "full desk sweep - what is actually tradeable right now?"
```

离线运行（本仓库默认即可离线，Bitget 域名不可达时自动降级）：

```bash
PRISM_DATA_MODE=offline node prism.mjs demo      # macOS / Linux
$env:PRISM_DATA_MODE='offline'; node prism.mjs demo   # PowerShell
```

自检（确认数据接线、价格库、语料、账本全部就绪）：

```bash
node prism.mjs doctor
```

---

## Demo 场景 / Demo scenarios

六个脚本化场景，每一个都是**一次完整的投研任务**（提问 → 计划 → 取数 → 抽取 → 核验 → 打分 → 出判断）：

| id | 场景 | 演示重点 |
|---|---|---|
| `full-sweep` | 全频道扫描 | 一次跑完全部 7 个频道，最推荐先跑这个 |
| `earnings-gap` | 财报预期差 | consensus vs actual、指引立场分类、"beat but ugly" |
| `macro-transmission` | CPI 传导链路 | 排序由**实测 252 日 OLS beta** 计算得出，不是主观断言 |
| `closed-window` | 周末 rToken 窗口 | **S2 核心场景**：7×24 代币化股票 vs 6.5 小时现金盘 |
| `flows` | 内部人与 13F 资金 | 聚合值由证据账本从原始快照**重新计算** |
| `risk` | 反向风险扫描 | 不利语言与比率异常旗标 |

```bash
node prism.mjs scenarios                 # 列出场景
node prism.mjs demo --only=closed-window # 只跑一个
```

每个场景都带一个**钉死的 as-of**（`node prism.mjs scenarios` 会打印出来），对齐内置语料与价格数据的窗口 —— 所以 demo 输出不随你在哪一天运行而变化。命令行 `--as-of=<ISO>` 与 Web 端时钟框仍然优先。

完整逐字记录已生成在 [`docs/DEMO-TRANSCRIPT.md`](docs/DEMO-TRANSCRIPT.md)（`node prism.mjs demo` 可逐字重建）；讲解版脚本在 [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md)。

---

## 命令 / Commands

```bash
node prism.mjs serve                     # HTTP 服务 + Web 投研台（默认命令）
node prism.mjs ask <question>            # 跑一次投研任务并打印简报
node prism.mjs demo [--only=<id>]        # 跑脚本化 demo 场景
node prism.mjs board [--status=all]      # 打印信号板
node prism.mjs card <id>                 # 打印单张卡片的完整档案
node prism.mjs brief                     # 重新打印最近一次简报
node prism.mjs corpus                    # 列出在范围内的文档
node prism.mjs study <transmission|gaps> # 跑真实价格事件研究
node prism.mjs review                    # 复盘：拿真实价格裁决已到期的卡片
node prism.mjs scenarios                 # 列出 demo 场景
node prism.mjs doctor                    # 打印数据接线并自检
node prism.mjs help                      # 帮助
```

常用选项：`--as-of=<ISO>`（冻结桌面时钟，精确复现场景）· `--channels=<a,b>` · `--tickers=<A,B>` · `--json` · `--no-trace` · `--no-persist` · `--out=<file>` · `--keep-board`（仅 `demo`：往已持久化的看板上追加，而不是先清空）

> `demo` 默认**先清空看板再跑**，这正是 `docs/DEMO-TRANSCRIPT.md` 能被裸跑逐字重建的前提 —— 否则先跑过 `doctor` 或 `ask` 的人会得到一份对不上的逐字稿。`tests/wiring.test.mjs` 连跑两遍并逐行比对，钉住这条幂等性。

npm 脚本：`npm start` · `npm run dev` · `npm test` · `npm run validate` · `npm run replay` · `npm run demo` · `npm run seed` · `npm run review:seed` · `npm run xpost` · `npm run doctor` · `npm run export:static` · `npm run submission` · `npm run submission:check`

### HTTP API

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/ask` | POST | 提交问题，返回卡片与全链路 trace（支持 `stream`） |
| `/api/board` | GET | 信号板 |
| `/api/board/reset` | POST | 清空运行时状态 |
| `/api/card/:id` | GET | 单卡完整档案 |
| `/api/corpus` | GET / POST | 查看 / 追加语料 |
| `/api/research/transmission` · `/api/research/gaps` | GET | 两份事件研究结果 |
| `/api/review` | GET | 复盘裁决（只读，支持 `?asOf=`） |
| `/api/export/board.csv` · `/api/export/brief.md` · `/api/export/review.md` | GET | 导出 |
| `/api/status` · `/api/capabilities` · `/api/scenarios` · `/api/runs` | GET | 状态与能力 |

---

## 架构 / Architecture

```
PLAN -> INGEST -> EXTRACT -> VERIFY -> SCORE -> PRESENT -> REVIEW
```

- **PLAN** `src/desk/pipeline.mjs` — 自然语言问题（中/英）路由到频道与数据意图，解析 ticker，附带美股现金盘状态。
- **INGEST** `src/ingest/` — 语料（`corpus.mjs`）+ Bitget MCP 行情（`bitget-market.mjs`）+ Bitget Signal Skills（`bitget-signal.mjs`）+ 真实价格库（`prices.mjs`）+ 离线 fixture（`fixtures.mjs`）+ 可选外部 Partner 源 Chainbase AgentKey（`chainbase.mjs`，无 key 时 `disabled` 且零请求）。
- **EXTRACT** `src/extract/` — 双抽取器：**确定性规则**（`rules.mjs` + `lexicon.mjs`）与**可选 LLM**（`llm.mjs` + `prompts.mjs`），二者经 `index.mjs` 对账（reconcile）。
- **VERIFY** `src/verify/ledger.mjs` — 证据账本：每个数字回溯到文档字符偏移 / 快照字段 / 可复算代码；对不上则隔离。
- **SCORE** `src/score/rubric.mjs` — 5 个加权因子，每个因子都附**可审计的文字理由**。
- **PRESENT** `src/desk/brief.mjs` + `web/` — 简报、看板、单卡档案。
- **REVIEW** `src/review/adjudicate.mjs` — 窗口关闭后回头判分：失效条件是否触发 / 风险路径 / 相对 SPY 的超额收益，**三条轴分开算，只有前两条与第三条参与裁决，风险路径永不裁决**。默认只读，**永不自动改打分规则**。

### 7 个信号频道

`earnings-gap` 财报预期差 · `macro-transmission` 宏观传导链路 · `narrative-shift` 叙事转向 · `flow-footprint` 资金足迹 · `closed-window` 收盘窗口（rToken）· `cross-asset` 跨资产联动 · `risk-flag` 反向风险旗

### 打分规则（Rubric）

| 因子 | 权重 | 含义 |
|---|---:|---|
| surprise | 0.30 | 预期差幅度（不是头条好坏） |
| corroboration | 0.22 | 证据账本通过率、独立来源数、多模态证据 |
| asymmetry | 0.20 | 盈亏比 + 失效条件是否有可观测水平 |
| tradability | 0.18 | 工具流动性、可执行价位、仓位大小 |
| freshness | 0.10 | 按**信息发布时间** `informationAt` 对各频道半衰期衰减 |

发布门槛 **45/100**；低于门槛的卡片不会进看板（但仍可见于 trace，标记 below threshold）。

---

## 诚实性声明 / Honesty

这一节是本项目的**核心设计约束**，不是免责声明。评委可以直接验证下面每一条。

**1. Demo 里的发行主体是虚构的。** `CRVS` `HLXN` `ASTR` `BLWF` `NWCL` 都是虚构公司，语料是我们自己写的，这样"正确答案"才是已知的、可判分的。每个虚构主体都**显式声明**它借用的真实价格代理（`priceProxy`：NVDA / CAT / WMT / PFE / MSFT），`npm run validate` 会强制检查这条披露。

**2. 价格数据是真实的。** `data/prices/*.csv` 是 25 个标的、41,386 根日 K（2019-01-02 → 2025-09-30），来源为 Nasdaq 公开 chart API（见 `scripts/fetch-prices.mjs` 头部注释）。两份事件研究跑在这份真实数据上。

**3. 没有价格先验时，系统会承认没有。** 若某标的在价格库里没有可比跳空样本，卡片会写"无实证先验（no empirical prior）"并把风险条目改为"跳空幅度无锚，减半仓位或不做"，而不是编一个百分比。`tests/extract.test.mjs` 里有一条回归测试专门钉住这个行为。

**4. 证据账本会隔离幻觉。** `data/eval/extraction-eval.json` 的 ledger 部分**故意掺入了编造的数字**，用来证明账本真的会把对不上出处的卡片关进隔离区，而不是放行。

**5. 有一条阴性对照（negative control）。** 评测集里有一份平淡无信息的文档，期望产出 **0 张卡片**。一个什么都触发的信号生成器比一个很少触发的更糟糕。

**6. 统计结论带明确的 caveat。** 传导研究的样本只有 19/25 个事件，t 值按朴素独立假设计算，我们在报告里写明了这一点；跳空研究同时报告 **naive t 与按日期聚类的 clustered t**，并以 clustered 为准（更保守）。详见 [`docs/VALIDATION.md`](docs/VALIDATION.md)。

**7. 我们公开了自己的判分记录，包括难看的那部分。** 复盘闭环拿真实价格回头裁决已发布的卡片：**235 张卡 → 115 个独立主张 → 34 条决出胜负，10 胜 24 负，命中率 29.4%（95% CI 14.1–44.7%）**。更要紧的是打分与实现超额收益的 Spearman rho = **-0.138**，A 级卡命中率（22.2%）**低于** C 级卡（42.9%）——也就是**分数越高、实现越差**，报告把这一条标成 **BLOCKER**。这些数字全部在 [`docs/reports/review.md`](docs/reports/review.md) 里，由 `npm run review:seed` 从一个**已提交的看板 fixture** 复现——除生成时间戳那一行外**逐字节相同（实测）**。机制与全部 caveat 见 [`docs/REVIEW-LOOP.md`](docs/REVIEW-LOOP.md)。

**8. 不是投资建议。** Prism Desk 输出的是**带证据和失效条件的研究判断**，不是下单指令。

---

## 数据与可复现性 / Data & reproducibility

| 资产 | 规模 | 说明 |
|---|---|---|
| 价格库 | 25 symbols · 41,386 bars · 2019-01-02 → 2025-09-30 | 真实日 OHLCV（Nasdaq 公开 API） |
| 语料 | 14 documents · 2,599 words | 虚构发行主体 + 真实宏观文本，全部标注出处 |
| 宏观事件 | 25 events | date / indicator / actual / consensus |
| 离线 MCP fixture | 12 | Bitget MCP 与 Signal Skills 的录制响应 |
| 评测集 | 10 extraction + 9 ledger cases | 含阴性对照与故意幻觉样本 |
| 看板 fixture | 235 cards · 11 replay dates × 6 scenarios | `npm run seed` 重建，两次 SHA-256 相同（**实测**）——复盘报表据此复现 |
| Demo 逐字记录 | 951 行 · 6 场景 | `node prism.mjs demo` 重建，除生成时间戳与 6 处 `ms` 耗时外逐字相同（**实测**） |

**三种数据模式**（`PRISM_DATA_MODE`）：

- `auto`（默认）— 先试真实 Bitget MCP，失败则**透明降级**到 fixture，并在输出里标注 origin。
- `live` — 强制真实端点，拿不到就报错。
- `offline` — 完全不联网，只用 fixture。**本项目 demo 与测试全部在 offline 下可复现。**

```bash
npm test           # 211 个测试（node:test，无第三方依赖）
npm run validate   # 60 项结构性 / 数据完整性 / 研究质量 / 复盘检查 -> docs/reports/validation.md
npm run replay     # 重跑两份事件研究 -> docs/reports/{transmission,gap}-study.md
npm run seed       # 重建看板 fixture -> data/fixtures/board-seed.json（逐字节确定）
npm run review:seed # 从该 fixture 复现复盘报表 -> docs/reports/review.md
npm run xpost      # 校验 X 帖草稿合规 -> docs/reports/x-posts.md
npm run export:static # 重建在线演示的静态回放包 -> docs/demo/（+ --serve 可本机预览）
```

---

## 配置 / Configuration

全部可选 —— **没有任何 key 也能完整运行**（走确定性规则抽取器）。复制 `.env.example` 为 `.env` 或直接导出环境变量。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PRISM_DATA_MODE` | `auto` | `auto` / `live` / `offline` |
| `PRISM_LLM_BASE_URL` | — | OpenAI 兼容端点；黑客松 Qwen 网关 `https://hackathon.bitgetops.com/v1` |
| `PRISM_LLM_API_KEY` | — | 该端点的 key |
| `PRISM_LLM_MODEL` | `gpt-4o-mini` | 模型名（Qwen 用 `qwen3.8-max`） |
| `PRISM_MCP_URL` | `https://agent.bitget.com/mcp` | Bitget MCP Server |
| `CHAINBASE_AGENT_KEY` | — | 可选：Chainbase AgentKey（S2 外部 Partner 数据源，行情 / 链上 / 新闻 / 社媒）。**不配就完全不发请求**，`/api/status` 报 `disabled` |
| `CHAINBASE_MCP_URL` | — | AgentKey 的端点，随 key 一起发放；仓库**刻意不设默认值**（不替别人的基础设施猜 URL）。有 key 无端点时报 `error` 并写出原因 |
| `PRISM_HOST` / `PRISM_PORT` | `127.0.0.1` / `4310` | 服务绑定 |
| `PRISM_MIN_SCORE` | `45` | 发布门槛 |
| `PRISM_VERIFY_TOL` | `2.0` | 账本数值核验相对容差（%） |
| `PRISM_STRICT_VERIFY` | `true` | 头条证据核验失败即隔离 |

> 配了 LLM 后，抽取走**双通道**：规则抽取器与 LLM 抽取器并行，由 `src/extract/index.mjs` 对账；LLM 的输出同样要过证据账本，不享有豁免权。没配 LLM 时系统跑纯规则路径，行为完全确定。

---

## 文档索引 / Docs

| 文件 | 内容 |
|---|---|
| [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) | **完整投研任务演示**：提问 → 可用判断，逐环节讲解 |
| [`docs/DEMO-TRANSCRIPT.md`](docs/DEMO-TRANSCRIPT.md) | demo 的完整逐字输出（自动生成；从空看板重跑，除时间戳与每轮 ms 外逐字节相同，**实测**） |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 管线、频道、账本、打分细则 |
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | 两份事件研究的实测数字与 caveat |
| [`docs/REVIEW-LOOP.md`](docs/REVIEW-LOOP.md) | 复盘闭环：三条轴、七个方法决定、以及我们 **10 胜 24 负**的实测判分 |
| [`docs/PROJECT-STATEMENT.md`](docs/PROJECT-STATEMENT.md) | 报名表"项目说明"六段（中文） |
| [`docs/SUBMISSION-FORM.md`](docs/SUBMISSION-FORM.md) | 报名表逐字段填写内容；「提交材料链接」那一框由 `npm run submission` **生成**，不手写 |
| [`docs/X-POSTS.md`](docs/X-POSTS.md) | X 传播推文草稿 |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | 让 Demo 可公开访问（含本项目实际采用的 GitHub Pages 静态回放） |
| [`docs/demo/`](docs/demo/) | 发布在 Pages 上的**静态回放演示包**：真实引擎的录像，勿手改，用 `npm run export:static` 重建 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 后续路线 |
| [`docs/reports/`](docs/reports/) | 自动生成的验证与研究报表（`validation.md` · `review.md` · `transmission-study.md` · `gap-study.md` · `x-posts.md` · `submission-links.txt`），全部可由 `npm run validate` / `review:seed` / `replay` / `xpost` / `submission` 重建 |

---

## 目录结构 / Layout

```
prism.mjs            CLI 入口（也是默认 serve）
server.mjs           HTTP 服务 + SSE 流式 trace
src/
  config.mjs         环境与默认值
  schema.mjs         卡片 / 证据 / 频道的 schema 与校验
  util/              http json csv num stats time log
  ingest/            corpus, bitget-market, bitget-signal, chainbase(可选外部源),
                     mcp-client, prices, fixtures
  extract/           rules + lexicon（确定性）, llm + prompts（可选）, index（对账）
  verify/ledger.mjs  证据账本
  score/rubric.mjs   5 因子加权打分
  desk/              pipeline（PLAN）, board（状态机）, brief（渲染）
  research/          transmission, gap-study, factors, report
  review/            adjudicate（三轴裁决）, report（markdown 渲染）
web/                 index.html + app.js + styles.css + static-adapter.js（零构建）
scripts/             validate, replay, build-seed, fetch-prices, record-fixtures, xpost,
                     submission-links, export-static（生成 GitHub Pages 上的静态演示包）
data/                prices/ corpus/ events/ fixtures/ eval/ state/(gitignored)
tests/               211 个 node:test 用例
docs/                上述文档 + demo/（Pages 发布的静态回放演示包，由 npm run export:static 生成）
```

---

## License

MIT — 见 [`LICENSE`](LICENSE)。

**Built for Bitget AI Base Camp Hackathon S2 · Track 3 (AI Trading Desk) · 信息提炼与信号生成.**
