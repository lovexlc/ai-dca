# 统一价格净值溢价获取计划

## 目标

把 ETF 价格、净值、IOPV、溢价率的获取和计算统一收敛到 Workers 后端。前端只调用统一接口并渲染结果，不再直接拉雪球详情、读静态 daily-sina 回退或在浏览器里重复计算溢价。

## 步骤清单

- done: 盘点现有价格/净值/溢价路径，确认需要改动的 Worker 和前端入口。现有分支包括 `navService.getCnEtfPremiumSnapshot`、切换策略页雪球 raw 拉取、切换策略页 daily-sina 回退，以及 markets 页局部溢价补算。
- done: 在 markets Worker 增加统一 fund metrics 接口；交易时段直接拉实时上游，非交易时段优先使用 KV。新增 `/api/markets/fund-metrics`，支持 GET/POST 批量 codes，返回 price/currentPrice/latestNav/iopv/premiumPercent 和缓存策略。
- done: 将前端 navService 和切换策略页改为调用统一接口，移除前端分支与本地 daily-sina 价格回退。`navService` 改走 markets fund metrics；切换策略页不再解析雪球 raw 或读取 daily-sina；markets 页 1 日溢价不再用前端雪球 raw 快捷计算。
- done: 运行单元/构建验证，并对新 Worker 接口做正常与异常路径 smoke。
- done: 记录验证结果、影响范围和后续部署证据要求。

## 关键决策

- 不新增名为 snapshot 的前端数据路径；统一接口命名为 fund metrics，表达的是当前可用指标。
- 交易时段判断放在 markets Worker：A 股交易时段或显式 refresh 时跳过 KV，直接请求上游；非交易时段可读 KV。
- 前端不再解析雪球 raw payload，不再读 `data/<code>/daily-sina.json` 作为运行时价格回退。
- 此任务是数据/后端统一，不需要 Stitch 设计确认。

## 待确认项

- 无阻塞项。默认保留旧 `/api/holdings/nav` 作为 Worker 间兼容接口，但前端运行路径切到 markets Worker 统一接口。

## 产出与验证记录

- markets Worker 新增 `/api/markets/fund-metrics`，统一输出 `price/currentPrice/latestNav/iopv/premiumPercent`，并按 `refresh=1` 或 A 股交易时段直接拉上游，非交易时段读 KV。
- 前端 `navService`、切换策略页、markets 页 1 日溢价路径改为依赖统一 Worker 指标；不再由浏览器解析雪球 raw 或读取 `daily-sina.json` 作为运行时价格回退。
- `node --check workers/markets/src/index.js` 通过。
- `node --test test/*.mjs` 通过：58 pass / 0 fail。
- `npm run build` 通过，并已同步 Pages 产物。
- `npm run lint` 未通过，失败来自仓库既有 lint 债：`src/components/ai-chat/ai-chat-widget.jsx`、`src/components/data-table/data-table-column-header.jsx`、`src/components/markets/MarketsChartBlock.jsx`、`src/pages/MarketsExperience.jsx` 等已有规则错误；本次相关文件无新增 `no-undef`。
- Worker smoke：本地 `wrangler dev --config workers/markets/wrangler.toml --port 8790` 后，`POST /api/markets/fund-metrics?refresh=1` with `["513100","159941"]` 返回 HTTP 200，`successCount: 2`，`cachePolicy: "live-refresh"`；本地缺 `XUEQIU_COOKIE` 时按预期降级到新浪 quote，净值字段为空。异常路径 `POST /api/markets/fund-metrics` with `["BAD"]` 返回 HTTP 400，`error: "missing valid cn fund codes"`。
- 前端浏览器验证：当前会话没有热加载出 Cloudflare `cf-browser` 自动化工具；已通过 `wrangler browser create --install-skills` 安装 Cloudflare skills 并成功创建/关闭 Browser Run session。替代验证用本地 Playwright Chromium 移动端打开 `/?tab=fundSwitch`，页面可渲染；由于本地 Vite 没有接入新 Worker dev 路由，页面对 `/fund-metrics` 返回 404，这是本地代理环境限制，不是构建错误。
