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
- [x] **2.3** `feat(holdings): IncomeDetail entry on HoldingsExperience` — 持仓页接入入口
  - `HoldingsExperience.jsx` L44 `import { IncomeDetail }` + L2996 `<IncomeDetail ledger={ledger} />` 挂在 `renderPortfolioOverview()` 上方
  - 原 9 个 totalReturnRate 卡片（总市值/总成本/总收益/总收益率/累计收益/累计收益率/当日收益/当日收益率/最后更新）位置及计算未动
  - ESLint 0 errors；原有 22 warnings 未增加
  - Commit: `bc74ea29a2e0391a8bdad0494001766032429065`
  - 完成时间：2026-05-16 23:57 (CST)
- [x] **2.4** `feat(app): benchmark overlay (沪深300)` — 区间内基准对比数字
  - IncomeDetail.jsx +76 行：BENCH_CODE=510300 / BENCH_LABEL=沪深300
  - 不走 marketsApi.js（其 fetchKline 不接受区间参数），改复用 fetchNavHistory(同一 Worker 端点、同 IndexedDB 缓存)
  - navOnOrBefore / navOnOrAfter 取区间起始/结束 NAV；buy-and-hold 基准收益率 = endNav/startNav - 1
  - 下方一行显示「跑赢/落后基准 X.XX%」及「基准沪深300 X.XX%」
  - ESLint 0 errors / 0 warnings
  - Commit: `14104e4228d0b7378a46811d213e074d49ec7c09`
  - 完成时间：2026-05-17 00:03 (CST)
- [x] **2.5** `style(income): polish typography + mobile compact` — 视觉打磨
  - 涨跌色提取为 TONE_UP / TONE_DOWN / TONE_NEUTRAL / TONE_DIM，signClass + 基准区域统一引用
  - KpiCell：小屏 text-lg → sm:text-xl，label 加 uppercase tracking + min-w-0 防溢出
  - 外卡片 p-3 sm:p-4，border 200/70 软化；标题 / 资讯 / 基准 / 空状态 text-[11px] sm:text-xs
  - KPI grid 去 divide-x，改用 gap-1 sm:gap-2 (修复 2 列 mobile 下难看的垂线)
  - dark mode 跳过：HoldingsExperience 未用 dark: 且 tailwind 未启 darkMode，不泛滥加字段
  - ESLint 0 errors / 0 warnings
  - Commit: `7d4cc10560d7378945c4c7023d05f05a028bf6ba`
  - 完成时间：2026-05-17 00:09 (CST)

## 🗡️ 第三刀 — 曲线 + 日历 (4 commits)

蚂蚁财富下半屏体验，**完成后整套收益看板上线**。

- [x] **3.1** `feat(app): ReturnChart.jsx (Recharts area)` — 区间内组合 vs 沪深300 累计收益率双 Y 轴面积图
  - 文件：`src/app/ReturnChart.jsx` (11854 bytes，默认导出，便于 3.3 `React.lazy` 懒加载)
  - 复用 `useRangeUrlSync`，与 `IncomeDetail` 共享镜头；主线走 `buildPortfolioSeries.dailySeries.pnlRate`，副线为沪深300 forward-fill
  - esbuild OK / ESLint 0 errors；UI smoke 在 3.3 接入 IncomeDetail 后用 cf-browser-mcp 一起跳
  - Commit: `8f4be78`
  - 完成时间：2026-05-17 00:12 (CST)
- [x] **3.2** `feat(app): ReturnCalendar.jsx (月度日历热力图)` — 每日盈亏日历
  - 文件：`src/app/ReturnCalendar.jsx` (15140 bytes，默认导出)
  - 7×6 网格 · 红涨绿跌 · 色深按本月 |pnl| max 归一到 5 档 · 当月 ± 2 月限位
  - 单日 pnl = `dailySeries[i].pnl - dailySeries[i-1].pnl`，剔除当日现金流后是净盈亏
  - 点格子 Radix popover 弹当日交易明细 + 单日盈亏金额
  - 单元测试：8 个 pure-fn assert 全过 (`dailyPnlByDate` / `txsOnDate` / `toneFor`)
  - esbuild OK / ESLint 0 errors
  - Commit: `2aecc4b`
  - 完成时间：2026-05-17 00:17 (CST)
- [x] **3.3** `feat(holdings): wire ReturnChart + ReturnCalendar into IncomeDetail` — 装配下半屏
  - `IncomeDetail.jsx` +43/-8：`lazy(() => import('./ReturnChart.jsx'))` + `lazy(() => import('./ReturnCalendar.jsx'))` 拆出独立 chunk
  - 新增 `Disclosure` 折叠面板：收益曲线 defaultOpen / 收益日历 defaultClosed；Suspense fallback 走 `LoaderCircle`
  - 仅在 `inceptionDate` 存在（即有成交记录）时挂载下半屏，空持仓不渲染
  - esbuild OK / ESLint 0 errors
  - Commit: `1188318`
  - 完成时间：2026-05-17 09:50 (CST)
- [x] **3.4** `chore(holdings): remove __incomeProbe + add docs/income-dashboard.md` — 收尾
  - 删 `src/app/incomeProbe.js` (3361B) + `HoldingsExperience.jsx` L43 import & L121-122 useEffect 探针钩子
  - 新增 `docs/income-dashboard.md` (4604B)：投资以来起点 / 11 个镜头 / Modified Dietz 公式 / NAV 三层缓存 / 沪深300 基准 / UI 装配 / 文件索引
  - esbuild OK / ESLint 0 errors（22 个预存 warnings 未增加）
  - Commit: `40cd62a`
  - 完成时间：2026-05-17 09:52 (CST)

> ⚠️ 第三刀 3.3/3.4 完成后，又被 **v3 主页瘦身重构** 覆盖：`IncomeDetail.jsx` 拆成 `IncomeSummary.jsx`（主页 5-tile 入口）+ `income/IncomeDetailPage.jsx` / `IncomeChartPage.jsx` / `IncomeCalendarPage.jsx` 三个子路由（#/income · #/chart · #/calendar）。本文件未记录该次重构。第四刀基于子路由架构上做整合。

## 🗡️ 第四刀 — 收益明细整页化 + 清仓分析 (4 commits)

蚂蚁财富同款体验（参考用户截图 2026-05-17 8:31 / 8:45）：把收益明细页做成一站式（KPI + 曲线 + 日历），并新增清仓分析子页。

决策记录（2026-05-17 20:48 与用户确认）：
- Q1：曲线 + 日历都内嵌到 `IncomeDetailPage`，常驻在 KPI 下方（不折叠、不切 tab）
- Q2：`IncomeSummary` tile 合并到 4 个（收益明细 / 清仓分析 / 持仓分析 / 交易记录）
- Q3：移除 `HoldingsExperience` 原「已卖出」mainViewTab；`soldLots` 计算保留供清仓分析复用
- Q4：清仓后涨跌幅 = 卖出日 NAV → 今日 NAV 的累计涨跌；清仓盈利率 = 总清仓收益 / **总卖出本金**（卖出 lot 的 cost basis 之和）

- [x] **4.1** `feat(income): merge ReturnChart + ReturnCalendar into IncomeDetailPage` — 收益明细整页化 — commit `3415cff`
  - `IncomeDetailPage.jsx` 在 KPI/benchmark 行下方常驻 `ReturnChart`（不折叠）和 `ReturnCalendar`
  - 删除 `src/app/income/IncomeChartPage.jsx`、`IncomeCalendarPage.jsx`
  - `incomeRoute.js`：删 `ROUTES.CHART` / `ROUTES.CALENDAR`（或保留作为别名重定向到 `#/income`）
  - `IncomeSummary.jsx` TILES 移除「收益曲线」「收益日历」两个 tile
  - 验证：cf-browser-mcp goto `#/income` → 截图确认 KPI / 曲线 / 日历 三块齐显；旧 `#/chart` / `#/calendar` 不再 404 或落到收益明细
- [x] **4.2** `feat(holdings): remove 「已卖出」 main view tab` — 实际提交 — commit `b7cd4b3`
  - `HoldingsExperience.jsx` L2901 删 `{ key: 'sold', label: '已卖出', count: soldLots.length }`
  - 清理相关分支：`mainViewTab === 'sold'` 渲染分支 / `buildSoldTsv` 复制按钮文案 / emptyHint 中提到「已卖出」页的话术
  - 保留 `soldLots` / `soldSummary` / `summarizeSoldLots` 计算（4.3 / 4.4 仍要用）
  - 验证：cf-browser-mcp goto 持仓页主区，主 tab 只剩「基金汇总 / 成交流水」
- [x] **4.3** `feat(analytics): add clearedLotsAnalytics pure module` — 清仓分析纯函数 (20/20 测试) — commit `648a042`
  - 文件：`src/app/clearedLotsAnalytics.js`
  - 输入：`{ soldLots, range, today, inceptionDate, navByCode? }`
  - 输出：`{ window, kpi: { totalProfit, profitRate, productCount, lotCount, avgHoldingDays }, items: [{ buyDate, sellDate, code, name, profit, profitRate, postClearReturn, holdingDays }] }`
  - 镜头：本月 / 近半年 / 近一年 / 投资以来 — 按 `sellDate` 过滤
  - **清仓盈利率** = `totalProfit / totalSellCostBasis`（总卖出本金 = Σ 卖出 lot 的 cost basis）
  - **清仓后涨跌幅** = 该基金从 sellDate NAV 到今日 NAV 的累计涨跌（拉 `fetchNavHistory`，forward-fill 取最近可用值）
  - ≥ 12 个单元 assert：镜头过滤 / KPI 公式 / 边界（无 sold lot、navByCode 缺失、单日清仓、同基金多次清仓）/ 排序
- [x] **4.4** `feat(income): add liquidation analysis subpage (#/liquidation)` — 清仓分析子页 + 入口 — commit `6d39313`
  - 文件：`src/app/income/IncomeLiquidationPage.jsx`
  - 5 KPI 卡（清仓总收益 / 清仓盈利率 / 清仓产品数 / 清仓次数 / 平均持有天数）
  - 镜头切换 chip：本月 / 近半年 / 近一年 / 投资以来
  - Tab：清仓明细（按月分组，可按清仓时间/收益率排序）/ 盈亏排行（按 lot 收益率 desc）
  - List 每行：买入日 → 卖出日、基金名（代码+标签）、清仓收益、清仓收益率、清仓后涨跌幅
  - `IncomeSummary.jsx` TILES 注册「清仓分析」入口（紧跟在「收益明细」后）
  - `incomeRoute.js` 加 `ROUTES.LIQUIDATION = '#/liquidation'`
  - 验证：cf-browser-mcp goto `#/liquidation` → 截图 KPI / 镜头切换 / 列表按月分组

## 📋 进度速览

```
第一刀 ▰▰▰▰   4/4 🎉 完成 (后端 ✅ navClient ✅ series ✅ probe ✅)
第二刀 ▰▰▰▰▰  5/5 🎉 完成 (镜头 ✅ KPI ✅ 接入 ✅ 基准 ✅ polish ✅)
第三刀 ▰▰▰▰   4/4 🎉 完成 (曲线 ✅ 日历 ✅ 装配 ✅ 收尾 ✅)
第四刀 ▰▰▰▰   4/4 🎉 完成 (整页化 ✅ 移除 sold tab ✅ analytics ✅ 清仓分析页 ✅)
合计   ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  17/17 🎉
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
- 2026-05-16 23:57 - 第二刀 2.3 完成 (HoldingsExperience 接入 IncomeDetail)
- 2026-05-17 00:03 - 第二刀 2.4 完成 (沪深300 benchmark overlay 复用 navHistory)
- 2026-05-17 00:09 - 第二刀 2.5 完成 ＆ 第二刀全收 🎉 (typography / mobile / tone constants)
- 2026-05-17 00:12 - 第三刀 3.1 完成 (ReturnChart.jsx Recharts 面积图)
- 2026-05-17 00:17 - 第三刀 3.2 完成 (ReturnCalendar.jsx 月度热力图 + 8 asserts)
- 2026-05-17 09:50 - 第三刀 3.3 完成 (IncomeDetail lazy 装配 ReturnChart + ReturnCalendar)
- 2026-05-17 09:52 - 第三刀 3.4 完成 ＆ 第三刀全收 🎉 收益看板上线 (删 __incomeProbe + docs/income-dashboard.md)
- 2026-05-17 20:48 - plan.md 追加第四刀（收益明细整页化 + 清仓分析），共 4 commits；进度 13/13 → 13/17。同步注明 3.3/3.4 完成后被 v3 主页瘦身重构覆盖为子路由架构（IncomeSummary + income/IncomeDetailPage|IncomeChartPage|IncomeCalendarPage）
- 2026-05-17 20:53 - 第四刀 4.1 完成 (`3415cff`) - ReturnChart + ReturnCalendar 合并进 IncomeDetailPage；删 IncomeChartPage/IncomeCalendarPage；IncomeSummary TILES 5→3
- 2026-05-17 20:54 - 第四刀 4.2 完成 (`b7cd4b3`) - HoldingsExperience 移除「已卖出」主 tab，+9/-26；soldLots/buildSoldTsv/renderSoldTable 代码暂留（4.4 复用）
- 2026-05-17 20:57 - 第四刀 4.3 完成 (`648a042`) - clearedLotsAnalytics.js 纯函数模块 + 20/20 测试（lensFromDate / filterLotsByLens / computeClearedKpi / firstBuyDateForLot / holdDaysForLot / groupClearedByMonth / rankClearedLotsByProfit / afterSellChange）
- 2026-05-17 21:00 - 第四刀 4.4 完成 ＆ 第四刀全收 🎉 (`6d39313`) - IncomeLiquidationPage.jsx (#/liquidation)：4 镜头 + 5 KPI + 清仓明细/盈亏排行 2 Tabs；esbuild 30.2kb / ESLint 0。0 警告。IncomeSummary TILES 插入「💰 清仓分析」。4 commit 合计进度 17/17。
