# ai-dca 策略体系升级 — 计划与状态

> 创建时间：2026-05-18  
> 来源：用户提交的《ai-dca 策略体系升级 — 技术方案》  
> 范围：买（已有）+ 卖（新增）+ 控（新增）+ 行情中心自选 / AI 分析 + DCA 回测

---

## 0. 目标

在现有「加仓 + 定投」基础上，补齐 **卖出（做T/减仓）**、**VIX 信号**、**仓位管理**、**成本追踪**、**自选 + AI 分析**、**DCA 回测**，形成 **买-卖-控** 完整闭环。

- 宽基指数（QQQ/SPY/VOO 等）：只买不卖，金字塔加仓。
- 个股（Mag7 + 台积电等）：70% 底仓 + 30% 做T，分档减仓（涨 15%/25%/35%）。

---

## 1. 架构（新增模块标记 ★）

```
src/app/
  strategyEngine.js        扩展卖出策略
  plan.js                  扩展 planType
  tradePlans.js            扩展减仓行渲染
  notifySync.js            扩展减仓/VIX/仓位规则
  nasdaqPrices.js          扩展 ^VIX + 历史价格
  homeDashboard.js         嵌入 VIX 摘要 + 放宽 ticker
  ★ sellStrategy.js        卖出/做T 引擎
  ★ vixSignal.js           VIX 信号引擎
  ★ positionManager.js     仓位管理
  ★ costTracker.js         成本追踪 / 负成本
  ★ assetType.js           宽基/个股分流
  ★ stockAnalysisPrompt.js 金渐成 AI prompt
  ★ dcaCalculator.js       DCA 回测引擎

src/pages/
  TradePlansExperience.jsx 扩展 sell / vix / dcaCalc tab
  HomeExperience.jsx       自选按钮 + AI 分析按钮
  HoldingsExperience.jsx   仓位占比 + 真实成本
  ★ SellPlanExperience.jsx 减仓配置页
  ★ VixDashboard.jsx       VIX 面板
  ★ DcaCalculatorExperience.jsx DCA 回测 UI

src/components/
  ★ StockAnalysisPanel.jsx AI 分析弹窗（SSE）
```

---

## 2. 数据模型（新增 localStorage key）

- `aiDcaSellPlanStore` — 卖出/减仓计划（与 `aiDcaPlanStore` 对称）
- `aiDcaVixState` — VIX 当前值 + 信号等级 + 历史
- `aiDcaPositionSnapshot` — 总资产 + 各标的仓位占比
- `aiDcaTradeLedger` — 买卖单笔台账（用于真实成本/已实现盈亏）

### VIX 信号阈值（默认）

| VIX | level | 操作 |
|-----|-------|------|
| < 20 | caution | 过热谨慎 |
| 25 | watch | 关注 |
| 30 | buy-index | 买宽基 |
| 40 | buy-all | 加买个股 |
| ≥ 50 | heavy-buy | 重仓 |

### 资产分类

- `INDEX_SYMBOLS = {QQQ, SPY, VOO, IVV, QLD, TQQQ, SSO, UPRO}` → 只买不卖，跌 9% 首买，每跌 3.5% 加仓，最少 7 次，倍数 `[1,1,1.5,1.5,2,2,3]`，不限仓位。
- 其它 → 个股策略：70% 底仓，单仓上限 50%，跌 30% 首买（优质 20%），每跌 4.5% 加仓，最少 6 次。

---

## 3. PR 拆分与状态

状态：`todo` / `in_progress` / `done` / `blocked`

### PR 0 — 行情中心 AI 分析 + 加仓/定投多标的快选 — `done`
- [x] 新建 `src/app/stockAnalysisPrompt.js`（金渐成框架 prompt，MarketsExperience 复用）
- [x] 改 `src/pages/MarketsExperience.jsx`：自选行「AI 分析」弹窗 + 流式渲染 + 取消（提交 `dbb2bad`）
- [x] 新建 `src/app/extraSymbols.js`（QQQ/VOO/Mag7/TSM 额外标的表）
- [x] 改 `src/pages/NewPlanExperience.jsx` + `src/pages/DcaExperience.jsx`：三组快选 chip、额外标的跳过自动 seed、提醒手填价（提交 `4130965`）
- [ ] 前端验证：cf-browser-mcp 点一轮 AI 分析 + 新建计划页选 NVDA / VOO 看 chip 勿选中状态

### PR 1 — 卖出策略引擎 + 减仓计划页（核心） — `in-progress`
实际交付范围（PR 1 起步，优先打通「手动填入成本/股数 → 生成分档价 → 保存」闭环；plan/notifySync 集成推迟到 PR 1.5）：
- [x] 新建 `src/app/assetType.js`：`INDEX_SYMBOLS` / `getAssetType` / `canSell` / `canHaveTradingPosition`
- [x] 新建 `src/app/sellStrategy.js`：`buildSellPlan` / `evaluateSellSignals`，默认 15/25/35% × 33/33/34%，支持 3–5 档
- [x] 新建 `src/app/sellPlans.js`：`aiDcaSellPlanStore` CRUD + 草稿存储
- [x] 新建 `src/pages/SellPlanExperience.jsx`：Mag7/TSM chip、关联加仓策略、档位预览卡
- [x] 改 `src/pages/TradePlansExperience.jsx`：新增 `#sell` 二级 tab，复用 `Suspense` 加载
- [ ] PR 1.5：改 `src/app/tradePlans.js` 让列表页渲染卖出计划行（`buildSellPlanRows`）
- [ ] PR 1.5：改 `src/app/notifySync.js`：`sell_layer` 规则同步至 worker
- [ ] 单测：`sellStrategy.test.js`（分档计算、超 100% 归一、宽基禁售、股数/利润上限）
- [ ] 前端验证（e2e）：
  1. 打开 `/trade-plans#sell`，选 NVDA chip → 填写成本 100 / 股数 50 → 三档预览价为 115 / 125 / 135
  2. 选 QQQ chip → 页面出现「宽基指数不可挂卖出计划」提示，保存按钮置灰
  3. 调档数 4–5 → 预览档随之增加，卖出比总和在「100%」附近
  4. 保存后重新进入 `#sell`，上次草稿被清空；`localStorage.aiDcaSellPlanStore` 多了一条
  5. 联「加仓策略」下拉选一个已有计划 → symbol 自动同步

### PR 1 — 卖出策略引擎 + 减仓计划页（核心） — `todo`
- [ ] 新建 `src/app/assetType.js`（`isBroadIndex` / `getAssetType` / `getStrategyRules`）
- [ ] 新建 `src/app/sellStrategy.js`（`buildSellPlan` / `checkSellTrigger` / `executeSell` / `calculateTTradeImpact`）
- [ ] 新建 `src/pages/SellPlanExperience.jsx`（参考 `NewPlanExperience.jsx` 结构）
- [ ] 改 `src/app/plan.js`：新增 `planType: 'buy' | 'sell' | 'grid'`
- [ ] 改 `src/app/tradePlans.js`：`buildSellPlanRows` 渲染减仓行
- [ ] 改 `src/pages/TradePlansExperience.jsx`：新增 `sell` tab
- [ ] 单测：`sellStrategy.test.js`（节点计算、触发、底仓保护、做T 新成本）
- [ ] 前端验证：宽基不显示减仓选项、个股可配置 3–5 档、底仓提示生效

### PR 2a — VIX 信号引擎 + 面板 — `done`
- [x] 新建 `src/app/vixSignal.js`：`VIX_THRESHOLDS` / `resolveVixSignal` / `fetchVixSnapshot` / `listVixLevels`，复用 markets worker `/quote/^VIX`
- [x] 新建 `src/pages/VixDashboard.jsx`：数值卡 + 信号等级卡 + 操作建议列表 + 阈值参考表
- [x] 改 `src/pages/TradePlansExperience.jsx`：新增 `#vix` 二级 tab（Activity 图标）
- [x] `aiDcaVixState` localStorage 缓存 · 拉取失败允许手动录入 VIX 数值
- [ ] 前端验证（e2e）：
  1. 打开 `/trade-plans#vix`，页面会自动拉 `^VIX`；拉到后数值 + 等级卡出现
  2. 手动输入 28、32、42、52，验证 5 个等级（calm/watch/buyIndex/buyAll/heavyBuy）颜色与推荐动作切换
  3. 刷新 → 担出 worker 里没有 `/quote/^VIX` 路由时 fallback 到手动输入提示
  4. `localStorage.aiDcaVixState` 被写入；刷新页面依然能读到上次值

### PR 2b — VIX 深度集成（后插队） — `todo`
- [ ] 改 `src/app/nasdaqPrices.js`：拉取 `^VIX` 30 日历史，复用 TTL 缓存
- [ ] VixDashboard 增加 30 日走势 + 历史信号列表
- [ ] 改 `src/app/homeDashboard.js`：`vixSummary` 注入首页监控区
- [ ] 改 `src/app/notifySync.js`：`vix_signal` 规则同步至 worker（跨阈值触发 + 24h 同级防抖，D7）
- [ ] 后端冲烟：触发 VIX≥30/40/50 各一条通知看 worker 响应

### PR 2.5 — DCA Calculator（独立可插入此处） — `todo`
- [ ] 新建 `src/app/dcaCalculator.js`（`calculateDcaBacktest` / `filterBuyDates` / `buildDcaChartData`）
- [ ] 新建 `src/pages/DcaCalculatorExperience.jsx`（输入表单 + 折线图 + 明细表）
- [ ] 改 `src/app/nasdaqPrices.js`：`loadHistoricalPrices(symbol, range)`
- [ ] 改 `src/pages/TradePlansExperience.jsx`：新增 `dcaCalc` tab
- [ ] 「应用此策略」一键预填到现有 DCA 计划
- [ ] 前端验证：3m/6m/1y/2y/3y/5y × weekly/biweekly/monthly 全组合

### PR 3 — 成本追踪 + 负成本 — `todo`
- [ ] 新建 `src/app/costTracker.js`（`calculateCostBasis` / `recordTrade` / `getTradeHistory`）
- [ ] 改 `src/app/holdingsCore.js`：关联交易记录
- [ ] 改 `src/pages/HoldingsExperience.jsx`：显示真实成本 + 已实现盈亏 + 负成本标签
- [ ] 单测：加权平均、卖出回收、负成本判定

### PR 4 — 仓位管理 + 做T 收益 — `todo`
- [ ] 新建 `src/app/positionManager.js`（`calculateWeights` / `checkWeightLimit` / `generateRebalanceAdvice`）
- [ ] 改 `src/pages/SellPlanExperience.jsx`：集成仓位检查
- [ ] 改 `src/pages/HoldingsExperience.jsx`：仓位占比可视化（饼图/柱状图）
- [ ] 买入时超仓警告 + 做T 后新成本自动重算
- [ ] 改 `src/app/notifySync.js`：`weight_alert` 规则同步

---

## 4. 通知扩展（workers/notify）

新增三类规则：`sell_layer` / `vix_signal` / `weight_alert`。复用现有 `syncTradePlanRules` 通道。Worker 部署走 GitHub Actions（`deploy-worker-notify.yml`），不在本机 `npx wrangler deploy`。

---

## 5. 关键决策（已锁定的默认值）

- 底仓比例：70%（UI 滑块 50%–90%）
- 单只个股仓位上限：50%
- 减仓档位默认：3 档（涨 15% / 25% / 35%），可配置 3–5 档
- 宽基判定：白名单 + 用户可手动覆盖 `assetType`
- VIX 数据源：Yahoo Finance `^VIX`，复用 `nasdaqPrices.js` 缓存
- 交易台账容量：单标的最多 100 条，旧记录归档

---

## 6. 待确认（需用户答复）

全部决策已锁定（2026-05-18 用户确认默认推荐值）。

| 编号 | 决策 | 锁定值 |
|------|------|--------|
| D1 | PR 入口顺序 | PR 0 → 1 → 2 → 2.5 → 3 → 4 |
| D2 | AI 分析位置 | 仅「行情分析页」`MarketsExperience.jsx`；Home / 交易计划页不加 |
| D3 | `homeDashboard.normalizeCodes` 放宽 | 底数字基金码 + `nas-daq100` + US ticker 白名单（QQQ/VOO/Mag7/TSM）；不使用通配正则 |
| D4 | 卖出默认参数 | 底仓 70% / 个股仓位上限 50% / 默认 3 档，UI 支持 3–5 档 |
| D5 | 宽基白名单 | `QQQ, SPY, VOO, IVV, QLD, TQQQ, SSO, UPRO, DIA, IWM, VTI, VT`，可手动 override `assetType` |
| D6 | VIX 数据源 | Yahoo `^VIX` + 复用 TTL 缓存 |
| D7 | VIX 通知触发 | 跨阈值触发 + 24h 同级防抖 |
| D8 | 交易台账起点 | 迁移现有持仓 + 增量记录 |
| D9 | 台账容量 | 单标的 100 条，溢出归档 `aiDcaTradeLedgerArchive` |
| D10 | 负成本 UI | 绿色 + 「负成本」文字标签 |
| D11 | 做T 成本重算 | 加权平均 |
| D12 | DCA Calc 范围 | 时间段加 `10y` / `max`；频率保持 weekly/biweekly/monthly |
| D13 | DCA Calc 一键应用 | 跳转现有 DCA 创建页 + 预填 |
| D14 | localStorage 命名 | 保持 `aiDcaSellPlanStore` / `aiDcaVixState` / `aiDcaPositionSnapshot` / `aiDcaTradeLedger` |
| D15 | AI 分析取消 | 弹窗内显式「停止分析」按钮 |
| D16 | e2e 清单 | 每个 PR 启动时在此补充 |

---

## 7. 风险

- Yahoo Finance 限流：复用 `nasdaqPrices.js` 已有 TTL 缓存，必要时加退避。
- `HoldingsExperience.jsx` 已 167KB，改动需小步。
- localStorage 容量：交易台账需要归档策略。
- 负成本 UI：要特殊配色 + 标签，避免误读为亏损。
- 宽基白名单不完整：需要 UI 提供手动标记 `assetType`。
- 通知 worker 部署：必须走 GitHub Actions，禁本机 `npx wrangler deploy`。

---

## 8. 验证策略

- **前端验证**：必走 cf-browser-mcp（goto → wait_for → screenshot/get_text），交互路径用 click/type_text 复现，验证完 close_session。
- **后端验证**：worker 改动用 `curl` 冲烟，正常 + 边界各一条，记录 HTTP 状态码与 Worker Version ID。
- **单测**：纯算子（sellStrategy / costTracker / dcaCalculator / positionManager）必带单测，放 `test/` 目录。
- 每个 PR 完成后：`git_status` → `git_diff` → 小步 commit（conventional commit）。

---

## 9. 产出与验证记录（实施过程中逐步追加）

_（每完成一个 step 在此追加：commit SHA + 关键截图/响应 + Actions run URL）_
