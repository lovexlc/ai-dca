# 收益明细当日口径一致性计划

## 目标

修复「收益明细 tab → 当日收益明细」与「持仓总览」在最新交易日的净值/价格口径不一致问题。目标是同一日期、同一基金在收益明细和持仓总览中使用同一份已更新的 Worker 数据，不再出现总览已更新但明细仍停留旧净值的情况。

## 步骤清单

- done: 盘点当日收益明细、收益日历、持仓总览各自的数据来源和日期过滤逻辑。当日明细只拉 NAV history；持仓总览使用 `ledger.snapshotsByCode` 和 `getExpectedLatestNavDate`。
- done: 找出 2026-05-29 明细未更新的具体分支，并统一到已更新的 Worker/实时 snapshot 口径。`DailyFundBreakdown` 现在会用持仓总览同一份 snapshot 对目标日期补齐 NAV 序列后再计算单日收益。
- done: 补充或调整测试，覆盖最新日期明细使用实时 snapshot 的场景。
- done: 构建验证，必要时做页面/接口 smoke。
- done: 记录验证结果和后续部署要求。

## 关键决策

- 不重做收益页 UI，只修正数据源和日期口径。
- 如果收益明细使用历史净值序列而持仓总览使用实时 snapshot，应把最新日期的明细数据用同一 snapshot 覆盖/补齐。
- 保留历史日期的 per-fund NAV 历史口径，避免用实时价格污染历史收益。

## 待确认项

- 无阻塞项。先按“最新日期与持仓总览一致，历史日期保持历史 NAV”实现。

## 产出与验证记录

- 新增 `src/app/income/dailyFundBreakdownData.js`，把持仓总览的 `ledger.snapshotsByCode` 合并到当日明细的 NAV 序列中。若 snapshot 的 `latestNavDate` 已达到该基金 kind 在 `selectedDate` 的预期最新日期，则用 `selectedDate` 承载最新可用净值，让当日明细和持仓总览同口径。
- `src/app/income/DailyFundBreakdown.jsx` 改为在 `fetchNavHistoryBatch` 后合并 snapshot，再调用 `singleDayFundPnl`。
- 新增 `test/dailyFundBreakdown.test.mjs`，覆盖 QDII 最新可用净值补齐到 2026-05-29，以及 exchange snapshot 未达到预期日期时不伪造收益。
- `node --test test/dailyFundBreakdown.test.mjs` 通过。
- `node --test test/*.mjs` 通过：8 files / 8 pass / 0 fail。
- `npx eslint src/app/income/DailyFundBreakdown.jsx src/app/income/dailyFundBreakdownData.js` 通过。
- `npm run build` 通过，`DailyFundBreakdown.js` chunk 已更新。
- 浏览器验证：当前会话仍未暴露 Cloudflare `cf-browser.goto/screenshot` 工具；替代使用 Playwright Chromium 移动端打开 `http://127.0.0.1:5173/?tab=holdings#/income`，页面渲染成功并显示 `持仓总览`、`收益/清仓/持仓/记录`、`暂无交易记录`。
