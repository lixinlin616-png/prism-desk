# 项目说明（报名表「项目说明」字段 · 六段结构）

> **用法：** 下面「正式提交版」整块复制进 Google Form 的「项目说明」字段即可。
> 官方明确要求：**必须写在表单内，GitHub README 或 X Thread 不能替代。**
> 赛道：🟧 赛道三 · AI Trading Desk（AI 投研工作台） → 子主题：**信息提炼与信号生成**

---

## 正式提交版（直接复制以下全部内容）

**项目名称：Prism Desk · 棱镜投研台**
**赛道：🟧 AI Trading Desk（AI 投研工作台）｜子主题：信息提炼与信号生成**

### 一、思路

**痛点。** Base Camp S2 把美股搬上了 7×24 的轨道：rToken 全天候交易，而它对应的原生美股现金盘每天只开 6.5 小时、周末完全关闭。这制造了一个结构性窗口 —— **财报、CPI、FOMC、地缘政策这些信息，有大量是在现金盘无法定价的时段落地的，此时 rToken 是唯一的价格发现场所。** 我们的跳空研究在真实数据上量到了这个窗口的分量：周一开盘（约 64 小时累积信息）的向上跳空延续率 **55.4%**，而普通工作日隔夜只有 **49.4%**；周一开盘只占样本 20.3%，却集中了不成比例的大跳空。**周末不是"更长一点的隔夜"，它是一个独立的定价 regime。**

但真正的难点不在"能不能读到新闻"。中文区交易者在周末面对一条 tariff 新闻时，缺的不是信息本身，而是三样东西：**这条信息相对一致预期到底差多少、它应该在什么场所按多大仓位定价、以及它在什么条件下作废。**

**现有方案为什么不够。**（1）通用大模型直接读财报：速度快，但**会编数字**。一个看起来合理的 EPS、一个不存在的 consensus，足以让整条推理链变成幻觉 —— 而在交易场景里，幻觉直接等于亏损。（2）传统投研终端：贵、英文为主，且**根本不覆盖 rToken 这个场所**，没有"现金盘关闭时该怎么想"的概念。（3）加密信号频道：只给方向，**不给失效条件**，事后无法复盘，也无法判断该不该信。

**核心假设与三条主张。**

1. **预期差 > 头条。** 价格重定价的是"实际 vs 一致预期"的差，不是新闻的好坏。所以我们把 `surprise` 设成打分权重最高的单一因子（**0.30**）—— 而且这个权重不是拍脑袋定的：我们在 25 个真实宏观事件上做了传导研究，按 surprise 大小分桶后，mean Spearman ρ 从中 surprise 的 **0.102** 单调升到大 surprise 的 **0.254**，多空价差命中率从 64.3% 升到 75%。**排序在数据更出人意料时更有效，这正是 0.30 权重所假设的事情。**
2. **证据账本（Evidence Ledger）—— 本项目的反幻觉核心。** 卡片里**每一个数字**都必须对回一个出处：文档的**字符偏移**、数据快照的**字段路径**、或一段**可被引擎重新执行的 recipe**。三种裁决：pass / fail / unverifiable。头条证据 fail 就整张卡进隔离区，永不发布；unverifiable 不隔离，但**扣 corroboration 分并在卡片上如实标注**。关键点是：**LLM 不享有豁免权** —— 配了模型之后，模型抽取的卡片和规则抽取的卡片走同一个账本、同一套打分。
3. **每张卡都可证伪，而且真的会被拿去证伪。** 卡片必须写明"什么情况下我错了"，并给出**可观测的价位/数值水平**和复检时间。没有失效条件的观点不是研究，是情绪。**而一条没人回头核对的失效条件只是修辞** —— 所以管线末端还有一条回路：窗口一关，系统拿真实价格回头裁决这张卡（失效条件是否触发 / 风险路径 / 相对 SPY 的超额收益，**三条轴永远分开算**），结果连同打不中的部分一起写进公开报表。第一批判分是 **10 胜 24 负**，而且分数与实现超额收益的 Spearman rho = **-0.138**（分数越高反而越差）—— 这一条被系统自己标成 **BLOCKER**。我们没有藏它，也**没有让系统自动去改权重**：45 条主张只来自 6 个信息日期，不是独立观测，自动调参等于把噪声拟合进规则。

**风控设计。** 五因子加权打分（surprise 0.30 / corroboration 0.22 / asymmetry 0.20 / tradability 0.18 / freshness 0.10），发布门槛 **45/100**，低于门槛的卡片不进看板但**保持可见**（不静默丢弃）。freshness 按**信息发布时间**（而非卡片生成时间）对各频道分别做指数衰减 —— closed-window 半衰期只有 **16 小时**，因为下一个现金开盘它就作废。看板层做三件人类否则要手工做的家务：**去重取代**（同一论点的新卡片取代旧卡片）、**冲突显式暴露**（同一标的方向相反的两张 active 卡绝不静默净冲）、**到期退役**（过期信号比没有信号更糟）。仓位上，rToken 流动性系数被刻意压到 **0.45**（原生股 1.0），卡片直接写"退出通道才是约束，不是进场"。

### 二、目标用户与产品价值

**主要人群：在 Bitget 上交易美股 rToken 的中文区自主决策型个人交易者（Retail / 进阶 Retail）。** 具体画像：

- **资金规模** $5k – $100k；**风险偏好** 中高，能承受单笔 10–20% 的波动但不做杠杆赌博
- **交易频率** 每周主动做 3–8 次投研决策；**持仓周期** 日内到波段（1–10 天），与系统的 `intraday / days / weeks` horizon 对齐
- **主要市场与场景** Bitget 美股 rToken + 加密现货；**最痛的场景就是周末和盘后** —— 现金盘关了，rToken 还在动，信息在推特上碎片化地飞，他需要在周一开盘前形成一个**有依据、有仓位、有失效条件**的判断
- **能力边界** 读得懂英文财报但没时间逐份精读；知道 CPI/FOMC 重要但**算不清传导到自己的标的上是多少**；有过被"AI 给的数字其实是编的"坑过的经历

**为什么他需要它。** 他不是缺一个会聊天的 AI，他缺一个**可以问责的投研流程**。Prism Desk 给他的每张卡都带：预期差的精确数字与出处、可执行的 entry/stop/target、明确的失效水平与复检时点、系统自己写的反方观点（bear case）、以及逐条 ✅/⚠️ 的证据账本。**他可以不同意结论，但他永远知道结论是怎么来的、以及在哪个数字上被推翻。**

**次要人群：小型私募 / 家办 / 券商自营的初级研究员（Pro）。** 场景是晨会前的信息压缩 —— 需要在 30 分钟内把overnight 落地的所有事件梳理成"哪些值得上会、哪些不值得"。他们要的是**可审计**：`--as-of` 能冻结时钟精确复现历史某个时点的判断，`/api/export/board.csv` 能导出留档，每个分数都有书面理由可追溯。这条能力也是本项目"复盘"价值的入口。

**明确不服务的人群：** 高频/做市商（我们不做延迟竞争，~60ms 是研究耗时不是交易耗时）；完全被动的长期定投者（他们不需要事件驱动判断）；以及**任何想要"一键下单"的人 —— Prism 输出研究判断，人做决策，这是赛道三的定位，也是我们主动选择的产品边界。**

### 三、验证数据与关键指标

本项目是**工具类**，按官方要求给测试用户 / 任务完成率 / 使用数据。**每个数字都标注了【实测】【估算】【目标】，实测项全部可在仓库内一键复现。**

**A. 工程质量【实测】**

| 指标 | 数值 | 复现命令 |
|---|---|---|
| 单元/集成测试 | **211 / 211 通过 · 0 跳过** | `npm test` |
| 结构性与研究质量检查 | **60 / 60 通过**（7 个 suite） | `npm run validate` |
| 第三方依赖 | **0**（纯 Node ≥20 标准库，clone 即可跑，无需 `npm install`） | `package.json` |
| 全频道扫描耗时 | **~60 ms** 产出 9 张卡（离线、纯规则路径；本机 6 次实测 60–64 ms，耗时随机器而异） | `node prism.mjs demo --only=full-sweep` |
| 确定性 | 同输入两次运行产出**逐字节相同**的卡片集 | `validate.mjs` → `determinism/same-answer-twice` |
| 确定性（跨进程） | 看板 fixture 连续两次重建 **SHA-256 相同**；复盘报表除时间戳行外**逐字节相同**；`npm test` 跑完真看板**字节数不变** | `npm run seed` ×2 · `npm run review:seed` ×2 |

**B. 任务完成率【实测】** 我们用一套**带标签的评测集**（`data/eval/extraction-eval.json`）来量"任务完成率"，每份文档都有已知的正确读法：

- **抽取任务：10 / 10 通过（100%）** —— 频道、方向、幅度全部读对。其中两条是关键：**`earn-beat-withdraw`**（超预期但**撤回指引**必须判为 neutral 而不是 long，因为撤回意味着管理层主动放弃可预测性，与"指引下调"是完全不同的信息）；**`negative-control-bland`**（一份平淡无信息的文档必须产出 **0 张卡片** —— 评测集里对这条的原文注释是 *"A signal generator that fires on everything is worse than one that fires rarely."*，**这条量的是假阳性**）。
- **证据核验任务：9 / 9 通过（100%）** —— 账本对已知裁决的证据全部判对，**其中故意掺入了编造的数字**（`quote-fabricated`、`metric-inflated`、`computed-recipe-fake`、`unsourced-number`、`price-tampered`），用来证明账本真的会隔离，而不是永远绿灯。

**C. 端到端运行数据【实测】** 全频道扫描一轮（`node prism.mjs demo --only=full-sweep`，as-of 2025-09-19T20:00Z 由场景钉死）：9 张卡；证据账本 **26 items · pass 23 · fail 0 · unverifiable 3 · pass rate 88.5% · 隔离 0**。

这 3 个 unverifiable 是 HLXN / CRVS / ASTR 三张财报卡各自的 consensus `estimate`（`E2`）—— **设计上刻意保留的诚实**，不是缺陷：

- HLXN 卡片的 consensus（1.94）没有独立第二来源可核对 → 判 ⚠️，账本给出的理由原文是 `no document or snapshot available to check this number against`。corroboration 因子因此停在 **75.5**（该卡总分恰好也是 75.5/A），bear case 里同时写明"consensus 出处是文档 meta，consensus 过期会让预期差变成假象"。CRVS、ASTR 同理。

**最能说明问题的第四个例子来自另一轮运行** —— `node prism.mjs doctor` 的 smoke run（as-of 2025-09-13T15:00Z 那个周六下午；那一轮账本是 **26 items · pass 22 · unverifiable 4 · 84.6%**。同一张 ASTR 闭窗卡也出现在 `demo --only=closed-window` 的 below-threshold 列表里）：

- ASTR 的 closed-window 卡片，因为该标的在价格库里没有序列、gap-study recipe **无法复算** → 判 ⚠️（`computed claim without a re-executable recipe`），corroboration 从 SPY 的 **96** 掉到 **70.3**，总分 **44.9**，**低于 45 门槛，卡片不发布**。同一周末、同一新闻逻辑，SPY 有 44 个可比跳空样本 → **58.3** 分发布。**系统在拿不到证据时会主动降分并闭嘴，这就是证据账本与"让 LLM 自由发挥"的可观测差别。**

> 两轮都是 26 items 属于巧合：问题文本与时点不同，卡片组合也不同。并列对照见 [`ARCHITECTURE.md`](ARCHITECTURE.md) 的 VERIFY 一节。

**D. 研究质量与事后判分【实测】** 三份跑在**真实价格数据**上的研究（25 symbols · **41,386** 根日 K · 2019-01-02 → 2025-09-30，来源 Nasdaq 公开 chart API）：

- **宏观传导研究** → 支撑 `surprise` 权重 0.30。19/25 个事件打分，mean Spearman ρ **0.157**，ρ>0 占比 **73.7%**，平均多空价差 **+1.70%**，方向命中率 **68.4%**；按 surprise 分桶单调（大 0.254 / 中 0.102）。**caveat 我们直说：样本只有 19 个，naive t=1.61 把它们当独立抽样是乐观的，所以请把"分桶单调性"当结论，不要把 p 值当结论。**
- **隔夜/休市窗口跳空研究** → 支撑 closed-window 频道。**15,478** 个跳空，延续 48.8% / 回补 46.4%；5 日超额 **+0.387%**，**date-clustered t 5.23**（naive t 8.45）。**项目里任何地方引用的都是 clustered 值，因为 naive 值错在"让结果更好看"的方向上。** 另外必须说明：**我们并没有发现"跳空必延续"的规律 —— 恰恰相反，接近一半会回补**，所以该频道用这份研究来给观点定规模和时间盒，而不是声称跳空总会延续。

- **复盘裁决研究** → 检验"按上述权重发出去的判断，后来对了吗"。235 张卡按 `claimKey` 折叠成 **115 个独立主张**（合并 120 次重述），64 个窗口已关，**45 条裁决、34 条决出胜负：10 胜 24 负，方向命中率 29.4%（95% CI 14.1–44.7%）**，平均带符号超额 **-0.832%**、中位 **-0.745%**。**两个必须直说的结果：**（a）**打分规则不排序** —— A 级卡命中率 **22.2%** 低于 C 级 **42.9%**，rho(score, excess) = **-0.138**（n=45），报告标为 **BLOCKER**；（b）**24 / 45 条主张的失效条件只是文字**（如"≥2 篇文档语气符号翻转"），没有可机器验证的水平，所以轴 ① 无法裁决、只能回退到超额收益 —— 也就是说过半结论**并没有在检验 desk 自己写下的话**。另有 **13 / 64 条不可测**（卡片引用了价格库里没有的序列），它们**不进胜负分母、也没有被悄悄丢掉**。**caveat 我们直说：** 34 条决出主张来自 6 个信息日期、共享文档与基准，**不是独立观测**，且**不含任何交易成本**；报告第一句就是"不应从本报告得出任何关于盈利能力的结论"。复现：`npm run seed && npm run review:seed`（连续两次 seed 的文件 SHA-256 相同，**实测**）。

**E. 估算值【估算】** rToken 流动性系数 **0.45**（原生股 1.0）是**保守估算**，不是从真实盘口测出来的 —— 因为本构建环境无法访问 Bitget 域名。它是刻意压低的：代币化股票盘口更薄，且 mint/redeem 套利可能在你之前抹平错位。

**F. 测试用户与分发【目标 + 验证计划】** 诚实说明：**目前没有外部测试用户，所有实测数据都是内部可复现的工程与研究指标，不是用户使用数据。** 我们不编造 DAU。验证计划：

1. **【目标】** 赛后 4 周内招募 **20 名** Bitget rToken 活跃交易者做封闭内测，主任务是"周末给一条真实新闻，让 Prism 出判断，用户独立打分是否可用"，指标为**任务完成率**与**判断可用率（用户主观 1–5 分）**。
2. **【目标】** 在能访问 Bitget 端点的环境跑 `PRISM_DATA_MODE=live`，用**真实 rToken 盘口深度**替换 0.45 这个估算系数，并录制一份 live fixture 回填仓库。
3. **【目标】** 把标注抽取评测集从 10 例扩到 **100+ 例**，并给出**规则路径 vs LLM 路径**的准确率对比表（双抽取器与对账逻辑已实现并有测试，但尚未做系统对比）。
4. **怎么证明被有效使用：** 看板状态机天然产生可审计的使用痕迹 —— 每张卡有 `issuedAt / expiresAt / status(active|superseded|expired|quarantined) / supersededBy`，**失效条件到期时是否被触发是可事后判定的**。**这条链现在已经接上了**（见 D 的复盘裁决）：方向命中率 **29.4%**、失效条件确实被触发 **12 次**、rho **-0.138** —— 数字不好看，但它是真的，而且任何人 clone 下来都能逐字节复现。这是工具类产品少见的、可量化的"被有效使用"证据链：**我们统计的不是点击量，是自己说过的话后来对没对。**

> **我们明确没有测的：** 信号的**扣费后净收益**（三份研究都不含佣金/点差/借券/滑点，也没做组合层面回测）。复盘给出的是**方向命中率**，一次"命中"是一个方向、不是一笔利润。**这不是 desk 的回测，它只验证一个打分因子的一个输入。** 这句话写在这里是刻意的 —— 一个声称自己"验证了盈利能力"的投研工具，比一个说清楚自己验证了什么的更危险。

### 四、完成度

**已完成（全部可运行、有测试覆盖）**

- **七阶段管线** PLAN → INGEST → EXTRACT → VERIFY → SCORE → PRESENT → **REVIEW**，每阶段独立模块 + 独立测试 + 可流式观测的 trace 事件
- **7 个信号频道**：财报预期差、宏观传导链路、叙事转向、资金足迹、休市窗口定价、跨资产联动、反向风险旗
- **证据账本**：4 类核验策略（文档字符偏移匹配 / 快照字段路径 / recipe 重新执行 / session clock），3 种裁决，头条 fail 即隔离
- **五因子打分**：显式权重 + 等级（A≥75 / B≥62 / C≥48 / D≥35）+ 发布门槛 45 + **每个因子都返回一句可审计的书面理由**
- **双抽取器 + 对账**：确定性规则路径（默认，零成本可测）与可选 LLM 路径并行，`hydrate()` **强制钳制模型越界输出**（非法 direction/horizon/instruments/conviction 被改写，超长 quote 被截断，有测试钉住）
- **数据接入**：Bitget MCP Server（美股/ETF 行情、财报日历、分析师预期）、Bitget Signal Skills（sentiment-analyst、macro-analyst）、真实价格库、离线 fixture；三种数据模式 `auto / live / offline`，**每个快照都标注 origin**，评委能一眼看出哪些数字来自真实端点
- **交付界面**：零构建 Web 投研台（SSE 流式 trace）+ 全功能 CLI（11 个子命令）+ 14 个 HTTP API 路由 + CSV/markdown 导出
- **看板状态机**：去重取代 / 冲突显式暴露 / 到期退役 / 状态持久化
- **三份真实数据研究** + 自动生成的研究报表（宏观传导、隔夜跳空、**复盘裁决**）
- **复盘闭环（REVIEW 阶段）**：窗口关闭后拿真实价格回头裁决 —— **失效条件 / 风险路径 / 相对 SPY 的超额收益，三条轴永远分开算**（风险路径只报告、**永不裁决**，因为"这笔交易疼不疼"和"这个判断对不对"是两个问题）；按 `claimKey` 折叠重述、±1% 实质性带内记 `inconclusive`、**不可测与非方向性不进胜负分母**、同 bar 并列时**悲观判止损**（这个偏向压低命中率）；输出按 grade / channel / direction 的校准分档、发布门槛上下对比与 Spearman rho，**每条 finding 必须引用产生它的那个测量值**，否则不予输出。CLI（`review`）+ HTTP（`/api/review`、`/api/export/review.md`）+ Web 左栏面板三个入口，**默认只读**，`--persist` 才写回且**只重分类已终结状态的卡片、永不改动 active 卡**。
- **复盘绝不自动修改打分规则** —— 只报告。这是**设计约束，不是未完成项**：样本非独立，自动调权等于拟合噪声，而且之后没人能分辨规则是被证据改的还是被运气改的。改规则必须是一次写进 commit 的人类决定。
- **可复现性**：`--as-of` 冻结桌面时钟精确复现历史时点，**六个 demo 场景各自钉死 as-of**，所以 `node prism.mjs demo` 不带参数也能逐字重建 `DEMO-TRANSCRIPT.md`（仅生成时间戳与 6 处耗时行不同，实测）；确定性检查保证同输入同输出；**看板 fixture 可逐字节重建** —— `npm run seed` 用 11 个固定 as-of × 6 个场景回放，连续两次产出 SHA-256 相同（实测），`npm run review:seed` 据此复现复盘报表，**所以全新 clone 也能复现已发布的判分数字**
- **X 帖合规校验**：`npm run xpost` 按 X 官方 v3 权重（中文/全角 2 · 拉丁 1 · 任意 URL 固定 23）逐条校验草稿的话题标签、@提及、**实质性**（去掉强制 token 后仍需 ≥40 权重单位原创文案，即"非纯转发"的机器化表达）、长度与"是否引用转发官方推文"；草稿与校验规则**共用同一个文件**，所以不可能悄悄漂移。当前 **17/17 帖、86/86 检查通过**（实测）

**遇到的问题与解法（十个真实的坑）**

1. **freshness 一开始是假因子。** 最初按卡片生成时间（墙上时钟）衰减，结果所有历史场景复现时 freshness 永远是满分 —— 因子形同虚设，`--as-of` 也无法真正生效。**解法：** 改为按**源文档发布时间** `informationAt` 衰减，并给每张卡打上运行时 `as-of`。改完之后 `--as-of` 场景复现才真正work，freshness 也成了实际起作用的因子（代价是头条分数全部变化，所有文档数字重新生成）。`validate.mjs` 里加了 `as-of-matters` 检查防止回归。
2. **缺数据时系统会输出 `null%`。** 虚构标的在价格库里没有跳空样本时，closed-window 卡片会把 null 直接插值成 `"continued null% of the time"`。**这是我们自己在 demo 逐字稿里发现的真实缺陷。解法：** 改为自然语言承认无知（"该标的无可比历史跳空，无实证先验，请按结构性而非统计性理解"），同时改写风险条目为"跳空幅度无锚，减半仓位或不做"，并**在 `tests/extract.test.mjs` 加了回归测试钉住**（断言任何卡片都不得出现 `null% / undefined% / NaN%`）。
3. **验证报表在 PASS 行显示失败文案。** `check()` 只有一个 `detail` 参数，多数调用点传的是失败消息，而 markdown 渲染器无条件打印 —— 导致一份全绿的报表里出现 "a quarantined card reached the published set"、"two identical runs diverged" 这种话。**对一个以"诚实"为卖点的项目，这是最讽刺的缺陷。解法：** 给 `check()` 拆出 `detail`（通过时显示的测量值）与 `failDetail`（仅失败时显示），并改写全部 10 个受影响的调用点。现在每个 PASS 行都读起来像一个测量结果。

4. **我们最想拿出来当卖点的那份报表，自己复现不出来。** 三个各自很小、合起来致命的可复现性漏洞：（a）卡片 id 用 `Date.now()` 打戳 —— `--as-of` 冻结了 `createdAt`，却**没冻结卡片的身份**，同一回放在不同日期产出不同 id；（b）证据账本的 `verifiedAt` 用墙上时钟，于是同一次 `--as-of` 回放每跑一遍就写出一个**不同的**看板文件；（c）**`npm test` 会写真看板** —— `POST /api/ask` 默认 persist，测试套件每跑一次就往 `data/state/board.json` 追加卡片，而 `data/state/` 是 gitignored 的，所以**全新 clone 上的看板是空的、`review` 会裁决 0 条主张，而 `docs/reports/review.md` 里写着一堆数字**。**对一个以"每个数字都能被追责"为卖点的项目，这是最讽刺的一类缺陷 —— 而且它是在给复盘报表做可复现性验证时自己撞出来的。解法：** id 改由 `stampTime()` 按运行时钟重打（`rebaseCardId()`，序号后缀保留所以唯一性不变）；`verifiedAt` 改取 `card.createdAt`；测试与验证脚本各自用 `PRISM_STATE_FILE` 钉死到自己的 scratch 文件、并在 `after` 里删除；看板本身做成**已提交的 fixture**，由固定回放计划重建，连续两次 SHA-256 相同（实测）。顺带产出三个部署必需的修正：`PRISM_STATE_FILE`（只读根文件系统 / 挂卷）、服务端识别 `HOST`/`PORT`（所有容器 PaaS 注入的就是这两个名字，原来只认 `PRISM_*`）、以及 SSE 响应补上 `X-Accel-Buffering: no`（否则反向代理会把流式 trace 缓冲成一次性输出 —— **Demo 里最直观的那个效果会静默失效，而且本机测不出来**）。

5. **`npm test` 在全新 clone 上其实是 177 通过 + 1 跳过，而每一份文档都写着 178/178。** `tests/review.test.mjs` 里那条"在真实看板上把复盘跑一遍"的测试带着 `{ skip: !existsSync('data/state/board.json') }`，而 `data/state/` 是 gitignored 的 —— 干净 checkout 上它**永远跳过**。**跳过的检查不等于通过的检查**，而且被跳过的恰好是唯一一条"复盘能在真实看板上跑通"的端到端检查。**解法：** 改为跑**已提交的** `data/fixtures/board-seed.json`（就是 `npm run review:seed` 用的那份看板），并断言 `decided > 0`，防止它退化成一条永真的空测试；修完当时是 **179 / 179 · 0 跳过**，在干净 checkout 上也是真的（实测；比 177+1 多出的那一条，钉住"提交材料清单不得指向仓库里不存在的文件"）。当前测试总数以 `docs/VALIDATION.md` 的实测行为准。同一轮排查还发现：六个 demo 场景里**只有 `closed-window` 钉死了 as-of**，其余五个跟着墙上时钟走，所以 `node prism.mjs demo` 在不同日期会产出不同卡片、`DEMO-TRANSCRIPT.md` 根本复现不出来。**解法：** 六个场景在 `SCENARIOS` 里全部钉死 as-of（对齐内置语料与价格窗口），命令行 `--as-of` 与 Web 时钟框仍优先；`tests/server.test.mjs` 加了断言防止将来被悄悄改掉。修完之后 `node prism.mjs demo` **不带任何参数**即可逐字重建 `docs/DEMO-TRANSCRIPT.md`（实测：951 行中仅生成时间戳 1 行与 6 处 `ms` 耗时不同）。
6. **`node prism.mjs demo` 跑第二遍就不再逐字可复现 —— 而 README 让评委裸跑的正是这条命令。** 看板会 autosave 到 `data/state/board.json`，`cmdDemo` 却从不清空它。于是先跑过 `doctor` 或 `ask`（"30 秒上手"两条都推荐）再跑 `demo`，结尾那份看板 dump 就会比已提交的逐字稿多出一批 superseded 重复卡（实测 total 23 → 25），"除时间戳与 6 处 ms 外逐字节相同（实测）"这句话对**最有可能去验证它的那个评委**恰好失效。**解法：** `cmdDemo` 默认先 `board.clear()` 再跑，新增 `--keep-board` 给确实想往手工看板上追加的人；`tests/wiring.test.mjs` 用独立的 `PRISM_STATE_FILE` 连跑两遍 `demo`、忽略时间戳行与 ms 行后逐行比对，把幂等性钉死。

7. **`CHAINBASE_AGENT_KEY` 是一个假开关。** `config.chainbase` 读了这个 key，`/api/status` 在 key 存在时如实报告 `{ enabled: true }`，而**整个仓库没有任何一行代码消费它** —— 没有 provider、没有请求、没有数据。Chainbase AgentKey 是本届官方列出的外部 Partner 数据源（行情 / 链上 / 新闻 / 社媒），出现在 `.env.example` 里并不奇怪；奇怪的是一个以"每个数字都要对回出处"为卖点的项目，会在自己的状态接口里报告一个**接不出数据的数据源**。**解法：** 补上真正的 `src/ingest/chainbase.mjs`（复用现成的 `McpClient`；工具名一律走 `tools/list` 发现 + 模糊解析，不硬编码、不猜端点）。没有 key 时状态是 `disabled` 且**一个请求都不发**；有 key 没端点时状态是 `error` 并把原因写出来（端点随 key 一起发放，仓库刻意不设默认值 —— 不替别人的基础设施编一个 URL）。doctor / `/api/status` / `/api/capabilities` / Web 左栏一律如实显示 `no key · optional partner source, inert`。`tests/wiring.test.mjs` 钉住两件事：禁用路径既不发请求也不编值；**接上一个禁用的 provider 之后卡片输出逐条不变**（离线 demo 与看板 fixture 因此完全不受影响）。

8. **四处"能力被低报、缺口被静默"的接线问题 —— 全部由本轮评审在跑通测试之后发现。** 测试全绿不等于接线正确：
   - `closed-window` 频道**从不取加密侧数据**，而它产出的卡片正文正在论证"rToken 在加密轨道上定价、现金盘关门时它是唯一的价格发现场所"。论证所依赖的数据没有被取（bitget-signal 的 Skill 原先只在 `cross-asset` 命中时调用）。**解法：** 抽出 `SKILL_TRIGGERS` 作为唯一的接线真相源，`closed-window` 与 `cross-asset` 都会触发；六个固定场景的输出逐条不变（实测），变的只有自由提问。
   - 规划器解析失败时会**静默扩到全部 7 个频道**，与"用户明确要求全扫"产出完全相同的计划与简报 —— 一句乱码也能拿回一份自信的七频道简报。**解法：** `plan.matched / sweepRequested / widened` 三个字段把两种情况分开，`widened` 时 trace 多一条 `plan:widened`、简报开头多一节"How I read this question"明说这是扫描不是回答；显式全扫（含中文"全频道扫描"）不会被误报成解析失败。
   - 计划请求了 `balanceSheet` / `cashFlow`，离线拿不到，trace 里却**完全不提** —— `ingest:data` 只列成功返回的 intent。**解法：** 逐 intent 记录 requested / served / missing（含原因），简报新增一节"Data I asked for and did not get"。risk 场景的逐字稿现在会自己承认这两个 intent 没取到（逐字稿因此从 944 行变成 951 行）。
   - Web 左栏把 signal skills 显示成 `0/5`（离线时 `resolved` 全为 null），**低报**了真实接线；`/api/capabilities` 也只给 `resolved`，不给"是否有离线数据"和"被哪个频道调用"。**解法：** capabilities 补 `fixture / wired / invokedBy / why` 四个字段，左栏与 intents 行同构显示 `live N · fixture M`。
9. **两个"同一份东西存在两份"的缺陷 —— 一个是跨平台的，一个是发布物与后端的。**
   - **X 帖合规闸门在 Windows 上会误判。** `scripts/xpost.mjs` 的 `weightedLength()` 逐字符计权，于是 CRLF 检出里的 `\r` 每行被算作 1 个权重单位。实测同一段文案 LF 计 29、CRLF 计 31；而 `a1` / `a2` / `zh-5` 三条帖子距 280 上限只差 2–4 个单位，结果是**完全相同的文案在 Windows 上 FAIL、在 Linux 上 PASS**（本机实测 `npm run xpost` 83/86，切成 LF 后 86/86）。这道闸门守的是**必交项**"合规 X 帖链接"，而作者看到 FAIL 的自然反应是去删内容 —— 也就是一条平台相关的假阳性会诱导作者把本来合规的帖子改短。**解法：** 计长前把 `\r\n?` 归一为 `\n`（X 对一个换行收 1 个字符，对回车不收）；`tests/wiring.test.mjs` 直接拿**仓库里真实的 `docs/X-POSTS.md`** 跑 LF 与 CRLF 两遍，断言结论与每条帖子的计长逐一相同。顺带补 `.gitattributes`（`* text=auto eol=lf`）：仓库对外声称"两次重建 SHA-256 相同"，而 `core.autocrlf=true` 的 Windows clone 检出的是 CRLF、生成器写的是 LF，字节级宣称会因与引擎无关的原因失效。`render.yaml` 与 `scripts/submission-links.mjs` 的已提交 blob 本来就是混合换行，一并归一。
   - **发布出去的 demo 与后端对不上。** `server.mjs` 和 `scripts/export-static.mjs` 各自手抄了一份 `/api/capabilities` 的构造逻辑，然后漂了：GitHub Pages 上那份（**评委真正会打开的那个产物**）没有 `fixture` / `wired` / `invokedBy`，也完全没有 agentKey 段，左栏因此显示 `signal skills 0/5`，而实时后端如实报 2 个已接线。**解法：** 抽出唯一的 `src/desk/capabilities.mjs`，两处共用；`tests/wiring.test.mjs` 把 `docs/demo/data/api/capabilities.json` 与实时构造器的输出逐项比对（频道 / intent 的 resolved+fixture / skill 的 resolved+fixture+wired+invokedBy / agentKey 状态），谁再漂谁就红。

10. **第三轮评审：三处"数字比接线说得响"的地方 —— 全部只在跑起来之后才看得见。**
   - **`--as-of` 冻结了卡片与账本，却没冻结会话时钟。** `planQuestion()` 里写的是 `sessionState()`（无参 → 取机器当前时间），而 `rules.mjs` 早就写的是 `sessionState(asOf)`。后果有两层：（a）`closed-window` 场景钉死在 2025-09-13T15:00Z 那个**周六下午**，简报第一行却印着 `US cash session pre-market · Wed` —— 这个频道存在的全部理由就是"现金盘关着、rToken 是唯一的价格发现场所"，而它自己的抬头说现金盘快开了；（b）`nyMinutes` 是墙上时钟，于是每重新导出一次静态 demo，录制包里就会变一个数，"确定性录制"名不副实。**解法：** `planQuestion(question, { asOf })` → `sessionState(asOf ?? new Date())`，`runTask` 把已经钉死的 `asOf` 传下去；`tests/wiring.test.mjs` 钉住"冻结时钟必须冻结会话"，`tests/static-demo.test.mjs` 钉住"录制包里的 session 必须等于场景钉死 as-of 的 session，且 closed-window 必须落在周末"。修完 `closed-window` 抬头变成 `closed (weekend) · Sat`，逐字稿仍是 951 行，除生成时间戳与 6 处耗时外只多了 6 行 session 修正，其余逐字节不变。
   - **`doctor` 把共享 fixture 包的总数，报成了行情源自己的覆盖率。** 离线 fixture 包由 bitget-market 与 bitget-signal 共用（10 个行情 intent + 2 个 `signal:*` 技能录制 = 12 条），而 `doctor` 在行情那一行印 `resolved=0/20 fixtures=12`，紧挨着"20 个 intent"—— 读起来就是"20 个里有 12 个有离线数据"，而 `/api/capabilities` 如实写的是 10 个。**赛道三评的正是"数据源 / Skill 集成的数量与有效性"，同一个接线在两处给出两个数字，等于自己给自己扣分。解法：** `FixtureStore.countFor(intents)`，行情源只报自己那 10 条，另报包内总条数；`doctor` 现在印 `fixture-backed=10/20 intents (pack: 12 entries, 2 of them signal skills)`，并有测试断言它必须等于 capabilities 里 `fixture:true` 的 intent 数。
   - **`npm test` 会改写一份已提交的报表。** `scripts/xpost.mjs` 末尾无条件调用 `main()`，而 `tests/wiring.test.mjs` 为了验证长度闸门跨平台一致必须 `import` 它 —— 于是每跑一次测试就重写一遍 `docs/reports/x-posts.md`（时间戳行），`npm test` 之后 `git status` 不干净；更要紧的是 `main()` 会设 `process.exitCode`，X 帖校验一旦失败，测试进程会以一个与测试无关的理由退出。**解法：** 补上仓库里 `prism.mjs` / `server.mjs` / `scripts/submission-links.mjs` 早就在用的入口守卫（`invokedDirectly`），并加一条测试：`import` 该脚本前后，报表字节必须不变。

**尚未完成**

- **打分规则的符号反转未修**（rho = **-0.138**，A 级命中率 22.2% 低于 C 级 42.9%，short 1/12）—— 已定位为 **BLOCKER**，四步修法写在 `ROADMAP.md` §1；但**刻意没有自动调权**，理由见上
- **24 / 45 条主张的失效条件无法机器验证** —— 需要把 `invalidation` 收紧成 `level / series / comparator / by` 四字段必填。这是路线图里**性价比最高**的一项：不碰模型、不碰权重、不需要新数据源，却能把复盘从"事后看涨跌"变成"事后核对承诺"（`ROADMAP.md` §2）
- **13 / 64 条不可测** —— 卡片引用了价格库里没有的序列；等于发出了**实践中不可证伪**的卡（`ROADMAP.md` §3）
- 复盘样本的**独立性不足** —— 45 条已裁决主张只来自 6 个信息日期，需要扩到 ≥20 个日期、≥150 条决出主张（`ROADMAP.md` §4）
- 真实 rToken 盘口深度接入（本环境无法访问 Bitget 域名，全部走 offline fixture）
- 规则路径 vs LLM 路径的系统性准确率对比（**LLM 路径目前没有被证明带来任何增益**，它存在、能跑、受同一个账本约束，但"它更好"这句话我们说不出口）
- 组合层面的扣费后回测（补上之前**永远不发布** Sharpe / 回撤数字）
- 多用户与生产级持久化（当前是单机 JSON 文件，面向 demo 与研究）

**用到的框架 / 模型 / API：** **零第三方依赖**，纯 Node.js ≥20 标准库（`node:http` / `node:test` / `fetch`），前端原生 HTML/CSS/JS 零构建 —— 这是刻意选择：评委 clone 下来 `node server.mjs` 就能跑，没有安装失败的可能。模型侧支持任意 **OpenAI 兼容端点**（默认 `gpt-4o-mini`，黑客松 Qwen 网关 `https://hackathon.bitgetops.com/v1` + `qwen3.8-max`），**但不配 key 也完整可运行**（走确定性规则路径）。数据侧接 Bitget MCP Server（`https://agent.bitget.com/mcp`）与 Bitget Signal Skills，价格数据来自 Nasdaq 公开 chart API。

### 五、材料清单

「提交材料链接」字段里提交的内容（与下表一一对应，方便评委定位）：

| # | 材料 | 说明 | 对应赛道必交项 |
|---|---|---|---|
| 1 | **在线 Demo** | 可公开访问的 Web 投研台，打开即可提问，无需安装、无需 key | ✅ **Demo 可访问（必填）** |
| 2 | **GitHub 仓库** | 完整源码 + 数据 + 测试。零第三方依赖，`git clone` 后 `node server.mjs` 直接可跑 | ✅ |
| 3 | **完整投研任务演示** `docs/DEMO-SCRIPT.md` | 赛道三必填项。以「周末 rToken 窗口」为主任务，把 提问 → PLAN → INGEST → EXTRACT → VERIFY → SCORE → 可用判断 **全链路逐环节拆开**，含 SPY（有实证先验，58.3 分发布）vs ASTR（无先验，44.9 分不发布）的关键对照 | ✅ **完整投研任务（必填）** |
| 4 | **Demo 逐字稿** `docs/DEMO-TRANSCRIPT.md` | 六个场景的完整原始输出（自动生成，非手写），含每张卡的 claim / 预期差 / trade sketch / 失效条件 / bear case / 证据账本 / 打分理由。六个场景各自钉死 as-of，所以**裸跑 `node prism.mjs demo`（不带任何参数）即可从空看板逐字重建**：全文 951 行中仅 1 行生成时间戳与 6 处 ms 计时不同，其余**逐字节相同（实测）** | ✅ 佐证 |
| 5 | **验证数据** `docs/VALIDATION.md` | 全部实测数字 + 逐项 caveat + **明确列出「我们没有测的」** | ✅ 第 3 段支撑 |
| 6 | **架构说明** `docs/ARCHITECTURE.md` | 七阶段管线（含复盘回路）、7 频道、账本核验策略、五因子与半衰期、看板状态机 | ✅ |
| 7 | **研究报表** `docs/reports/` | `transmission-study.md`（25 个真实宏观事件逐事件明细）、`gap-study.md`（15,478 个真实跳空）、**`review.md`（复盘裁决：235 卡 → 115 主张 → 34 决出，10 胜 24 负，rho -0.138 标为 BLOCKER）**、`validation.md`（60 项检查）、`x-posts.md`（X 帖合规 86/86） | ✅ 研究质量佐证 |
| 8 | **复盘闭环说明** `docs/REVIEW-LOOP.md` | 三条轴、七个方法决定、"为什么绝不自动调权"、以及看板 fixture 的可复现性 | ✅ 佐证 |
| 9 | **部署说明** `docs/DEPLOY.md` | 四条上线路径（Docker / PaaS / VPS+Caddy / 隧道）+ **逐项标注本环境验证到什么程度** + 反向代理 SSE 缓冲坑 + 静态托管为什么不行 | ✅ **Demo 可访问**支撑 |
| 10 | **路线图** `docs/ROADMAP.md` | 每一项都挂在一个**已实测数字**上；含明确的 non-goals（不自动执行、不自动调权、不把命中率当营销数字） | ✅ 第 4 段支撑 |
| 11 | **X 传播推文草稿** `docs/X-POSTS.md` | 中文单条 + 英文单条 + 中文 8 条 thread + 英文 7 条 thread，**全部经 `npm run xpost` 按 X v3 权重校验**；含配图建议、发布顺序与「不要这样写」对照表 | ✅ **合规 X 帖（必填）** |
| 12 | **录屏（可选）** | 5 分钟走一遍评委动线 | ⚪ |

**本地一键复现（评委可自行验证所有实测数字）：**

```bash
git clone <repo> && cd prism-desk
node prism.mjs doctor     # 数据接线自检 + smoke run
node prism.mjs demo       # 逐字重建 docs/DEMO-TRANSCRIPT.md（as-of 由场景钉死，无需传参）
npm test                  # 211 / 211 · 0 跳过
npm run validate          # 60 / 60
npm run replay            # 三份研究里的两份事件研究
npm run seed              # 重建看板 fixture（逐字节确定）
npm run review:seed       # 复盘裁决 -> docs/reports/review.md
npm run xpost             # X 帖草稿合规 -> docs/reports/x-posts.md
node server.mjs           # http://127.0.0.1:4310
```

零依赖、零 key、零网络。**demo 里的发行主体是虚构的（我们自己在语料里写明，且每个虚构主体都显式披露它借用的真实价格代理），价格数据是真实的** —— 这两件事在 `doctor` 输出和每张卡的证据账本里分开标注，不会混淆。

### 六、对 AI Trading 的看法

**1. 在投研场景里，大模型的价值不在"生成更多"，而在"能被追责"。** 我们做这个项目最大的认知转变是：让 LLM 自由发挥地产出交易观点，技术上很容易，产品上很难成立 —— 因为用户无法判断该不该信，而错的代价是真金白银。所以我们把架构反过来设计：**模型可以说任何话，但它说的每一个数字都要过证据账本；账本对不上，要么隔离，要么降分并在卡片上如实标注。** 模型不享有豁免权。这套设计跑出来的效果是可见的：一轮扫描 26 个证据项，23 pass / **0 fail** / 3 unverifiable，而那 3 个 unverifiable 全部被如实标注、并压低了相应卡片的分数，其中一张因此被挡在发布门槛之外。

**2. 确定性路径不是"降级方案"，是基线。** Prism 不配任何 key 也能完整运行（纯规则抽取器，211 个测试全部基于这条路径）。这不是为了省事：**一个无法在没有模型时运行的投研工具，你没法测试它的模型部分到底贡献了什么。** 有了确定性基线，LLM 路径才是可度量、可对比、可回退的增量。

**3. 对 Bitget AI 工具的体验与建议。** MCP Server 把美股/ETF 行情、财报日历、分析师预期做成只读工具集，这个抽象层次是对的 —— 投研 Agent 需要的是"可查询的事实"，不是"可执行的下单"。Signal Skills（sentiment-analyst / macro-analyst）提供的是**已加工的观点**，我们把它当作 cross-asset 频道的一个**独立信源**接入，并让它和规则路径的结论互相印证，而不是直接采信 —— 这正好是 corroboration 因子要量的东西。**两条建议：**（a）MCP 若能提供 rToken 的**盘口深度与成交明细**，closed-window 频道就能把当前 0.45 这个保守估算的流动性系数换成实测值，这是本项目最想接的一个数据；（b）Signal Skills 若能带上**观点的时间戳与历史修正记录**，就可以对信源本身做命中率统计，让 corroboration 从"来源数量"升级到"来源质量"。

**4. 关于 Agentic Trading 的判断。** 我们主动选择了赛道三而不是赛道二，这是一个产品立场：**在当前阶段，让 LLM 全自主下单的核心障碍不是模型能力，而是问责链条。** 一次亏损之后，如果没人能说清"这个数字从哪来、这个判断在什么条件下作废"，那么这套系统就无法被信任、也无法被改进。我们的路线是先把**可审计的判断**做扎实 —— 每张卡带出处、带失效条件、带复检时点、带到期状态 —— 这样即使将来接入自动执行，人类也始终有一条能回溯、能复盘、能追责的链路。**先让 AI 的每个判断都能被推翻，再谈让它自己做决定。**

---

## 填写提示（不要复制进表单）

- **字数：** 上面「正式提交版」约 5,500 字（中文约 4,900 字 + 英文术语与数字）。若表单有长度限制，优先压缩第四段的「遇到的问题与解法」和第六段；**前三段不要删**（官方明确：评委重点看前三段）。
- **必须替换的占位符：** 第五段表格与 `docs/SUBMISSION-FORM.md` 里的 `<repo>`、`<demo-url>`、`<x-post-url>`、`<video-url>`。
- **高校名称（选填）：** 填学校全称即进入高校专项评选池；若已获主赛道奖则不再参评高校专项。
- **是否申请 Demo Day（选填）：** 所有队伍均可勾选。
- **是否申请 K3 Token 补贴（选填）：** 勾选且为有效提交，赛后可获 30U 等值 K3 Token。注意 **Qwen 额度走独立申请表，不在本表内申请**。
- **提交窗口：** 2026/9/3 – 9/27（UTC+8）。提交完成 = 参赛完成。
- **无效提交红线：** 缺合规 X 帖、缺项目说明、或提交材料不可访问 → 直接判无效，不进入评审。
