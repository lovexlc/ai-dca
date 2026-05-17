# 收益看板 v3 plan — 激进主页瘦身 + 年化 bug 修复

> 触发：v2 名义 18/18 全收后，用户实机截图发现主页仍很密 — “投资组合概览” 10 项 KPI 区块不在 IncomeSection 范围内，v2 plan 从未及；另 IncomeSummary 本身也还带 11 镜头 + benchmark。参考支付宝主页只有 “总资产 + 今日 + 累计 + 5 tile + 持仓表”。
>
> 定狢：dudu 拍板选 A 激进瘦身 2026-05-17。
>
> 上一阶段 plan: `docs/income-dashboard-v2-plan.md`（18/18 名义全收）。

---

## 0. 决策

| # | 问题 | 决策 |
|---|---|---|
| Q1 | 是否删 `HoldingsExperience.renderPortfolioOverview()` 10 项 KPI | **删 cards + grid**（L1875-1904 + L1933-1960） |
| Q2 | section header 里的行情入口 + 大盘 ticker (L1905-1931) | **保留** — 这是唯一的大盘快讯入口，收益 KPI 不重复 |
| Q3 | IncomeSummary 4 KPI / 11 镜头 / benchmark / A/B 切换 | **全删**，瘦到只剩 三项：总市值大字 + 当日收益 + 累计盈亏 + 5 tile |
| Q4 | 11 镜头 + benchmark + 年化 去哪 | 已在 IncomeDetailPage / IncomeChartPage 存在，主页只保留入口 |
| Q5 | 年化收益率 +15729.41% bug | **portfolioSeries.annualize**：days < 365 返回 `null`，不头外推 |
| Q6 | IncomeSummary `localStorage incomeOverviewLayout` | 代码全删，localStorage key 自然脱落不理会 |

---

## 1. 位置成果可提交状态（v3 完工后）

```
持仓总览（主页）/#
┌──────────────────────────┐
│ [hero 区 / 简洁]               │
│                                 │
│ 总市值（大字）                 │
│ ¥159,175.49                     │
│ 当日  -¥31.42  -0.02%          │
│ 累计  +¥21,943.22 +15.93%      │
│                                 │
│ 📊 📈 📅 🥧 💱               │
│ 明细 曲线 日历 分析 交易       │
│                                 │
│ [行情入口 · 纳斯达克 27186 ↑] │
│                                 │
│ 我的持有                       │
│ ─ 博时纳斯达克100ETF +21.65%│
│ ─ 博时标普500ETF    +12.71% │
└──────────────────────────┘
```

主页信息点 从 v2 18 个 → v3 8 个（3 KPI + 5 tile），接近支付宝主路径。

---

## 2. 切片及状态

### 第一刀：HoldingsExperience 清理 + IncomeSummary 重写 + 年化 bug 修复

- [ ] 5.1 `src/pages/HoldingsExperience.jsx`：`renderPortfolioOverview()` 里删 cards 数组（L1875-1904）+ cards.map 渲染 grid（L1933-1960）。保留 section 外壳 + header（“投资组合概览” label 可同时隐去，只留 “行情中心” 进入按钮 + ticker）。
- [ ] 5.2 `src/app/income/IncomeSummary.jsx`：重写，~409 行 → ~120 行：
  - 入参新增 `portfolio`（总市值 / 当日盈亏 / 当日收益率 / 累计盈亏 / 累计收益率 / lastNavMeta）
  - 保留 `ledger` `navigate` `inceptionDate` 参数使调用点不变
  - 删：`useRangeUrlSync` / `TimeRangeSelector` / benchmark / fetchNavHistory 取数 / A/B 布局切换 / LayoutToggle / SnapshotKpi+MiniKpi 4 KPI / `LAYOUT_KEY` `localStorage`
  - 保留 5 tile 网格 + accent emoji 不变
  - 新 UI：总市值大字（text-3xl）+ 当日一行（金额 + 百分比，色调跌绿/涨红）+ 累计一行（金额 + 百分比）
- [ ] 5.3 `src/app/portfolioSeries.js` `annualize()`：不足 1 年 (days < 365) 返回 `null`，避免 137 天 +559% 被推为 +15729%。同时在 IncomeDetailPage 的年化卡 sub 加上券意说明（子页不冲击，只是数据变 “—”）。
- [ ] 5.4 验证：ESLint `src/app/income/`,`src/pages/HoldingsExperience.jsx`,`src/app/portfolioSeries.js` 0 warning / commit + push / GitHub Actions success / curl HEAD last-modified 同步。

---

## 3. 验证矩阵

| 切片 | ESLint | Actions | curl HEAD | 证据 |
|---|---|---|---|---|
| 5.1+5.2+5.3 全打 | 0 err | success | last-modified 同步 | git diff stat 净減 ~290 行 |

cf-browser-mcp 仍被 worker 60s read-timeout 限制，走上三片同样降级三证。

---

## 4. 进度速览

- 5.1 ⊡⊡⊡⊡ 0/4 (未启动)

---

## 5. 变更日志

- 2026-05-17 v3 plan 初版。决策：A 激进瘦身，三改一打 (HoldingsExperience cards 删 / IncomeSummary 重写 / annualize bug 修)。
