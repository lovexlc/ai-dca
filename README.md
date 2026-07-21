# ai-dca

面向基金、ETF、股票和个人持仓的 local-first 投资策略工作台。

项目以 React 单页应用为入口，覆盖行情研究、持仓账本、交易计划、基金切换和多通道通知；后端由多个 Cloudflare Worker 分别承担行情、OCR、通知、加密同步与深度研究能力。

## 功能

| 模块 | 能力 |
| --- | --- |
| 行情中心 `markets` | A 股 / 美股自选、搜索、指数、基金指标、K 线、新闻、财务数据和切换策略回测 |
| 持仓总览 `holdings` | 手工交易、截图 OCR、持仓聚合、NAV / 实时价格、收益拆分、清仓分析和交易记录 |
| 交易计划 `tradePlans` | 建仓、定投、卖出、VIX 信号和回测工具 |
| 基金切换 `fundSwitch` | H/L 分组、规则监控、切换信号、快捷记录和历史收益复盘 |
| 通知设置 `notify` | Bark、Server酱³、PC WebSocket、规则同步和晚盘持仓通知 |

账户菜单提供登录、端到端加密云同步、冲突合并和本地备份预览。管理员账号会额外显示数据看板。

旧 `home`、`dca` 和 `quant*` 地址仍可访问，但会映射到当前工作台。旧 Android GCM/FCM 接收端已经废弃。

## 技术栈

- React 19、Vite、Tailwind CSS 4
- Radix UI、TanStack Table、Recharts、GSAP
- Cloudflare Workers、KV、R2、D1、Durable Objects、Workers AI、Containers
- Node.js test runner、Playwright、ESLint
- Capacitor Android

## 架构

```text
Browser / React SPA
  ├─ localStorage        持仓、计划、自选、偏好和同步元数据
  ├─ markets Worker      报价、基金指标、K 线、新闻、财务和 AI 问答
  │    ├─ KV             quote、列表增强字段等小对象
  │    ├─ R2             完整 K 线等大对象
  │    └─ markets-agent  深度研究 Worker + Container
  ├─ ocr-proxy Worker    截图 OCR、持仓 NAV、净值历史和基金限购
  ├─ notify Worker       规则计算、cron、Bark / Server酱³ / WebSocket
  └─ sync Worker         登录、加密备份、分析事件和管理统计
       ├─ D1             用户、会话、备份版本和分析元数据
       └─ KV             客户端加密后的备份 envelope
```

用户投资数据以浏览器本地数据为主。云同步在客户端使用 PBKDF2 + AES-GCM 加密后上传，安全密码和明文投资数据不会交给同步 Worker。

### 行情数据边界

行情链路遵循由近到远的缓存顺序：

```text
组件 inflight / memory
  -> localStorage 列表增强缓存
  -> Worker KV 小对象
  -> R2 完整历史对象
  -> 外部行情源
```

- 列表页只请求 `/quotes` 和当前可见列所需的轻量增强数据。
- 当前列表和可见行由 `useVisibleMarketSymbols` 控制，隐藏列不会触发对应请求。
- 单标的和批量报价共用 `quote:<code>` KV key。
- 完整 K 线保存在 R2；列表只读取 `kline-high:<market>:<symbol>:1d` 等 KV 小对象。
- K 线、净值历史、财务数据和深度研究在用户选中标的后按需加载。
- 非核心字段缓存缺失时降级显示，不通过重接口同步兜底。

修改行情请求或缓存策略前，请先阅读 [AGENTS.md](AGENTS.md)。

## 目录

```text
src/
  app/                    领域逻辑、客户端 API、存储、加密与同步
  components/             通用组件和控制台外壳
  pages/                  主工作区及其拆分模块
workers/
  markets/                行情、K 线、基金指标、新闻和财务数据
  markets-agent/          深度研究 Worker + Container
  notify/                 通知规则、cron 和 WsHub Durable Object
  ocr-proxy/              OCR、持仓 NAV、净值历史和限购
  sync/                   账户、加密同步和分析事件
  apex-redirect/          旧 tools 域名重定向
scripts/                  结构检查、诊断、发布和知识库构建
test/                     Node.js 单元、集成测试和 Playwright 端到端测试
docs/                     架构、设计、运维和参考文档
.github/workflows/        测试及生产部署流程
```

大型页面只负责调度。新逻辑应继续下沉到 `src/pages/<domain>/` 或 `src/app/`；`npm run check:refactor` 会检查文件行数预算和模块边界。

## 快速开始

要求：

- Node.js 20+
- npm
- 调试 Cloudflare Worker 时使用 Wrangler；仓库多数 Worker 固定 Wrangler 3，`markets-agent` 部署使用 Wrangler 4

安装并启动前端：

```bash
npm install
npm run dev
```

Vite 默认使用 `http://localhost:5173`，并把未单独配置的 `/api/*` 请求代理到 `CF_WORKER_DEV_ORIGIN`（默认 `http://127.0.0.1:8787`）。可按环境分别设置：

```dotenv
VITE_API_ORIGIN=https://api.example.com
VITE_MARKETS_API_ORIGIN=https://markets.example.com
VITE_NOTIFY_API_ORIGIN=https://notify.example.com
VITE_SYNC_API_ORIGIN=https://sync.example.com
```

PostHog 等可选配置见 [.env.example](.env.example)。

常用命令：

```bash
npm run build:app          # 构建到 .frontend-build
npm run build              # 结构检查 + 前端构建
npm run check:refactor     # 检查大型模块和拆分边界
npm run lint -- --quiet    # 前端静态检查
npm run test:e2e:smoke     # Chromium 冒烟测试
node --test                # Node.js 测试套件
```

运行单个或一组测试：

```bash
node --test test/marketsApi.test.mjs
node --test test/quoteCache.test.mjs test/klineHighPoint.test.mjs
```

涉及行情调用、缓存或列表字段时，测试必须同时覆盖成功路径和“不会调用重接口”的负向路径。

## Worker 本地开发

```bash
npm run worker:dev          # ocr-proxy，http://localhost:8787
npm run worker:notify:dev   # notify，http://localhost:8788
npx wrangler dev --config workers/sync/wrangler.toml --port 8789
npm run worker:markets:dev  # markets，http://localhost:8790
```

Worker 说明：

- [Workers 总览](workers/README.md)
- [OCR 与 NAV](workers/ocr-proxy/README.md)
- [通知 Worker](workers/notify/README.md)
- [行情研究 Agent](workers/markets-agent/README.md)
- [实时通道架构](docs/architecture/realtime-channel.md)
- [QDII NAV 规则](docs/reference/qdii-nav-rules.md)

> 生产部署只通过 GitHub Actions 执行，不要在本机运行生产 `wrangler deploy`。部署凭证只存放在 GitHub Actions secrets。具体证据要求见 [Worker 部署规约](docs/ops/notify-worker-deploy.md)。

## API 概览

| 服务 | 主要路径 | 用途 |
| --- | --- | --- |
| markets | `GET /api/markets/health` | 健康检查 |
| markets | `GET /api/markets/search`、`quote/:symbol`、`quotes` | 搜索、单标的和批量报价 |
| markets | `GET /api/markets/kline/:symbol`、`fund-metrics` | K 线、净值、溢价和基金指标 |
| markets | `GET /api/markets/news`、`financials/:symbol`、`earnings` | 新闻、财务和财报日历 |
| markets | `POST /api/markets/ask`、`ask/stream` | 普通问答和流式深度研究 |
| notify | `GET/POST /api/notify/status`、`events`、`sync`、`settings` | 通知状态、事件和规则同步 |
| notify | `GET/POST /api/notify/holdings-rule`、`switch/*` | 持仓与基金切换规则 |
| notify | `POST /api/notify/quick/*`、`/api/notify/bark/:key/*` | 快捷推送和 Bark 风格路由 |
| notify | `WS /api/notify/ws/*` | PC 实时通知和行情频道 |
| ocr-proxy | `POST /api/ocr`、`/api/holdings/ocr` | 通用截图和持仓截图识别 |
| ocr-proxy | `GET /api/holdings/nav`、`nav-history` | 持仓净值和区间净值历史 |
| ocr-proxy | `GET/POST /api/fund-limit` | 基金限购读取和刷新 |
| sync | `POST /api/sync/register`、`login` | 账户注册和登录 |
| sync | `GET/PUT /api/sync/backup` | 加密云备份读取和写入 |
| sync | `POST /api/sync/events`、`GET /api/sync/admin/analytics` | 分析事件和管理员统计 |

生产域名：

- 主站：<https://freebacktrack.tech>
- Worker API：<https://api.freebacktrack.tech>
- 旧工具域名：<https://tools.freebacktrack.tech>，保留 path/query 并重定向到主站

所有面向用户的时间均按 `Asia/Shanghai`（UTC+8）解释和展示；Cloudflare cron 表达式仍使用 UTC。

## 部署

| 环境 / 服务 | 触发与目标 |
| --- | --- |
| 香港生产前端 | `main` 分支经 `deploy-hk-frontend.yml` 构建，通过 SSH 发布到香港 Nginx |
| 国内前端 | 经 `deploy-cn-frontend.yml` 构建，通过 SSH 发布到 Bohrium Nginx |
| 测试前端 | `test` 分支经 `deploy-test-frontend.yml` 发布到 Cloudflare Pages |
| 测试 Workers | `test` 分支经 `deploy-test-workers.yml` 部署并验证四组 Worker 路由 |
| 生产 Workers | 各 `deploy-worker-*.yml` 按相关路径变更独立部署 |
| 知识库 | `build-knowledge-base.yml` 构建并写入 Vectorize |

Worker 改动的交付记录必须包含：本地路径行号、commit SHA 和固定到该 SHA 的 raw 链接、成功的 GitHub Actions run URL、Worker `Current Version ID`。

## 知识库

`scripts/build_kb.mjs` 会把根文档、`docs/**` 和 Worker 文档切分后写入 Cloudflare Vectorize 索引 `ai-dca-kb`。

```bash
npm run kb:build
```

本地执行需要在 `.env.local` 配置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`，并授予 Vectorize Edit 与 Workers AI Read 权限。通常应通过 `build-knowledge-base.yml` 运行。

## 提交前检查

```bash
node --test
npm run check:refactor
npm run lint -- --quiet
git diff --check
```

按改动范围补充 Playwright smoke、visual 或 accessibility 测试。Worker 变更合并后还需按部署规约记录线上版本证据。

## 社区

感谢 [LinuxDo](https://linux.do/) 社区的支持。
