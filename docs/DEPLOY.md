# Deploy / 让 Demo 可公开访问

**赛道三必交项：Demo 可访问。** 本文给出从「本机跑通」到「公网可访问」的五条路径。

**本项目实际发布的是第 7 节那条** —— GitHub Pages 上的静态回放演示：https://lixinlin616-png.github.io/prism-desk/demo/ （点开即用，无需登录 / 安装 / key，也不会休眠）。第 3–6 节是带后端的完整实时版（能自由提问、能写入看板），其中第 4 节的 Render 一键部署最省事。

---

## 0. 先说清楚验证边界

本项目全部文档都区分**实测**与**未验证**，部署文档也不例外。下表是本仓库构建环境（无外网、无 docker）里**实际验证到什么程度**：

| 步骤 | 状态 |
|---|---|
| `node server.mjs` 本地启动、`/api/status` 返回 `ok:true` | ✅ **实测通过**（Node v24.21.0，offline 模式，价格库 41,386 bar、语料 14 篇全部加载） |
| `HOST` / `PORT` 环境变量被服务端识别 | ✅ **实测通过**（`PORT=4399` 时服务起在 4399） |
| SSE 反代不缓冲（`X-Accel-Buffering: no`） | ✅ 响应头**已实测发出**；上游代理是否尊重它 **未验证**（无外网） |
| `Dockerfile` 能否 build | ⚠️ **未验证** —— 构建环境没有 docker |
| Fly / Render / Railway 实际部署 | ⚠️ **未验证** —— 构建环境无外网 |
| cloudflared / ngrok 隧道 | ⚠️ **未验证** —— 同上；本机另试过 localhost.run：隧道能建、URL 能拿到，但访问被中断，**不作为提交材料** |
| `npm run export:static` 生成静态回放包 -> `docs/demo/` | ✅ **实测通过**（6 个场景 / 258 份卡片档案 / 2.87 MB，0.7 s 生成） |
| 静态回放包与引擎不漂移 | ✅ **实测通过**（`tests/static-demo.test.mjs` 14 项：路由覆盖、场景一致、看板 = fixture、复盘数字 = 已提交报表） |
| 静态回放包在真实 DOM 里跑得起来 | ✅ **实测通过**（本机 jsdom + 真实 HTTP 的 34 项端到端检查：启动 / 场景回放 / 卡片档案 / 复盘面板 / 两份研究 / 未知问题的替换提示 / 写入被拒；该脚手架是临时的，**未入库**） |
| GitHub Pages 实际发布（main + `/docs`） | ✅ **已发布** https://lixinlin616-png.github.io/prism-desk/demo/ |

这不是免责声明，是**你上线前必须自己走一遍的清单**。下面每条路径都附了验证命令与预期输出。

---

## 1. 运行时要求

| 项 | 值 |
|---|---|
| Node | **≥ 20**（`package.json` 的 `engines` 已声明；本环境实测 v24.21.0） |
| 第三方依赖 | **零**。没有 `npm install`，没有构建步骤，没有前端打包 |
| 唯一写入路径 | `data/state/board.json`（看板状态）。只读根文件系统的平台需挂卷，或用 `PRISM_STATE_FILE` 指到可写路径 |
| 出网 | **不需要**。`PRISM_DATA_MODE=offline` 完全离线；默认 `auto` 会试 Bitget MCP，失败自动降级到 fixture 并标注 origin |
| 内存 | 价格库 41,386 bar 常驻，量级 < 200 MB |
| 监听 | `PRISM_HOST` 或 `HOST`（默认 `127.0.0.1`）；`PRISM_PORT` 或 `PORT`（默认 `4310`） |

> ⚠️ **容器里 host 必须是 `0.0.0.0`。** 否则服务只在容器内部回环可达——健康检查会过，外部访问会超时，这是容器化最常见的一个坑。仓库里的 `Dockerfile` 已经设了 `PRISM_HOST=0.0.0.0`，同时服务端也认平台注入的 `HOST`/`PORT`。

> ℹ️ **看板状态是临时的，这是设计取舍。** 容器重启后 `data/state/` 会清空。本项目不依赖它：看板可以由固定回放计划**逐字节重建**——
> ```bash
> npm run seed        # 11 个固定 as-of 日期 × 6 个场景 -> data/fixtures/board-seed.json
> npm run review:seed # 从该 fixture 重新生成 docs/reports/review.md
> ```
> 两次 `npm run seed` 产出的文件 SHA-256 相同（**实测**）。所以「状态丢了」不影响任何已发布的数字。

---

## 2. 上线前 30 秒冒烟（本机）

```bash
node prism.mjs doctor                 # 数据接线自检
npm test                              # 208 / 208
npm run validate                      # 结构性 / 数据 / 研究质量检查
node server.mjs                       # 另开一个终端
```

```bash
curl -s http://127.0.0.1:4310/api/status
```

**预期**（实测节选）：

```json
{"ok":true,"hub":{"mode":"offline",
  "corpus":{"documents":14,"words":2599},
  "prices":{"symbols":25,"bars":41386,"from":"2019-01-02","to":"2025-09-30"},
  "llm":{"enabled":false}},
 "extractor":{"mode":"rules"},
 "config":{"dataMode":"offline","minScore":45}}
```

- [ ] `ok` 为 `true`
- [ ] `prices.bars` = **41386**，`prices.symbols` = **25**
- [ ] `corpus.documents` = **14**
- [ ] 浏览器打开 `http://127.0.0.1:4310`，左栏输入问题后 **trace 是逐条流出来的**，不是一次性刷出

最后一条是反向代理配置的试金石：本机流式、上线后不流式 = 代理在缓冲。见 §5。

---

## 3. 路径 A（推荐）· Docker

仓库根目录已有 `Dockerfile` 与 `.dockerignore`。`node:20-alpine` 基底，非 root 用户运行，`/api/status` 兼作 HEALTHCHECK。

```bash
docker build -t prism-desk .
docker run --rm -p 4310:4310 -e PRISM_DATA_MODE=offline prism-desk
curl -s http://127.0.0.1:4310/api/status | head -c 120
```

### Fly.io

```bash
fly launch --no-deploy --copy-config    # 生成 fly.toml，选一个 region
fly deploy
fly status
```

`fly.toml` 关键字段（**未在本环境验证**，按 Fly 当前文档核对）：

```toml
app = "prism-desk"
primary_region = "nrt"

[http_service]
  internal_port = 8080          # Fly 注入 PORT=8080，服务端已认 PORT
  force_https = true
  auto_stop_machines = false    # 别让它休眠：评委点开时不该等冷启动
  auto_start_machines = true

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

> `auto_stop_machines = false` 是刻意的。休眠实例的首次请求要等冷启动 + 加载 41k bar 价格库，评委的第一印象会变成"这玩意儿很慢"。

### 任意有 docker 的 VPS

```bash
docker run -d --name prism --restart unless-stopped \
  -p 127.0.0.1:4310:4310 \
  -e PRISM_DATA_MODE=offline \
  -v prism-state:/app/data/state \
  prism-desk
```

---

## 4. 路径 B（**最省事，推荐**）· Render / Railway

仓库根目录有 **`render.yaml` 蓝图**，所以这条路径不需要手填任何字段：

**[▶ 一键部署到 Render](https://render.com/deploy?repo=https://github.com/lixinlin616-png/prism-desk)**

点开后用 GitHub 登录 → Create，蓝图会自动设定 Runtime=Docker、Dockerfile 路径、Health Check=/api/status 以及三个环境变量。若你想手动建（New → Web Service → 连 GitHub 仓库），字段如下：

| 字段 | 填 |
|---|---|
| Runtime | **Docker**（仓库有 Dockerfile，Render 会自动用）；或 Node |
| Build Command | **留空** —— 没有依赖要装 |
| Start Command | `node server.mjs` |
| Health Check Path | `/api/status` |
| Env | `PRISM_DATA_MODE=offline`、`PRISM_HOST=0.0.0.0` |
| Disk | 不需要（状态可重建，见 §1） |

**Railway**：`railway init && railway up`，或从 GitHub 仓库一键创建，变量同上。

> ⚠️ **Render 免费实例 15 分钟无流量会休眠。** 冷启动要加载价格库，量级数秒。两件事必须做：
> 1. 表单里 Demo 链接旁边注明「首次加载约 5–10 秒」；
> 2. **提交前自己点一次**把实例唤醒，别把冷启动留给评委。
>
> 预算允许就升成付费实例关掉休眠——这是本项目性价比最高的一笔部署开销。

---

## 5. 路径 C · VPS + systemd + Caddy（自己可控、自动 HTTPS）

Caddy 自动签发并续期证书，是这类单机 Demo 最省心的组合。

`/etc/systemd/system/prism-desk.service`：

```ini
[Unit]
Description=Prism Desk
After=network.target

[Service]
Type=simple
User=prism
WorkingDirectory=/opt/prism-desk
Environment=PRISM_DATA_MODE=offline
Environment=PRISM_HOST=127.0.0.1
Environment=PRISM_PORT=4310
Environment=PRISM_STATE_FILE=/var/lib/prism-desk/board.json
ExecStart=/usr/bin/node /opt/prism-desk/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/prism-desk
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo install -d -o prism -g prism /var/lib/prism-desk
sudo systemctl daemon-reload && sudo systemctl enable --now prism-desk
systemctl status prism-desk --no-pager
```

`Caddyfile`：

```caddyfile
prism.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:4310 {
        flush_interval -1
    }
}
```

> 🔴 **`flush_interval -1` 不是可选的。** 没有它，Caddy 会缓冲上游响应，SSE trace 会在整轮研究跑完后一次性吐出来——Demo 里最直观的「AI 正在一步步想」的效果就没了。
>
> 服务端已经发出 `X-Accel-Buffering: no`（nginx / Caddy / Cloudflare 都尊重它），但**显式关掉缓冲更可靠**，别只依赖那个头。
>
> 用 nginx 的等价写法：
> ```nginx
> location / {
>     proxy_pass http://127.0.0.1:4310;
>     proxy_http_version 1.1;
>     proxy_buffering off;
>     proxy_cache off;
>     proxy_read_timeout 300s;
>     proxy_set_header Connection '';
> }
> ```

---

## 6. 路径 D · 临时隧道（只适合答辩当天）

```bash
# cloudflared：免注册、免账号，最快
cloudflared tunnel --url http://127.0.0.1:4310
# -> https://<随机>.trycloudflare.com

# 或 ngrok（需账号）
ngrok http 4310
```

> 🔴 **不要把隧道 URL 填进提交表单。** 隧道进程一停链接就死，你的机器还得一直开机联网。评委在 9/22–10/7 之间任意时刻点开，而隧道撑不了两周。
>
> 隧道的正确用途：**答辩 / Demo Day 现场**，或者在正式部署搞定之前先自测一遍公网访问行为（尤其是 SSE 有没有被缓冲）。

---

## 7. 路径 E（**本项目实际采用的**）· GitHub Pages 静态回放

**已发布：** https://lixinlin616-png.github.io/prism-desk/demo/

本文这一节原来写的是「静态托管不行」。那句话对**引擎**成立，对**录像**不成立 —— 而演示需要的恰恰是一段录像。所以现在的做法是：

```bash
npm run export:static              # 用真实离线引擎跑完六个场景 -> docs/demo/（已提交）
npm run export:static -- --serve   # 顺便在本机 4321 端口预览，看到的就是 Pages 会发的东西
```

`scripts/export-static.mjs` 启动的正是 `server.mjs` 启动的那条管线（同一个 hub、同一份语料、同一本价格库、同一块 `data/fixtures/board-seed.json` 看板），把每条 `/api/*` 路由**本来会返回的字节**录下来，包括 SSE 的每一个 stage 帧和帧间隔。`web/static-adapter.js` 在浏览器里拦下 `window.fetch`，用这份录像回答 `/api/*`，其余请求原样放行 —— 所以 `web/app.js` 一行都没改，它分不出差别。

| 静态回放**能**做 | 静态回放**做不到**（页面会明说） |
|---|---|
| 六个预置场景的全链路回放（PLAN → INGEST → EXTRACT → VERIFY → SCORE → PRESENT），trace 逐帧到达 | 跑一个**全新**的自由提问：没有引擎，只能回放最接近的预录任务，并在左下角提示"这是替换、匹配度多少" |
| 卡片档案与逐条证据账本、隔离原因、失效条件 | 写入：粘贴文档 / 清空看板返回 **409** 并说明理由，**不假装成功** |
| 看板（235 张卡 = 已提交 fixture）、watchlist、冲突标记 | 改 as-of 时钟：回放的永远是录制时钉死的那个 as-of，改了会提示被忽略 |
| 复盘面板（34 条已裁决 / 29.4% 命中 / rho −0.138，与 `docs/reports/review.md` 逐条一致） | LLM 双通道抽取（录像走的是确定性规则路径，和文档里的所有数字同源） |
| 两份真实价格事件研究、导出 board.csv / brief.md / review.md | 任何需要联网的实时数据 |

页面左下角有一枚**永久** `static replay` 徽标，写着数据来自真实引擎的离线录制、以及实时后端怎么起。一段录像最不能做的事就是冒充实时引擎，所以每一次替换、每一次拒绝都会显式说出来。

**发布（一次设置，之后每次 push 自动更新）：**

```bash
npm run export:static
git add docs web scripts tests && git commit -m "..." && git push
# 仓库 Settings -> Pages -> Source: Deploy from a branch -> main + /docs -> Save
# 或者用 API：
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/<owner>/prism-desk/pages \
  -d '{"source":{"branch":"main","path":"/docs"}}'
```

`docs/.nojekyll` 与 `docs/demo/.nojekyll` 必须存在（已提交）：少了它 Pages 会用 Jekyll 处理站点，下划线开头的目录会被吃掉。站点根 `docs/index.html` 是一页导航，裸地址 `.../prism-desk/` 落在那里，`.../prism-desk/demo/` 才是演示台。

**防漂移。** 录像是会过期的：改了场景、换了 fixture、加了路由，而忘记重新导出，演示就开始和仓库自相矛盾 —— 对这个项目来说是最难看的一种失败。所以 `tests/static-demo.test.mjs` 把这件事变成 `npm test` 的一部分：

- 服务端每个 `/api/*` 路由，录像必须**要么回答、要么显式拒绝**（路由表从 `server.mjs` 源码里提取，加路由不改适配器就红）；
- 录下来的 `scenarios` 必须与 `server.mjs` 导出的 `SCENARIOS` **深度相等**；
- 录下来的看板必须等于 `data/fixtures/board-seed.json`（235 张卡）；
- 录下来的复盘数字必须等于 `docs/reports/review.md` headline 表里的数字（235 / 115 / 34 / 29.4% / −0.138，直接从报表里正则读出来对比）；
- 适配器在一个 40 行的 DOM stub 里真跑一遍：SSE 帧数、stage 顺序、卡片数、账本数字、导出内容、409 拒绝、404 未知路由、非 API 请求放行。

录像里带导出时刻的字段（run id、`ms` 耗时、帧间隔、`review.summary.generatedAt`）在 `docs/demo/data/manifest.json` 的 `volatileFields` 里列全了；其余语义字段逐字节确定。

> ⚠️ **它不替代后端。** 赛道三要求的是"完整投研任务的演示"，录像满足"演示"；但评委想**自己提一个问题**，就必须有第 3–6 节里任意一条带后端的路径。报名表里两者都给。

**兜底方案仍然保留：** `docs/DEMO-TRANSCRIPT.md`（六个场景的完整原始输出，自动生成）挂在仓库里，万一演示地址不可达，表单里注明「完整逐字输出见此」。

---

## 8. 部署相关环境变量

| 变量 | 默认 | 部署时怎么设 |
|---|---|---|
| `PRISM_HOST` / `HOST` | `127.0.0.1` | 容器里设 `0.0.0.0`；VPS + 反代设 `127.0.0.1`（只让 Caddy 访问） |
| `PRISM_PORT` / `PORT` | `4310` | PaaS 会注入 `PORT`，服务端已认，**不要**硬编码 |
| `PRISM_DATA_MODE` | `auto` | 公开 Demo 建议 `offline`，见 §9 |
| `PRISM_STATE_FILE` | `data/state/board.json` | 只读根文件系统时指到挂载卷，如 `/var/lib/prism-desk/board.json` |
| `PRISM_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | 未设 | **公开 Demo 建议不设**：走确定性规则路径，行为可复现、零成本、不会因为 key 额度耗尽而变慢 |
| `PRISM_MIN_SCORE` | `45` | 发布门槛，别在 Demo 环境改——文档里所有分数都基于 45 |

> 🔑 **key 放平台的环境变量/secret，不要提交 `.env`。** `.gitignore` 已经排除了 `.env` 和 `.env.*`（保留 `.env.example`）。

---

## 9. 数据模式怎么选

| 场景 | 建议 | 理由 |
|---|---|---|
| **公开 Demo**（评委随机访问） | `offline` | 完全确定、零外部依赖。不会因为 Bitget 端点抖动而两次给出不同答案——那会直接砸掉「可复现」这个核心卖点 |
| 想展示真实 Bitget MCP 接入 | `auto` | 拿得到就用真的，拿不到自动降级，且**每个快照都标 origin**，评委能看出哪个数字来自真实端点 |
| 录视频 / 答辩现场 | `offline` | 不要在台上赌网络 |
| `live` | **不要用于公开 Demo** | 拿不到端点就报错，评委看到的是一个错误页 |

---

## 10. 上线后验证（必做，别跳过）

```bash
D=https://<your-demo-domain>

curl -s $D/api/status | head -c 200; echo
curl -s -X POST $D/api/ask -H 'content-type: application/json' \
  -d '{"question":"full desk sweep - what is actually tradeable right now?"}' \
  | head -c 300; echo
curl -s $D/api/review | head -c 200; echo
curl -s $D/api/export/review.md | head -20
```

- [ ] `/api/status` 的 `ok` 为 `true`，`prices.bars` = 41386
- [ ] `/api/ask` 返回卡片（不是 500）
- [ ] `/api/review` 与 `/api/export/review.md` 可读，且 headline 数字与仓库里 `docs/reports/review.md` **一致**
- [ ] **无痕窗口**打开首页可用（评委可能是登出状态）
- [ ] **手机流量**打开首页可用（不是只在公司/家里网络可达）
- [ ] Web UI 提问后 trace **逐条流式**出现 —— 不是的话回到 §5 关掉代理缓冲
- [ ] 冷启动时间可接受；不行就在表单里注明首次加载耗时

> 最后一条「headline 数字一致」值得单独强调：如果线上 `/api/review` 和仓库里的报表对不上，说明线上跑的是一个**累积过其它请求**的看板。清空 `data/state/` 重启，或用 `--board=data/fixtures/board-seed.json` 对齐。

---

## 11. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 容器起来了但外部连不上 | host 还是 `127.0.0.1` | 设 `PRISM_HOST=0.0.0.0`（或 `HOST=0.0.0.0`） |
| PaaS 报「端口未监听」 | 平台注入 `PORT` 而服务监听 4310 | 服务端已认 `PORT`；检查平台 internal port 配置是否与实际一致 |
| trace 不流式，最后一次性出现 | 反向代理缓冲 | Caddy `flush_interval -1` / nginx `proxy_buffering off`，见 §5 |
| 重启后看板空了 | `data/state/` 是临时文件系统 | 正常。挂卷，或 `npm run seed` 重建（§1） |
| `/api/review` 说没有可裁决的卡 | 看板是空的 | 先跑一次 demo 或用 `--board=data/fixtures/board-seed.json` |
| EACCES 写 `data/state` | 只读根文件系统 | `PRISM_STATE_FILE` 指到可写路径，并把该路径加进 `ReadWritePaths` |
| 首次请求特别慢 | 冷启动要解析 41,386 bar CSV | 关掉自动休眠；或在反代层加一个定时 `/api/status` 探活保温 |
| 想接真 Bitget 数据但失败 | 出网被限制 / 端点不可达 | 用 `auto`（会自动降级并标 origin），别用 `live` |

---

## 12. 与提交材料的关系

- 表单「提交材料链接」第 1 项 = 按本文部署出来的**公网 URL**
- 部署完成后，把 URL 回填进 `SUBMISSION-FORM.md` §4 与 `X-POSTS.md` §6 的自回复
- 三处 URL 必须是**同一个**：表单、X 帖回复、README 顶部
