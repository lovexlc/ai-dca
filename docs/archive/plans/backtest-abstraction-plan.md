# 回测逻辑抽象整合计划

目标：把溢价差回测收敛到统一入口，消除同名函数冲突、重复工具函数和 worker V1/V2 分叉。

## 状态

完成日期：2026-06-24

| 步骤 | 状态 | 结果 |
| --- | --- | --- |
| S1 冻结现状基线 | done | 以现有 `test/quantTrading.test.mjs`、`test/quantPremiumRoutes.test.mjs` 作为回归基线。 |
| S2 新建 core | done | `src/app/backtest/core/` 提供 math、candles、nav、account、simulator。 |
| S3 新建 premiumSpread 引擎 | done | `src/app/backtest/engines/premiumSpread.js` 为前端唯一溢价差引擎，成交逻辑复用 core simulator。 |
| S4 统一入口 | done | `src/app/backtest/index.js` 暴露 `runBacktest()`，保留 `runPremiumSpreadBacktest` deprecated alias。 |
| S5 改造调用方 | done | 前端回测入口统一调用 `runBacktest()`；`EtfSwitchStrategyPage` 移除样例/V1 回测分支。 |
| S6 Worker 适配 | done | `workers/notify/src/backtest/` 镜像统一模块；`quantPremiumBacktestV2.js` 改为薄适配；`quantPremiumRoutes.js` 移除内联 V1 和 useV2 分叉。 |
| S7 清理玩具版 V1 | done | `quantTrading.js` 删除公式版 `runPremiumSpreadBacktest`，转发统一 backtest 导出；删除 `quantBacktestEngine.js`。 |
| S8 测试对齐 | done | 更新 `quantTrading.test.mjs`，新增 `test/backtest-engine.test.mjs`、`test/backtestDataFetcher.test.mjs`，保留 worker 回归测试。 |
| S9 前端验证 | done | `npx playwright test test/e2e/quant-v2-backtest.spec.js --project=chromium` 通过，覆盖 QuantStudio 回测路径。 |
| S10 提交推送 | pending | 代码完成后按仓库流程提交。 |

## 决策

- DCA 回测和 fund-backtest skill 不纳入本轮抽象，保持领域独立。
- Worker 本轮使用复制适配层，长期可抽成 workspace package。
- 旧玩具版 V1 下线；样例数据生成器保留在 `src/app/backtest/engines/sample.js`。
