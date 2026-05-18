# vStart nav 缓冲修复（彻底解决"当日 +9.1 万 / 今年来 +542%"）

## 目标

所有「窗口收益」相关计算（日历、收益曲线、IncomeDetailPage KPI），`vStart` 在窗口起点为非交易日（节假日/元旦/月初）时不再坍缩为 0。

## Root Cause

`fetchAllNav(codes, from, to)` 的 `from` 直接等于 `buildPortfolioSeries` 的 `from`。当 `from` 是非交易日：

1. nav 响应窗口 `[from, to]` 内不含任何 `<= from` 的 nav 点。
2. `portfolioMarketValue(sharesAtStart, navMap, from)` 内 `findNavOnOrBefore(series, from)` 对每只基金都 null → 该基金从 vStart 中**整体丢失**。
3. `vStart = 0`，`buildDailySeries` 把整个组合市值压在节后第一天 (`pnl - vStart = MV`)，`dailyPnlByDate` 相邻差 dump → 日历节后第一格 ≈ 全组合市值。
4. Modified-Dietz `return = (vEnd - 0 - netCF) / (0 + weighted)` → 分母虚低 → +542% 之类的离谱百分比。

## Fix

所有 `fetchAllNav(codes, from, to)` 调用，把 `from` 左移 **30 自然日**（覆盖任何节假日空窗）。`buildPortfolioSeries` 的 from/to 维持业务窗口不变。

## 步骤

- [x] 1. 写 plan
- [ ] 2. 改 src/app/ReturnCalendar.jsx:247 fetchAllNav 加 30d 左缓冲
- [ ] 3. 改 src/app/ReturnChart.jsx:191 同上
- [ ] 4. 改 src/app/income/IncomeDetailPage.jsx:191 同上
- [ ] 5. portfolioSeries.js: vStart 缺 nav 时 console.warn（dev-time safeguard）
- [ ] 6. ESLint
- [ ] 7. commit + push
- [ ] 8. Actions 部署 + Pages bundle 验证
- [ ] 9. 浏览器复核（cf-browser-mcp 不可用时降级为 bundle hash 验证）

## 影响

- 当日收益：节后第一天回归到真实当日变动（~¥1.7k 而非 ¥91k）
- 今年来收益率：vStart 恢复到 12-31 真实持仓市值，return% 回到正常区间
- 累计盈亏 since-inception：from = inceptionDate（首笔 BUY 当天必有 nav）原本就不受此 bug 影响
