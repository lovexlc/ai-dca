# 数据字典（data glossary）

> 权威口径定义集。当代码/UI 出现同名字段但含义不同时，**以本文档为准**。
> 本文档是 Phase 1 (NAV 分层) 的隶属产出，后续 Phase 2 (收益口径) 会补齐「profit / returnRate 语义对齐」表。

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

## 后续补充（待 Phase 2/4 填）

- 收益表：profit / cumulativeProfit / windowProfit / realizedProfit / per-fund pnl / TWR returnRate / Modified Dietz returnRate / 移动摊薄 totalReturnRate / 清仓 profitRate
- 今日涨跌口径：persistent vs pricePulse vs ReturnCalendar singleDay
- 颜色：rose / emerald / red / amber / slate 语义表
