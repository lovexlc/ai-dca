# ai-dca 策略引擎修复计划

## 状态

- P0-1 修正金字塔倍数：已完成
- P0-2 宽基/个股参数分离：已完成
- P1 高位少买机制：已完成
- P2-1 个股基本面门槛：已完成
- P2-2 三账户体系：已完成

## 实施摘要

1. `strategyEngine.js` / `newPlan.js`
   - 新增宽基与个股两套金字塔蓝图。
   - 固定回撤计划按 `multiplier` 分配资金，不再使用线性 1-8 权重。
   - 固定回撤计划根据资产类型自动切换宽基 7 档 / 个股 6 档。

2. `assetType.js`
   - 新增 `STRATEGY_PARAMS` 与 `getStrategyParams(symbol)`。
   - 宽基：首买 9%，步长 3.5%，7 档，倍数 `[1,1,1.5,1.5,2,2,3]`。
   - 个股：首买 30%，步长 4.5%，6 档，倍数 `[1,1,1.5,2,2,2.5]`。

3. `smartDca.js` / `dca.js` / `DcaExperience.jsx`
   - 新增 Smart DCA 逻辑：高位仅投 10%，其余进入资金池。
   - 关联建仓计划后，定投页显示距高点跌幅、资金池余额、当前模式与本期投入。

4. `stockScreener.js` / `NewPlanExperience.jsx`
   - 新增个股 checklist。
   - 创建个股计划时展示关键项警告，但不强制阻止保存。
   - checklist 答案与结果随计划保存。

5. `accountManager.js` / `HoldingsExperience.jsx`
   - 新增三账户配置：进取型、稳健型、防守型。
   - 持仓表新增账户下拉列。
   - 持仓页新增账户资产占比卡片。

## 验证记录

- 策略脚本验证通过：
  - QQQ / index：7 档，倍数 `1,1,1.5,1.5,2,2,3`，首买 9%。
  - AAPL / stock：6 档，倍数 `1,1,1.5,2,2,2.5`，首买 30%。
  - Smart DCA 高位：月预算 1000 时投入 100、入池 900。
- 定向 ESLint 通过（本次改动文件 0 error，保留既有 warning）。
- 全量 `npm run lint` 仍因仓库既有问题失败：`IncomeTransactionsPage.jsx`、`ai-chat-widget.jsx`、`data-table-column-header.jsx`、`MarketsChartBlock.jsx`、`MarketsExperience.jsx` 等已有错误。
