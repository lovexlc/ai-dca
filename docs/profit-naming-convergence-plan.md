# Phase 2: 收益率 / profit 口径收敛 plan

## 目标

承接 `docs/data-consistency-audit-plan.md`「Phase 2：收益率/profit 口径收敛」。

收敛 `profit` / `returnRate` / `profitRate` 的同名歧义，让代码里**字段名 = 语义 = 算法**一一对应，避免「同一张卡里两个数字打架」。

## 已拍板决策（2026-05-18 20:21 +08:00）

1. **决策 6 - 现金/未投入余额**：维持现状，**不计入**组合统计（`portfolioSeries.js` 注释「现金视为 0% return」不变）。SELL 后现金从模型中消失，TWR / Modified-Dietz 只看在场资金。
2. **决策 7 - UI 暴露口径**：
   - **区间收益率** = TWR（`buildPortfolioSeries.returnRate`），消费方：IncomeDetailPage 区间 KPI / IncomeSummary 区间 sub / ReturnChart 折线。
   - **累计收益率** = 成本法（`holdingsLedgerCore.summary.cumulativeReturnRate`），消费方：IncomeSummary 顶部「累计收益率」KPI / IncomeDetailPage 顶部「已卖出」副标。
   - Modified-Dietz + 持仓 ROI 仅保留在 `diagnostics` / 代码里做对账，**UI 不显示**。
3. **字段命名策略**：**破坏式重命名**所有同名歧义字段，一次性迁移 CSV/备份/Notify schema。外部 schema 影响面已盘点：
   - **CSV 导出表头是中文**（基金代码/总收益(元)/总收益率/...），与 JS 字段名解耦，**不变**。
   - **WebDAV backup** 透传 localStorage key-value，**不含 derived metric**，**不变**。
   - **Notify worker server** 已在 `workers/notify/src/index.js:1694` 注释「统一丢弃 totals」，client 端 `notifySync.js` 的 totals 白名单实际是死字段，本次顺手**删除**。
   - **唯一 test** `test/clearedLotsAnalytics.test.mjs` 命中 5 处 assertion，同步改名。

## 字段重命名映射

| 模块 | 旧名 | 新名 | 含义 | 公式 |
|---|---|---|---|---|
| `portfolioSeries.js` | `profit` | `windowProfit` | 区间 per-fund 累计盈亏 | Σ_t Σ_fund shares·Δnav |
| `portfolioSeries.js` | `returnRate` | `twrReturnRate` | 区间时间加权收益率 | exp(Σ log(1+r_i)) - 1 |
| `portfolioSeries.js` | `annualizedReturn` | `annualizedTwrReturnRate` | TWR 年化（≥365d 才返） | (1+TWR)^(365/days) - 1 |
| `portfolioSeries.js` | `dailySeries[i].pnl` | 保留（含义已清晰） | 从 from 到 day_i 的累计 per-fund 盈亏 | 同 windowProfit 截至 day_i |
| `portfolioSeries.js` | `diagnostics.modifiedDietz.{profit,returnRate}` | 保留（诊断内部） | Modified-Dietz 对账 | 见模块注释 |
| `holdingsLedgerCore.js` 行级 + 聚合 | `totalProfit` | `unrealizedProfit` | 未实现浮盈 | marketValue - movingTotalCost |
| `holdingsLedgerCore.js` 行级 + 聚合 | `totalReturnRate` | `unrealizedReturnRate` | 成本法浮动收益率 | unrealizedProfit / movingTotalCost |
| `holdingsLedgerCore.js` summary | `realizedProfit / cumulativeProfit / cumulativeReturnRate / todayProfit / todayReturnRate` | 保留（含义已清晰） | 各自定义不变 | 不变 |
| `clearedLotsAnalytics.js` | `profitRate` | `sellCostProfitRate` | 清仓盈利率，**分母是卖出本金** | totalProfit / totalSellCostBasis |
| `clearedLotsAnalytics.js` | `totalProfit` | 保留（清仓段已实现，含义清晰） | Σ realizedProfit | 不变 |
| `holdingsCore.js` (Phase 3 删) | `totalProfit / todayProfit` | 保留旧名（死代码，本 Phase 不动） | — | — |

## 步骤清单

- [x] step-1：补 `docs/data-glossary.md`「字段重命名映射表 + 决策结果」段，作为后续代码改动的字典。
- [x] step-2：`src/app/portfolioSeries.js` 重命名 `profit → windowProfit` / `returnRate → twrReturnRate` / `annualizedReturn → annualizedTwrReturnRate`，更新模块头注释、`buildPortfolioSeries` 返回对象、`diagnostics` 保留。
- [x] step-3：`src/app/holdingsLedgerCore.js` 行级 + 聚合 `totalProfit / totalReturnRate → unrealizedProfit / unrealizedReturnRate`，summary 同步；summary 内 `summary.totalProfit / summary.totalReturnRate` 也改。`cumulative* / realized* / today*` 保留。
- [x] step-4：`src/app/clearedLotsAnalytics.js` `profitRate → sellCostProfitRate`，注释同步。
- [x] step-5：消费方批量改字段引用：
  - `src/pages/HoldingsExperience.jsx`（列 id `totalProfit/totalReturnRate/todayProfit/todayReturnRate` → `unrealizedProfit/unrealizedReturnRate/todayProfit/todayReturnRate`；`metrics.totalProfit` 等访问点；TSV 输出；聚合 summary 卡片 key）
  - `src/app/income/IncomeBreakdownPage.jsx`（内部 bucket key `totalProfit` → `unrealizedProfit`；上游 `p.totalProfit` 读 `aggregateByCode` 的字段同步）
  - `src/app/income/IncomeSummary.jsx`（`cumulativeProfit / cumulativeReturnRate` 不变，但若有 `totalProfit/totalReturnRate` 引用 ledger summary 旧名则同步改）
  - `src/app/income/IncomeDetailPage.jsx`（`rangeSeries.profit/returnRate/annualizedReturn` → 新名；`portfolio.cumulativeReturnRate` 保留）
  - `src/app/income/useCumulativeSparkline.js`（`result?.dailySeries` 字段不变，`profit/returnRate` 没读）
  - `src/app/ReturnChart.jsx`（`series.startValue / series.dailySeries / series.profit/returnRate` 视情况）
  - `src/app/holdingsCore.js` 死代码 → 保留旧名（避免和新 unrealizedProfit 混用，本 Phase 不动；Phase 3 整块删）
- [x] step-6：`src/app/notifySync.js` 清理 `normalizeHoldingsDigest` 内 totals 白名单（server 已统一丢弃），同步精简 worker 端 1694 行附近的注释。
- [x] step-7：`test/clearedLotsAnalytics.test.mjs` 5 处 assertion 改 `profitRate → sellCostProfitRate`；命中的 `totalProfit` 是保留字段，**不改**。
- [x] step-8：本地 `node --test test/clearedLotsAnalytics.test.mjs` 跑通；`grep -rE '\b(totalProfit|totalReturnRate)\b' src/ | grep -v holdingsCore.js | grep -v 旧测试`  应**无遗漏**。
- [x] step-9：commit 拆分推送（每个模块独立 commit），等 GitHub Actions 部署 → bundle chunk grep 验证新名出现。
- [x] step-10：前端 cf-browser-mcp 冲烟（持仓页 / 收益看板 / IncomeDetail）取截图；后端 notify worker `/holdings-rule` GET/POST 冲烟（不传 totals 字段，预期 200）。

## 待确认（执行中遇到再问）

- summary 旧名 `totalProfit / totalReturnRate` 改成 `unrealizedProfit / unrealizedReturnRate` 后，是否要在 summary 上**同时保留**旧名 alias（给 dev console / 调试方便）？默认**不保留**（破坏式）。
- IncomeSummary 顶部「累计收益率」KPI 当前用 ledger.cumulativeReturnRate（成本法），UI 文案是否需要加 tooltip「成本法 = (浮盈+已实现) / 累计投入成本」？默认**加 tooltip**。

## 产出与验证

- 本 plan：`docs/profit-naming-convergence-plan.md`
- 字典：`docs/data-glossary.md`（step-1 增补）
- 每个 step 独立 commit；最后一条带 Actions run URL + bundle chunk 命中证据。
- 验证标准：
  - 单测全过：`node --test test/clearedLotsAnalytics.test.mjs`
  - 全 repo grep：旧字段名仅出现在 `holdingsCore.js`（Phase 3 待删）+ docs。
  - 前端冲烟：持仓页总收益/今日收益数字与改名前一致；IncomeDetailPage 区间收益率 / 年化数字与改名前一致；IncomeBreakdownPage Top5 排序不变。
  - 后端冲烟：`/holdings-rule` POST 不带 totals 仍 200，KV 写入正常。

## Phase 2 收尾报告（2026-05-18 20:35 +08:00）

- **Commit**：`e373e3d refactor(profit-naming): converge profit/returnRate field semantics (Phase 2)`
- **Actions run**：https://github.com/lovexlc/ai-dca/actions/runs/26033956782 → completed success
- **部署版本**：`react-assets-v2/?v=202605181238`
- **本地 test**：`node --test test/clearedLotsAnalytics.test.mjs` 20/20 pass
- **Bundle chunk grep 验证**（tools.freebacktrack.tech）：
  - HoldingsExperience.js (154778B)：unrealizedProfit×2 / unrealizedReturnRate×2 / windowProfit×1 / twrReturnRate×1 / annualizedTwrReturnRate×1 → 新名全上线；totalProfit/totalReturnRate/profitRate 均 0 残留
  - IncomeDetailPage.js：windowProfit×1 / twrReturnRate×1 / annualizedTwrReturnRate×1 → rangeSeries 返回字段已走新名
  - IncomeBreakdownPage.js：unrealizedProfit×1 / unrealizedReturnRate×1 → 持仓分类聚合已迁移
  - IncomeLiquidationPage.js：sellCostProfitRate×1 / totalProfit×1（清仓 KPI 上下文，按 glossary 保留）
  - index.js：unrealizedProfit×1 / unrealizedReturnRate×1 → 主 chunk 同步
- **未迁移范围（按计划）**：
  - `clearedLotsAnalytics.totalProfit` = 清仓总收益（与持仓 unrealizedProfit 不冲突）
  - `holdingsCore.js` totalProfit/totalReturnRate 是死代码，Phase 3 整块删除
  - `workers/notify/src/index.js:1694` 注释保留作为历史说明
- **Notify worker 契约**：client 不再发 totals，server 原就丢弃 totals → 0 变更 0 契约风险

## Phase 进度

- Phase 1 NAV 分层：✅ (commit `ea1a86a`)
- **Phase 2 收益口径收敛：✅ (commit `e373e3d`)**
- Phase 3 holdingsCore 死代码清理：⏳
- Phase 4 颜色 + BUY/SELL 中性化：⏳
