# 日历单日 pnl 与「当日明细」加和方向相反 修复 plan

## 现象
- 5-12 日历格红色 +5.2k
- 5-12「当日收益明细」全部 8 行均为绿色负值（QDII），加和 ≈ -¥506
- 两侧反号，差额 ~ +¥5.7k

## Root cause
1. 日历 `dailyPnlByDate(dailySeries)` = `dailySeries[i].pnl - dailySeries[i-1].pnl`，pnl=`MV-vStart-cumulativeNetCF`，等价于「全组合 mv 相邻差 - 当日 cashflow」。
2. `portfolioMarketValue(sharesByCode, navMap, day)` 对当日 nav 未披露的基金（QDII T+1/T+2、A 股基金当日 nav 尚未刷新等）fallback 用 `findNavOnOrBefore(day)` 取「上一个交易日 nav」。
3. 但当日 BUY tx 的 shares **已经被加入** sharesByCode，amount 也已计入 cumulativeNetCF：
   - 当日 mv 贡献 = `newShares × nav_fallback_old`
   - 当日 cashflow = `newShares × price`
   - 净差 = `newShares × (nav_old - price)`
   - 这部分**伪 pnl** 被错算到「日历单日」。
4. 同一天 `singleDayFundPnl` 对该基金 `hasUpdate = pointToday.date === isoDate` = false → pnl = null，不进明细加和。

→ 日历多出来的 +5.7k = QDII 当日 BUY × (旧 nav − 买入价) 的伪 pnl 之和，明细看不到。

## 修复方案
让日历改用与「当日明细」**同源同语义**的算法：直接复用 `singleDayFundPnl` per-fund 真·当日 pnl 之和。

- 在 `portfolioSeries.js` 暴露 `buildDailyFundPnlMap({ tx, navByCode, fromIso, toIso })`：对范围内每一天调 `singleDayFundPnl`，累加 finite pnl（未披露基金贡献 0）。
- `ReturnCalendar.jsx` 用 `buildDailyFundPnlMap` 替换 `dailyPnlByDate(dailySeries)`。
- `dailyPnlByDate` 保留导出供其他视图引用，但日历不再消费它。
- 自然不变量：**「日历单日格 = 当日明细 finite pnl 加和」**永远成立。

## 步骤
- [x] 探查 `singleDayFundPnl` 与 DailyFundBreakdown 调用路径
- [x] 锁定 root cause（mv fallback + BUY tx 双算）
- [x] 写 plan
- [x] portfolioSeries.js 新增 `buildDailyFundPnlMap` 导出
- [x] ReturnCalendar.jsx import 切换 + 调用换源
- [x] ESLint clean
- [x] commit `727a302` + push + Actions `26018048285` success + Pages last-modified `Mon, 18 May 2026 06:48:51 GMT`
- [x] 回应用户列证据
