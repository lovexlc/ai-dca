# TWR 收益率改造 plan

## 目标
把 `今年来收益率` / `区间收益率` / `年化` 从 Modified-Dietz 资金加权口径切换到 TWR（Time-Weighted Return，时间加权收益率），让收益率与图表上的沪深300基准（`endNav/startNav-1`）同口径，可直接对比；同时与「总盈利率 = totalProfit/totalCost」并排不再误导。

## 根因复盘
- Modified-Dietz 分母 = vStart + weightedCF，weightedCF 给后期加仓打折（一笔 5/15 加仓只算 ~2.5% 权重）。当 vStart 较小、今年大额加仓主要在窗口后期发生时，分母被严重压缩，率被严重放大。
- 用户判断「6.4% vs 42.25%」差距不合理是正确的：两个数字口径不同。
- TWR 直接基于「每日真涨跌 / 前一日市值」连乘，与现金流时间无关，等价于「假设投入 1 元从首日持有到末日」的回报率，与沪深300等单位净值口径完全对齐。

## 算法
```
for each day i:
  pnl_i = Σ_fund sharesPrev × (nav_i - nav_{i-1})   // 已在 singleDayFundPnl 实现
  V_{i-1} = 前一日收盘市值（第一天用 vStart）
  r_i = V_{i-1} > ε ? pnl_i / V_{i-1} : 0
  cumLogR += log(1 + r_i)                            // 数值稳定累乘
TWR = exp(cumLogR) - 1
annualized = (1 + TWR)^(365/days) - 1，days < 365 不年化（保留 v3 护栏）
```
Modified-Dietz 结果保留到 `diagnostics.modifiedDietz` 供对账。

## 步骤

- [x] step-1 写 plan.md
- [x] step-2 改 `buildDailySeries`：增 `dailyReturn` + `twrCumulative`，log 累乘（L193-235）
- [x] step-3 改 `buildPortfolioSeries`：`returnRate` 切 TWR，`annualizedReturn` 用 TWR，`diagnostics.twr` 新增（L305-319）
- [x] step-4 ESLint clean
- [x] step-5 commit `3f7ca80` push success
- [x] step-6 Actions run `26019351651` head_sha `3f7ca80` completed success；Pages root last-modified `Mon, 18 May 2026 07:22:09 GMT`（CST 15:22）
- [x] step-7 cf-browser-mcp script 模式不可用 → 降级到 Actions sha + Pages last-modified 证据
- [x] step-8 回应用户

## 关键决策
- TWR 是行业标准用来与指数基准对比的口径；用户希望「今年来收益率」与图表上的沪深300线可比，TWR 是唯一正解。
- profit（金额口径）仍用「per-fund 真当日 nav 增量累加」（Turn 32 落点），不动。只动「收益率」字段。
- 「总盈利率 totalReturnRate = totalProfit/totalCost」是另一口径，不动。两个数字在 UI 上将自然不同：TWR 是「单位净值视角」，总盈利率是「投入本金视角」。

## 待确认项
- 无（用户已选 A. TWR）

## 产出 & 验证
- 部署证据（待填）：commit / Actions / Pages last-modified
- 不变量（用户验证）：
  - 区间内每日 dailyReturn 累乘 ≡ TWR
  - profit 金额不变（仍是 per-fund 真增量累加）
  - 沪深300 基准与持仓收益率同口径，可直接对比
