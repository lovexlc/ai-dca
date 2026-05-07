# 持仓总览（holdings）

- 入口组件：[`src/pages/HoldingsExperience.jsx`](../../src/pages/HoldingsExperience.jsx)（约 3000 行单文件）
- 计算/存储核心：[`src/app/holdingsLedgerCore.js`](../../src/app/holdingsLedgerCore.js) + [`src/app/holdingsLedger.js`](../../src/app/holdingsLedger.js)
- localStorage 主键：`aiDcaHoldingsLedger`（迁移自旧版 `aiDcaAggregateState`）
- 默认主 tab：`holdings`（在 `WorkspacePage.jsx` 中硬编码）

## 一、tab 内的二级视图

顶部主区有 4 个切换：

| `mainViewTab` | 文案 | 数据来源 | 用途 |
|---|---|---|---|
| `aggregate` | 基金汇总 | `aggregateByCode(transactions, snapshotsByCode)` | 默认视图。每只基金一行，展示份额、成本、最新净值、当日收益、累计收益，自动用持仓最新净值做盈亏。|
| `sold` | 已卖出 | `buildSoldLots(transactions)` + `summarizeSoldLots` | FIFO 拆批的已实现收益，按卖出日期倒序。支持显示「换仓链路」的目标代码。|
| `switch` | 换仓链路 | `normalizeSwitchChains` + `computeSwitchChainMetrics` | 将一组卖→买配对成「同一笔钱被链式换仓」的有向链路，逐段展示每段成本、收益、当前持仓段。|
| `ledger` | 成交流水 | `buildLedgerRows(transactions, snapshotsByCode)` | 原始交易明细。可在行内编辑、复制到录入表、删除。|

## 二、右侧抽屉 sidePanel

`sidePanelOpen=true` 时显示，`sidePanelTab` 共三种：

| `sidePanelTab` | 内容 |
|---|---|
| `summary` | 选中基金的汇总摘要：当前持仓、成本、最新净值、当日 / 累计收益、QDII 累计 N 日提示。|
| `create` | 单条新增表单（基金代码、名称、类型、买卖、日期、份额、单价、备注）。|
| `edit` | 选中流水的编辑缓冲，受 `editingTxId / editingBuffer` 控制。|

外加几个浮层 Modal：粘贴 Excel（`pasteModalOpen`）、OCR 截图导入（`ocrModalOpen`）、跨基金链路换仓选择（`switchPickerOpen` / `chainPicker`）。

## 三、数据导入路径

1. **手动单条**：`sidePanelTab=create` 表单 → `persistLedgerState`。
2. **粘贴 Excel/TSV**：`parseExcelPaste` 把 TSV 解析成多行 → 校验 → 批量 append。
3. **截图 OCR**：`recognizeLedgerFile(file)` → 走 `POST /api/holdings/ocr`（ocr-proxy worker） → 解析为 `transactions[]` 草稿。
4. **链路换仓**：在 sold 视图选源仓 → `switchPickerOpen` → 把目标买入跟源卖出绑定，写入 `switchChains`。

所有路径最终都进入 `normalizeTransaction` + `getTransactionErrors` 双重校验。无效记录会显式标记「跳过」，不会进入持仓。

## 四、净值刷新

顶部 `RefreshCw` 按钮触发 `requestLedgerNav(codes)`，调用：

- `POST /api/holdings/nav`（ocr-proxy worker）
- 请求体：`{ items: [{ code, kind }] }`
- 响应：每个 code 对应 `{ navDate, navValue, previousNavDate, previousNavValue, latestPrice }`
- 成功结果由 `mergeSnapshotsFromNavResult` 合并到 `state.snapshotsByCode`。

基金类别检测：`detectFundKind(code, name)` → `otc / exchange / qdii`。QDII 走 ocr-proxy 的 QDII 分桶（动态 TTL，按持仓时是否在交易日 / 是否盘中切换缓存窗口）；A 股 ETF 在 9:30–15:00 之间会被 notify worker 的 `push2` 实时价覆盖到最近的成交价，收盘后落回到当日收盘价。

## 五、关键聚合逻辑（来自 `holdingsLedgerCore.js`）

- `buildLotMetrics(tx, snapshot, options)`：每条交易计算 `cost / shares / latestValue / unrealizedPnL / todayPnL`。
- `aggregateByCode`：按基金代码聚合，得到 `aggregates[]`，包含 `holdingShares / avgCost / latestNav / todayProfit / todayProfitSpanDays / todayProfitHolidayDays`。其中 `todayProfit*` 跨周末/法定假期的「窗口收益」会带 hover tooltip 提醒「这是空窗累计涨跌不是单日波动」。
- `summarizePortfolio(aggregates)`：汇总当前总市值、总成本、总浮盈、当日合计盈亏、按 fund-class 拆分的「H 高溢价 / L 低溢价」桶。
- `buildSoldLots(transactions)`：FIFO 拆批求已实现收益。
- `buildLedgerRows(transactions, snapshotsByCode)`：把交易和最新净值合并成流水视图行。
- `buildHoldingsNotifyDigest({ aggregates, summary })`：被 NotifyExperience 用来生成「今日持仓推送 digest」。
- `parseExcelPaste(text)`：粘贴板 TSV 解析（支持中英文表头映射）。
- `normalizeSwitchChain / normalizeSwitchChains`：换仓链路 schema 规整。
- `computeSwitchChainMetrics`：按链路逐段计算损益。

## 六、状态键速查

React state（`useState`）：

```
ledger          // 全部交易、快照、链路（持久化主对象）
kindFilter      // all | otc | exchange | qdii
searchText      // 列表搜索
selectedCode    // 选中基金
sidePanelTab    // summary | create | edit
sidePanelOpen
mainViewTab     // aggregate | sold | switch | ledger
draft / draftMode / editingTxId / editingBuffer
navStatus       // 净值刷新状态
ocrState / ocrModalOpen / ocrPreview / ocrWarningsExpanded
importMenuOpen / pasteModalOpen / pasteText / pasteResult
switchPickerOpen / switchPickerSearch / chainPicker / chainPickerSearch
```

localStorage：

```
aiDcaHoldingsLedger     # ledger.transactions / snapshotsByCode / switchChains / lastNavRefreshedAt
```

## 七、和其他 tab 的耦合

- 通知 tab：`buildHoldingsNotifyDigest` 提供给 `NotifyExperience` 做「持仓推送规则」开关 + 数据。
- 切换策略子页（tradePlans → switch）：从 `aggregateByCode` 派生持仓基准，自动决定基准 ETF 列表，不需要手选。
- 基金切换收益分析（fundSwitch）：通过持仓代码列表辅助 OCR 解析与历史归档。

## 八、相关文档

- 净值与 QDII 分桶规则：[`docs/qdii-nav-rules.md`](../qdii-nav-rules.md)
- 实时通道（A 股盘中 push2 → ledger latestNav）：[`docs/architecture/realtime-channel.md`](../architecture/realtime-channel.md)
