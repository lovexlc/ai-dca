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
- [done] step-2 重写 IncomeSummary.jsx：单卡布局 + 3 列 KPI + sparkline hidden sm:block
- [done] step-3 ESLint check（clean）
- [done] step-4 commit + push + Actions success
- [done] step-5 验 Pages last-modified 推进
- [skipped] step-6 cf-browser-mcp script 模式不可用，降级部署证据
- [done] step-7 回应用户带证据

## 验证证据

- commit: `1b438f7 feat(income): IncomeSummary 改单卡支付宝风格`
- Actions run: 26021624786 success
- Pages lm: Mon, 18 May 2026 08:15:15 GMT (CST 16:15)
- PC / Mobile screenshot: 待用户刷新页面反馈
