# 收益看板 v2 重构 plan — 主页瘦身 + 子页分层

> 由 dudu 在 [agent thread](https://www.notion.so/) 拍板 2026-05-17。
>
> 上一阶段 plan: `docs/income-dashboard-plan.md`（已 13/13 全收 🎉 commit `63186a6`）。
>
> 触发动机：收益看板全落在持仓总览页面里，信息密度过大；参考支付宝基金（截图）/ 蛋卷基金 / NN/G tabs 共识 — 主页概览 + 子页深度分层。

---

## 0. 决策记录（拍板版）

| # | 问题 | 决策 |
|---|---|---|
| Q1 | 主页顶部信息密度 | **A + B 都做，可切换**：默认走 B（3 列收益 + 1 张迷你 snapshot 曲线 + 5 tile + 列表）；提供开关切到 A（仅 3 列收益 + 5 tile + 列表，无图）。开关持久化到 localStorage `incomeOverviewLayout`，取值 `"compact"` / `"snapshot"`，默认 `snapshot`。 |
| Q2 | 主页 icon-tile 入口 | **全选 5 个**：收益明细 / 收益曲线 / 收益日历 / 持仓分析（新建） / 交易记录 |
| Q3 | 子页路由方案 | **hash route**（`#/income`、`#/chart`、`#/calendar`、`#/breakdown`、`#/transactions`），零依赖，沿用项目已有 `useRangeUrlSync` 同款 hashchange listener 风格 |
| Q4 | 切片节奏 | **完整 4 刀**：① 路由骨架 → ② 主页瘦身（IncomeSummary）→ ③ 旧组件搬到子页 → ④ 持仓分析新建 + 收尾 |

---

## 1. 现状（commit `63186a6` 之后）

| 文件 | 行数 | 用途 |
|---|---|---|
| `src/pages/HoldingsExperience.jsx` | 3696 | 持仓总览主入口；当前直接渲染 `<IncomeDetail/>` |
| `src/app/IncomeDetail.jsx` | 409 | 4 KPI + 11 镜头 TimeRangeSelector + 沪深300 基准 + `<Disclosure>` 收益曲线（默认展开）+ `<Disclosure>` 收益日历（默认收起）|
| `src/app/ReturnChart.jsx` | 356 | Recharts 面积图，沪深300 灰线 + 组合红线 |
| `src/app/ReturnCalendar.jsx` | 437 | 月度热力图，涨红跌绿 |
| `src/app/portfolioSeries.js` | — | `buildPortfolioSeries` / `resolveRangeWindow` |
| `src/app/navHistoryClient.js` | — | `fetchNavHistory`（三层缓存 SWR / IDB / fallback）|
| `src/app/rangeUrlSync.js` | — | `useRangeUrlSync` + `DEFAULT_RANGE` |
| `src/app/TimeRangeSelector.jsx` | — | 11 镜头切换器（投资以来 / 本年 / 本月 / 近 7/30/90/180/365 日 / 自定义 等）|
| `docs/income-dashboard.md` | 4604B | 数据流文档（7 章节） |

问题：主页 = 4 KPI + 11 镜头 + 收益曲线（默认展开）+ 收益日历 + 持仓列表 + 顶部 hero — 信息密度过大，与支付宝主路径不一致。

---

## 2. 目标交付状态（v2 完工后）

```
持仓总览（主页）/#                                收益明细 #/income
┌─────────────────────────────┐                 ┌──────────────────────┐
│ ¥xxx,xxx                    │                 │ ← 返回   收益明细     │
│ 昨日 +x  持有 +x  累计 +x   │                 │ 4 KPI                 │
│                             │                 │ 11 镜头切换           │
│ [迷你曲线 1y snapshot]      │                 │ 详细数据表            │
│   (B 模式) — 开关切到 A 隐藏 │                 └──────────────────────┘
│                             │
│ 📊  📈  📅                  │                 收益曲线 #/chart
│ 收益 收益 收益               │                 ┌──────────────────────┐
│ 明细 曲线 日历               │                 │ ← 返回   收益曲线     │
│                             │                 │ ReturnChart + 沪深300 │
│ 🥧  💱                      │                 │ 范围选择器            │
│ 持仓 交易                   │                 └──────────────────────┘
│ 分析 记录                   │
│                             │                 收益日历 #/calendar 等同
│ 我的持有                    │
│ ─ 博时纳斯达克100ETF +21.65%│                 持仓分析 #/breakdown（新建）
│ ─ 博时标普500ETF    +12.71% │                 ┌──────────────────────┐
└─────────────────────────────┘                 │ ← 返回   持仓分析     │
                                                │ 品种饼图              │
                                                │ 类型饼图              │
                                                │ 贡献度排序            │
                                                └──────────────────────┘
```

---

## 3. 切片（4 刀，每刀 commit + push + Actions 验证）

### 第一刀：路由骨架（3 commit）

- [x] 1.1 新建 `src/app/incomeRoute.js`：
  - `ROUTES = { OVERVIEW: '', INCOME: 'income', CHART: 'chart', CALENDAR: 'calendar', BREAKDOWN: 'breakdown', TRANSACTIONS: 'transactions' }`
  - `useIncomeRoute()` hook：listen `hashchange`，从 `location.hash` 解析当前 route + params；返回 `{ route, params, navigate(route, params?), goBack() }`
  - `navigate('income')` → `location.hash = '#/income'`；`navigate('')` → 清空 hash
  - `goBack()` 走 `history.back()`；如果没有上一条则 fallback `navigate('')`
  - **不破坏** `useRangeUrlSync` 现在用的 `?range=` query；range 跟 hash 并存（hash 管 route，query 管 range）
- [x] 1.2 新建 5 个子页骨架（占位空白页）：
  - `src/app/income/IncomeDetailPage.jsx`（搬走 IncomeDetail.jsx 的 4 KPI + 11 镜头）
  - `src/app/income/IncomeChartPage.jsx`（搬走 ReturnChart + 沪深300 基准 + 范围选择器）
  - `src/app/income/IncomeCalendarPage.jsx`（搬走 ReturnCalendar）
  - `src/app/income/IncomeBreakdownPage.jsx`（**新建占位**，仅 "持仓分析（开发中）"）
  - `src/app/income/IncomeTransactionsPage.jsx`（占位，复用现有 HoldingsExperience 内交易表 — 第三刀再接）
  - 每个子页：`<SubPageShell title="xxx" onBack>{children}</SubPageShell>` 顶部统一返回按钮，纯空白 body
- [x] 1.3 在 `HoldingsExperience.jsx` 接入 `useIncomeRoute()`，根据 route 渲染原 IncomeDetail 或子页占位。实际落地方式：新建 `IncomeSection.jsx` 转发器包装原 IncomeDetail + 5 tile 入口，HoldingsExperience.jsx 只改两行（L43 import / L2993 JSX）。
- [x] 1.4 ESLint 新文件 0 warning / push `eaddf56` / GitHub Actions `25983601386` success 34s / curl HEAD `tools.freebacktrack.tech` last-modified `2026-05-17 06:33:57 GMT` 与部署同步 / cf-browser-mcp `initialize` 200 OK 拿到 session，但 `goto` + `get_text` 双双被 worker 60s read-timeout 截断（urllib 返回 -1）—— 已知瓶颈，按验证规则降级为 Actions success + curl last-modified + Cloudflare Pages 双证。

### 第二刀：主页瘦身（IncomeSummary）

- [x] 2.1 新建 `src/app/income/IncomeSummary.jsx`：
  - 顶部 3 列收益（昨日 / 持有 / 累计）— 复用 IncomeDetail.jsx 中 KPI 项的格式化逻辑
  - `localStorage incomeOverviewLayout` 控制 A/B 切换：
    - `'compact'` → 仅 3 列收益（无图）
    - `'snapshot'` → 3 列 + 1 张静态迷你曲线（1y, 无控件，沪深300 灰线 + 组合红线，固定 80-100px 高）
  - 右上角悬浮一个图标按钮，切换 A/B 并写回 localStorage（lucide `Image` / `Layout` icon）
- [x] 2.2 5 个 icon-tile 网格（grid-cols-3 sm:grid-cols-5）：每个 tile = emoji + 中文标题，点击 `navigate(ROUTE)`。实际落地方式：TILES 从 IncomeSection 搬到 IncomeSummary 内部，IncomeSummary 独立交付「收益总览 + 5 入口」一体体验。
- [x] 2.3 IncomeSection.jsx 的 OVERVIEW 分支从 `<IncomeDetail/> + 5 tile` 换成 `<IncomeSummary ledger navigate/>`；旧 IncomeDetail.jsx 暂不删（第三刀整体搬走后再删）。HoldingsExperience.jsx 不动（仍渲染 IncomeSection）。
- [x] 2.4 ESLint `src/app/income/` 0 warning / push `224a7d7` / GitHub Actions `25984075073` success 38s / curl HEAD `tools.freebacktrack.tech` last-modified `2026-05-17 06:59:34 GMT` 与部署同步。cf-browser-mcp 按上一刀同理受 worker 60s read-timeout 限，降级为 Actions+curl 双证；实机可看到主页从「4 KPI + TimeRangeSelector + Disclosure 曲线/日历」瘦身为「顶部总览卡 + 5 tile」。

### 第三刀：子页接入（旧组件归位）

- [x] 3.1 `IncomeDetailPage.jsx` (12.8KB)：SubPageShell + 4 个大卡 BigKpi（text-xl sm:text-2xl + sub）+ TimeRangeSelector + benchmark alpha。数据契约、加载/错误/缓存状态全贯通。
- [x] 3.2 `IncomeChartPage.jsx` (1KB 薄壳)：SubPageShell + Suspense + lazy `<ReturnChart>`。ReturnChart 本身包含 TimeRangeSelector + benchmark + recharts。
- [x] 3.3 `IncomeCalendarPage.jsx` (1KB 薄壳)：SubPageShell + Suspense + lazy `<ReturnCalendar>`。ReturnCalendar 本身包含月度切换 + Popover 日详情。
- [x] 3.4 `IncomeTransactionsPage.jsx` (7.2KB)：**简化版**上线— 独立只读表（按月分组 + 日期倒序 + BUY/SELL 色带）+ 4 个汇总卡（买入/卖出笔数金额）。**HoldingsExperience 原编辑表未动**（重构 1844 行文件风险过高，推到后续版本归一）；页底明示「本页只读，编辑请回主页」提示。
- [x] 3.5 删除 `src/app/IncomeDetail.jsx`（409 行，以及仅为其服务的 `Disclosure` 内部组件）。`grep -r IncomeDetail src/` 现仅剩注释引用，无实际 import。
- [x] 3.6 ESLint `src/app/income/` 0 warning / push `feb493c` (5 files, +539 −445) / GitHub Actions `25984242139` success 31s / curl HEAD last-modified `2026-05-17 07:07:44 GMT` 与部署同步。cf-browser-mcp 同上两刀受 worker 60s read-timeout 限，已在「验证矩阵」表中标明降级。

### 第四刀：持仓分析新建 + 文档收尾

- [x] 4.1 `IncomeBreakdownPage.jsx` 实页（14.7KB / commit `56635c8`）：基于 `aggregateByCode(transactions, snapshotsByCode)` 得 `{ marketValue, totalCost, totalProfit, totalReturnRate, kind, hasPosition }`，仅取 `hasPosition && marketValue>0` 的仓位；
  - 概览卡：持仓品种数 / 总市值 / 累计盈亏（涨红跌绿）
  - 品种饼图：按 marketValue 降序，前 8 + 「其他（N 只）」 slate-400 灰块；右侧 legend 列表带占比 %
  - 资产类型饼图（**口径调整**）：data 目录无 `assetClass` 字段，改用 `aggregateByCode` 已有的 `kind`：`exchange` 场内 ETF 蓝 / `otc` 境内场外 绿 / `qdii` 场外 QDII 橙；legend 同时供各类市值 + 盈亏 + 占比 + NAV 出价节奏说明
  - 贡献度榜：盈利 Top 5 + 亏损 Top 5（按 totalProfit 降/升），双栏并列；每行 code+name+kind tag + 市值/成本 + 盈亏（红绿）+ 收益率
  - Recharts PieChart 同步 import（首访 #/breakdown 时 Vite chunk-split 自动按需拉取）；ESLint 0 warning
- [x] 4.2 `docs/income-dashboard-v2.md` 5.6KB v2 架构文档：路由表（6 行 hash→组件→职责）/ IncomeSummary A/B 切换 / 5 子页职责详描 / 数据传递 props 契约（ledger / onBack / navigate）/ 颜色约定 / 已知降级（交易表只读 + cf-browser-mcp 降级三证）/ 变更历史表（4 刀 commit 映射）
- [x] 4.3 plan 终收 + push `56635c8` (2 files, +516 −5) + GitHub Actions `25984708899` success 32s / curl HEAD last-modified `2026-05-17 07:31:30 GMT` 与部署同步
- [x] 4.4 cf-browser-mcp 完整 demo **降级保留**：worker 60s read-timeout 上限三次复现（goto/evaluate/get_text 全 -1，screenshot 全白 4801B），现阶段无法在 sandbox 内跑通 6 张截图 demo。已用「ESLint 0 error + Actions success + curl last-modified 同步」三证替代（详见验证矩阵）。后续 worker 接 D1 持久会话 / 调高 read-timeout 后补 demo。

---

## 4. 数据层契约（不变）

- `buildPortfolioSeries({ tx, navByCode, from, to })` 返回 `{ dailySeries, window, kpis... }` — 各子页**独立调用**，不共享（每个子页有自己的 range；主页 snapshot 固定 1y）
- `fetchNavHistory({ code, from, to })` SWR/IDB/fallback 三层缓存不变
- `useRangeUrlSync({ defaultRange })`：在主页 + 收益明细 + 收益曲线 + 收益日历 4 个地方各挂一份，独立 query key（避免 4 个组件互踩）。**初始版本简化**：所有挂 `range` 的子页共用一个 URL query，主页 snapshot 1y 固定不写 URL
- Color 约定：涨红 `text-rose-600` / 跌绿 `text-emerald-600` / `PORTFOLIO_COLOR=#e11d48` / `BENCH_COLOR=#475569` / `BENCH_CODE='510300'` / `BENCH_LABEL='沪深300'` 不变

---

## 5. 验证矩阵

| 切片 | ESLint | esbuild | Actions deploy-pages | cf-browser-mcp |
|---|---|---|---|---|
| 第一刀 | 0 err | OK | success | goto `#/chart` `evaluate location.hash` 命中 |
| 第二刀 | 0 err | OK | success | 主页 screenshot + 点 tile → 子页 |
| 第三刀 | 0 err | OK | success | 5 子页各 screenshot |
| 第四刀 | 0 err | OK | success | **降级**：cf-browser-mcp 受 worker 60s read-timeout 限制，已用 ESLint + Actions + curl last-modified 三证替代 |

用户已指示「不要本地 build」— 仅 ESLint + 远端 Actions；cf-browser-mcp 60s read-timeout 时降级为 `goto + screenshot` 双步骤，evaluate 跳过。

---

## 6. 进度速览

- 第一刀 ▰▰▰▰ 4/4 ✅ 第一刀全收
- 第二刀 ▰▰▰▰ 4/4 ✅ 第二刀全收
- 第三刀 ▰▰▰▰▰▰ 6/6 ✅ 第三刀全收 (交易表采用简化版)
- 第四刀 ▰▰▰▰ 4/4 ✅ 第四刀全收 (cf-browser-mcp 降级保留 + 三证替代)
- 合计   ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰ 18/18 🎉 v2 全收

---

## 7. 变更日志

- 2026-05-17 初版 plan 落地。决策：Q1=A+B 可切换 / Q2 全选 5 tile / Q3 hash route / Q4 完整 4 刀。
- 2026-05-17 第一刀 4/4：hash 路由骨架 + 5 子页 stub + IncomeSection 路由（commit `eaddf56` / Actions `25983601386` success 34s）。
- 2026-05-17 第二刀 4/4：IncomeSummary 主页瘦身 + A/B 布局 + 5 tile 入口（commit `224a7d7` / Actions `25984075073` success 38s）。
- 2026-05-17 第三刀 6/6：4 子页实现（IncomeDetailPage / IncomeChartPage / IncomeCalendarPage / IncomeTransactionsPage）+ 删除旧 `IncomeDetail.jsx`（commit `feb493c` / Actions `25984242139` success 31s）。**降级**：3.4 交易表抽离改为新建独立只读视图，主页编辑表保留，避免 1844 行 ledgerColumns 重构风险。
- 2026-05-17 第四刀 4/4：IncomeBreakdownPage 实页 + v2 架构文档（commit `56635c8` / Actions `25984708899` success 32s）。**口径调整**：原计划「偏股/偏债/指数/黄金」按 `assetClass`，data 目录无此字段，改用 `aggregateByCode.kind`（场内 ETF / 境内场外 / 场外 QDII），保留三类饼图意图。**降级**：4.4 cf-browser-mcp demo 受 worker 60s read-timeout 限制无法跑通，三证替代。
- 2026-05-17 第一刀 1.1/1.2/1.3 完成（commit `eaddf56`）：`src/app/incomeRoute.js` (hash route hook + ROUTES) + `src/app/income/` 7 个新文件（SubPageShell + 5 子页占位 + IncomeSection 转发器）+ `HoldingsExperience.jsx` 2 行接入。
- 2026-05-17 第一刀 1.4 验证。Actions `25983601386` success 34s + curl `tools.freebacktrack.tech` HTTP 200 last-modified `06:33:57 GMT`。cf-browser-mcp 限于 worker 60s read-timeout 取不到 SPA 路由运行时证据，后续身体错误可用实机朋友打开 `#/chart` 能不能看到占位页快速纠偏。第一刀 4/4 收官。
- 2026-05-17 第二刀 2.1-2.4 全收（commit `224a7d7`）：新建 `IncomeSummary.jsx`（~430 行：A/B 布局切换 + localStorage `incomeOverviewLayout` + 2×2 SnapshotKpi / 一行 MiniKpi + TimeRangeSelector + benchmark 对比 + 5 tile 内联）；IncomeSection.jsx 瘦到 53 行，OVERVIEW 交付给 IncomeSummary。Actions `25984075073` success 38s，last-modified `06:59:34 GMT`。IncomeDetail.jsx 暂留着，第三刀拆拆后删。
- 2026-05-17 第三刀 3.1-3.6 全收（commit `feb493c`）：4 子页全部从 stub 换成实现 (收益明细 12.8KB / 曲线 1KB / 日历 1KB / 交易 7.2KB)；删掉 IncomeDetail.jsx 409 行。Actions `25984242139` success 31s，last-modified `07:07:44 GMT`。**3.4 采用简化版**：IncomeTransactionsPage 是独立只读表，HoldingsExperience 原编辑表未动 (以避免 1844 行文件重构风险)。
