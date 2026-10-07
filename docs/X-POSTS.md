# X 传播推文 / X Posts

**赛道三必交项之一。缺合规 X 帖 = 提交不完整 = 直接判无效，不进入评审。**

<!-- xpost-meta official=https://x.com/Bitget_AI/status/2100519318824055159 -->

> 本文件里的每一条草稿都是**可直接复制粘贴**的成品，不含占位符。
> Demo 链接与配图是账号相关的，单独在 §6 说明，不写进草稿正文。

---

## 1. 硬性要求（逐条对回官方规则）

| # | 要求 | 出处 |
|---|---|---|
| 1 | 含 `#BitgetHackathon` | 表单字段「X 传播推文链接」 |
| 2 | 含 `@Bitget_AI` | 同上 |
| 3 | 是**介绍你所构建产品的互动宣发帖**——「纯转发或无实质介绍 = 提交不完整」 | 第三章 FAQ |
| 4 | **转发**官方指定推文 `https://x.com/Bitget_AI/status/2100519318824055159` | 第三章 · 时间线 / FAQ |
| 5 | 把发布后的推文 URL 填进表单**单独字段** | 第四章 · 表单字段 |

**第 3 条和第 4 条同时满足的最省事做法：引用转发（Quote Retweet）。** 引用转发官方推文、并在引用框里写实质介绍——一条帖同时构成「转发」和「介绍」，还自带官方推文的卡片渲染。纯转发（Retweet）不满足第 3 条。

---

## 2. 本文件是可执行的

所有草稿都写在带 `xpost` 标记的围栏代码块里，由 `scripts/xpost.mjs` 解析并逐条校验：

```bash
npm run xpost             # 校验全部草稿 -> docs/reports/x-posts.md
npm run xpost -- --json   # 机器可读
```

**改草稿就是改测试**——草稿与校验规则共用同一个文件，两者不可能悄悄不一致。校验项：

| 检查 | 说明 |
|---|---|
| `length` | 按 **X 官方 v3 权重**计算：中文/全角 = 2，拉丁 = 1，任意 URL = 固定 23。默认上限 280 |
| `hashtag` / `mention` | 第 1、2 条硬性要求 |
| `substantive` | 去掉话题标签、@提及与 URL 后仍需 ≥ 40 权重单位的原创文案——这是第 3 条「非纯转发」的机器化表达 |
| `no-placeholder` | 不得残留 `<...>` 占位符 |
| `urls-https` | 出现的链接必须是绝对 https |
| `quote-rt-exists` | 至少一条草稿声明了 `quotes=official`（第 4 条） |
| `threads-shaped` | thread 从 1 连续编号、不跳号 |

> **为什么按权重算而不是按字数算：** X 对 CJK 字符按 2 计权。一条「看起来只有 150 字」的中文推，权重可能是 290——复制进发布框会被直接拒发。下文标注的长度全部是权重值，由 `npm run xpost` 实测。

> `tokens=off` 用于 thread 的第 2 条及以后：只有你**实际提交的那条**必须带话题标签和 @提及，每条回复都重复一遍会被读成 spam。续帖仍然受长度、占位符与实质性检查约束。

---

## 3. 方案 A · 主推单条（引用转发官方推文）

**发布方式：** 打开官方推文 → **引用转发（Quote）** → 粘贴下面任一条 → 配图（见 §6）→ 发布 → 把 URL 填进表单。

一条即可满足「至少 1 条 X 帖」。A1 与 A2 内容等价，按受众语言选；**只发一条就发 A1**（本次赛事为中文语境）。

### A1 · 中文（主推）

```xpost id=a1 lang=zh kind=quote-rt quotes=official
Prism Desk｜把财报、宏观、新闻压成「可证伪」的信号卡。

每个数字都要回溯到原文的字符偏移，对不上就进隔离区，不进卡片。每张卡必须写明「我在什么条件下错了」，附可观测价位与复检时点。

窗口一关自动判分——判错的也一起公开。

零依赖 Node，clone 即跑。

#BitgetHackathon @Bitget_AI
```

### A2 · English

```xpost id=a2 lang=en kind=quote-rt quotes=official
Prism Desk turns earnings, macro prints and news into falsifiable signal cards.

Every number traces to an offset in its source - or it is quarantined, not published.

Closing a window scores the card. Losses included.

Zero deps. Clone and run.

#BitgetHackathon @Bitget_AI
```

---

## 4. 方案 B · 中文长 thread（8 条）

**首条即引用转发官方推文，首条的 URL 就是填进表单的那条。** 后续 7 条依次作为回复发出。
续帖用 `tokens=off` 标记——它们不需要重复话题标签和 @提及，但仍受长度与实质性检查约束。

```xpost id=zh-1 lang=zh kind=quote-rt quotes=official thread=zh
我们给 Bitget AI 黑客松做的东西：Prism Desk，一个 AI 投研台。

它不生成「观点」，它生成可证伪的信号卡——每张卡都写明「我在什么条件下错了」，附可观测价位和复检时点。

窗口一关自动判分，判错的也一起公开。

怎么工作的 🧵 #BitgetHackathon @Bitget_AI
```

```xpost id=zh-2 lang=zh kind=thread-post thread=zh tokens=off
先说问题。

问题不是「AI 读不读得懂财报」。它读得懂。问题是它会编数字——一个看起来合理的 EPS、一个不存在的 consensus，就足以让整条推理链变成幻觉，而你从结论上完全看不出来。

所以第一条设计原则：模型可以说任何话，但它说的每个数字都要能被追责。
```

```xpost id=zh-3 lang=zh kind=thread-post thread=zh tokens=off
证据账本（Evidence Ledger）。

卡片里每个数字都必须回溯到三样东西之一：
· 某份文档里的字符偏移量
· 某个数据快照的字段路径
· 一段能重新执行、复算出同一个值的代码

对不上？不进卡片，进隔离区。

评测集里我们故意掺了编造的数字，就是为了证明它真会拦。
```

```xpost id=zh-4 lang=zh kind=thread-post thread=zh tokens=off
一张卡长这样：

主张 → 预期差 → 交易草图 → 失效条件 → bear case → 逐条打分理由。

重点是「预期差」：价格重定价的是「实际 vs 一致预期」的差，不是「好/坏」。超预期但下调指引，系统标成 beat-but-ugly，不给做多分。

失效条件必须给可观测价位 + 复检时间。
```

```xpost id=zh-5 lang=zh kind=thread-post thread=zh tokens=off
最想做对的场景：7×24 的代币化股票 vs 每天只开 6.5 小时的美股现金盘。

信息在现金盘关门时落地，rToken 是唯一还在做价格发现的地方。

我们数了 15,478 个真实隔夜跳空：继续 48.8% / 回补 46.4%，几乎对称。

所以系统不把「跳空必继续」当规律；没有先验时直接写「无实证先验」，不编百分比。
```

```xpost id=zh-6 lang=zh kind=thread-post thread=zh tokens=off
新加的闭环：复盘。

卡片到期后，系统拿真实价格回头判它，三件事分开算：
① 它自己写的失效条件有没有被触发
② 止损/目标有没有被摸到
③ 相对 SPY 的超额收益

裁决优先看 ①。「thesis 对不对」和「这笔交易疼不疼」是两个问题，混在一起就是自欺。
```

```xpost id=zh-7 lang=zh kind=thread-post thread=zh tokens=off
第一批判分结果，直接公开：

235 张卡 → 115 个独立主张 → 64 个窗口已关 → 34 个决出胜负：10 胜 24 负。

胜率 29.4%，95% 置信区间 14–45%。样本仍然太小，报告第一句就是这么写的。

打分与超额收益的 Spearman rho = -0.138，A 级卡胜率反而低于 C 级。这条被标成 BLOCKER。
```

```xpost id=zh-8 lang=zh kind=thread-post thread=zh tokens=off
最后一条，也是我们认为最重要的：复盘绝不自动改打分规则。

它只报告。45 条样本、rho 只有 -0.138，就去调五个权重等于把噪声拟合进去。

零第三方依赖，Node ≥ 20。clone 下来 node server.mjs 就能跑，全程离线可复现，211 个测试 + 60 项验证检查全绿。

Demo 与代码链接在评论区 👇
```

---

## 5. 方案 C · English thread (7)

Same story for an English-speaking audience. `en-1` is the quote-retweet and is the URL you submit.

```xpost id=en-1 lang=en kind=quote-rt quotes=official thread=en
Prism Desk ships falsifiable signal cards, not opinions. Built for the Bitget AI hackathon.

Every card names the condition that would prove it wrong, an observable level and a recheck date. When the window closes it scores itself - losses too.

🧵 #BitgetHackathon @Bitget_AI
```

```xpost id=en-2 lang=en kind=thread-post thread=en tokens=off
The problem is not whether an LLM can read a 10-Q. It can. The problem is that it invents numbers - a plausible EPS, a consensus nobody published - and the chain downstream still looks fine.

Rule one: every number the model states must be attributable.
```

```xpost id=en-3 lang=en kind=thread-post thread=en tokens=off
The Evidence Ledger: every number must resolve to a character offset in a named document, a field path in a snapshot, or code that recomputes it.

No reconciliation, no card - it goes to quarantine. The eval set injects fabricated numbers on purpose, to prove the gate closes.
```

```xpost id=en-4 lang=en kind=thread-post thread=en tokens=off
Tokenized equities trade 24/7; US cash is open 6.5h a day. News lands while cash is closed, and the rToken is the only venue still pricing it.

15,478 real overnight gaps: 48.8% continue, 46.4% fill. Near symmetric - so "gaps continue" is not a rule the desk may use.
```

```xpost id=en-5 lang=en kind=thread-post thread=en tokens=off
New: the review loop. Once a window closes the desk scores the card against real prices on three axes: did its own invalidation level fire, was the stop or target touched, and what was the excess return vs SPY.

Only axis one decides. The others are reported, never merged.
```

```xpost id=en-6 lang=en kind=thread-post thread=en tokens=off
First results, as-is: 235 cards -> 115 claims -> 64 windows closed -> 34 decided: 10 won, 24 lost. Hit rate 29.4%, 95% CI 14-45%.

Spearman rho, score vs excess: -0.138. A-grade cards hit LESS often than C-grade - flagged BLOCKER. Sample still too small to conclude anything.
```

```xpost id=en-7 lang=en kind=thread-post thread=en tokens=off
The review never edits the scoring rules automatically - it only reports. Re-tuning five weights on 45 claims at rho -0.138 is fitting noise.

Zero deps, Node >= 20: clone it, run node server.mjs, fully offline. 211 tests, 60 checks green.

Demo and code in the replies 👇
```

---

## 6. 链接与配图

### 链接放不进正文——这是实测结论，不是偏好

`a1` 实测 **274/280** 权重。X 对**任意** URL 一律计 **23** 权重（t.co 短链），加一个换行就是 274 + 1 + 23 = **298 > 280**，发布框会直接拒发。17 条草稿里最紧的 `en-6` 是 279/280。

**所以链接走自己回复（self-reply），不挤进正文。** 回复不占主帖预算，而且 thread 本来就会被展开看到。zh-8 / en-7 末尾的「评论区 👇」就是在给这条回复留位置。

发布后立刻自己回复一条：

```text
Prism Desk · Demo: https://<你的-demo-域名>
代码: https://github.com/<你的-org>/prism-desk
完整投研任务演示: .../blob/main/docs/DEMO-SCRIPT.md
零依赖，clone 后 node server.mjs 即可本地跑。
```

> 上面这段**故意**保留 `<...>` 占位符，且**不在** `xpost` 代码块里——它是账号相关的，不参与自动校验。

### 配图（不占字符预算，等于免费的长度）

X 的图片是附件，不计入权重。建议 4 张，按这个顺序：

| # | 图 | 怎么截 |
|---|---|---|
| 1 | Web 投研台首屏：左边问题框，右边信号板 | `node server.mjs` → 浏览器开 `http://127.0.0.1:4310` |
| 2 | **单卡档案**：证据账本 pass / fail / unverifiable 三色 + 五个因子逐条打分理由 | 卡片点开详情，或 `node prism.mjs card <id>` 截终端 |
| 3 | **隔离区**：一张因数字对不上出处而被拦下的卡 | `npm run validate` 的 ledger suite 跑的就是这个 |
| 4 | `node prism.mjs review` 的终端输出：headline 表 + 那条 BLOCKER | 直接截终端，别裁掉 caveat 部分 |

第 4 张是这条 thread 最有说服力的一张图：**一个 AI 投研工具公开自己 10 胜 24 负的判分记录，还把自己的打分规则标成 BLOCKER。** 截的时候不要裁掉「样本太小」那几行——裁掉了就从"诚实"变成"营销"。

---

## 7. 发布顺序与时间

| 时间 | 动作 |
|---|---|
| 截止前 ≥ 48h | 发布主帖（`a1`，或 `zh` thread 首条）。留足被官方账号看见、互动、转发的时间 |
| 主帖发出后 1 分钟内 | 自己回复带 Demo / GitHub 链接的那条（见 §6） |
| 同一天 | 补发 thread 剩余各条；有录屏的话挂在 thread 末尾 |
| 发布后 | **用无痕窗口 + 手机流量各打开一次推文**，确认未登录也能看到（表单里贴的链接评委可能是登出状态点的） |
| 填表单时 | 把**主帖** URL 粘进「X 传播推文链接」字段。发 thread 就填首条 |

⚠️ **不要删帖重发**——URL 会变，而表单里填的是旧 URL。要改就先在本地改草稿、跑 `npm run xpost`、再发。

⚠️ 公众投票窗口是 **9/22–9/28**，投票方式是「在官方投票推文评论区评论项目编号」。主帖发出后可以在自己的回复里补一条投票引导（项目编号官方截止后才公布，届时再补）。

---

## 8. 贴进表单前的自检

- [ ] `npm run xpost` 全绿（当前 **17/17 帖通过，86/86 检查通过**，报表 `docs/reports/x-posts.md`）
- [ ] 发的是**引用转发（Quote）**官方推文，不是纯转发（Retweet）
- [ ] 帖子里 `#BitgetHackathon` 和 `@Bitget_AI` 都是**可点击的蓝色链接**，不是纯文本（在发布框里删掉再重打一次 @ 和 # 才会触发解析）
- [ ] 至少 1 张配图；主帖发出后 1 分钟内已回复 Demo 链接
- [ ] 无痕窗口打开推文 URL 可见
- [ ] 表单「X 传播推文链接」字段填的是**主帖** URL

---

## 9. 不要这样写（这些说法会与仓库里的实测记录冲突）

本项目全部卖点建立在"每个数字都能被追责"上，宣发文案不能例外。以下几条**不能写**，因为 `docs/VALIDATION.md` 的「我们没有测的」一节明确说没测：

| 不能写 | 为什么 | 可以写成 |
|---|---|---|
| 「回测年化 X%」「Sharpe X」 | 没有做过扣费后组合回测，一个数字都没有 | 「两份真实价格事件研究，报表自动生成、可一键复现」 |
| 「胜率 29% 说明策略不行 / 很强」 | 决出胜负的只有 **34 条主张**，95% 置信区间 14–45%，比任何可能测出的效应都宽；且不含任何交易成本 | 「第一批判分：34 条决出胜负，10 胜 24 负——样本太小、未扣费，报告第一句就这么写」 |
| 「已接入 Bitget 实盘下单」 | 本项目是**只读投研台**，人类做最终决策；这正是赛道三的定位 | 「只读接入 Bitget MCP 行情与 Signal Skills，决策权留给人」 |
| 「rToken 盘口深度实测」 | 流动性系数 **0.45 是保守估算**，构建环境访问不到 Bitget 域名 | 「rToken 流动性系数当前是保守估算，接入真实盘口是路线图上第一项」 |
| 「CRVS / HLXN 财报显示…」 | 这五个发行主体**是虚构的**，语料是我们自己写的 | 「demo 语料里的发行主体是虚构的（这样正确答案才已知、可判分），价格数据是真实的」 |
| 「LLM 抽取准确率 X%」 | 双抽取器实现了、有测试，但**没做过**两条路径的系统性准确率对比 | 「规则路径与 LLM 路径并行、互相过同一个证据账本，系统性对比在路线图上」 |

**一条判断标准：** 如果一句话不敢在帖子里附上对应的 `docs/` 路径，就不要写。

---

## 10. 与表单的对应关系

- 「X 传播推文链接」字段 → 主帖 URL（`a1` 或 `zh-1` 发布后的链接）
- 「提交材料链接」字段 → 见 `SUBMISSION-FORM.md` §4
- 「项目说明」六段 → 见 `PROJECT-STATEMENT.md`

三者内容必须一致：帖子里说的数字、材料清单里列的文件、项目说明里的指标，指向的是同一批实测结果。评委交叉对不上，扣的是"研究质量"这一项。
