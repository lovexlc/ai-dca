# ai-dca

`ai-dca` 是一个面向纳指相关基金/ETF 的策略看板项目，当前仓库主要包含：

- React 前端工作台（多 tab 控制台 + 持仓 / 计划 / 切换 / 通知 / 备份）
- Cloudflare Worker：
  - `ocr-proxy` — OCR/识别代理、持仓 NAV、限购扫描、AI 问答（RAG）
  - `notify` — 推送（FCM / Bark / Gotify）、规则同步、定时事件、实时 WS 通道
  - `webdav-cors-proxy` — 备份页用的 WebDAV CORS 代理
- 数据抓取与静态页面发布脚本
- 知识库构建脚本（写入 Cloudflare Vectorize，供 AI 助手检索）

Android 推送接收端已经拆分到独立仓库，不再放在本项目内：

- `ai-dca-android-notify`

## 功能概览

控制台左侧主菜单（默认进入「持仓总览」）：

- **持仓总览** `holdings`
  - 截图 OCR → 内联可编辑预览 → 一键写入持仓
  - 持仓 NAV 实时刷新（A 股 / 港股 / QDII 分桶，A 股假期感知 NAV 预期日期，节后跨度「累 N 日」角标）
  - 右上角迷你大盘指数滚动 ticker
  - 场外 / QDII 限购信息直接渲染在卡片上
- **交易计划中心** `tradePlans`（合并了原来的 Home / DCA 两个二级 tab）
  - 首页：策略汇总、价格走势、建仓层级、资金配置模型、策略列表
  - 新建建仓计划：均线分层 / 固定回撤策略
  - 定投计划：固定金额定投，或关联加仓策略后按周期总预算分批执行
- **基金切换收益分析** `fundSwitch`
  - Worker 端统一信号计算（前端不再各算各的）
  - 按 fund-class 配对的 H/L 候选 + 单卡片渲染 benchmark + candidates
  - 持仓中的场内 ETF 自动加入 benchmark；纳指池在 H/L 双非空时自动收纳
  - 全部场外纳指 100 基金按基金公司分组展示
- **交易历史** `history`
  - 历史成交记录、策略命中、复盘
- **通知设置** `notify`
  - 提醒规则同步、测试通知按钮、最近提醒记录
  - FCM / Bark / Gotify 多通道；Android 端通过 `deviceInstallationId` 直绑（已弃用配对码）
  - 持仓晚盘通知 20:30 / 21:30 统一全量推送（in + out + 总览），支持 `body_md`
- **数据同步 / 备份** `backup`
  - WebDAV 备份 / 恢复（通过 `webdav-cors-proxy` worker 转发 CORS）
- **AI 助手**（右下角悬浮入口，Plus 体验）
  - 基于 Cloudflare Vectorize（`ai-dca-kb`，1024 维 cosine）+ bge-m3 嵌入 + `@cf/meta/llama-3.1-8b-instruct` 推理
  - 检索 README / `docs/**` / `AGENTS.MD` 等仓库文档，回答附引用来源
  - 自动带上当前 tab 的页面上下文（`pageContext`）

## 目录结构

```text
src/
  pages/                React 主 tab（HoldingsExperience、TradePlansExperience、FundSwitchExperience、
                        HistoryExperience、NotifyExperience、BackupExperience、WorkspacePage 等）
  components/
    ai-chat/            右下角 AI 问答悬浮窗
    console-layout.jsx  多 tab 控制台外壳
  app/                  路由 / tab 注册 / 共享逻辑
workers/
  ocr-proxy/            OCR / 持仓 NAV / 限购 / AI 问答（RAG） Worker
  notify/               推送、规则同步、cron、WsHub Durable Object
  webdav-cors-proxy/    备份页用 WebDAV CORS 代理
scripts/
  build_kb.mjs                  构建知识库 → 写入 Vectorize
  fetch_nasdaq_etf_daily_sina.mjs   纳指基金/ETF 日线
  fetch_etf_latest_nav.mjs          ETF 最新 NAV
  fetch_market_indices.mjs          大盘指数滚动 ticker 数据源
  fetch_nasdaq100_benchmark.py      纳指 100 基准
  fetch_nasdaq_etf_minute.py        纳指 ETF 分钟线
  publish_react_pages.mjs           前端静态产物发布
data/                 本地数据文件（含 all_nasdq_otc.json 等）
docs/                 静态站点产物 + 架构 / 运维文档（`architecture/`, `ops/`）
.github/workflows/    GitHub Actions（Pages、ocr-proxy、notify、Build KB 等）
.frontend-build/      本地构建中间产物（git ignored）
```

## 本地开发

要求：

- Node.js 20+（wrangler 锁 v3，需要 Node 22+ 的 wrangler v4 暂不升）
- npm
- Python 3
- 可选：Wrangler，用于本地调试 Worker

安装依赖：

```bash
npm install
```

启动前端开发环境：

```bash
npm run dev
```

构建前端：

```bash
npm run build:app
```

构建并发布静态页面产物：

```bash
npm run build
```

## 数据相关命令

```bash
npm run data:fetch-nasdaq-daily        # 纳指基金/ETF 日线
npm run data:fetch-nasdaq-benchmark    # 纳指 100 基准
npm run data:fetch-market-indices      # 持仓页右上角大盘指数 ticker 数据
```

## Worker 开发

本地调试：

```bash
npm run worker:dev          # ocr-proxy（端口 8787）
npm run worker:notify:dev   # notify（端口 8788）
npm run worker:webdav:dev   # webdav-cors-proxy（端口 8789）
```

> ⚠️ 部署不要在本机执行 `npx wrangler deploy`。GitHub Actions 是 worker 部署的唯一来源，凭证只存在仓库 Actions secrets 里。详细规约见
> [`docs/ops/notify-worker-deploy.md`](docs/ops/notify-worker-deploy.md)。

对应环境变量示例见：

- [workers/ocr-proxy/.dev.vars.example](workers/ocr-proxy/.dev.vars.example)
- [workers/notify/.dev.vars.example](workers/notify/.dev.vars.example)

更细的 Worker 说明：

- [workers/ocr-proxy/README.md](workers/ocr-proxy/README.md)
- [workers/notify/README.md](workers/notify/README.md)
- 实时通道架构：[docs/architecture/realtime-channel.md](docs/architecture/realtime-channel.md)
- QDII NAV 规则：[docs/qdii-nav-rules.md](docs/qdii-nav-rules.md)

## Worker API 一览

域名：`tools.freebacktrack.tech`

### `ocr-proxy`

| 路径 | 用途 |
| --- | --- |
| `GET  /api/health` | 健康检查 + 当前 prompt 版本 |
| `POST /api/ocr` | 通用截图 OCR |
| `POST /api/holdings/ocr` | 持仓截图识别（结构化解析） |
| `GET  /api/holdings/nav` | 持仓 NAV（A 股 / 港股 / QDII 分桶动态 TTL，支持 `?force=1` / `?refresh=1`） |
| `POST /api/fund-limit` | 基金限购扫描（公告 → F10 → detail 多层回退 + KV 缓存 + LLM 抽取） |
| `POST /api/ai-chat` | AI 助手（Vectorize RAG + llama-3.1-8b） |

### `notify`

| 路径 | 用途 |
| --- | --- |
| `GET/POST /api/notify/status` `events` `sync` `test` `settings` | 通知规则与测试 |
| `POST /api/notify/gcm/{register,check,pair,unpair,unpair-from-device,pairing-key}` | Android FCM 配对（已主用 `deviceInstallationId`） |
| `POST /api/notify/run` | 手动触发推送循环 |
| `GET/POST /api/notify/holdings-rule` | 持仓规则读写 |
| `GET/POST /api/notify/switch/{config,snapshot,run}` | 切换信号配置 / 快照 / 触发 |
| `POST /api/notify/admin/holdings-all-test` | 持仓全量推送的管理员触发（需 token） |
| `POST /api/notify/quick/*`，`/api/notify/bark/:key/...` | 快捷推送 / Bark 风格路由 |
| `WS   /api/notify/ws/*` | 实时频道（WsHub Durable Object，ntfy/Gotify 风格） |

## AI 助手与知识库

- 知识库（Cloudflare Vectorize 索引 `ai-dca-kb`，1024 维 cosine）由 `scripts/build_kb.mjs` 生成。
- 触发：手动跑 GitHub Actions「Build AI knowledge base」工作流，或在涉及文档路径的 push 上自动触发。
- 索引数据来源：仓库根 `README.md`、`AGENTS.MD`、`docs/**`、`workers/README.md` 等。
- 本地调试可跑：
  ```bash
  npm run kb:build
  ```
  需要 `.env.local` 中提供 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`（含 Vectorize:Edit + Workers AI:Read 权限）。
- 前端入口：`src/components/ai-chat/ai-chat-widget.jsx`，通过 `POST /api/ai-chat` 调用 worker，回答附引用来源（`sources[]`）。

## 部署

- **GitHub Pages**：由 `.github/workflows/` 中的 Pages workflow 构建发布，本地不要手动 `npm run build` 当作发布。
- **ocr-proxy worker**：`Deploy ocr-proxy worker` workflow（`cloudflare/wrangler-action@v3`）。
- **notify worker**：`Deploy notify worker` workflow。
- **知识库**：`Build AI knowledge base` workflow。

Worker 改动的回报必须附四件证据：本地路径行号、commit SHA + 以 SHA 固定的 raw 链接、GitHub Actions run URL（success）、Worker `Current Version ID`。详见
[`docs/ops/notify-worker-deploy.md`](docs/ops/notify-worker-deploy.md)。

## 备注

- 仓库目录名当前仍可能为 `ai-dca-stragety`，但项目语义上就是 `ai-dca`
- Android app 已迁移到独立仓库，后续移动端推送侧变更应在 `ai-dca-android-notify` 中维护
- 时区：所有时间戳一律渲染为 Asia/Shanghai（UTC+8）

## 社区支持

感谢 [LinuxDo](https://linux.do/) 各位佬的支持。欢迎加入 LinuxDo，这里有技术交流、AI 前沿资讯和实战经验分享。
