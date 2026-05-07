# 交易计划中心（tradePlans）

- 入口组件：[`src/pages/TradePlansExperience.jsx`](../../src/pages/TradePlansExperience.jsx)
- 二级 tab（lazy import）：
  - `src/pages/HomeExperience.jsx` — 加仓计划 dashboard
  - `src/pages/DcaExperience.jsx` — 定投计划编辑器
  - `src/pages/SwitchStrategyExperience.jsx` — 场内/场外纳指 100 切换套利
  - `src/pages/NewPlanExperience.jsx` — 新建加仓计划（覆盖整个 tab 的独占视图）
- 计算核心：`src/app/tradePlans.js`（`buildTradePlanCenter` / `buildTradeHistory`）、`src/app/plan.js`、`src/app/dca.js`、`src/app/strategyEngine.js`、`src/app/switchStrategySync.js`

## 一、二级视图与 hash 路由

本 tab 内部维护 `subView`，由 URL hash 驱动：

| Hash | `subView` | 渲染组件 |
|---|---|---|
| `''` / `#list` | `list` | TradePlansExperience 自身的「计划列表 + 详情」双栏 |
| `#home` | `home` | `HomeExperienceLazy` |
| `#dca` | `dca` | `DcaExperienceLazy` |
| `#switch` | `switch` | `SwitchStrategyExperienceLazy` |
| `#new` | `new` | `NewPlanExperience`（独占整个 tab） |

hash 变更监听 `popstate` + `hashchange`，切 hash 立刻切 subView，无 reload。lazy import 让首次进入 `list` 不会拖入 dashboard 图表 chunk。

## 二、`list` 视图（默认）

顶部三张 StatCard：

- 「待执行计划」= `summary.pendingCount`（价格触发买入 + 固定定投）
- 「最近触发条件」= `summary.nearestTrigger`
- 「下一次定投日期」= `summary.nextDcaDate`

下方两列：

- 左列「计划列表 / 后续交易计划」：基于 `buildTradePlanCenter()`，每行带 `Pill statusTone` 状态徽章 + `typeLabel` 类型徽章，可点击选中 → 右侧详情。每行有「测试通知」按钮（走 `sendNotifyTest`）和删除按钮（`deletePlan`）。
- 右列「计划详情」：选中计划的完整规则、当前价格、距离触发的剩余空间、关联的定投计划。包含「打开规则详情」链接，跳到 `buildRuleDetailUrl`（在通知 tab 中渲染）。

顶部还有「新建计划」按钮 → `setSubView('new')`。

## 三、`home` 子视图（加仓 dashboard）

来自 `HomeExperience.jsx`，UI 取自 Tremor / shadcn 风格 dashboard，详细 layout 见 [`docs/home-redesign.md`](../home-redesign.md)。

- 多基金价格 + 移动平均线图表（默认日线，可切到分钟线）。
- KPI 卡片显示当前价格、日内涨跌、距离均线百分比。
- 数据源：`loadLatestNasdaqPrices` / `loadNasdaqDailySeries` / `loadNasdaqMinuteSnapshot`（GitHub Action 抓取的静态 JSON 文件）。
- 策略下拉：`STRATEGY_OPTIONS`（默认值见 `home/helpers.js`），用 `buildNasdaqStrategyPlan` / `buildPeakDrawdownStrategyPlan` 生成「下一次触发价」和分层挂单价。
- localStorage 键：
  - `aiDcaHomeDashboard` — 用户的图表 / 策略 / 时间窗口选择
  - `aiDcaPlans` / `aiDcaActivePlanId`（来自 `src/app/plan.js`）— 计划列表本身

## 四、`dca` 子视图（定投计划）

来自 `DcaExperience.jsx`：

- 表单输入：基金代码、单笔金额、频率（来自 `frequencyOptions`）、扣款日（`DAY_OPTIONS = [1, 8, 15, 28]`）、关联加仓策略下拉。
- 实时计算：`buildDcaProjection(state, { planList })` 给出未来 N 期金额、累计投入、最近一次执行日。
- 保存即调用 `persistDcaState` 写入 localStorage 键 `aiDcaDca`，并触发 `syncTradePlanRules` 把全部计划下发到 notify worker（`POST /sync`）。

## 五、`switch` 子视图（场内 / 场外纳指 100 切换套利）

来自 `SwitchStrategyExperience.jsx`。整页核心逻辑（见源文件顶部注释）：

- 真实溢价：`(成交价 − 单位净值) / 单位净值`。
- 数据源（每交易日 15:30 GitHub Action 拉取）：`data/<code>/latest-nav.json`、`data/all_nasdq.json`、`data/<code>/daily-sina.json`。
- 持仓基准 (`benchmarkCodes`) 自动从 `aggregateByCode(readLedgerState())` 派生，**不在该页让用户手选**。
- 候选 ETF (`enabledCodes`) 由用户勾选；UI 仅展示「对侧分类」。
- `premiumClass` 给每只 ETF 标签 H / L，`gap = H溢价 − L溢价` 作为机会触发量。
- localStorage：
  - `aiDcaSwitchStrategyPrefs` — 基准 / 候选 / 阈值
  - `aiDcaSwitchStrategyLedger` — 套利轮次人工日志
- 与 worker 的对接通过 `loadSwitchConfigFromWorker / saveSwitchConfigToWorker / loadSwitchSnapshotFromWorker / runSwitchOnce`，对应 notify worker 的 `/switch/config`、`/switch/snapshot`、`/switch/run`。

## 六、`new` 子视图（NewPlanExperience）

- 模板下拉来自 `strategyOptions`：固定回撤模板（`buildFixedDrawdownPlan` + `fixedDrawdownBlueprint`）、均线模板（`buildMovingAverageTemplatePlan`）。
- 选择基金 → 自动拉 `loadLatestNasdaqPrices` 当前价 + `loadNasdaqDailySeries` 历史 → 算出移动均线 + 推荐挂单价。
- 保存：`persistPlanState` 写 localStorage `aiDcaPlans` 列表 + 把当前作为 active；同步 `syncTradePlanRules` 推到 notify worker。
- `onBack` / `onAfterSave` 由父组件控制，避免整页 reload。

## 七、状态键速查

React state：

```
selectedRowId      // 计划列表选中行
subView            // list | home | dca | switch | new
testingRowId       // 「测试通知」按钮 loading
channelConfigured  // 是否已经配置 Bark / Android（从 notifySync 推断）
planRefreshKey     // 强制重新读 plan list 的计数器
```

localStorage：

```
aiDcaPlans                       # 加仓计划列表
aiDcaActivePlanId                # 当前选中的 plan id
aiDcaDca                         # 定投配置 + projection
aiDcaHomeDashboard               # home dashboard 图表/策略偏好
aiDcaSwitchStrategyPrefs         # 切换策略偏好
aiDcaSwitchStrategyLedger        # 切换策略人工日志
aiDcaNotifyClientConfig          # 复用通知客户端配置
```

worker API：

- `POST /sync` — 同步全部计划规则
- `POST /test` — 测试通知
- `GET /status` — 查询通道状态（决定 `channelConfigured`）
- `POST /switch/{config,snapshot,run}` — 切换策略

## 八、相关文档

- Home dashboard layout 规范：[`docs/home-redesign.md`](../home-redesign.md)
- notify worker 部署规约：[`docs/ops/notify-worker-deploy.md`](../ops/notify-worker-deploy.md)
