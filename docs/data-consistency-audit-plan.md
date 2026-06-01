# 数据一致性审计 plan

## 目标

全面盘点 ai-dca 项目里跟「净值 / 收益 / 盈亏 / 涨跌幅 / 颜色语义」相关的数据口径，找出

- 「同一指标多处实现」
- 「同名字段含义不同」
- 「同义字段不同名」

先定级归档，再按用户确认顺序拆子任务修复，避免再发生 5/12 那类"日历看到 -X 元、首屏看到 +Y 元"的对账偏差。

## 步骤清单

- [x] step-1：grep 收集所有 nav / profit / returnRate / latestNav / todayProfit / pnl 出现点
- [x] step-2：梳理 NAV 数据流的所有上游/下游链路
- [x] step-3：识别「同名不同义」+「同义不同名」+「死代码」
- [x] step-4：写本 plan，列出问题与初步修复方向
- [x] step-5：与用户对齐修复优先级 + 决策项（ask-survey）—— 见末尾「决策结果」
- [x] step-6：按优先级拆子任务（每项独立 plan + 独立 commit）—— Phase 1 见 `docs/nav-source-stratification-plan.md`
- [x] step-7：执行 + 验证 + 部署证据（Phase 1-4 全部完成）

---

## 一、净值（NAV）来源链路不统一

不同页面拿"价格/净值"走的是完全不同的链路：

| 入口 | 上游来源 | 字段 | 时效 |
|---|---|---|---|
| 持仓 ledger / 收益看板 KPI / Notify 推送 | `/api/holdings/nav`（ocr-proxy worker → 天天基金 DWJZ）`workers/ocr-proxy/src/index.js:1506-1509` | `snapshot.latestNav`、`previousNav` | 公布单位净值，场外 T+1 |
| ETF（场内） | 同接口走「最后成交价」分支 `workers/ocr-proxy/src/index.js:1878-1881` | `latestNav` = `latestPrice` | 实时分钟价 |
| 实时回写覆盖 | notify worker 在 A 股开盘期间 push2 写入 `latestNav` | 直接覆盖 ocr-proxy 上游 | 实时 |
| ReturnCalendar / IncomeDetail / ReturnChart / DailyFundBreakdown / useCumulativeSparkline | `fetchNavHistory` → `/api/holdings/nav-history` + IndexedDB 缓存 `src/app/navHistoryClient.js`、`workers/ocr-proxy/src/index.js:1605` | `items[].nav`（仅公布单位净值） | T+1 公布值，**交易时段不与 latestNav 同步** |
| SwitchStrategy | 前端：`/api/holdings/nav`（getNav）；后端信号：`data/<code>/latest-nav.json`（getNav） | `payload.latestNav` | 前端实时/公布，信号端仍可能是 T-1 |
| 行情中心（HomeExperience） | markets worker K 线 + `selectedFund.current_price` `src/pages/HomeExperience.jsx:352-366` | `latestBar.close` / `firstBar.open` | 实时 K 线，**不走 nav 链路** |
| Holdings 录入回填 | ocr 识别 + live snapshot.latestNav `workers/ocr-proxy/src/index.js:700-702` | `liveSnapshot.latestNav` | 主接口同源 |

**风险点**：

- 开盘期间持仓页 KPI 用 push2 写入的实时 `latestNav`，但 IncomeSummary / IncomeDetail 累计图末端用 `fetchNavHistory` 公布单位净值（T-1）→ 同一时刻两个数字差几个点。
- 行情中心"今日涨跌"用 K 线 `(close - open) / open`，持仓"今日涨跌"用 `(latestNav - previousNav) / previousNav` → 同一只 ETF 同一天可能呈现两个完全不同的百分比。
- SwitchStrategy 后端信号仍依赖离线 latest-nav.json，与主链路在 T-1 收盘前可能差一天；前端已改为 /api/holdings/nav。

---

## 二、收益率/盈亏 至少 5 套算法并存

1. **持仓 KPI：移动摊薄成本法**
   `src/app/holdingsLedgerCore.js:488-516, 543-550`
   - `totalProfit = marketValue - movingTotalCost`
   - `totalReturnRate = totalProfit / movingTotalCost`
   - `todayProfit = (latestNav - previousNav) × shares`
   - 消费方：HoldingsExperience、IncomeSummary 顶部、Notify digest。

2. **portfolioSeries Modified Dietz**
   `src/app/portfolioSeries.js:113-168`
   - `R = (V_end - V_start - NetCF) / (V_start + Σ w_i·CF_i)`
   - 当前只保留在 `diagnostics.modifiedDietz`，不对外。

3. **portfolioSeries TWR（时间加权收益率）**
   `src/app/portfolioSeries.js:200-218, 307-319`
   - `cumLogReturn += log(1 + dayReturn)`，`returnRate = exp(cumLogReturn) - 1`
   - 外露字段 `returnRate` 用这一套，消费方：IncomeSummary、IncomeDetail 主图、累计 sparkline、ReturnChart。

4. **portfolioSeries per-fund 真·NAV 增量累加**
   `src/app/portfolioSeries.js:199-237, 303-318`
   - `profit = Σ_t Σ_fund shares_{t-1} × (nav_t - nav_{t-1})`
   - 外露字段 `profit` 用这一套，与 ReturnCalendar / DailyFundBreakdown 同源（同样调用 `singleDayFundPnl`）。

5. **清仓盈利率**
   `src/app/clearedLotsAnalytics.js:141-143`
   - `profitRate = totalProfit / totalSellCostBasis`（分母是"卖出成本"，不是总投入）

**已知矛盾**：

- 同一张 IncomeSummary 卡里：`profit`（per-fund 累加） vs `returnRate`（TWR） —— 分子分母分属两个模型，肉眼对账 `profit / startValue ≠ returnRate`。
- 持仓页 `totalReturnRate`（持有成本视角）vs IncomeSummary `returnRate`（TWR）—— 同一份组合同一时刻两个数字不同。
- 清仓盈利率分母是"卖出成本"，跟普通 ROI 不同；用户看到 +X% 容易误以为是总收益率。

---

## 三、profit / pnl 同名歧义

| 出现位置 | 含义 | 公式 |
|---|---|---|
| `holdingsLedgerCore.summary.totalProfit` | 未实现浮盈 | `marketValue - totalCost` |
| `holdingsLedgerCore.summary.cumulativeProfit` | 未实现 + 已实现 | `totalProfit + realizedProfit` |
| `holdingsLedgerCore.summary.realizedProfit` | 已实现 | Σ `(sellPrice - avgCost)·sellShares` |
| `portfolioSeries.profit` | 区间 per-fund 累计盈亏 | Σ_t shares·Δnav |
| `dailySeries[i].pnl` | 起始日至 day_i 累计盈亏 | 同上 |
| `clearedLotsAnalytics.totalProfit` | 全部清仓段累计 | Σ `realizedProfit` |
| `holdingsCore.totalProfit`（旧版本 `src/app/holdingsCore.js:139`） | `(latestNav - avgCost)·shares` | **已废弃但还导出**（见第五节） |

**建议**：建立 `docs/data-glossary.md`，把这些口径写死。代码里同名字段加前缀消歧（`unrealizedProfit` / `cumulativeProfit` / `windowProfit` / `realizedProfit`）。

---

## 四、「今日涨跌」窗口/分母不一致

| 位置 | 分子 | 分母 |
|---|---|---|
| 持仓页 `todayProfit` / `todayReturnRate` | `(latestNav - previousNav) × shares` | `previousMarketValue` |
| 行情中心 `pricePulse.changePct` `HomeExperience.jsx:356-358` | `latestPrice - firstBar.open` | `firstBar.open` |
| ReturnCalendar 日历 | 单日 `singleDayFundPnl` 求和 | 不显式分母（只显示金额） |
| DailyFundBreakdown 单日明细 | per-fund `shares_{t-1} × (nav_t - nav_{t-1})` | 同上 |

**跨节假日**：持仓页 `todayProfit` 会把整段空窗累计算成"今日"（已有 tooltip `HoldingsExperience.jsx:2364` 标注），但行情中心从未做降级处理 → 节后第一天数字常常对不上日历。

---

## 五、`holdingsCore.js` 老版本残留（dead-code 风险）

`src/app/holdingsCore.js` 仍导出 `buildHoldingMetrics` / `summarizeHoldingRows`（line 130-216），其中 `totalProfit = (latestNav - avgCost)·shares` —— **不是移动摊薄**，跟现行 ledger 完全不同。

现状：

- 这两个函数 **没有被任何地方再调用**（grep 后只剩 `holdings.js` 引入 `createEmptyHoldingRow` / `getHoldingCodeList` 等工具函数）。
- 一旦未来有人误调，会立刻产生与 ledger 不一致的指标。

**建议**：保留 `holdingsCore.js` 里 row 规范化/校验工具，**移除** `buildHoldingMetrics` / `summarizeHoldingRows`；指标计算唯一入口收敛到 `holdingsLedgerCore.js`。

---

## 六、颜色语义未完全统一

Turn 3 已定调「涨红跌绿」。现状盘点：

- ✅ `src/app/income/*` 全部 `text-rose-600` / `text-emerald-600`。
- ⚠️ `src/pages/HoldingsExperience.jsx` 同时存在两套色板：
  - 主体涨跌色：`text-rose-600` / `text-emerald-600` ✅（line 377/390/403/416/620/634/648/662/1945）
  - 异常态/失败态：`text-red-500` / `text-red-600` / `bg-red-50`（line 569/698/884-891/1740-1744/1876/1897）—— 与 rose 色板色相略偏，建议统一到 `rose-*` 或明确划分「rose=涨/red=危险/error」两类。
- ⚠️ 交易动作 tag（line 510 / 1865）：`BUY = bg-emerald-50/text-emerald-600`（绿）、`SELL = bg-red-50/text-red-500`（红）。这是「资金流」语义（BUY=入场绿、SELL=离场红），但跟整体"涨红跌绿"语义相反，容易被误读。
  - 决策待定：① 沿用资金流色板 + 加文字图标 ② 改为与涨跌一致（BUY 红 SELL 绿） ③ 改为中性灰色 + 形状区分。

---

## 七、其他散点

- **现金 / 费用未参与计算**：`portfolioSeries.js:10` 明确「现金不参与（视为 0% return）」。卖出获得的现金/未投入余额不在任何页面体现，会与"实际账户净值"偏差。
- **`normalizeFundKind` 在 aggregateByCode 重识别 QDII**（`holdingsLedgerCore.js:527-530`）：历史 `kind='otc'` 的 QDII 基金在持仓页会自动升级为 `qdii`，但导出 CSV / 备份 / 同步接口里仍是 `otc`，重新导入后再次 normalize 才归位 → kind 字段历史值与持仓页显示不一致。
- **`getActiveHoldingCodeList`（Turn 44）vs `aggregateByCode.hasPosition`**：两套"当前持仓"判定。前者只看份额 > 0，后者带成本/市值。理论一致，需加单测保证永远同步。
- **TWR 年化护栏**：`portfolioSeries.js:174-176` 不足 1 年不年化（返回 `null`）。但部分卡片可能还在用 `returnRate * (365/days)` 做手算年化（待 grep 二次确认）。

---

## 关键决策（待用户拍板，会以 ask-survey 形式发送）

1. **修复优先级**：NAV 来源统一（影响最大）/ 删 holdingsCore 死代码（清洁）/ 颜色统一（视觉）/ data-glossary 沉淀文档 —— 先做哪个？
2. **NAV 唯一权威源**：开盘期间 latestNav 是否要回灌进 navHistory 序列末端（让 IncomeSummary 与持仓页同步）？
3. **行情中心"今日涨跌"**：是否改成与持仓口径一致（`(latestNav - previousNav) / previousNav`）而非 K 线开盘对照？
4. **BUY/SELL 配色**：维持"BUY 绿 SELL 红"资金流语义，还是统一为「涨红跌绿」？
5. **跨节假日今日盈亏**：是否在行情中心也加 tooltip 或降级显示？
6. **现金/未投入余额**：是否纳入组合净值统计？
7. **TWR vs Modified-Dietz vs 持仓 ROI**：UI 上是否给用户切换？还是只暴露 TWR（当前实现）？

---

## 决策结果（2026-05-18 17:51 +08:00）

### 已拍板

1. **修复优先级**：按 `Phase 1 NAV 来源分层 → Phase 2 收益率/profit 口径收敛 → Phase 3 holdingsCore 死代码清理 → Phase 4 颜色 + BUY/SELL` 顺序逐个推进，**不并发**。每个 Phase 独立 plan + 独立 commit。
2. **NAV 权威源**：明确分两套，**接受漂移**：
   - 实时态（持仓 KPI / Notify digest / 持仓今日盈亏 / TopN）→ 走 `latestNav`（push2 实时回写 + ocr-proxy DWJZ 兜底）。
   - 历史/累计图（IncomeSummary 收益曲线 / IncomeDetail 主图 / ReturnChart / ReturnCalendar / Sparkline）→ 走 `fetchNavHistory`，序列末端为 T-1 公布单位净值，**不强行回灌 latestNav**。
   - 副作用：交易时段两套数字可能差几个点 → UI 必须给「可能 stale」的末端加感知标记（tooltip / 副标题 / 时间戳）。
3. **BUY/SELL 标签**：改 **中性灰底 + 箭头/形状** 区分（不再用颜色承担方向语义，避免与「涨红跌绿」打架）。

### 留待后续 Phase 决定

- 决策 3「行情中心今日涨跌口径」、决策 5「跨节假日降级」→ 归入 Phase 4。
- 决策 6「现金/未投入余额是否纳入组合净值」、决策 7「TWR vs Modified-Dietz UI 切换」→ 归入 Phase 2。

---

## 产出与验证

- 本 plan：`docs/data-consistency-audit-plan.md`
- 用户确认后：每项修复独立 plan + 独立 commit，避免一次性大改
- 验证标准：「修复前后对账截图（同一时间点、同一基金、跨页面同一数字）」+「单测」+「部署证据」
