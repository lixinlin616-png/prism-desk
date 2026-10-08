# 完整投研任务演示 / Complete Research Task Demo

> 赛道三要求：**一个完整的投研任务演示（提问 → 可用判断）**。
> 本文档把这条链路逐环节拆开，所有数字都来自仓库内可复现的真实运行，不是手写的。
>
> Track 3 requires one complete research task, from question to usable judgment. Every number below comes from a reproducible run of this repo.

**复现方式 / How to reproduce**

```bash
PRISM_DATA_MODE=offline node prism.mjs demo --out=docs/DEMO-TRANSCRIPT.md
```

零依赖、零 key、零网络。六个场景在 `server.mjs` 的 `SCENARIOS` 里各自钉死了 `asOf`，所以**不带任何参数也能逐字复现**：重建结果与已提交版本相比，只有生成时间戳那一行和 6 处 `ms` 耗时不同（实测）。逐字输出见 [`DEMO-TRANSCRIPT.md`](DEMO-TRANSCRIPT.md)。

---

## 主演示：周末 rToken 窗口（S2 核心场景）

**为什么选这个任务。** Base Camp S2 的核心结构性变化是：代币化股票 7×24 交易，而美股现金盘每天只开 6.5 小时、周末完全关闭。这意味着**信息在现金市场无法定价的时段落地时，rToken 是唯一的价格发现场所**。这个任务同时考验三件事：能不能读懂非结构化新闻、能不能把它和历史价格证据结合、能不能在流动性受限的场所给出可执行的判断。

### Step 0 — 提问（自然语言，LUI 入口）

```bash
node prism.mjs ask --as-of=2025-09-13T15:00:00Z --channels=closed-window,cross-asset \
  "A tariff framework just landed on a Saturday afternoon. The cash market is shut \
   for 47 hours but the rToken still trades. How should I think about pricing that gap?"
```

中文同样可问。规划器（不强制频道）把「周末休市期间 rToken 怎么定价」只路由到 `closed-window`；上面那条英文命令用 `--channels` 额外打开了 `cross-asset`，所以两轮的卡片组合不完全相同。静态演示把这句中文单独录了一次，点芯片就是那一轮，不是英文场景的模糊匹配。

```bash
node prism.mjs ask "周末休市期间 rToken 怎么定价"
```

> `--as-of` 冻结桌面时钟。这是刻意设计：投研结论必须绑定在一个明确的信息时点上，否则无法复现、无法事后复盘。六个 demo 场景**各自已钉死 as-of** —— `closed-window` 用 2025-09-13T15:00Z 那个周六下午，其余五个用 2025-09-19T20:00Z —— 所以 `node prism.mjs demo` 不带参数就能复现；命令行 `--as-of` 与 Web 端时钟框仍然优先。

### Step 1 — PLAN：把问题变成研究计划

`src/desk/pipeline.mjs` 的 `planQuestion()` 做四件事：

1. **路由频道** → `closed-window`, `cross-asset`
2. **解析数据意图** → `quote`, `news`, `signal:sentiment-analyst`, `signal:macro-analyst`
3. **解析 ticker** → 从问题与语料中得到 `SPY`, `ASTR`（问题里没写 ticker 时走 issuer-in-scope 回退，并在 trace 里**明说**这是回退）
4. **附带美股现金盘状态** → `closed (weekend)`，纽约时间周日 00:20

第 4 点是 closed-window 频道的前提条件：**系统永远先知道现在现金盘开不开**，而不是让模型猜。

### Step 2 — INGEST：取数，并标注来源

| 来源 | 内容 | origin |
|---|---|---|
| `src/ingest/corpus.mjs` | 14 份文档（含 `weekend-policy-shock`、`astr-guidance-withdrawal`） | local |
| `src/ingest/bitget-market.mjs` | Bitget MCP Server 行情（离线走录制 fixture） | fixture |
| `src/ingest/bitget-signal.mjs` | Bitget Signal Skills：sentiment-analyst / macro-analyst | fixture |
| `src/ingest/prices.mjs` | 真实日 OHLCV，25 symbols / 41,386 bars | local |

本轮取到 **7 个数据快照**，trace 里逐个标出 intent 与 origin：

```
ingest:data   7 snapshots via quote,news,signal:sentiment-analyst,signal:macro-analyst [fixture]
```

**origin 标注是刻意的**：评委能看到哪些数字来自真实端点、哪些来自录制 fixture，不会把离线演示误认成实时数据。

### Step 3 — EXTRACT：双抽取器

- **规则抽取器**（`rules.mjs` + `lexicon.mjs`）：确定性、可测试、零成本。识别到 `weekend-policy-shock` 带 `releasedOutsideRth`，且现金盘 `closed` → 生成 closed-window 卡片。
- **LLM 抽取器**（`llm.mjs` + `prompts.mjs`）：可选。配了 `PRISM_LLM_API_KEY` 才启用。
- **对账**（`index.mjs`）：两路结果合并去重；**LLM 的输出不享有豁免权，同样要过证据账本。**

本轮 trace：`mode rules, 9 candidate cards, trace rules:13 -> data-snapshots:1 -> reconcile:9`

### Step 4 — VERIFY：证据账本（本项目的核心）

卡片里**每一个数字**都要对回到某个出处。三种可接受的出处：

1. **文档字符偏移** — 例如 `hlxn-q2-release @ chars 0-227`，账本会去原文那个区间做精确/模糊匹配。
2. **数据快照字段路径** — 例如 `fixture $.fearGreed.value`。
3. **可复算的 recipe** — 例如 `gap-study on SPY`，账本会**真的重新执行一遍**这个计算，看能不能复现出卡片里写的数字。

产出三种裁决：`pass` ✅ / `fail` ❌ / `unverifiable` ⚠️。头条证据 fail 且 `PRISM_STRICT_VERIFY=true` → **整张卡进隔离区**，不进看板。

### Step 5 — 关键对照：有先验 vs 无先验

这一步是整个演示最有说服力的部分。同一个周末、同一条新闻逻辑，两个标的，系统给出**完全不同的处理**。

#### SPY — 价格库里有 44 个可比跳空样本 → 卡片发布

**判断：** `WATCH · closed window: SPY has no cash price discovery` — **58.3/100 (C)**，horizon intraday，venue rtoken

**Claim（原文）：**
> The US cash session is closed (weekend) but the SPY rToken still trades. Information from "Weekend wire: new tariff framework announced outside market hours" can only be priced on the rToken until the next open. Across 44 comparable historical gaps in SPY, the gap direction continued 45.5% of the time and reverted 45.5% of the time; the median |gap| was 1.23%.

**证据账本（3/3 通过，100%）：**

| id | 类型 | 出处 | 裁决 |
|---|---|---|---|
| `E1` | calendar | `session-clock @ computed` — 2025-09-13T15:00Z 现金盘 `closed` | ✅ |
| `E2` | news | `weekend-policy-shock @ document` — 标题精确匹配 | ✅ |
| `E3` | computed | `price-book @ gap study on SPY` — **引擎重新执行了 gap-study，复现出 44 / 45.5%** | ✅ |

**失效条件（可证伪）：** rToken 相对上一个现金收盘价的溢价/错位在开盘前收敛 → 说明信息已被代币市场完全定价。可观测水平：`rToken vs last cash close within 0.3%`；复检时点：下一个现金开盘。

**打分理由（每个因子都有书面理由，可审计）：**

| 因子 | 分 | 权重 | 贡献 | 理由（摘录） |
|---|---:|---:|---:|---|
| surprise | 52 | 0.30 | 15.60 | 结构性频道 —— surprise 是"交易时段/流动性状态"本身，不是一个数据点 |
| corroboration | 96 | 0.22 | 21.12 | 3/3 通过 → 62；+14 独立来源(3)；+12 多模态证据(calendar/news/computed)；+8 头条证据过账 |
| tradability | 27.5 | 0.18 | 4.95 | rtoken 流动性 0.45 × 大盘覆盖 1 → 32；+8 已给仓位；**-8 仅 rToken：盘口更薄，mint/redeem 套利可能不等你**；-4 intraday 要求快速执行 |
| asymmetry | 35 | 0.20 | 7.00 | trade sketch 缺 entry/stop/target 中至少一项 |
| freshness | 96.1 | 0.10 | 9.61 | 信息 0.9h 前发布（源时间戳 2025-09-13T14:05），closed-window 半衰期 16h → 衰减权重 0.961 |

**仓位建议（原文）：** `Half the size you would take in the native share; the exit is the constraint, not the entry.` 风险 0.25% of portfolio。

> 注意 tradability 只有 27.5 —— 系统没有因为"故事讲得通"就给高分。**它明确指出退出通道才是约束，而不是进场。**

#### ASTR — 价格库里没有可比跳空样本 → 卡片不发布

**判断：** `closed window: ASTR has no cash price discovery` — **44.9/100 (D)**，**低于 45 发布门槛，进 "Below publish threshold"，不上看板。**

**Claim（原文，注意它如何承认无知）：**
> The US cash session is closed (weekend) but the ASTR rToken still trades. Information from "Aster Retail Group (ASTR) withdraws full-year outlook ahead of holiday peak" can only be priced on the rToken until the next open. **No comparable historical gap in ASTR is recorded in the bundled price book, so there is no empirical prior for this name; read the closed-window argument as structural rather than statistical.**

**打分差异（对照 SPY）：**

| 因子 | ASTR | SPY | 为什么不同 |
|---|---:|---:|---|
| corroboration | **70.3** | 96 | `E3` 被判 **⚠️ unverifiable**，理由是 `computed claim without a re-executable recipe` —— 没有价格序列就无法复算，账本**拒绝假装它通过了** |
| tradability | **13.3** | 27.5 | rtoken 流动性 0.45 × 大盘覆盖 **0.55**（ASTR 是小盘代理） |
| freshness | **44.4** | 96.1 | 信息 18.8h 前发布，已超过 closed-window 的 16h 半衰期 |
| **总分** | **44.9 (D)** | **58.3 (C)** | 低于门槛 → 不发布 |

风险条目也随之改写为：`No gap prior exists for ASTR in the bundled data, so the likely dislocation size is unanchored; halve the size again or stand aside.`

> **这就是本项目最想演示的行为**：面对缺数据，系统不是编一个百分比（修复前它确实会输出 `null%`，我们把它当缺陷修掉了，并在 `tests/extract.test.mjs` 里加了回归测试钉住），也不是照样发布一张无法验证的卡片 —— 而是**降低 corroboration 分、把卡片挡在发布门槛之外，并用自然语言写清楚为什么**。

### Step 6 — PRESENT：可用判断

最终交给人的不是一堆 JSON，而是一份简报：headline、ranked cards、每张卡的完整档案（claim / 预期差 / trade sketch / 失效条件 / bear case / 证据账本 / 打分理由）、below-threshold 列表、ledger 汇总。

同一场景还会给出一张 **cross-asset** 卡片，把加密侧状态接进来 —— 因为代币化美股在加密轨道上结算，**加密 regime 决定了美股宏观在现金盘外落地时，谁还醒着能交易 rToken**：

> `WATCH · Crypto regime: Fear & Greed 41 (Fear) | BTC funding 0.0081 | US spot BTC ETF flow -184000000` — 49/100 (C)
> 失效条件：F&G 回到 35–65 区间且 funding 正常化。可观测水平：`F&G in [35,65]`。

**这一步的产出是"可用的判断"，因为它同时给了：方向、时点、场所、仓位、以及最重要的一条 —— 什么情况下我错了，去哪个数值上看。**

---

## 全频道扫描：一次跑完 7 个频道

```bash
node prism.mjs demo --only=full-sweep   # as-of 2025-09-19T20:00Z 由场景自带，无需传参
```

**问题：** `Full desk sweep across every channel - what is actually tradeable right now?`
**耗时：** 随机器而异（本份逐字稿里这一轮是 143 ms）。其余数字不随机器变化。
**证据账本：** 30 items · pass 28 · **fail 0** · unverifiable 2 · **pass rate 93.3%** · 0 张卡被隔离。共 13 张卡，12 张发布，1 张低于门槛。

| # | 方向 | 频道 | 标的 | 分数 | 等级 | horizon | 核验率 |
|---:|---|---|---|---:|---|---|---|
| 1 | SHORT | 财报预期差 | HLXN | **75.5** | A | days | 75% |
| 2 | LONG | 财报预期差 | CRVS | 70.6 | B | days | 75% |
| 3 | PAIR | 宏观传导链路 | AMD TSLA COIN PFE XOM WMT | 68.0 | B | days | 100% |
| 4 | SHORT | 财报预期差 | ASTR | 67.9 | B | intraday | 100% |
| 5 | PAIR | 宏观传导链路 | COIN TSLA PLTR PFE XOM WMT | 61.3 | C | days | 100% |
| 6 | AVOID | 反向风险旗 | BLWF | 59.4 | C | weeks | 100% |
| 7 | WATCH | 资金足迹 | BTC ETH | 55.7 | C | days | 100% |
| 8 | LONG | 叙事转向 | NWCL | 54.9 | C | weeks | 100% |
| 9 | SHORT | 叙事转向 | HLXN | 53.3 | C | weeks | 100% |
| 10 | WATCH | 跨资产联动 | BTC ETH | 49.0 | C | intraday | 100% |
| 11 | WATCH | 反向风险旗 | CRVS | 46.7 | D | days | 100% |
| 12 | WATCH | 宏观传导链路 | QQQ | 45.5 | D | days | 100% |

第 7 行是 market-intel 的跨市场资金足迹，第 11 行是 technical-analysis 的超买风险（RSI 78.6），第 12 行是 macro-analyst 的中性桥接卡：政策利率上限 4.25%、下次会议降息概率 82%、2s10s +59bp、BTC/Nasdaq 90 日相关 0.44。82 这个数字对回了技能快照，方向是 `neutral`，不假装成一笔交易。低于门槛的那一张是叙事热度卡 41.8/D。

### Headline 卡片：HLXN SHORT 75.5/A

**Claim：** `HLXN EPS 1.61 vs 1.94 consensus (-17.0% surprise, very large) guidance lower - the expectation gap, not the headline, is what reprices the name.`

**预期差：** metric EPS · consensus 1.94 · actual 1.61 · gap **-17.01%** · guidance **lower**

**Trade sketch：** entry 464.21–468.87 · stop 482.87 · target 433.88 · risk 0.3% of portfolio · venue native-equity

**失效条件：** `HLXN reclaims the pre-print close within two sessions and holds, showing the miss was already discounted.` 可观测水平 `466.54`，复检 2025-09-21T20:00Z。

**证据账本 4 项，3 ✅ / 1 ⚠️：**

| id | 类型 | 裁决 | 说明 |
|---|---|---|---|
| `E1` | metric (headline) | ✅ | `EPS reported: 1.61` ← `hlxn-q2-release meta$.actual` |
| `E2` | estimate (headline) | ⚠️ | `EPS consensus: 1.94` ← **无文档或快照可核对**，账本如实标注 unverifiable |
| `E3` | quote | ✅ | 营收/EPS 原句，`hlxn-q2-release` 精确匹配 @0 |
| `E4` | quote | ✅ | 指引下调原句，精确匹配 @392，附注 `guidance stance: lower` |

> `E2` 是**故意保留的 unverifiable**：consensus 来自文档 meta，没有独立第二来源。系统不把它算作已验证，corroboration 因此从满分降到 75.5，并在 bear case 里写明 `Consensus provenance is the document meta; a stale consensus makes the gap illusory.`
> **这正是"证据账本"与"让 LLM 自由发挥"的区别。**

**打分理由：**

| 因子 | 分 | 权重 | 贡献 | 理由（摘录） |
|---|---:|---:|---:|---|
| surprise | 97.3 | 0.30 | 29.19 | -17% 预期差 → base 82；consensus 置信度 0.9 调整 +7.5；guidance "lower" 与 print 同向确认 +8 |
| corroboration | 75.5 | 0.22 | 16.61 | 3/4 通过(75%) → 47；+14 独立来源；+12 多模态(metric/estimate/quote)；+8 头条过账；**-5 有 1 项 unverifiable** |
| asymmetry | 66.0 | 0.20 | 13.20 | 盈亏比 2:1 → 60；+6 失效条件给了可观测水平，不是"感觉不对" |
| tradability | 62.5 | 0.18 | 11.25 | native-equity 流动性 1 × 大盘覆盖 0.55 → 39；+16 给了可执行价位；+8 仓位 0.3% |
| freshness | 52.2 | 0.10 | 5.22 | 信息 225h 前发布（2025-09-10T11:00），earnings-gap 半衰期 240h → 衰减权重 0.522 |

**Bear case（系统自己写的反方）：**
- 超卖行情里的 miss 常常会反弹 —— 方向对不等于时点对。
- 指引立场由 6 个词命中分类为 "lower"，一句歧义表述就可能翻转。
- consensus 出处是文档 meta，consensus 过期会让预期差变成假象。

### 同时演示"沉默"也是一种输出

简报里有一段 **"Asked about, but silent"**：

> No card was produced for **CAT**. That means nothing in scope cleared the evidence ledger and the publish threshold - it is not an endorsement and it is not a rejection. Widen the corpus or the data window and ask again.

**没有信号 ≠ 看空，也 ≠ 看涨。** 系统明确区分"我查了但没结论"和"我没查"。评测集里还专门有一份平淡文档作为**阴性对照，期望产出 0 张卡片** —— 一个什么都触发的信号生成器比一个很少触发的更危险。

---

## 其余四个场景

| 场景 | 命令 | 看点 |
|---|---|---|
| 财报预期差 | `node prism.mjs demo --only=earnings-gap` | consensus vs actual、指引立场分类（raise / lower / **withdraw** / maintain），以及 "beat but ugly"（超预期但指引撤回）如何被惩罚 |
| CPI 传导链路 | `node prism.mjs demo --only=macro-transmission` | 标的排序**由实测 252 日 OLS beta 计算得出**，不是主观断言；输出 PAIR（多空配对）而非单边 |
| 内部人与 13F | `node prism.mjs demo --only=flows` | 聚合数字由账本从原始快照**重新计算**；并明确 13F 是 45 天滞后快照，只能确认论点、不能开启论点 |
| 反向风险扫描 | `node prism.mjs demo --only=risk` | 不利语言与比率异常旗标，产出 AVOID 而非做多建议 |

---

## 评委 5 分钟动线

1. **`node prism.mjs doctor`**（30 秒）—— 一屏看清数据接线：data mode、MCP 解析情况、语料规模、价格库规模、抽取器模式、发布门槛、核验容差，最后跑一次 smoke run。
2. **`node server.mjs` → http://127.0.0.1:4310**（1 分钟）—— Web 投研台里输入问题，看 SSE 流式 trace 逐阶段滚出来。
3. **跑 `closed-window` 场景**（2 分钟）—— 讲 SPY vs ASTR 的对照：**同一个周末，一个有实证先验所以发布，一个没有所以被挡在门槛外。** 这是全项目最能说明"信息提炼与信号生成"含金量的一步。
4. **打开任意一张卡的档案**（1 分钟）—— 指着证据账本的 ✅/⚠️ 和打分表的"why"列：**每个数字都有出处，每个分数都有书面理由。**
5. **`npm run validate` + `npm test`**（30 秒）—— 60/60 检查、222/222 测试。

**一句话收尾：** 我们不追求让 AI 说出更多，而是让 AI 说的每一句都能被追溯、被打分、被证伪。

---

_Prism produces research inputs. A human takes the trade._
