# 交易历史（history）

- 入口组件：[`src/pages/HistoryExperience.jsx`](../../src/pages/HistoryExperience.jsx)（约 130 行，纯展示）
- 数据来源：`buildTradeHistory()`（来自 [`src/app/tradePlans.js`](../../src/app/tradePlans.js)）

这个 tab 是只读的：它只展示「策略写出来的历史记录」，不接受新增 / 修改。所有写入都来自 `tradePlans` / `dca` tab 在创建/触发计划时附带写入。

## 一、顶部 4 张 StatCard

| 卡片 | 来源 | 说明 |
|---|---|---|
| 策略记录 | `summary.recordCount` | 当前 history 总条数 |
| 累计投入 | `summary.totalInvestment`（`formatCurrency` `¥ ` 前缀） | 只统计已经写入历史的计划金额 |
| 覆盖策略 | `summary.strategyCount` | 当前进入历史的策略数量 |
| 最近执行日 | `summary.latestExecutionDate` + `dcaMeta.cadenceLabel` | 没配置定投时显示「先配置定投计划后才会生成历史」 |

## 二、历史表格

`hasHistory=true` 时渲染一个表格，列结构：

| 列 | 字段 | 渲染 |
|---|---|---|
| 日期 | `row.date` | YYYY-MM-DD |
| 策略 | `row.strategyLabel` | 文本 |
| 类型 | `row.typeLabel` | 文本 |
| 金额 | `row.amount` | `formatCurrency` |
| 状态 | `row.statusTone` + `row.statusLabel` | `<HistoryStatusPill>`（薄包装的 `Pill`） |
| 说明 | `row.note` | 长描述 |

空状态显示「先配置定投计划后才会生成历史」。

## 三、为什么只是只读

- 这个 tab 是「策略行为审计页」，写入由 `dca.js` 在保存 / 模拟触发时主动 append。
- 想清空历史 → 在 `tradePlans` 删除对应计划，或在 `backup` tab 用 WebDAV 恢复历史快照。
- 这种只读约束让导出报表的口径稳定：所有展示数据都来自单一函数 `buildTradeHistory()`，前端不会就地编辑。

## 四、状态键速查

React state：无（只 `useMemo`）

localStorage：

```
aiDcaTradeHistory   # buildTradeHistory() 读取的源数组（在 dca.js / plan.js 中写入）
aiDcaDca            # 定投状态 — 用于派生 dcaMeta.cadenceLabel
```

## 五、相关函数

- `buildTradeHistory()` — `src/app/tradePlans.js`：
  - 输出 `{ rows, hasHistory, summary, dcaMeta }`
  - 已经做了排序（按 `date` 倒序）和金额合计
