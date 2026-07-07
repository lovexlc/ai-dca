# ai-dca

`ai-dca` 是一个面向基金、ETF 和个人持仓的策略工作台，当前仓库主要包含：

- React 前端工作台：行情中心、持仓总览、交易计划、基金切换、通知管理。
- Cloudflare Workers：
  - `markets`：行情、K 线、基金指标、新闻/财务数据、行情 AI 能力入口。
  - `notify`：Bark / Server酱³ / PC WebSocket 推送、规则同步、定时事件、切换信号。
  - `ocr-proxy`：截图 OCR、持仓 NAV、基金限购扫描。
  - `sync`：登录、加密云同步、分析事件、管理端统计。
  - `markets-agent`：行情研究/回测相关的内部 Agent Worker + Container。
  - `apex-redirect`：旧 `tools.freebacktrack.tech` 域名跳转。
- 数据抓取、静态页面发布、知识库构建脚本。

旧 Android GCM/FCM 推送接收端已废弃，不再维护：

- `ai-dca-android-notify`（deprecated）

## 功能概览

控制台左侧主菜单默认进入「行情中心」。当前主菜单为：

- **行情中心** `markets`
  - A 股 / 美股自选、行情搜索、指数、热点、新闻、财务和基金详情。
  - 场内 ETF 溢价、场外基金净值、申购费率、限购信息。
  - 标的详情侧边栏支持切换策略回测，并可从基金切换页一键带参数打开。
- **持仓总览** `holdings`
  - 手工交易、截图 OCR、持仓聚合、收益拆分和切换交易配对。
  - 持仓 NAV / 实时价格刷新，支持 A 股 / 港股 / QDII 分桶。
  - 今日信号、快捷交易、收益明细、清仓分析、持仓分析、交易记录。
- **交易计划** `tradePlans`
  - 建仓、定投、卖出、VIX 信号和回测工具集中在同一页。
  - 旧 `home` / `dca` 入口会重定向到该 tab 的二级视图。
- **基金切换** `fundSwitch`
  - H/L 分组、worker 自动监控、手动运行、切换信号和快捷记录。
  - 历史切换收益复盘：从持仓账本里的 SELL/BUY 配对推导切换链路。
  - 可从顶部 banner 或当前规则按钮跳到行情中心回测切换策略。
- **通知设置** `notify`
  - 提醒规则同步、测试通知按钮、最近提醒记录。
  - Bark / Server酱³ / PC 浏览器实时通道。
  - 持仓晚盘通知 20:30 / 21:30 统一全量推送（in + out + 总览），支持 `body_md`。

账户菜单里保留登录、加密云同步、冲突合并和本地备份预览能力；它不再是独立主 tab。管理员账号会额外看到「数据」入口。

## 目录结构

```text
src/
  pages/                React 主 tab（MarketsExperience、HoldingsExperience、TradePlansExperience、
                        FundSwitchExperience、NotifyExperience、WorkspacePage 等）
  components/
    console-layout.jsx  多 tab 控制台外壳
  app/                  路由 / tab 注册 / 共享逻辑
workers/
  markets/              行情、K 线、基金指标、新闻/财务数据 Worker
  markets-agent/        行情研究/回测 Agent Worker + Container
  ocr-proxy/            OCR / 持仓 NAV / 限购 Worker
  notify/               推送、规则同步、cron、WsHub Durable Object
  sync/                 登录、加密云同步、分析事件 Worker
  apex-redirect/        旧 tools 域名跳转 Worker
scripts/
  build_kb.mjs          构建知识库 → 写入 Vectorize
  publish_react_pages.mjs
docs/                   静态站点产物 + 架构 / 运维文档
.github/workflows/      GitHub Actions（Pages、Workers、知识库、Playwright）
.frontend-build/        本地构建中间产物（git ignored）
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

常用检查：

```bash
npm run check:refactor
npm run lint
npm run test:e2e:smoke
```

## 行情与净值

运行时行情/净值统一走 Worker：

- 场内基金/ETF：`markets` Worker 从雪球等数据源获取。
- 场外基金：`markets` / `notify` 链路从蛋卷等数据源获取。
- 纳指候选池和 QDII 识别表内置在 `src/app/nasdaqCatalog.js`、`src/app/qdiiFundCodes.js`。

## Worker 开发

本地调试：

```bash
npm run worker:dev          # ocr-proxy（端口 8787）
npm run worker:notify:dev   # notify（端口 8788）
npm run worker:markets:dev  # markets（端口 8790）
npx wrangler dev --config workers/sync/wrangler.toml --port 8789
```

> 部署不要在本机执行 `npx wrangler deploy`。GitHub Actions 是 worker 部署的唯一来源，凭证只存在仓库 Actions secrets 里。详细规约见
> [`docs/ops/notify-worker-deploy.md`](docs/ops/notify-worker-deploy.md)。

更细的 Worker 说明：

- [workers/README.md](workers/README.md)
- [workers/ocr-proxy/README.md](workers/ocr-proxy/README.md)
- [workers/notify/README.md](workers/notify/README.md)
- [workers/markets-agent/README.md](workers/markets-agent/README.md)
- 实时通道架构：[docs/architecture/realtime-channel.md](docs/architecture/realtime-channel.md)
- QDII NAV 规则：[docs/reference/qdii-nav-rules.md](docs/reference/qdii-nav-rules.md)

## Worker API 一览

域名：

- 主站：`https://freebacktrack.tech`
- Worker API：`https://api.freebacktrack.tech`
- 旧工具域名：`https://tools.freebacktrack.tech`，当前 302 到主站并保留 path/query

### `markets`

| 路径 | 用途 |
| --- | --- |
| `GET /api/markets/health` | 健康检查 |
| `GET /api/markets/search` `quote` `quotes` `kline` | 搜索、报价、批量报价、K 线 |
| `GET /api/markets/fund-metrics` | 场内/场外基金指标、净值、溢价 |
| `GET /api/markets/news` `financials` `earnings` | 新闻、财务、财报日历 |
| `POST /api/markets/ai/*` | 行情 AI / 深度研究相关入口 |

### `notify`

| 路径 | 用途 |
| --- | --- |
| `GET/POST /api/notify/status` `events` `sync` `test` `settings` | 通知规则与测试 |
| `POST /api/notify/run` | 手动触发推送循环 |
| `GET/POST /api/notify/holdings-rule` | 持仓规则读写 |
| `GET/POST /api/notify/switch/{config,snapshot,run}` | 切换信号配置 / 快照 / 触发 |
| `POST /api/notify/admin/holdings-all-test` | 持仓全量推送的管理员触发（需 token） |
| `POST /api/notify/quick/*`，`/api/notify/bark/:key/...` | 快捷推送 / Bark 风格路由 |
| `WS /api/notify/ws/*` | 实时频道（WsHub Durable Object，ntfy/Gotify 风格） |

### `ocr-proxy`

| 路径 | 用途 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `POST /api/ocr` | 通用截图 OCR |
| `POST /api/holdings/ocr` | 持仓截图识别（结构化解析） |
| `GET /api/holdings/nav` | 持仓 NAV（A 股 / 港股 / QDII 分桶动态 TTL，支持 `?force=1` / `?refresh=1`） |
| `GET /api/fund-limit?code=` | 基金限购扫描·单 code |
| `POST /api/fund-limit` | 基金限购扫描·批量 |

### `sync`

| 路径 | 用途 |
| --- | --- |
| `POST /api/sync/register` `login` | 账户注册 / 登录 |
| `GET/PUT /api/sync/backup` | 加密云同步数据读写 |
| `POST /api/sync/events` | 前端分析事件 |
| `GET /api/sync/admin/analytics` | 管理端统计（管理员 token） |

## 知识库

- 知识库（Cloudflare Vectorize 索引 `ai-dca-kb`，1024 维 cosine）由 `scripts/build_kb.mjs` 生成。
- 触发：手动跑 GitHub Actions「Build AI knowledge base」工作流，或在涉及文档路径的 push 上自动触发。
- 索引数据来源：仓库根 `README.md`、`AGENTS.MD`、`docs/**`、`workers/README.md` 等。
- 本地调试可跑：

```bash
npm run kb:build
```

需要 `.env.local` 中提供 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`（含 Vectorize:Edit + Workers AI:Read 权限）。

## 部署

- **前端生产站**：主域 `freebacktrack.tech` 灰云直连香港 Nginx，`.github/workflows/deploy-hk-frontend.yml` 在 `main` push 后构建 `.frontend-build` 并通过 SSH 发布到 `/var/www/ai-dca-hk`。
- **国内前端站**：`https://cn.freebacktrack.tech:5000` 灰云直连 Bohrium Nginx，`.github/workflows/deploy-cn-frontend.yml` 发布到 `/var/www/ai-dca-cn`。
- **markets worker**：`deploy-worker-markets.yml`。
- **markets-agent worker**：`deploy-worker-markets-agent.yml`。
- **ocr-proxy worker**：`deploy-worker-ocr-proxy.yml`。
- **notify worker**：`deploy-worker-notify.yml`。
- **sync worker**：`deploy-worker-sync.yml`。
- **apex redirect worker**：`deploy-worker-apex-redirect.yml`。
- **知识库**：`build-knowledge-base.yml`。

Worker 改动的回报必须附四件证据：本地路径行号、commit SHA + 以 SHA 固定的 raw 链接、GitHub Actions run URL（success）、Worker `Current Version ID`。详见
[`docs/ops/notify-worker-deploy.md`](docs/ops/notify-worker-deploy.md)。

## 备注

- 旧 Android GCM/FCM app 已废弃；当前通知通道为 Bark、Server酱³ 和 PC WebSocket。
- 旧 `home` / `dca` / `quant*` 入口会映射到当前工作台，不再作为主菜单存在。
- 时区：所有时间戳一律渲染为 Asia/Shanghai（UTC+8）。

## 社区支持

感谢 [LinuxDo](https://linux.do/) 各位佬的支持。欢迎加入 LinuxDo，这里有技术交流、AI 前沿资讯和实战经验分享。
