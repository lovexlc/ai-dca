# IncomeSummary 紧凑化（v6.9 单卡支付宝风格）

## 目标

顶部双卡（左:总市值+sparkline+累计 / 右:今日 ¥0 大块 rose 浅底）改成**单卡**，参考支付宝设计：

```
┌────────────────────────────────────────┐
│ 总市值                  起 2025-10-12  [↻]│
│ ¥159,175.49                            │
│ [PC only: sparkline]                   │
│ ── divider ──                          │
│  今日 ¥0.00 0%  │ 持有 +¥X +X%  │ 累计 +¥Y +Y% │
└────────────────────────────────────────┘
[收益明细] [清仓分析] [持仓分析] [交易记录]
```

## 关键决策（已确认）

- **PC 端**：保留 sparkline（PC 不空），布局与移动端一致（单卡）
- **移动端**：去掉 sparkline，纯文字 + 3 列 KPI
- **3 列 KPI**：今日 / 持有 / 累计（沿用 todayProfit/totalProfit/cumulativeProfit）
  - 今日 = portfolio.todayProfit / todayReturnRate
  - 持有 = portfolio.totalProfit / totalReturnRate（持仓未实现）
  - 累计 = portfolio.cumulativeProfit / cumulativeReturnRate（含已卖出）
- **刷新按钮**：从原右窄卡移到顶部右上
- **起始日期**：放顶部右侧小字

## 影响范围

- `src/app/income/IncomeSummary.jsx` 重写布局（双卡 → 单卡）
- portfolio 已暴露 todayProfit/todayReturnRate/totalProfit/totalReturnRate/cumulativeProfit/cumulativeReturnRate（无需改 holdingsLedgerCore）
- IncomeSection / OverviewSummary props 不变

## 步骤

- [done] step-1 确认 portfolio 已暴露 totalProfit/totalReturnRate（无需后端改）
- [in_progress] step-2 重写 IncomeSummary.jsx：单卡布局 + 3 列 KPI + sparkline hidden sm:block
- [todo] step-3 ESLint check
- [todo] step-4 commit + push + 等 Actions success
- [todo] step-5 验 Pages last-modified 推进
- [todo] step-6 cf-browser-mcp 验证 PC（1280×800）+ 移动（390×844）渲染
- [todo] step-7 回应用户带截图证据

## 验证证据（填入）

- commit: 
- Actions run: 
- Pages lm: 
- PC screenshot: 
- Mobile screenshot: 
