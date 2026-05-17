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

- [ ] 1.1 新建 `src/app/incomeRoute.js`：
  - `ROUTES = { OVERVIEW: '', INCOME: 'income', CHART: 'chart', CALENDAR: 'calendar', BREAKDOWN: 'breakdown', TRANSACTIONS: 'transactions' }`
  - `useIncomeRoute()` hook：listen `hashchange`，从 `location.hash` 解析当前 route + params；返回 `{ route, params, navigate(route, params?), goBack() }`
  - `navigate('income')` → `location.hash = '#/income'`；`navigate('')` → 清空 hash
  - `goBack()` 走 `history.back()`；如果没有上一条则 fallback `navigate('')`
  - **不破坏** `useRangeUrlSync` 现在用的 `?range=` query；range 跟 hash 并存（hash 管 route，query 管 range）
- [ ] 1.2 新建 5 个子页骨架（占位空白页）：
  - `src/app/income/IncomeDetailPage.jsx`（搬走 IncomeDetail.jsx 的 4 KPI + 11 镜头）
  - `src/app/income/IncomeChartPage.jsx`（搬走 ReturnChart + 沪深300 基准 + 范围选择器）
  - `src/app/income/IncomeCalendarPage.jsx`（搬走 ReturnCalendar）
  - `src/app/income/IncomeBreakdownPage.jsx`（**新建占位**，仅 "持仓分析（开发中）"）
  - `src/app/income/IncomeTransactionsPage.jsx`（占位，复用现有 HoldingsExperience 内交易表 — 第三刀再接）
  - 每个子页：`<SubPageShell title="xxx" onBack>{children}</SubPageShell>` 顶部统一返回按钮，纯空白 body
- [ ] 1.3 在 `HoldingsExperience.jsx` 接入 `useIncomeRoute()`，根据 route 渲染原 IncomeDetail 或子页占位（无 tile 还没做，先用临时 `<a href="#/chart">收益曲线</a>` 等链接进入）
- [ ] 1.4 ESLint + push + GitHub Actions deploy-pages success + cf-browser-mcp goto `#/chart` 验证空白子页能被路由命中（拿 Title 或 `evaluate` URL）

### 第二刀：主页瘦身（IncomeSummary）

- [ ] 2.1 新建 `src/app/income/IncomeSummary.jsx`：
  - 顶部 3 列收益（昨日 / 持有 / 累计）— 复用 IncomeDetail.jsx 中 KPI 项的格式化逻辑
  - `localStorage incomeOverviewLayout` 控制 A/B 切换：
    - `'compact'` → 仅 3 列收益（无图）
    - `'snapshot'` → 3 列 + 1 张静态迷你曲线（1y, 无控件，沪深300 灰线 + 组合红线，固定 80-100px 高）
  - 右上角悬浮一个图标按钮，切换 A/B 并写回 localStorage（lucide `Image` / `Layout` icon）
- [ ] 2.2 5 个 icon-tile 网格（grid-cols-3 sm:grid-cols-5）：每个 tile = lucide icon + 中文标题，点击 `navigate(ROUTE)`
- [ ] 2.3 在 `HoldingsExperience.jsx` 把 `<IncomeDetail/>` 替换为 `<IncomeSummary/>`；旧 IncomeDetail.jsx 暂不删（第三刀整体搬走后再删）
- [ ] 2.4 ESLint + push + Actions + cf-browser 验证主页瘦身 + 切换按钮可点

### 第三刀：子页接入（旧组件归位）

- [ ] 3.1 把 IncomeDetail.jsx 的「4 KPI + TimeRangeSelector」整体搬到 `IncomeDetailPage.jsx`；移除 Disclosure 包装（子页全屏，直接平铺）
- [ ] 3.2 把 IncomeDetail.jsx 的 `<ReturnChart>` Disclosure 子节点搬到 `IncomeChartPage.jsx`；保留沪深300 基准 + 让 TimeRangeSelector 也在这里挂一份（独立 range state，URL `?range=`）
- [ ] 3.3 把 `<ReturnCalendar>` 搬到 `IncomeCalendarPage.jsx`；月度切换控件单独显示
- [ ] 3.4 把现在嵌在 HoldingsExperience 里的「交易记录」表抽到 `IncomeTransactionsPage.jsx`；主页持仓列表保持，但表头/排序/筛选搬走
- [ ] 3.5 删除 `src/app/IncomeDetail.jsx`（已无引用）；删 `<Disclosure>` 组件（如无其他用途）
- [ ] 3.6 ESLint + push + Actions + cf-browser 跑 5 个 hash route 各自截图

### 第四刀：持仓分析新建 + 文档收尾

- [ ] 4.1 `IncomeBreakdownPage.jsx`：按 `txByCode` × `currentNav` 算每只基金当前市值 + 贡献度（盈亏 / 总盈亏占比）；
  - 品种饼图（前 10 + 其他）
  - 资产类型饼图（偏股 / 偏债 / 指数 / 黄金 — 从 ai-dca/data 中读 `assetClass`，缺失则归 "其他"）
  - 贡献度排序表（基金名 + 当前市值 + 累计盈亏 + 占比条）
  - 复用 Recharts PieChart
- [ ] 4.2 `docs/income-dashboard-v2.md`：新建 v2 架构文档 — 路由表 / IncomeSummary A/B 切换 / 5 子页职责 / 数据传递（Context vs props drilling）/ 已知降级（持仓分析仅算当前持仓不含历史已清仓）
- [ ] 4.3 plan 终收 + 删 plan v1 中已被取代的章节交叉引用 + push + Actions success
- [ ] 4.4 cf-browser-mcp 跑完整 demo：主页 → 5 子页 → 返回 → A/B 切换，各拿一张截图

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
| 第四刀 | 0 err | OK | success | demo 流程 6 张截图（5 子页 + A/B 切换）|

用户已指示「不要本地 build」— 仅 ESLint + 远端 Actions；cf-browser-mcp 60s read-timeout 时降级为 `goto + screenshot` 双步骤，evaluate 跳过。

---

## 6. 进度速览

- 第一刀 ▱▱▱▱ 0/4
- 第二刀 ▱▱▱▱ 0/4
- 第三刀 ▱▱▱▱▱▱ 0/6
- 第四刀 ▱▱▱▱ 0/4
- 合计   ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 0/18

---

## 7. 变更日志

- 2026-05-17 初版 plan 落地。决策：Q1=A+B 可切换 / Q2 全选 5 tile / Q3 hash route / Q4 完整 4 刀。
