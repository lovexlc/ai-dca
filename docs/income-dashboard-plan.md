# 收益看板实施计划 (周 / 月 / 年)

> 目标：在持仓页对齐蚂蚁财富「收益明细」体验 —— 顶部累计盈亏卡片 + 时间镜头切换 + 区间收益曲线 + 收益日历。
>
> 每完成一刀就回到本文件勾选 ✅，并补上 commit SHA / Worker Version / Actions run 链接。

## 🎯 锁定决策（参考）

- **「投资以来」起点** = 成交流水里最早一笔 BUY 的日期：`min(tx.date)`
- **基准** = 沪深300（设置页可换，但默认锁死）
- **计算位置** = 前端实时 + IndexedDB 24h 缓存；不存 Notion；不做服务端聚合
- **不做**同业对比/同类排名
- **Worker 部署** = 走 GitHub Actions（`deploy-worker-ocr-proxy.yml`），禁止 `wrangler deploy` 直推
- **时间镜头键** = `today | week | month | year | lastWeek | lastMonth | ytd | lastYear | last365d | sinceInception | custom`
- **URL 同步** = `?range=ytd` 等
- **NAV 历史接口** = `GET /api/holdings/nav-history?code=&from=&to=` 由 ocr-proxy Worker 提供
- **NAV 缓存策略**
  - Worker 边缘缓存：纯历史段 24h；含今天动态 TTL（盘中 5min/收盘 30min/周末节假日 8h），由 `computeNonExchangeNavTtlMs` 复用计算
  - 前端 IndexedDB：信任 Worker 给的 `expiresAt`，预留 60s 安全余量；离线/出错时回退 stale 数据并打 `stale:true`

## 🗡️ 第一刀 — 基础设施 (4 commits)

后端 + 前端拉数据层 + 计算引擎雏形。**完成后可在 Console 跑出 YTD 收益率，不渲染 UI。**

- [x] **1.1** `feat(worker): /api/holdings/nav-history with edge cache` — ocr-proxy Worker 新增端点
  - 文件：`workers/ocr-proxy/src/index.js`（+181 行，新增 `fetchFundNavHistory` / `buildNavHistoryCacheKey` / `todayShanghaiIsoDate` / `handleHoldingsNavHistory`）
  - README：`workers/ocr-proxy/README.md` +8 行
  - Commit: `d40f787c1e577f77139620fb56f3bada92aea432`
  - Raw: https://raw.githubusercontent.com/lovexlc/ai-dca/d40f787/workers/ocr-proxy/src/index.js
  - Actions run: https://github.com/lovexlc/ai-dca/actions/runs/25958083716 (success, 32s)
  - Worker Version: `a7142f18-0b9e-4a4d-9f86-a27b1b020e03` (#47, 2026-05-16T09:08:20Z)
  - Deployment: `ffe21b77-af7a-4be8-b3c0-48cb6dc592dd` (100%)
  - 完成时间：2026-05-16 17:08 (CST)
- [x] **1.2** `feat(app): navHistoryClient with IndexedDB 24h cache` — 前端单只基金区间净值拉取层
  - 文件：`src/app/navHistoryClient.js`（11014 bytes，3 exports: `fetchNavHistory` / `clearNavHistoryCache` / `__internals`）
  - L1 内存 Map 去重 in-flight / L2 IndexedDB / L3 Worker / stale 回退
  - 17 个单元 assert 全绿（日期/参数/freshness）
  - Commit: `1d1f447a7eabac8b79c470ad5587ceabc083c02b`
  - Raw: https://raw.githubusercontent.com/lovexlc/ai-dca/1d1f447/src/app/navHistoryClient.js
  - 完成时间：2026-05-16 17:23 (CST)
- [x] **1.3** `feat(app): portfolioSeries.js with Modified Dietz` — 组合收益序列计算
  - 文件：`src/app/portfolioSeries.js`（11783 bytes，2 + 1 exports: `buildPortfolioSeries` / `resolveRangeWindow` / `__internals`）
  - 输入：`{ tx, navByCode, from, to }`
  - 输出：`{ window, startValue, endValue, netCashFlow, weightedCashFlow, profit, returnRate, annualizedReturn, dailySeries[], holdings, cashFlows, diagnostics }`
  - 与 `holdingsLedgerCore` 对齐：tx 仅 BUY/SELL；同日 BUY 先于 SELL；跨基转换（同日 SELL+BUY）现金流净额 ≈ 0、不被误伤
  - 镜头解析覆盖 11 个键 (`today | week | lastWeek | month | lastMonth | ytd | year | lastYear | last365d | sinceInception | custom`)
  - 45 个单元 assert 全绿（MD 公式、边界、镜头、错误路径、daily series）
  - Commit: `b027ad753f084b61dfac88b43a21f93e135e0c06`
  - Raw: https://raw.githubusercontent.com/lovexlc/ai-dca/b027ad7/src/app/portfolioSeries.js
  - 完成时间：2026-05-16 23:33 (CST)
- [x] **1.4** `chore(app): wire fetchNavHistory + portfolioSeries into HoldingsExperience console probe` — 开发用 console 入口
  - 文件：`src/app/incomeProbe.js`（3361 bytes，导出 `installIncomeProbe(getLedger)`） + `src/pages/HoldingsExperience.jsx` L43 import + L120-121 useEffect 钩子
  - 仅暴露 `window.__incomeProbe(range, opts)`；ledger 变化时自动重挂；卸载时自动 `delete window.__incomeProbe`
  - 走 `fetchNavHistory` → `buildPortfolioSeries`，输出 startValue/endValue/netCashFlow/profit/returnRate/annualizedReturn 及 NAV 缺失诊断
  - 第三刀 3.4 收尾时一并删除
  - Commit: `c42a770aeedf5500847cbb9120ff1dda57045353`
  - Raw: https://raw.githubusercontent.com/lovexlc/ai-dca/c42a770/src/app/incomeProbe.js
  - 完成时间：2026-05-16 23:37 (CST)

## 🗡️ 第二刀 — 顶部入口 + 时间镜头 (5 commits)

蚂蚁财富同款顶部「收益明细」卡片 + 镜头切换器，**完成后用户可看到不带曲线的数字**。

- [x] **2.1** `feat(app): TimeRangeSelector component` — 8 + 1 个镜头按钮 + URL 同步
  - 文件：`src/app/rangeUrlSync.js` (5542B，纯函数 + hook) + `src/app/TimeRangeSelector.jsx` (6699B, chip-row + custom popover)
  - 10 个 chip（今/本周/上周/本月/上月/今年/去年/近一年/投资以来/自定义）；自定义日期 popover 由 2.2 IncomeDetail 接入
  - URL 同步：`?range=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD`，保留非镜头参数；SSR 安静
  - 22 个单元 assert 全绿（解析/序列化/round-trip/跨参数保持）；ESLint 0 errors
  - Commit: `fcf4689c1100e940770eded02702b0b9d9e53fc5`
  - Raw: https://raw.githubusercontent.com/lovexlc/ai-dca/fcf4689/src/app/TimeRangeSelector.jsx
  - 完成时间：2026-05-16 23:48 (CST)
- [x] **2.2** `feat(app): IncomeDetail.jsx scaffolding + KPI rows` — 顶部卡片主体
  - 文件：`src/app/IncomeDetail.jsx` (10103 bytes，默认导出 `IncomeDetail` 组件)
  - 显示「区间收益 / 区间收益率 / 累计盈亏 / 年化收益率」；数字大字号 + 涨跌色（红涨绿跌）；下挂 TimeRangeSelector
  - 集成 useRangeUrlSync + fetchNavHistory + buildPortfolioSeries；并行两次 build（区间 + 投资以来）
  - loading / error / stale 三态提示；空持仓友好提示
  - ESLint 0 errors / 0 warnings
  - Commit: `77811f1baa375a770cf67d4f233bea5d98b559cb`
  - Raw: https://raw.githubusercontent.com/lovexlc/ai-dca/77811f1/src/app/IncomeDetail.jsx
  - 完成时间：2026-05-16 23:53 (CST)
- [ ] **2.3** `feat(holdings): IncomeDetail entry on HoldingsExperience` — 持仓页接入入口
  - 替换/补足 `HoldingsExperience.jsx` L1878-1900 顶部卡片区域；保留旧 totalReturnRate 列不变
- [ ] **2.4** `feat(app): benchmark overlay (沪深300)` — 区间内基准对比数字
  - 复用 `marketsApi.js` 拉沪深300区间数据；只显示「跑赢基准 X.XX%」一行
- [ ] **2.5** `style(income): polish typography + dark mode` — 视觉打磨
  - 对齐 Notion-native 留白；移动端紧凑布局；涨跌色变量统一

## 🗡️ 第三刀 — 曲线 + 日历 (4 commits)

蚂蚁财富下半屏体验，**完成后整套收益看板上线**。

- [ ] **3.1** `feat(app): ReturnChart.jsx (Recharts area)` — 区间净值/收益率曲线
  - 双 Y 轴（左净值/右收益率）；hover 显示某日盈亏；惰性加载 Recharts
- [ ] **3.2** `feat(app): ReturnCalendar.jsx (月度日历热力图)` — 每日盈亏日历
  - 当月+前后2月可滑；红绿格子；点格弹当日 lots 明细
- [ ] **3.3** `feat(holdings): wire ReturnChart + ReturnCalendar into IncomeDetail` — 装配下半屏
  - 折叠面板：默认仅曲线展开；日历可点 toggle
- [ ] **3.4** `chore(holdings): remove __incomeProbe + add docs/income-dashboard.md` — 收尾
  - 删调试入口；写一篇用户文档讲「投资以来」起点、缓存、镜头定义

## 📋 进度速览

```
第一刀 ▰▰▰▰  4/4   (后端 ✅ navClient ✅ series ✅ probe ✅)  🎉 完成
第二刀 ▰▰▱▱▱  2/5   (镜头选择器 ✅ KPI 卡片 ✅)
第三刀 ▱▱▱▱  0/4
合计   ▰▰▰▰▰▰▱▱▱▱▱▱▱  6/13
```

## 🔍 验证阶梯（每个 commit 都要过）

1. **语法/编译**：`node --check` 或 `tsc --noEmit`
2. **焦点测试**：纯函数 ≥ 5 个 assert；UI 组件 manual 截图
3. **冒烟**：`/api/holdings/nav-history?code=510300&days=30` 等 happy path
4. **回归**：`HoldingsExperience` 原有 `totalReturnRate` 列数字不变

## 📝 变更日志

- 2026-05-16 17:08 - 第一刀 1.1 完成 (Worker 端点上线)
- 2026-05-16 17:23 - 第一刀 1.2 完成 (navHistoryClient.js)
- 2026-05-16 23:13 - 计划落档为本文件
- 2026-05-16 23:33 - 第一刀 1.3 完成 (portfolioSeries.js + Modified Dietz, 45 asserts)
- 2026-05-16 23:37 - 第一刀 1.4 完成 (incomeProbe.js + window.__incomeProbe 探针) 🎉 第一刀全收
- 2026-05-16 23:48 - 第二刀 2.1 完成 (TimeRangeSelector + rangeUrlSync, 22 asserts)
- 2026-05-16 23:53 - 第二刀 2.2 完成 (IncomeDetail.jsx 脚手架 + 4 KPI 行)
