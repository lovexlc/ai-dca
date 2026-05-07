# 基金切换收益分析（fundSwitch）

- 入口组件：[`src/pages/FundSwitchExperience.jsx`](../../src/pages/FundSwitchExperience.jsx)（约 1180 行）
- 叶子展示组件：[`src/pages/fundSwitch/sections.jsx`](../../src/pages/fundSwitch/sections.jsx)
- 计算核心：[`src/app/fundSwitch.js`](../../src/app/fundSwitch.js) + [`src/app/fundSwitchHelpers.js`](../../src/app/fundSwitchHelpers.js)
- 数据源（场内 ETF）：`src/app/nasdaqPrices.js` 提供 `loadLatestNasdaqPrices / findLatestNasdaqPrice`

> 这个 tab 解决的问题：「我把场外 A 切到场内 B 之后，到底比不切多挣 / 少挣了多少钱？」
> 不只是单一汇率换算，而是会把多笔分批换仓 + 现金补入 + 手续费一起做对账。

## 一、文档（document）模型

一个 fundSwitch document 是一次完整的换仓对账记录，由若干识别行 + 比较参数构成。

| 函数 | 作用 |
|---|---|
| `createDefaultFundSwitchState()` | 空白状态 |
| `readFundSwitchState()` | 读当前正在编辑的 document |
| `persistFundSwitchState(state, computed)` | 持久化当前编辑态 |
| `readFundSwitchDocuments() / readFundSwitchDocument(id)` | 已保存 document 列表与单条读取 |
| `saveFundSwitchDocument(state, opts)` | 保存当前编辑为新 document（或更新） |
| `deleteFundSwitchDocument(id)` | 删除 document |
| `readFundSwitchHistory()` | 历史归档（结果快照） |
| `saveFundSwitchHistoryEntry(state, computed)` | 把当前 document 写入历史 |
| `deleteFundSwitchHistoryEntry(id)` | 删历史条目 |
| `buildFundSwitchSummary(state, { getCurrentPrice })` | 核心计算入口，产出 `summary.comparison` |
| `deriveFundSwitchComparison(rows, comparison, strategyOverride)` | 用不同策略口径重新算对比 |

## 二、URL hash 路由

- `parseFundSwitchHashRoute(hash)`：解析 `#doc-<id>` → 切换到对应 document。
- `isFundSwitchViewHash(hash)` / `buildFundSwitchViewHash(docId)`：写入 hash。
- React state 中 `routeState` 受 `readFundSwitchRouteState` 控制；切换 document 时不刷新页面。

## 三、UI 工作流（4 步骤）

顶部一个 expandable workflow，受 `expandedStepKey` 控制（点击展开 / 折叠当前步骤）。

| Step | 关键 UI | 说明 |
|---|---|---|
| 选择策略口径 | `FUND_SWITCH_STRATEGIES` 下拉（`STRATEGY_LABELS / STRATEGY_DESCRIPTIONS`） | 决定 `comparison` 计算用「按金额/按份额/按净额」哪种算法 |
| 录入识别行 | `rows[]` 表格 | 字段：日期 (`例如 2026-03-29`)、基金代码、净值 (`step=0.0001`)、金额 (`step=0.01`)；可粘贴或截图 OCR 导入 |
| 校准价格 | 「计算参数 / 收益口径与价格校准」 Section | 当前价默认从 `loadLatestNasdaqPrices` 拉，允许人工覆写 |
| 成本调整 | 「成本调整 / 切换成本调整项」 Section | `comparison.extraCash`（额外补入现金）、`comparison.switchCost`（切换成本）、`feePerTrade × feeTradeCount`（按笔数算手续费） |

## 四、收益摘要（`buildFundSwitchSummary`）

返回的 `summary` 含三张 CompactMetricCard：

- **「如果不换，现在值多少」** — 仍持有原 ETF 在当前价下的市值
- **「换到现在这只后，值多少」** — 完成换仓 + 现金补入后的当前市值
- **「现持仓浮盈」** — `换后市值 − 已识别成交累计金额 + 已计入额外现金`

以及辅助 metric：

- 「预估处理金额」= 已识别记录累计成交额
- 「额外补入现金」= 已计入最终真实额外收益
- `summary.comparison.advantage` 用 `getAdvantageTone` 决定徽章颜色（emerald/red/slate）

## 五、数据导入路径

1. **手动逐行**：表格内直接增/删/改行（`createEmptyFundSwitchRow()` + `Trash2`）。
2. **截图 OCR**：复用 `recognizeLedgerFile`（`POST /api/holdings/ocr`），把识别出的成交按字段映射到 `rows[]`。`ocrState` 跟踪上传 / 解析状态。
3. **从持仓 ledger 派生**：用持仓中的成交记录直接构造 `rows[]`（用 `buildFundSwitchStateFromHistoryEntry` / `buildFundSwitchStateFromDocument` 反向再编辑）。

## 六、状态键速查

React state：

```
state                  // 当前编辑中 document（rows + comparison + 策略 + currentPrice 等）
documentEntries        // 已保存 document 列表（左栏）
historyEntries         // 已归档历史结果
ocrState               // OCR 上传 / 解析进度
activeWorkspacePanel   // details | summary（默认 details，等结果确认完跳 summary）
routeState             // hash route 状态
expandedStepKey        // 展开的工作流步骤
highlightedRowIndex    // OCR 结果高亮的行
confirmError           // 确认按钮的报错
priceState             // 价格快照拉取状态：idle/loading/ready/error
```

localStorage：

```
aiDcaFundSwitchState        # 当前编辑态（reset 时清空）
aiDcaFundSwitchDocuments    # 已保存 document 数组
aiDcaFundSwitchHistory      # 历史归档结果
```

## 七、和其他 tab 的耦合

- 持仓 tab：换仓链路（`switchChains`）的源 / 目标流水可以快速生成一份 fundSwitch document。
- 价格服务：和加仓 dashboard / NewPlan 共用 `nasdaqPrices.js`，避免重复请求。
- AI 助手：`buildFundSwitchSummary` 的运行结果会作为 page context 注入 AI 问答。
