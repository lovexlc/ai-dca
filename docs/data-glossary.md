# 数据字典（data glossary）

> 权威口径定义集。当代码/UI 出现同名字段但含义不同时，**以本文档为准**。
> 本文档是 Phase 1 (NAV 分层) + Phase 2 (收益口径) 的共同产出。

## NAV 相关

| 字段 | 含义 | 上游源 | 时效 | 读取者 |
|---|---|---|---|---|
| `latestNav` | 最新净值（可能是当日实时） | ocr-proxy `/api/holdings/nav` → 天天基金 DWJZ；开盘期间 notify worker push2 实时覆盖；ETF 走最后成交价分支 | 交易时段：实时；非交易时段：T-1 公布 | HoldingsExperience KPI / Notify digest / TopN / Holdings 录入回填 |
| `previousNav` | 上一交易日公布净值 | 同上 `/api/holdings/nav` `snapshot.previousNav` | T-1 | 持仓页「今日盈亏」分母 |
| `navHistory[].nav` | 指定区间逐日公布单位净值 | ocr-proxy `/api/holdings/nav-history` → 天天基金历史表 | **末端始终 = T-1**，不含当日实时变动 | IncomeSummary 曲线 / IncomeDetail 主图 / ReturnChart / ReturnCalendar / useCumulativeSparkline / DailyFundBreakdown |
| `latest-nav.json` | GitHub Action 预生成的离线净值 | `lovexlc/ai-dca` Actions 周期任务产物，仅供 SwitchStrategy | T-1 或更早（取决于上次 Action 跑的时间） | SwitchStrategyExperience 仅作 fallback |
| K 线 `latestBar.close` / `firstBar.open` | 行情中心 K 线最新/开盘点价 | markets worker 分钟级 K 线 | 实时（仅 ETF/股票，场外基金无效） | HomeExperience `pricePulse.changePct`（与持仓页今日涨跌口径不同） |

### 分层原则

- 需要「实时」看数字（持仓 KPI / 今日盈亏 / 推送 / TopN / 录入回填）→ **`latestNav`** 路径。
- 需要「历史走势 / 累计对账」（收益看板曲线 / Chart / Calendar / Sparkline）→ **`navHistory`** 路径，末端 T-1，接受漂移。
- 两者出现在同一页面时，UI 必须给「末端面」加「截至 YYYY-MM-DD」提示，避免用户对不上帐。

### 反例 / 常见误用

- ❌ 把 `latestNav` 填回 `navHistory` 末端伪造实时曲线 → 会让 TWR / cumulativeProfit 隐含「当日交易时段未公布的估算净值」，难以复现 / 对账。
- ❌ 用 K 线 `(close - open) / open` 去跟持仓页「今日涨跌」对账 → 两者分母不同（K 线是当日开盘价，持仓页是 T-1 公布净值）。后续 Phase 4 统一。
- ❌ SwitchStrategy 直接信任 `latest-nav.json` 不做时效检查 → 可能暴露两三天前的 NAV。Phase 1 step-6 会加 fallback。

## profit / returnRate 字段表（Phase 2 收敛后）

> 关键原则：**字段名 = 语义 = 算法**，一一对应。代码里出现的同名字段含义必须以本表为准；UI 上的口径选择参考「UI 呈现」列。

| 字段（新名） | 模块 | 含义 | 公式 | UI 呈现 |
|---|---|---|---|---|
| `unrealizedProfit` | `holdingsLedgerCore` 行级/聚合/summary | 未实现浮盈 | `marketValue - movingTotalCost` | HoldingsExperience 持仓表「总收益(元)」/ IncomeBreakdownPage 分类聚合 |
| `unrealizedReturnRate` | 同上 | 成本法未实现收益率 | `unrealizedProfit / movingTotalCost × 100` | HoldingsExperience 持仓表「总收益率」 |
| `realizedProfit` | `holdingsLedgerCore.summary` | 历史已实现收益 | Σ `(sellPrice - avgCost)·sellShares` | 计算 cumulativeProfit 的输入，UI 不直显 |
| `cumulativeProfit` | `holdingsLedgerCore.summary` | 未实现+已实现合计 | `unrealizedProfit + realizedProfit` | IncomeSummary 顶部「累计收益(元)」 |
| `cumulativeReturnRate` | `holdingsLedgerCore.summary` | **成本法**累计收益率 | `cumulativeProfit / cumulativeCostBasis × 100` | IncomeSummary 顶部「累计收益率」/ IncomeDetailPage「已卖出」副标 |
| `todayProfit` | `holdingsLedgerCore` 行级/聚合/summary | 今日盈亏（跨节假日时为整段空窗累计） | `(latestNav - previousNav) × shares`，按位汇总 | HoldingsExperience 「今日收益」/ Notify digest |
| `todayReturnRate` | 同上 | 今日收益率 | `todayProfit / previousMarketValue × 100` | HoldingsExperience 「今日收益率」 |
| `windowProfit` | `portfolioSeries.buildPortfolioSeries` | 区间 per-fund 累计盈亏（与 ReturnCalendar/DailyFundBreakdown 同源） | Σ_t Σ_fund shares_{t-1}·(nav_t - nav_{t-1}) | IncomeDetailPage 区间「收益」 |
| `twrReturnRate` | 同上 | 区间**时间加权收益率** | `exp(Σ log(1 + r_i)) - 1`，r_i = dayPnl_i / V_{i-1} | IncomeDetailPage 区间「收益率」/ ReturnChart 与沪深300 对比线 |
| `annualizedTwrReturnRate` | 同上 | TWR 年化（≥365d 才返回，否则 null） | `(1 + TWR)^(365/days) - 1` | IncomeDetailPage 区间「年化」 |
| `dailySeries[i].pnl` | `portfolioSeries.buildDailySeries` | 从 from 到 day_i 的累计 per-fund 盈亏（即 windowProfit 截至 day_i） | 同 windowProfit 累加截止 day_i | ReturnChart 折线 / Sparkline |
| `dailySeries[i].pnlRate` | 同上 | 当日 r_i 比例（TWR 内部用） | dayPnl_i / V_{i-1} | 仅内部使用，不展示 |
| `diagnostics.modifiedDietz.{profit,returnRate,denominator}` | 同上 | Modified-Dietz 对账（决策 7：不上 UI） | `R = (V_end - V_start - NetCF) / (V_start + Σ w_i·CF_i)` | 仅 dev console / 对账 |
| `clearedLotsAnalytics.totalProfit` | `clearedLotsAnalytics` | 全部清仓段累计已实现 | Σ `lot.realizedProfit` | IncomeLiquidationPage KPI |
| `clearedLotsAnalytics.sellCostProfitRate` | 同上 | **清仓盈利率（分母 = 卖出本金，不是总投入）** | `totalProfit / totalSellCostBasis × 100` | IncomeLiquidationPage KPI |

### 决策结果（2026-05-18 20:21 +08:00）

1. **现金/未投入余额**：维持「不计入组合」。SELL 流出的现金从模型中消失；TWR / Modified-Dietz 公式只观察在场资金。这是 `portfolioSeries.js` 的明确设计，**Phase 2 不动**。
2. **UI 口径分工**：
   - 「累计」类指标（IncomeSummary 顶部、IncomeDetailPage「已卖出」副标） → **成本法** `cumulativeReturnRate`。
   - 「区间」类指标（IncomeDetailPage 区间 KPI、ReturnChart 比例线） → **TWR** `twrReturnRate` / `annualizedTwrReturnRate`。
   - Modified-Dietz 与持仓 ROI 仅保留在 `diagnostics` 与代码层对账，不在 UI 暴露切换器。
3. **破坏式重命名**：见上表「字段（新名）」一列。CSV 表头中文不变；WebDAV backup 只透传 localStorage 键值不含 derived 字段，不受影响；Notify worker server 已在 `workers/notify/src/index.js:1694` 丢弃 totals，client 端 `notifySync.js` 的 totals 白名单同步清理。

## 反例 / 常见误用（收益口径篇）

- ❌ `IncomeSummary.cumulativeReturnRate` 与 `rangeSeries.twrReturnRate` 直接相减做「最近 N 天贡献」 → 分母不同（成本 vs 在场资金），不可比。
- ❌ `clearedLotsAnalytics.sellCostProfitRate` 当作总投入 ROI 解读 → 分母是「已卖出本金」，会高估清仓策略的整体收益率。
- ❌ `dailySeries[i].pnlRate` 当作展示用的「当日收益率」 → 这是 TWR 内部 r_i = dayPnl / V_{i-1}，仅用于 log 累乘，UI 不应直显。

## 后续补充（待 Phase 4 填）

- 今日涨跌口径：持仓 todayProfit vs HomeExperience pricePulse vs ReturnCalendar singleDay
- 颜色：rose / emerald / red / amber / slate 语义表 + BUY/SELL 中性化
