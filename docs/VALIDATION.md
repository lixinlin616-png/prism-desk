# Validation / 验证数据与关键指标

> 本文汇总项目里**所有可复现的实测数字**，并按报名表要求标注每一项是 **实测 / 估算 / 目标**。
> 复现命令：`npm test` · `npm run validate` · `npm run replay` · `npm run review:seed`（全部离线，零依赖，零 key）。

---

## 0. 一页速览

| 指标 | 数值 | 类型 | 复现方式 |
|---|---|---|---|
| 单元/集成测试 | **219 / 219 通过 · 0 跳过**（全新 clone 亦然） | 实测 | `npm test` |
| 结构性与研究质量检查 | **60 / 60 通过** | 实测 | `npm run validate` |
| 价格数据集 | 25 symbols · **41,386** 根日 K · 2019-01-02 → 2025-09-30 | 实测 | `data/prices/*.csv` |
| 语料 | 14 篇文档 · 2,599 词 | 实测 | `data/corpus/` |
| 宏观事件 | 25 个（date / indicator / actual / consensus） | 实测 | `data/events/macro-events.json` |
| 离线 MCP fixture | 15 个 | 实测 | `data/fixtures/mcp/` |
| 标注评测集 | 10 个抽取用例 + 9 个账本用例 | 实测 | `data/eval/extraction-eval.json` |
| 全频道扫描耗时（离线，纯规则） | 13 张卡（12 发布 / 1 低于阈值）；耗时随机器而异（本份逐字稿 143 ms） | 实测 | `node prism.mjs demo --only=full-sweep` |
| 该轮证据账本 | 30 items · pass 28 · **fail 0** · unverifiable 2 · **pass rate 93.3%** · 隔离 0 | 实测 | 同上 |
| `doctor` smoke run 账本 | 30 items · pass 27 · **fail 0** · unverifiable 3 · **pass rate 90%** · 13 张卡（11 发布 / 2 低于阈值） | 实测 | `node prism.mjs doctor`（as-of 钉在 2025-09-13T15:00Z） |
| 第三方依赖 | **0** | 实测 | `package.json` `"dependencies": {}` |
| 在线演示（GitHub Pages 静态回放） | 6 场景 + 7 条中文提问 · **409** 份卡片档案 · 4.37 MB · 约 1 s 生成 | 实测 | `npm run export:static` 重建 -> `docs/demo/` |
| 演示包与引擎不漂移 | **14 项检查**（路由覆盖 / 场景一致 / 看板 = fixture / 复盘数字 = 报表 / SSE 回放） | 实测 | `npm test` -> `tests/static-demo.test.mjs` |
| 复盘裁决样本 | 345 卡 → **162** 独立主张 → **39** 决出胜负 | 实测 | `npm run review:seed` |
| **方向命中率**（对 SPY，±1% 实质性带；失效条件优先） | **25.6%**（Wilson 95% CI **14.6–41.1%**；精确 Clopper–Pearson 13–42.1%） | 实测 | 同上 · 见 §4 |
| Spearman rho（分数 vs 实现超额） | **-0.137**（n=45）→ 标为 **BLOCKER** | 实测 | 同上 |
| 逐因子 rho 诊断（把 BLOCKER 点名到因子） | asymmetry **-0.261** · tradability **-0.133** · freshness **-0.037** · corroboration **-0.028** · surprise **+0.045**（各 n=45）；**五个权重一个未动** | 实测 | 同上 · 见 §4.1 |
| 20 个市场意图的出处 | **2** 个由真实日 K 现算（`history` / `marketMovers`）· **10** 个走 fixture（全部标注 synthetic）· **8** 个离线无出处，如实报为 miss | 实测 | `node prism.mjs doctor` · `/api/capabilities` |
| 信号**扣费后净收益** | **未测量** | — | 见 §6「我们没有测的」 |

> 上面两行账本**都是 30 items，但不是同一轮运行**：full-sweep 用 as-of 2025-09-19T20:00Z（问题里带 "what is actually tradeable right now?"），通过 28、无法核验 2；doctor 的 smoke run 用 2025-09-13T15:00Z 那个周六下午，问题是更短的 `Full desk sweep across every channel`，通过 27、无法核验 3。多出来的那一项仍是现金盘关闭时才出现的 ASTR 闭窗 `computed` 证据。逐项对照见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 的 VERIFY 一节。

---

## 1. 抽取质量（10 个标注用例）

每个用例是一份**已知正确读法**的文档，检查系统是否读对了频道、方向与幅度。

| 用例 | 断言 | 结果 |
|---|---|---|
| `earn-beat-raise` | 干净的超预期 + 上调指引 → earnings-gap / **long** | PASS |
| `earn-miss-lower` | 干净的不及预期 + 下调指引 → earnings-gap / **short** | PASS |
| `earn-beat-withdraw` | **超预期但撤回指引 ≠ 做多**，撤回主导 → earnings-gap / **neutral** | PASS |
| `macro-cpi-hot` | 热 CPI → macro-transmission 卡片，side=hot | PASS |
| `macro-nfp-cool` | 冷 NFP → macro-transmission，side=cool | PASS |
| `fomc-hawkish` | 鹰派 FOMC → 正确的政策分类与方向 | PASS |
| `risk-filing` | 文件中的不利语言 → risk-flag | PASS |
| `news-constructive` | 正面新闻 → narrative-shift / long | PASS |
| `news-negative` | 负面新闻 → narrative-shift / short | PASS |
| **`negative-control-bland`** | 平淡无信息文档 → **必须产出 0 张卡片** | PASS |

> **`earn-beat-withdraw` 与 `negative-control-bland` 是这套评测里最重要的两条。**
> 前者验证系统区分"指引下调"与"指引撤回"—— 后者是管理层主动放弃可预测性，是完全不同的信息，在打分里惩罚最重。
> 后者验证**假阳性**：评测集里对这条的注释是原文 —— *"A signal generator that fires on everything is worse than one that fires rarely."* 一个什么都触发的信号生成器比一个很少触发的更危险。

---

## 2. 证据账本（9 个标注用例）

账本部分的用例带有**已知正确裁决**，其中**故意掺入了编造的数字**，用来证明账本真的会隔离，而不是永远绿灯。

核验策略与结果类型见 [`ARCHITECTURE.md`](ARCHITECTURE.md#4-verify--srcverifyledgermjs证据账本)。三种裁决：`pass` / `fail` / `unverifiable`。

**实测行为（来自 demo，非构造）：**

- HLXN 卡片的 `E2`（EPS consensus 1.94）被判 **⚠️ unverifiable**，理由是 `no document or snapshot available to check this number against`。系统**没有**把它算作已验证：corroboration 因此从满分降到 75.5，并在 bear case 里写明 *"Consensus provenance is the document meta; a stale consensus makes the gap illusory."*
- ASTR closed-window 卡片的 `E3`（计算型证据）被判 **⚠️ unverifiable**，理由是 `computed claim without a re-executable recipe` —— 该标的在价格库里没有序列，recipe 无法复算。corroboration 从 SPY 的 96 掉到 **70.3**，直接把总分压到 **44.9**，低于 45 发布门槛，**卡片不发布**。
- SPY closed-window 卡片的 `E3` 被判 **✅ pass**，理由 `engine re-executed the recipe and reproduced the figure` —— 账本**真的重新跑了一遍 gap study**，复现出 44 个跳空 / 45.5% 继续率。

**这就是"证据账本"与"让 LLM 自由发挥"的可观测差别：不是我们说它可靠，而是它在自己拿不到证据时会主动降分并闭嘴。**

---

## 3. 两份真实价格事件研究

这两份研究不是包装用的图表，它们是**打分权重的实证依据**。跑在仓库内 bundled 的真实日 OHLCV 上（Nasdaq 公开 chart API，见 `scripts/fetch-prices.mjs`），离线可复现。

### 3.1 宏观传导研究 → 支撑 `surprise` 权重 0.30

**问题：** 用实测因子暴露排序，能不能预测事件日的横截面相对收益？surprise 越大是不是预测得越准？（后者正是给 `surprise` 最高权重的依据。）

**方法：** 17 个标的；对每个数据点，用**印前 252 个交易日**的日收益对 SPY 做 OLS 估暴露（**印后数据一律不参与排序，无前视**）；`predicted = exposure × surprise sign`；测 predicted 排序与实际事件日相对收益的 Spearman ρ，外加 top-minus-bottom 篮子价差及其方向正确率。

| 统计量 | 值 | 类型 |
|---|---:|---|
| 打分事件数 | 19 / 25（6 个跳过：surprise 恰为 0，或指标无传导映射） | 实测 |
| mean Spearman ρ | **0.157** | 实测 |
| median ρ | 0.201 | 实测 |
| ρ 标准差 | 0.424 | 实测 |
| naive t | 1.61 | 实测（**乐观，见 caveat**） |
| ρ > 0 的事件占比 | **14 / 19 = 73.7%** | 实测 |
| 平均 top-bottom 价差 | **+1.70%** | 实测 |
| 价差方向正确率 | **68.4%** | 实测 |

**按 surprise 大小分桶（这是承重结论）：**

| 分桶 | n | mean ρ | ρ>0 | 平均价差 | 命中率 |
|---|---:|---:|---:|---:|---:|
| \|surprise\| ≥ 1.5σ | 4 | **0.254** | 75% | 2.40% | **75%** |
| 0.5σ ≤ \|surprise\| < 1.5σ | 14 | 0.102 | 71.4% | 1.35% | 64.3% |
| \|surprise\| < 0.5σ | 1 | 0.537 | 100% | 3.79% | 100% |

mean ρ 从中 surprise 的 0.102 升到大 surprise 的 **0.254**，命中率从 64.3% 升到 **75%**。**排序在数据更出人意料时更有效 —— 这正是 rubric 给 surprise 最高单一权重（0.30）所假设的事情。** 该单调性由 `validate.mjs` 的 `studies/transmission-monotone` 检查自动断言。

### 3.2 隔夜与休市窗口跳空研究 → 支撑 closed-window 频道

**问题：** rToken 7×24 交易，原生美股每天只开 6.5 小时、每周 5 天。信息在现金盘关闭时落地，rToken 是唯一的定价场所。那么：**跨越休市窗口到底累积了多少信息，产生的跳空是延续还是回补？**

**方法：** 15,478 个 ≥0.75% 的隔夜跳空，25 个标的，2019-01-03 → 2025-09-30。跳空 = 今日开盘 vs 昨日收盘（**原生股**）；延续 = 开盘到收盘的日内涨跌，按跳空方向取符号（正=延续，负=回补）；超额收益对 SPY，1 / 5 / 10 个交易日。

**每个数字都同时报两个 t 值。** naive t 把每个跳空当独立观测；**date-clustered t 把同一日历日的所有跳空归为一个事件** —— 因为一个大宏观日会有几十个标的同时跳空，那是**一个事件，不是四十个**。

| 统计量 | 值 | 类型 |
|---|---:|---|
| 跳空样本 | **15,478** | 实测 |
| 延续 / 回补 / 平 | **48.8% / 46.4% / 4.8%** | 实测 |
| 绝对跳空中位数 | 1.32% | 实测 |
| 向上跳空 | 8,351 个（延续 **50.5%**） | 实测 |
| 向下跳空 | 7,127 个（延续 **46.8%**） | 实测 |

**超额收益（对 SPY）：**

| 窗口 | 原始均值 | 超额均值 | naive t | **clustered t** | 独立日期数 | 胜率 |
|---|---:|---:|---:|---:|---:|---:|
| 1 日 | 0.145% | 0.086% | 3.87 | **2.57** | 1,672 | 49.0% |
| 5 日 | 0.735% | **+0.387%** | 8.45 | **5.23** | 1,668 | 50.5% |
| 10 日 | 1.453% | +0.752% | 11.63 | **6.66** | 1,663 | 50.2% |

> naive 与 clustered 差别很大（5 日 8.45 vs **5.23**）。**项目里任何地方引用的都是 clustered 值**，因为 naive 值错在"让结果更好看"的方向上。这条由 `validate.mjs` 的 `studies/gaps-clustered` 检查自动断言。

**周末窗口 vs 普通隔夜（这是 closed-window 频道的经验基础）：**

| 窗口 | n | 向上跳空延续 | 向下跳空延续 | mean fwd5 | 超额 fwd5 clustered t |
|---|---:|---:|---:|---:|---:|
| **周一开盘**（约 64h 累积信息） | 3,143 | **55.4%** | 44.0% | 0.724% | 3.01 |
| 周二至周五开盘（约 17h 隔夜） | 12,335 | 49.4% | 47.6% | 0.738% | 4.33 |

周一开盘占样本约 20.3%，但**大跳空的比例显著偏高**。向上跳空在周一延续 **55.4%**，普通工作日只有 49.4%。**这就是把周末当成一个独立定价 regime、而不是"更长一点的隔夜"的实证依据。** 由 `studies/gaps-weekend-split` 检查断言。

**按跳空幅度分桶：**

| 分桶 | n | 延续 | 回补 | mean fwd5 | 超额 fwd5 | clustered t |
|---|---:|---:|---:|---:|---:|---:|
| 0.75–1% | 4,216 | 47.0% | 46.4% | 0.643% | 0.400% | 4.25 |
| 1–2% | 7,318 | 49.5% | 45.8% | 0.715% | 0.310% | 3.00 |
| 2–4% | 2,949 | 49.6% | 47.0% | 0.857% | 0.611% | 3.00 |
| ≥4% | 995 | 49.0% | 48.9% | 0.912% | 1.116% | 2.88 |

> **注意延续率在各桶都只有 47–50%。** 我们**没有**发现"跳空必延续"的规律 —— 恰恰相反，接近一半的跳空会回补。closed-window 频道用这份研究来**给观点定规模和时间盒**，而不是声称跳空总会延续。这也解释了为什么该频道的 surprise 因子只给 52 分（结构性频道，不是一个数据点）。

---

## 4. 复盘裁决（信号的事后判分）

前两份研究校准的是**权重应该定成多少**；这一份检验的是**按这些权重发出去的判断，后来对了吗**。

```bash
npm run seed         # 逐字节确定地重建看板 fixture（两次 SHA-256 相同，实测）
npm run review:seed  # 从该 fixture 生成 docs/reports/review.md
```

裁决日 **2025-09-30** · 基准 **SPY** · 实质性带 **±1%** · 悲观并列规则 **开**。以下全部**实测**：

| 指标 | 数值 |
|---|---:|
| 看板卡片 → 独立主张 | 345 → **162**（按 `claimKey` 折叠 183 次重述） |
| 窗口已关 / 仍开（不判） | 105 / 57 |
| 已裁决 / 决出胜负 | 45 / **39** |
| 胜 / 负 | **10 / 29** |
| 落在 ±1% 带内（`inconclusive`） | 6 |
| **方向命中率** | **25.6%**（Wilson 95% CI **14.6–41.1%**；精确 Clopper–Pearson 13–42.1%） |
| 平均 / 中位带符号超额 | **-0.832% / -0.745%** |
| 失效条件确实被触发 | 26 |
| 失效条件只有文字、无法机器验证 | **6**（可测的有 39；宏观 pair 的 50bp / 2 session 门槛已计入可测） |
| 不可测（价格库无该序列）/ 非方向性 | 31 / 29 |
| 经声明的 demo 价格代理测量 | 44 |
| **Spearman rho（分数 vs 实现超额）** | **-0.137**（n=45，来自 6 个信息日期） |

### 4.1 打分规则不排序 —— BLOCKER

总 rho 只有一个数，它说的是“加权总分排错了序”，说不出**哪一项**排错了。所以复盘现在把五个因子分别对同一批 45 条主张、同一个实现超额做 Spearman 相关，结果写进 `docs/reports/review.md`：

| 因子 | 权重 | rho vs 实现超额 | n | 读法 |
|---|---:|---:|---:|---|
| `asymmetry` | 0.20 | **-0.261** | 45 | 反向 —— 这一项给分越高，实现越差 |
| `tradability` | 0.18 | **-0.133** | 45 | 反向 |
| `freshness` | 0.10 | -0.037 | 45 | 无单调信号 |
| `corroboration` | 0.22 | -0.028 | 45 | 无单调信号 |
| `surprise` | 0.30 | **+0.045** | 45 | 方向对，但强度可忽略 |

**这是诊断，不是修复。五个权重一个都没动。** 在 45 条互不独立的主张上重新配权就是拟合噪声（见 `ROADMAP.md`）。要做的是回到 `src/score/rubric.mjs` 的 `scoreAsymmetry()` 那条分支，对着它自己吐出的理由串检查评分规则：目前的写法是“盈亏比 2:1 就 60 分、给了可观测失效水平再 +6”，而实测是这套加分和实现超额反着走。五个因子里 **0 个** rho 超过 +0.1，也就是说这份 rubric 里没有任何一项在这个样本上证明了自己会排序。

| grade | 主张 | 决出 | 命中率 | 平均超额 |
|---|---:|---:|---:|---:|
| A（≥75） | 10 | 9 | **22.2%** | -1.358% |
| B（62–75） | 28 | 24 | 20.8% | -0.378% |
| C（48–62） | 7 | 6 | **50%** | -1.896% |

**A 级卡的命中率低于 C 级卡。** 按方向拆：**short 1/12（8.3%）** vs long 5/9（55.6%）；按频道：`risk-flag` 2/2 最好，`macro-transmission` 2/16（12.5%）最差。pair 现在是 2/16（12.5%）：多出来的失败不是新的行情，而是卡片自己写的 50bp 门槛被执行了。原先落在 ±1% 带里、但两个 session 内多头没有跑赢空头 50bp 的 pair，从 `inconclusive` 变成 `LOST`。胜场仍是 10。**rho 没变，因为它量的是实现超额，不是胜负栏。**

这一条被报告标成 **BLOCKER**，处置写在 [`ROADMAP.md`](ROADMAP.md) §1。**我们没有去调那五个权重** —— 45 条主张来自 6 个信息日期、共享文档与基准，**不是独立观测**；在这种样本上自动调参等于把噪声拟合进规则，而且之后没人能分辨规则是被证据改的还是被运气改的。改规则必须是一次人类做的、写进 commit 的决定。

### 4.2 这些数字为什么不能当结论

- **样本太小。** 39 条决出胜负的主张；命中率的 Wilson 95% 区间是 14.6–41.1%（精确 CP 13–42.1%），**比任何它可能测出的效应都宽**。报告的第一句 caveat 就是「不应从本报告得出任何关于盈利能力的结论」。
- **不含任何成本。** 没有佣金、价差、借券费、滑点，也没有组合层面的聚合。一次「命中」是一个**方向**，不是一笔利润。
- **主张之间不独立。** rho 与命中率是对**这一块看板**的描述，不是对某个总体参数的估计。
- **44 条是透过代理测的。** 虚构发行主体没有上市价格，用其显式声明的 `priceProxy` 序列测量。这些裁决描述的是**代理**，不是 issuer。
- **窗口很短。** 中位 3 个交易日（区间 1–15），分不开「好判断」和「运气好的两周」。
- **这不是回测。** 它审计的是「已发布的判断有没有活过它们自己写下的证伪测试」。

机制、三条轴、方法决定与逐条审计见 [`REVIEW-LOOP.md`](REVIEW-LOOP.md)。

---

## 5. Caveats，直说

### 传导研究

- **样本小。** 19 个事件。t = 1.61 把它们当独立抽样，但它们不是：重叠的宏观 regime 和共享基准让它们正相关，**所以 naive t 是乐观的**。请把"跨 surprise 分桶的单调性"当作结论，**不要把 p 值当结论**。
- **6 个事件被跳过**（surprise 恰为 0 / 指标无传导映射），跳过原因在逐事件表里逐条列出，不是悄悄丢掉。
- **单日窗口。** 只测事件日相对收益，**不说明该波动是否持续**，而它校准的卡片带的是多日 horizon。
- **暴露是历史的。** 252 日 beta 描述的是过去的 regime，不是对下一个 regime 的承诺；因子暴露会轮动。
- **这不是对整个 desk 的回测。** 它只验证**一个打分因子的一个输入**，不衡量 Prism 产出的任何卡片在扣费后是否盈利。

### 跳空研究

- **测的是原生股，不是 rToken。** 代币化股票在另一个场所交易，流动性薄得多，且 mint/redeem 套利可能比信息本身更快地抹平错位。这份研究是**休市窗口错位幅度的先验**，不是 rToken 微观结构模型。
- **不含成本。** 没有佣金、点差、借券费、滑点。几个十基点的 5 日超额均值**本身不构成扣费后的 edge**；结论只是"跳空方向带有信息"。
- **幸存者偏差。** bundled universe 是今天的知名大盘股，那些跳空之后归零的名字不在样本里。
- **延续依赖 regime。** 大约一半跳空会回补。

### 项目层面

- Demo 里的发行主体（`CRVS` `HLXN` `ASTR` `BLWF` `NWCL`）**是虚构的**，语料由我们自己撰写，这样"正确答案"才已知、可判分。每个虚构主体都**显式披露**其借用的真实价格代理（`priceProxy`：NVDA / CAT / WMT / PFE / MSFT），并由 `data/price-proxy-disclosed` 检查强制。
- 价格数据是**真实的**；文档语料是**构造的**。这两件事在 `doctor` 输出和每张卡的 evidence ledger 里都分开标注。

---

## 6. 我们没有测的（同样重要）

| 项 | 状态 |
|---|---|
| 信号的**扣费后净收益** | **未测量。** 三份研究都不含交易成本，也没有做组合层面的回测。在这一层补上之前，本项目**永远不会**发布任何 Sharpe / 回撤数字 |
| 方向命中率 | **已测量，但不足以当结论。** 39 条决出胜负，25.6%（Wilson 95% CI 14.6–41.1%），见 §4 |
| 复盘样本的**独立性** | **不足。** 45 条已裁决主张只来自 6 个信息日期。扩到 ≥20 个日期、≥150 条决出主张之前，不对外引用任何单个校准数字 |
| LLM 抽取路径 vs 规则路径的**质量对比** | **未测量。** 双抽取器与对账逻辑已实现并有测试，但我们没有在标注集上系统对比两条路径的准确率 |
| rToken 真实盘口的**流动性与滑点** | **未测量。** rToken 流动性系数 0.45 是**保守估计值（估算）**，不是从真实盘口测出来的 |
| 真实 Bitget MCP 端点的**线上可用性** | **未在本环境验证。** 构建环境无法访问 Bitget 域名，因此 demo 与测试全部跑在 `offline` fixture 上；`auto` 模式的降级路径有测试覆盖，live 路径需要在能联网的环境复验 |
| 多用户并发 / 生产级持久化 | **未实现。** board 状态是单机 JSON 文件，面向 demo 与研究，不是生产存储 |

**目标值（尚未达成，明确标注为目标）：**

- 把标注抽取评测集从 10 例扩到 100+ 例，并给出规则路径与 LLM 路径的准确率对比表 —— **目标**
- 接入真实 rToken 盘口深度，用实测 spread 替换 0.45 这个估算系数 —— **目标**
- 在能访问 Bitget 端点的环境里跑一次 `PRISM_DATA_MODE=live` 的端到端录制，把 fixture 换成实时数据 —— **目标**

详见 [`ROADMAP.md`](ROADMAP.md)。

---

## 7. 一键复现

```bash
npm test            # 219 / 219
npm run validate    # 60 / 60 -> docs/reports/validation.md
npm run replay      # 两份研究 -> docs/reports/transmission-study.md, gap-study.md
npm run seed        # 重建看板 fixture（逐字节确定）-> data/fixtures/board-seed.json
npm run review:seed # 复盘裁决 -> docs/reports/review.md
node prism.mjs demo     # 6 场景逐字记录（as-of 由场景钉死）-> docs/DEMO-TRANSCRIPT.md
node prism.mjs doctor   # 数据接线自检 + smoke run
```

全部离线、零依赖、零 key。同样输入产出逐字节相同的结果（由 `determinism` suite 的 2 项检查断言）。

**已知的两处非确定性**，都只影响时间、不影响任何结论：`DEMO-TRANSCRIPT.md` 的生成时间戳那一行与 6 处 `ms` 耗时；`review.md` 的生成时间戳那一行。除此之外逐字节相同（实测）。

静态演示包 `docs/demo/` 同理：语义字段（卡片、分数、账本、复盘裁决）逐字节确定，带导出时刻的只有 run id、`ms` 耗时、SSE 帧间隔与 `review.summary.generatedAt` —— 全部列在 `docs/demo/data/manifest.json` 的 `volatileFields` 里，不靠记忆。
