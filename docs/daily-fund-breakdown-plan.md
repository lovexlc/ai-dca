# 收益日历 ↔ 当日收益明细 联动

## 目标
点击收益日历某一天 → 下方「当日收益明细」按基金维度展示该日 per-fund 盈亏；默认 selectedDate = 今天（Shanghai）。
参考图：蚂蚁财富 收益明细 tab — 顶部日历 + 当日明细列表（基金名 / 当日盈亏 / 投资增值 tag）。

## 步骤
- [done] 探查 ReturnCalendar / portfolioSeries / tx schema
- [todo] portfolioSeries.js: 新增 `export singleDayFundPnl({ tx, navByCode, date })`，返回 `[{ code, shares, nav, prevNav, prevDate, pnl }]`（基于 sharesAtEndOf(prevTradingDay) × (nav - prevNav)，cash flow 不算 pnl）
- [todo] ReturnCalendar.jsx: props 接收 `selectedDate / onSelectDate`；移除 Popover、点格调 onSelectDate；selected ring 高亮
- [todo] 新组件 `src/app/income/DailyFundBreakdown.jsx`：按 selectedDate 抓 nav（selectedDate - 30d → selectedDate），调 singleDayFundPnl，输出基金名 + 当日盈亏列表，按 |pnl| 降序
- [todo] IncomeDetailPage.jsx: 新增 `selectedDate` state (默认 today)，挂 Calendar(props) + DailyFundBreakdown(props)
- [todo] eslint + commit + push + 等 Actions + cf-browser-mcp 验证（PC 视口点击不同日期，确认底部列表联动）

## 决策
- 单日 per-fund pnl 公式：`shares_eod_prev × (nav_date - nav_prevDate)`；当日新买入份额不算 pnl（与 Modified-Dietz 思路一致）
- 基金名：直接用 tx.name（最近一笔），无 fallback 用 code
- 移除 Popover：列表更清晰；保留 hover/focus 视觉反馈
- 没数据日（节假日 / inception 之前）：显示「当日无更新」占位
