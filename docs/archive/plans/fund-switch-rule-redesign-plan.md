# App 端基金切换规则创建与管理流程重构计划

## 1. 目标与边界

将 App 端“基金切换收益分析”重构为普通用户可以理解的规则创建、管理、测试和运行流程。

普通用户只需要理解：

- 当前持仓
- 切换费用
- 推荐提醒条件
- 当前切换优势
- 候选基金
- 历史回测
- 快速测试
- 手动跑一次

以下技术概念只保留在数据层、Worker 和调试日志中，不出现在普通页面：

- H 组、L 组
- H/L 计算公式
- 规则 A、规则 B
- 动态阈值
- Worker 参数
- Cron 表达式

保留现有顶部应用栏、底部/移动端导航、登录体系、持仓数据、行情数据、回测引擎和 Worker 定时运行能力。

不修改行情中心、持仓总览、交易记录、其他业务模块，也不改变云端恢复和本地数据冲突处理逻辑。基金切换页面不展示云端同步、合并本机数据或清除本机数据内容。

本文件是实施计划，不包含本轮业务代码修改。由于现有 Worker 的触发引擎依赖旧的运行时字段，实施顺序必须是“先完成 Worker 运行时契约和兼容层，再拆 App 页面”；不能先做只有前端字段的 UI 重构。

## 1.1 本次审查后的强制前置结论

当前 Worker 的可运行条件不是单个用户提醒值，而是以下完整运行时配置：

```text
benchmarkCodes
enabledCodes
premiumClass
intraSellLowerPct
intraBuyOtherPct
```

其中：

- `premiumClass` 缺失或不完整时，场内规则不能触发；
- `intraBuyOtherPct` 必须严格大于 `intraSellLowerPct`，否则 `isSwitchRuleRunnable` 会跳过规则；
- 一个用户可见的 `thresholdValue` 不能直接替代两个 Worker 阈值；
- `internalHoldingSide` 只能作为推荐结果和最近一次分类的记录，不能成为运行时唯一依据；
- 快速测试和正式运行必须共用同一套快照、分类和触发计算函数，但使用只读状态和不同的副作用策略。
- 分类刷新失败不能让规则永久死锁：优先使用最后一次有效快照，只有没有历史快照才挂起；
- 迁移冲突不能自动合并候选池，非主记录必须作为可恢复的停用备份保存；
- 快速测试的所有写入都必须通过 `isTest` 沙箱上下文，不能触碰正式决策 Key；
- 推荐重计算必须有客户端防抖、Worker 组合缓存和限流；通知 eventId 必须保留旧 `A/B` 机器协议。

因此 Phase 1 必须先产出并通过 Worker 契约测试，未完成前不进入页面拆分。

## 2. 当前代码现状

当前入口和主要职责如下：

| 文件 | 当前职责 | 重构方向 |
| --- | --- | --- |
| `src/pages/FundSwitchExperience.jsx` | 基金切换页面壳，PC 双栏、移动端“规则/复盘”切换 | 改为“推荐机会/我的方案/切换记录”三 Tab 调度器 |
| `src/pages/SwitchStrategyExperience.jsx` | 规则状态、持仓聚合、候选池、行情、Worker 配置同步、手动运行、弹窗 | 降为调度层，拆出页面状态和业务组件 |
| `src/pages/SwitchStrategyPanels.jsx` | Worker 规则面板、手动运行、快速记录、候选快照弹层 | 改为规则列表、规则详情、快速测试和运行结果组件 |
| `src/pages/SwitchStrategyClassificationPanel.jsx` | 用户手动维护 H/L 分类和持仓基准 | 从用户界面移除，分类改由系统内部完成 |
| `src/pages/SwitchStrategyOpportunityPanels.jsx` | 展示规则 A/B 和多个内部阈值 | 改为当前切换优势和推荐机会 |
| `src/pages/FundSwitchAnalysisExperience.jsx` | 从持仓 ledger 推导已发生的切换链路和收益 | 改造成“切换记录”页面，保留已有链路计算能力 |
| `src/app/switchStrategySync.js` | 旧规则结构、本地缓存、Worker 配置/快照/运行接口 | 增加新结构、旧数据迁移和新接口封装 |
| `src/app/holdingsLedger.js`、`holdingsLedgerCore.js` | 持仓流水和 `aggregateByCode` | 继续作为持仓唯一来源，不改业务语义 |
| `src/app/navService.js` | `fund-metrics`、本地行情缓存和请求去重 | 继续复用，列表页不触发详情级请求 |
| `src/app/backtest/index.js`、`backtestDataFetcher.js` | 统一回测引擎和历史数据加载 | 通过适配层复用，不改行情中心交互 |
| `workers/notify/src/switchStrategy.js` | 旧 H/L 规则归一化、快照、触发计算和通知内容 | 支持新规则结构，保留旧结构兼容读取 |
| `workers/notify/src/switchStrategyRoutes.js` | 配置、快照、手动运行和测试 NAV 接口 | 增加推荐、单规则测试和最近运行结果接口 |

`src/pages/SwitchStrategyExperience.jsx` 当前已经接近 `check:refactor` 对该阶段的 1100 行限制，后续不得继续堆积业务逻辑，必须先拆分。

当前页面使用 `getNavSnapshots(codes, { forceRefresh: true })` 读取候选池行情，并且用户可以手动维护 H/L 分类；这与新的“系统自动匹配、列表轻量请求、详情按需请求”要求不一致。

当前 Worker 的 `/api/notify/switch/run` 会运行全部可运行规则，并可能发送正式通知，不能直接作为单条规则“快速测试”接口。

当前页面的“快速记录”是写入持仓 ledger 的交易记录，不是目标中的“快速测试”，两者必须分离。

## 3. 页面信息架构和状态模型

### 3.1 顶层 Tab

`FundSwitchExperience` 保留 `?tab=fundSwitch`，页面内部改为：

1. 推荐机会
2. 我的方案
3. 切换记录

必要时使用现有 query 机制保存页面状态：

```text
view=opportunity|rules|records
ruleId=<rule id>
runId=<run id>
```

`WorkspacePage.jsx` 只增加基金切换相关 query 参数保留，不引入新的路由框架。

### 3.2 我的方案内部状态

```text
list
create-holding
create-fee
create-recommendation
detail
backtest
quick-test
run-result
```

使用一个明确的 reducer 或等价状态模型管理流程，避免多个 effect 互相触发网络请求。

### 3.3 空状态

无规则时展示：

```text
还没有切换规则

选择一只当前持仓，系统会自动寻找同类基金，
并根据手续费和历史数据生成提醒条件。

添加第一条规则
手动跑一次
```

“添加第一条规则”为主按钮，“手动跑一次”为次按钮。无规则点击手动运行时不请求 Worker，直接提示先添加规则。

## 4. 新规则数据结构与兼容策略

### 4.1 费用结构

```ts
interface SwitchFeeConfig {
  mode: 'detailed' | 'estimated_total';
  sellCommissionRate?: number;
  buyCommissionRate?: number;
  minimumCommission?: number;
  otherFee?: number;
  estimatedTotalFee?: number;
}
```

费率统一按“百分比点”存储，例如 `0.03` 表示 `0.03%`；金额统一按人民币元存储。这个单位不能直接传给当前回测引擎的 `feeRate`，因为现有 `createTradeSimulator` 接收的是小数费率，例如 `0.0003` 才表示 `0.03%`。

必须新增唯一的费用适配函数 `toSwitchBacktestCosts(feeConfig, notional?)`，并在 App、Worker 推荐和 Worker 回测入口复用同一份语义：

```ts
interface SwitchBacktestCosts {
  sellFeeRate: number;       // 0.03% -> 0.0003
  buyFeeRate: number;        // 0.03% -> 0.0003
  minimumCommission: number;
  otherFee: number;
  fixedPerSwitchFee?: number;
}
```

详细模式必须按卖出、买入两笔交易分别计算费率和最低佣金；不能把买卖费率简单相加后同时传给两笔交易。直接填写总费用模式在没有成交金额时不能反推费率，回测引擎需要支持“每次完成切换的固定费用”或在有明确成交金额时按成交金额换算。推荐值、回测结果和当前切换优势都必须使用这套适配后的实际成本。

### 4.2 规则结构

```ts
type InternalFundSide = 'high' | 'low';
type TriggerOperator = 'gte' | 'lte';

interface SwitchRule {
  id: string;
  name: string;
  enabled: boolean;

  holdingFundCode: string;
  holdingFundName: string;
  holdingQuantity?: number;

  internalHoldingSide: 'high' | 'low';
  triggerOperator: 'gte' | 'lte';

  thresholdMode: 'backtest' | 'fixed';
  thresholdValue: number;
  backtestRecommendedValue?: number;

  feeConfig: SwitchFeeConfig;

  candidateFundCodes?: string[];
  recommendation?: SwitchRecommendation;
  runtimeConfig?: SwitchRuleRuntimeConfig;
  lastResult?: SwitchRuleRuntimeResult;

  createdAt?: string;
  updatedAt?: string;
}

/** 仅供 Worker 和回测适配层使用，普通页面不能直接配置。 */
interface SwitchRuleRuntimeConfig {
  recommendationId: string;
  premiumClass: Record<string, 'H' | 'L'>;
  premiumClassUpdatedAt: string;
  classificationSource: 'worker-recommendation' | 'worker-refresh' | 'legacy-migration';
  intraSellLowerPct: number;
  intraBuyOtherPct: number;
  holdingSideAtRecommendation: InternalFundSide;
  triggerOperatorAtRecommendation: TriggerOperator;
}

interface SwitchBacktestSummary {
  recommendedValue: number;
  triggerCount: number;
  winRatePct: number;
  annualizedImprovementPct: number;
  maxDrawdownPct: number;
  sampleCount: number;
  comparisons: Array<{
    thresholdValue: number;
    triggerCount: number;
    winRatePct: number;
    annualizedImprovementPct: number;
    recommended?: boolean;
  }>;
}

interface SwitchRuleRuntimeResult {
  status: 'pending_classification' | 'ready' | 'near_trigger' | 'triggered' | 'failed';
  maxAdvantagePct?: number;
  thresholdValue?: number;
  evaluatedAt?: string;
  errorCode?: string;
}
```

`candidateFundCodes`、`recommendation`、`runtimeConfig` 和 `lastResult` 是系统生成数据，不提供给用户手动维护。为兼容当前 Worker，保存到 `switch:config:{clientId}` 时必须同时写入 `runtimeConfig.premiumClass`、两个 `intra*` 阈值和推荐版本；不能只保存 `thresholdValue`。

配置在 Worker 的落盘形态必须明确为“新字段 + 旧运行时投影”，例如：

```json
{
  "schemaVersion": 2,
  "rules": [{
    "id": "rule-1",
    "holdingFundCode": "513100",
    "candidateFundCodes": ["159659"],
    "runtimeConfig": {
      "recommendationId": "rec-20260720-1",
      "premiumClass": { "513100": "H", "159659": "L" },
      "intraSellLowerPct": 0.50,
      "intraBuyOtherPct": 2.65
    },
    "benchmarkCodes": ["513100"],
    "enabledCodes": ["159659"],
    "premiumClass": { "513100": "H", "159659": "L" },
    "intraSellLowerPct": 0.50,
    "intraBuyOtherPct": 2.65
  }]
}
```

`runtimeConfig` 是新业务模型的来源；顶层旧字段是给当前 `normalizeSwitchRule`、`computeSwitchSnapshot` 和 Cron 兼容读取的投影。每次写配置时由 Worker 生成投影，客户端不得分别提交两份可能不一致的值。

### 4.3 单一用户值与 Worker 双阈值的映射

```text
hlPremiumDiff = highPremiumRate - lowPremiumRate
```

Worker 运行时仍保留两个独立阈值：

| 当前持仓运行时侧别 | 用户可见 `thresholdValue` 映射 | Worker 字段 | 操作符 | 含义 |
| --- | ---: | --- | --- | --- |
| high | `intraBuyOtherPct` | `intraBuyOtherPct` | `gte` | 当前持仓比候选基金贵到提醒值 |
| low | `intraSellLowerPct` | `intraSellLowerPct` | `lte` | 切回候选基金的价差收窄到提醒值以内 |

`recommend` 必须同时返回两个值，例如：

```json
{
  "selectedThreshold": {
    "value": 2.65,
    "operator": "gte",
    "holdingSide": "high"
  },
  "runtimeThresholds": {
    "intraSellLowerPct": 0.50,
    "intraBuyOtherPct": 2.65
  }
}
```

规则保存时：

1. 高侧规则的 `thresholdValue` 写入 `runtimeConfig.intraBuyOtherPct`，低侧规则的 `thresholdValue` 写入 `runtimeConfig.intraSellLowerPct`；
2. 未被用户选择的另一个阈值继续使用同一次推荐结果的值，不能被写成相同的 `thresholdValue`；
3. 自定义值只修改当前用户可见方向对应的内部字段；
4. 保存前强制校验 `intraBuyOtherPct > intraSellLowerPct`。不满足时不启用规则，并提示重新生成推荐条件或调整提醒值；
5. 推荐模式和自定义模式只改变当前方向的用户值，不改变 `premiumClass` 和候选池。

当前持仓为高侧时固定使用 `triggerOperator = 'gte'`；当前持仓为低侧时固定使用 `triggerOperator = 'lte'`。

页面只通过文案表达条件，例如：

- 当当前持仓比同类候选基金贵 2.65% 时提醒
- 当切回候选基金的价差收窄到 0.50% 以内时提醒

### 4.4 分类产出、归属和运行时刷新

`premiumClass` 的唯一业务来源是 Worker 的推荐/分类流程，不由用户填写，也不由 App 根据当前页面数据猜测。推荐流程复用现有回测侧 `classifyPremiumCodes` 的历史溢价分类能力，并将结果转换为 Worker 触发引擎需要的映射：

```ts
type PremiumClassMap = Record<string, 'H' | 'L'>;

interface SwitchClassificationResult {
  premiumClass: PremiumClassMap;
  holdingSide: InternalFundSide;
  classifiedCodes: string[];
  unclassifiedCodes: string[];
  sampleCount: number;
  generatedAt: string;
  source: 'worker-recommendation' | 'worker-refresh';
}
```

`POST /switch/recommend` 必须返回完整的 `SwitchClassificationResult`，而不是只返回候选名称和一个推荐值。持久化时由 Worker 在一次写操作中把以下字段写入同一条新规则：

```text
candidateFundCodes
runtimeConfig.premiumClass
runtimeConfig.premiumClassUpdatedAt
runtimeConfig.classificationSource
runtimeConfig.intraSellLowerPct
runtimeConfig.intraBuyOtherPct
runtimeConfig.holdingSideAtRecommendation
runtimeConfig.triggerOperatorAtRecommendation
recommendationId
```

运行时以当前行情重新确认持仓侧和候选侧：`premiumClass` 是分类快照，`holdingSideAtRecommendation` 只是最近一次结果，不是永久锁定的触发方向。每次推荐生成时刷新分类；正式运行发现分类缺失、候选集合变化或分类超过约定有效期时，Worker 先执行分类刷新，再构造 `computeSwitchSnapshot`。

分类刷新必须有可运行的降级策略：

1. 刷新成功时写入新的 `premiumClass`、分类时间和 `classificationSource`；
2. 刷新失败但存在上一次完整且格式有效的持久化分类时，沿用该快照继续计算，并在运行摘要、规则结果和 Worker warning 日志中标记 `classificationStatus: 'stale'`、`classificationWarning` 和上次成功时间；
3. 只有从未成功分类、快照缺失/损坏、持仓或候选代码不完整时，才返回 `pending_classification` 并跳过触发；
4. 使用旧快照不能覆盖正式配置，也不能更新 `premiumClassUpdatedAt`；用户在 App 中看到“暂时使用上次分析结果，可重新生成推荐”，而不是永久的“等待分析”；
5. 连续使用旧快照达到 Worker 规定的最大陈旧期限后，仍保留最后快照用于展示，但正式触发状态改为 `classification_expired`，要求用户重新生成推荐，并记录明确原因。

刷新后仍需检查 `intraBuyOtherPct > intraSellLowerPct`。如果当前分类导致用户方向变化，Worker 按当前持仓侧选择对应的两个阈值，并更新运行结果中的用户文案；不会只沿用创建时固化的 `triggerOperator`。沿用旧分类快照时也必须执行同一校验，不能因为降级而放宽运行约束。

### 4.5 旧数据迁移和去重

旧结构中的：

- `benchmarkCodes` 中的每个旧基准代码分别作为一条新规则的 `holdingFundCode`；不能把整个数组直接写成一个持仓代码。
- 一个旧规则包含多个基准时先按基准拆分，再按 `holdingFundCode` 去重。
- `premiumClass[holdingFundCode]` 映射为推荐时的 `holdingSideAtRecommendation`；完整 `premiumClass` 映射到 `runtimeConfig.premiumClass`，不能只保存持仓侧。
- 高侧持仓使用旧 `intraBuyOtherPct`。
- 低侧持仓使用旧 `intraSellLowerPct`。
- `enabledCodes` 仅作为迁移候选提示，最终候选由系统重新匹配。
- 缺少分类、缺少对侧候选或两个阈值不满足严格大小关系时，迁移为 `enabled: false`、`status: 'pending_recommendation'`，不能继续使用默认值假装可运行。

前端和 Worker 都必须支持旧结构读取，避免已有用户配置无法运行。新结构保存后以新结构为准。

迁移冲突采用确定性主记录选择，但禁止自动合并可能代表不同策略的配置：

1. `enabled: true` 的记录优先于停用记录；
2. 都启用或都停用时，`updatedAt` 较新的优先；
3. 时间相同使用旧数组中的先后顺序；
4. 只保留胜出的主记录为可编辑规则；不混合其它记录的候选池、费用、阈值、名称或回测摘要；
5. 其它同持仓记录转为 `enabled: false` 的“停用备份”，保留原始 `ruleId`、完整原始配置、`backupOfRuleId`、`migrationConflictCode` 和迁移时间，确保可审查和恢复；
6. 前端向用户提示存在重复方案，允许用户打开备份并主动选择“采用候选池/费用/提醒条件”，确认后才执行显式合并；显式合并必须产生新的配置版本和审计记录；
7. 主记录完成迁移后再重新调用推荐接口生成 `premiumClass` 和两个运行时阈值，不直接相信旧分类；
8. 保存前后都验证同一 `holdingFundCode` 只有一条启用规则。冲突响应必须包含 `conflictCode`、保留的 `ruleId`、停用备份的 `ruleId` 列表，前端不能无提示丢弃。

前端选择持仓时显示“已有规则”并禁止重复；Worker 配置接口对旧结构和新结构都执行同一去重校验。

## 5. 分阶段实施

### Phase 1：先完成 Worker 运行时契约和领域模型

先修改 `workers/notify/src/switchStrategy.js`、`workers/notify/src/switchStrategyRoutes.js` 和 `src/app/switchStrategySync.js`，不先拆页面：

- 增加新规则归一化、旧规则迁移和唯一持仓校验；新结构归一化时必须落成当前触发引擎可识别的 `benchmarkCodes`、`enabledCodes`、`premiumClass` 和两个 `intra*` 阈值。
- 增加 `resolveSwitchClassification`，从 Worker 推荐数据/历史溢价数据生成并校验完整 `premiumClass`，明确缺失、样本不足和对侧为空的状态。
- 分类刷新失败时优先读取最后一次有效 `premiumClass` 快照并标记 stale；只有没有可用快照时才返回 `pending_classification`，同时输出 warning 和陈旧原因。
- 增加 `adaptSwitchRuleToRuntime`，把用户规则的单个 `thresholdValue` 映射到当前持仓侧对应的旧阈值，同时保留另一个阈值，严禁两个阈值被写成同一个值。
- `isSwitchRuleRunnable` 之前先执行运行时分类补全和严格阈值校验；不可运行规则返回可识别状态，不再只返回空规则列表。
- 增加费用校验和预计成本计算。
- 增加内部方向、操作符和用户文案转换函数。
- 保留旧字段兼容，但禁止新 UI 直接读旧字段。
- 统一配置缓存和 Worker 配置缓存的 key 与版本信息，并设计推荐结果和运行结果的 KV key。
- 在 Worker 契约阶段固定最近运行结果 Key 为 `switch:run-result:{clientId}`，并同时固定历史详情 Key 为 `switch:run:{clientId}:{runId}`；契约测试必须验证正式运行写入、`runs/latest` 读取和部分失败覆盖行为。

Phase 1 的完成条件：一条新规则写入后，直接调用现有 `computeSwitchSnapshot` 和 `evaluateSwitchTriggers` 可以得到分类、候选、两个阈值和明确的 `none/wait/trigger/pending_classification` 结果；没有 `premiumClass` 或不满足双阈值关系时不会被 Cron 或手动运行静默跳过。

新增页面级模块建议放在：

```text
src/pages/switchStrategy/
```

### Phase 2：页面壳和规则列表

修改 `FundSwitchExperience.jsx`：

- 删除 PC 机会/复盘双栏布局。
- 删除旧的“新功能：现在可以回测”横幅。
- 增加三 Tab。
- 复用现有应用壳和响应式布局。
- 对基金切换页面隐藏演示数据中的云同步提示。

新增：

```text
src/pages/switchStrategy/SwitchRuleListView.jsx
src/pages/switchStrategy/SwitchRuleCard.jsx
src/pages/switchStrategy/SwitchEmptyState.jsx
```

规则列表只读取规则缓存、Worker 最近快照和已有小型行情缓存。列表不得请求 K 线、净值历史或逐个标的详情接口；缺失字段显示 `—`。

### Phase 3：三步创建流程

新增：

```text
src/pages/switchStrategy/SwitchRuleCreateFlow.jsx
src/pages/switchStrategy/SwitchHoldingPicker.jsx
src/pages/switchStrategy/SwitchFeeForm.jsx
src/pages/switchStrategy/SwitchRecommendationPanel.jsx
```

#### 选择持仓

使用：

```text
readLedgerState()
→ aggregateByCode()
→ hasPosition === true
```

要求：单选、默认第一只符合条件的持仓、已有规则不可重复创建、支持手动输入基金代码、不展示内部分类。

#### 填写费用

提供“按明细计算”和“直接填写预计总费用”两种模式。默认值：

```text
卖出手续费 0.03%
买入手续费 0.03%
最低佣金 5 元
其他费用 0 元
```

校验金额非负、费率非负、费率最多四位小数。无实时价格时不触发隐藏的详情请求。

#### 生成推荐

显示阶段进度，不显示虚假百分比：

```text
正在生成推荐规则
正在匹配同类基金
正在计算切换费用
正在分析历史溢价差
正在寻找更合适的提醒条件
```

生成完成后只保存 Worker 返回的 `recommendationId` 和完整推荐快照；配置提交时由 Worker 校验并持久化费用、候选、`premiumClass`、两个运行时阈值、当前方向和回测摘要。推荐失败、分类不完整或回测样本不足时停留在待推荐状态，不创建启用规则。

### Phase 4：推荐、回测和阈值回填

新增：

```text
src/app/switchRuleBacktest.js
src/pages/switchStrategy/SwitchRuleBacktestView.jsx
```

复用现有：

- `runBacktest`
- `fetchBacktestData`
- `buildGapDistributionThresholdGrids`
- NAV/K 线缓存

不修改行情中心的 `BacktestSidePanel`。基金切换页面通过 `switchRuleBacktest.js` 把单条规则转换为回测引擎可接受的输入，并只向用户暴露一个统一提醒值。

适配层必须明确实现以下转换，禁止在组件内散落转换：

```text
SwitchFeeConfig 0.03%  ->  simulator 0.0003
minimumCommission       ->  卖出和买入各自的最低佣金
estimatedTotalFee       ->  每次完整切换的固定成本
thresholdValue          ->  当前持仓侧对应的 intra* 字段
runtimeConfig.premiumClass -> 回测的 highCodes / lowCodes
```

当前模拟器只有单一 `feeRate` 时，需要在回测核心增加卖出费率、买入费率和完整切换固定费用的参数；不能将百分比点直接传入，也不能用买卖费率相加冒充两笔交易。保留现有回测调用方的默认行为，并为新适配参数补充单元测试，确保旧行情中心回测结果不被改变。

回测页面展示回测区间、手续费、滑点、样本数量、候选范围、推荐提醒值、触发次数、胜率、年化提升、最大回撤和不同提醒值对比。

点击“使用推荐值”后：

- 返回规则设置页。
- 设置 `thresholdMode = 'backtest'`。
- 按当前持仓侧回填 `thresholdValue`，同时保留推荐结果中另一个运行时阈值。
- 将推荐结果的 `recommendationId`、`premiumClass`、分类时间和两个 `intra*` 阈值一并写回规则草稿。
- 保留用户之前的费用配置。
- 显示“已采用回测推荐值 X%”。

### Phase 5：规则详情和候选基金

新增：

```text
src/pages/switchStrategy/SwitchRuleDetailView.jsx
src/pages/switchStrategy/SwitchCandidateList.jsx
```

详情页显示当前持仓、持有份额、启用状态、当前最大切换优势、推荐提醒值、当前状态、候选基金、切换费用和数据状态。

候选基金只在打开详情时加载必要行情，并按当前切换优势从高到低排序。

详情页底部提供：

- 快速测试
- 编辑规则
- 停用规则
- 当 `lastResult.status` 为 `pending_classification` 或 `classification_expired` 时，额外显示“重新分析候选基金”

“重新分析候选基金”沿用当前规则的持仓和费用配置，重新请求 `/switch/recommend`，不删除规则、不清空历史运行结果，也不要求用户重新创建。成功后替换候选、分类快照、推荐阈值和推荐摘要；失败时保留原规则和最后一次有效分类快照，并显示可重试状态。入口从详情页进入创建流程的“生成推荐”步骤，规则列表卡片只显示状态，不增加同名操作。

### Phase 6：快速测试和正式运行

新增：

```text
src/pages/switchStrategy/SwitchQuickTestSheet.jsx
src/pages/switchStrategy/SwitchRunResultView.jsx
```

快速测试状态：

```text
idle → running → success | failure | timeout
```

快速测试只运行当前规则，不发送正式提醒、不修改持仓、不修改正式触发状态、不写入正式运行结果。前端必须使用 AbortController 和明确超时。

Worker 快速测试内部仍调用与正式运行相同的 `fetchFundMetricPrices`、NAV 读取、`computeSwitchSnapshot` 和 `evaluateSwitchTriggers`，但采用以下隔离方式：

1. 从 `switch:state:{clientId}` 只读当前规则的历史 `triggerStatesByRule[ruleId]`，不把空状态伪装成正式初始化；响应标明 `stateSource: 'readonly-existing' | 'empty'`；
2. 使用只读的 `prevTriggerStates` 计算“当前条件是否会触发”和状态变化预览，不执行通知去重、推送和状态写回；
3. 不调用 `runSwitchStrategyForOneClient`，避免意外处理其它规则、写入 `switch:snapshot:*`、`switch:state:*` 或 `switch:push-digest:*`；
4. 以阶段结果返回远端连接、行情获取、分类、规则计算和通知通道检查；通知通道只做连通性检查，不发送正式通知；
5. 每个阶段有明确超时和错误码，整体超时返回 `timeout`，不落正式运行记录。

手动跑一次继续运行全部启用规则：

- 无启用规则时前端直接提示，不请求 Worker。
- 运行前弹出确认并显示规则数量。
- 运行中显示 `正在运行 1/2 条规则`。
- 完成后显示成功、触发、未触发、失败数量。
- Worker 必须先完成所有规则的结果汇总，再写入本次运行详情；部分失败也要保存部分结果。
- 支持进入本次运行详情。

### Phase 7：切换记录

将 `FundSwitchAnalysisExperience.jsx` 的已有 ledger 切换链路计算能力保留，并改为“切换记录”用户文案。

不得把“已发生交易链路”和“Worker 运行结果”混为一类：

- 已发生交易继续来自持仓 ledger。
- Worker 运行结果来自 Worker 最近运行记录。
- 页面分别以普通用户可理解的“切换记录”和“运行结果”呈现。

列表进入时只读已有缓存；需要刷新历史数据时必须由用户主动操作或进入具体详情。

## 6. Worker 接口计划

现有接口继续保留：

```text
GET  /api/notify/switch/config
POST /api/notify/switch/config
GET  /api/notify/switch/snapshot
POST /api/notify/switch/run
```

新增：

```text
POST /api/notify/switch/recommend
POST /api/notify/switch/test
GET  /api/notify/switch/runs/latest
GET  /api/notify/switch/runs/:runId
```

涉及：

- `workers/notify/src/switchStrategy.js`
- `workers/notify/src/switchStrategyRoutes.js`
- `workers/notify/src/index.js`

### 6.1 Worker KV 持久化契约

现有 `switch:snapshot:{clientId}`、`switch:state:{clientId}` 和 `switch:push-digest:{clientId}` 继续分别表示最新计算快照、正式触发状态和推送去重状态，不承担“运行记录”职责。新增：

```text
switch:recommendation:{clientId}:{recommendationId}
switch:run:{clientId}:{runId}
switch:run-result:{clientId}
```

- `switch:recommendation:*` 保存一次推荐生成的完整结果，包括候选、`premiumClass`、分类时间、两个运行时阈值、回测摘要和费用快照；配置保存必须携带未过期的 `recommendationId`，由 Worker 校验后原子写入 `switch:config:{clientId}`。
- `switch:run:*` 保存按 `runId` 查询的完整 `SwitchRunSummary`，包括每条规则的阶段状态、信号、错误和耗时；保留期由 Worker 配置统一定义。
- `switch:run-result:{clientId}` 是最近一次正式运行结果的规范 Key，保存完整的 `SwitchRunSummary`，供 `GET /api/notify/switch/runs/latest` 直接读取；不能用 snapshot 或 state Key 代替。
- 正式运行无论全成功、部分失败还是超时，都必须在 `finally` 路径写入运行摘要；只有正式运行成功完成的规则才更新正式 snapshot/state/push digest。
- 推荐结果、规则配置和运行摘要分别设定 schemaVersion，读取时校验版本、clientId、时间和数据形态，避免把 snapshot 当作 run summary 返回。

### 推荐接口

输入当前持仓代码、持仓元数据和费用配置，Worker 自动匹配同指数、同策略或允许切换的候选基金，运行历史分类和回测，并返回一个可持久化的完整推荐结果。候选匹配使用现有基金目录和 `index_key` 等元数据；不让用户配置分类或候选分类。

推荐是重计算入口，必须同时做服务端缓存和客户端请求去重：

- 前端对持仓代码、费用字段和候选范围变化做约 300–500ms debounce；正在进行的同一请求复用 inflight，费用或持仓再次变化时 abort 旧请求；
- Worker 对规范化后的 `(holdingCode, feeConfig, candidatePolicyVersion, backtestParams)` 生成稳定 hash，读取 `switch:recommend-cache:{hash}`；缓存成功结果 TTL 不低于 10 分钟，并校验 schemaVersion、生成时间、费用摘要和数据形态；
- 缓存对象只保存与客户端无关的计算结果。命中后仍为当前 client 写入新的 `switch:recommendation:{clientId}:{recommendationId}` 记录，不能让客户端直接引用其它用户的推荐 key；
- 缓存未命中时使用现有并发限制和单客户端速率限制，避免快速回退、重复点击或多标签页请求耗尽 Worker CPU；限流响应返回 `recommendation_rate_limited`，前端显示可重试状态；
- 费用、候选策略或回测算法版本变化必须改变 hash，避免复用旧成本或旧分类结果。

响应至少满足以下结构：

```ts
interface SwitchRecommendation {
  schemaVersion: 1;
  recommendationId: string;
  generatedAt: string;
  holding: {
    code: string;
    name: string;
    side: InternalFundSide;
    premiumRate?: number;
  };
  candidates: Array<{
    code: string;
    name: string;
    premiumRate?: number;
    eligible: boolean;
  }>;
  premiumClass: Record<string, 'H' | 'L'>;
  classification: SwitchClassificationResult;
  runtimeThresholds: {
    intraSellLowerPct: number;
    intraBuyOtherPct: number;
  };
  selectedThreshold: {
    value: number;
    operator: 'gte' | 'lte';
    holdingSide: InternalFundSide;
  };
  backtest: SwitchBacktestSummary;
  feeConfig: SwitchFeeConfig;
}
```

`premiumClass`、`runtimeThresholds` 和 `selectedThreshold` 必须同时存在，并且必须满足 `intraBuyOtherPct > intraSellLowerPct`。没有可用数据源、历史样本不足、分类不完整或没有对侧候选时，返回结构化状态（例如 `pending_classification`、`insufficient_history`、`no_candidate`）和缺失代码；前端显示降级状态，不调用固定返回空数据的接口，也不生成可启用规则。

推荐响应本身先写入 `switch:recommendation:{clientId}:{recommendationId}`。随后配置保存接口以 `recommendationId` 取回并校验这份结果，不能由客户端自行拼接 `premiumClass` 或两个 `intra*` 阈值。

### 快速测试接口

输入单个 `ruleId`，Worker 必须：

- 校验客户端和规则。
- 获取当前规则相关行情。
- 只计算这条规则。
- 返回逐阶段结果和当前信号。
- 不调用 `runClientDetection`。
- 只读既有 `switch:state:{clientId}` 作为状态比较基线；任何测试写入都必须带 `isTest: true` 并进入请求内存或 `:test:{testId}` 沙箱，不写正式 snapshot、trigger state、push digest 或 run summary。
- 返回 `stateSource`、`wouldTrigger`、`currentStatus` 和阶段级 `errorCode`，让“没有历史状态”和“当前未达到提醒条件”可区分。
- `timeout`、分类缺失和行情缺失都必须是显式结果，不得返回成功且把信号默认为未触发。

快速测试必须携带 `isTest: true` 和独立 `testId`。分类刷新、测试快照和阶段日志只能写入请求内存对象，或写入带 `:test:{testId}` 后缀且有短 TTL 的临时 Key（例如 `switch:test:snapshot:{clientId}:{testId}`）。共享计算函数接收显式测试上下文，不能依赖全局变量；测试结束后清理临时 Key，清理失败也不能影响正式 Key。分类刷新失败时可以只读最后一次正式分类快照作为测试输入，但不得把测试分类结果写回正式配置。

### 正式运行接口

`/switch/run` 继续运行全部启用规则，但响应增加：

```ts
interface SwitchRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  successCount: number;
  triggeredCount: number;
  untouchedCount: number;
  failedCount: number;
  timeoutCount: number;
  ruleResults: SwitchRuleRunResult[];
}
```

最近一次运行结果同时写入 `switch:run:{clientId}:{runId}` 和 `switch:run-result:{clientId}`：前者供 `GET /runs/:runId` 查询历史详情，后者供 `GET /runs/latest` 读取最近一次完整摘要。两者必须使用同一个 `runId` 和 `schemaVersion`；部分失败、整体超时也必须更新 `switch:run-result:{clientId}`。Worker live fetch 成功后继续写入既有 KV/R2 缓存，外部请求继续使用并发限制。

### 6.2 通知内容边界

现有 `switchStrategy.js` 的通知标题、正文和 `triggerCondition` 仍会输出规则 A/B、H/L 及溢价差公式。重构必须新增统一的 `formatSwitchTriggerUserMessage`，并让正式通知和 App 运行结果共用用户文案：

```text
标题：基金切换提醒 | 当前持仓代码 → 候选基金代码
正文：当前持仓比候选基金贵 2.65%，扣除预计切换成本后仍有切换优势。
条件：当前持仓比候选基金贵 2.65% 时提醒
```

当 `classificationStatus === 'stale'` 时，通知正文末尾必须追加一行用户可理解的提示：

```text
本次提醒基于 2026-07-20 的历史分析，建议打开 App 确认当前数据。
```

日期使用 `classifiedAt` 按用户时区格式化；没有有效日期时显示“本次提醒基于上一次历史分析”。`classification_expired` 不得产生正式通知，除非后续分类刷新成功。

内部 `rule: 'A' | 'B'`、`fromClass`、`toClass` 和原始计算字段可以保留在结构化调试日志，但不得进入手机通知的标题、正文、`triggerCondition`、App 卡片或运行结果页面。通知文案测试必须覆盖 fresh、stale 和 expired 三种状态，以及提示内容和事件 ID 的兼容性。

通知事件 ID 需要兼容旧客户端：`buildSwitchTriggerNotification` 不得直接使用可能为空的新结构字段生成 eventId。适配层按方向反映射一个虚拟的旧规则标识：`triggerOperator = 'lte'` 映射为 `A`，`triggerOperator = 'gte'` 映射为 `B`；若旧 `trigger.rule` 已存在则优先校验并沿用。eventId 的组成、去重字段和跳转参数保持原格式，虚拟 `A/B` 只存在于机器可见的兼容字段，不得进入用户文案。未知操作符必须返回结构化错误并阻止发送，不能生成不稳定的空 eventId。

## 7. 缓存和请求边界

- 规则列表：组件 inflight/memory → localStorage → Worker KV 小对象 → 外部源站。
- 列表页不得为每个标的请求 `/kline`、净值历史或详情接口。
- 详情页只请求当前持仓和候选基金需要的轻量行情。
- 推荐生成和回测是明确的重数据入口。
- 普通列表渲染不得使用 `forceRefresh`。
- 手动跑一次、快速测试和用户主动刷新可以使用明确的刷新参数。
- 所有 effect 中的网络请求增加去重、inflight、abort 或缓存保护。
- 缺失非核心字段显示 `—`，不做同步重接口兜底。

## 8. 测试和验收

新增或更新：

- `test/switchRuleModel.test.mjs`
- `test/switchStrategyConfigSync.test.mjs`
- `test/switchStrategyRoutes.test.mjs`
- `test/switchStrategyRecommendation.test.mjs`
- `test/switchRuleRuntimeAdapter.test.mjs`
- `test/switchRuleFeeAdapter.test.mjs`
- `test/switchStrategyRunSummary.test.mjs`
- `test/e2e/switch-strategy-classification.spec.js`

必须覆盖：

- 旧规则迁移和新结构归一化。
- 旧 `benchmarkCodes` 拆分后按持仓代码确定性去重，覆盖启用优先、更新时间优先、数组顺序兜底和冲突响应。
- 高侧使用 `gte`，低侧使用 `lte`。
- `thresholdValue` 正确映射到当前方向对应的 `intra*` 字段，另一个阈值被保留且不会被写成相同值。
- `intraBuyOtherPct <= intraSellLowerPct` 时规则不可启用，并返回可见的待推荐状态。
- 推荐接口返回并持久化完整 `premiumClass`、分类时间、候选列表和两个运行时阈值；分类缺失、样本不足和刷新失败都有明确状态。
- 正式运行遇到缺分类时不会静默返回“未触发”，分类刷新成功后才进入触发计算。
- 分类刷新失败时沿用最后一次有效分类快照并写入 warning；没有历史快照时才进入 `pending_classification`；超过陈旧期限进入 `classification_expired`。
- 同一持仓不能创建重复规则。
- 同一持仓的迁移冲突不会自动混合候选、费用或阈值；主记录保留，其它记录成为可恢复的停用备份。
- 费用负数、无效金额和超过四位小数的费率校验。
- `0.03%` 转换为回测小数费率 `0.0003`，卖出和买入费率、最低佣金、其它费用和总费用模式分别正确计算。
- 费用适配不会改变行情中心旧回测默认参数和结果。
- 推荐值回填和自定义值切换。
- 列表无缓存时不会请求 K 线或净值历史。
- 缓存命中、过期、source 不匹配和写入 key 防御。
- 快速测试只运行单条规则。
- 快速测试不会发送正式通知、修改持仓或触发状态。
- 快速测试只读线上 `triggerStatesByRule`，有历史状态和无历史状态的结果可区分。
- 快速测试不会写正式 `switch:snapshot:*`、`switch:state:*`、`switch:push-digest:*` 或 `switch:run:*`；测试分类和快照只能写内存或 `:test:{testId}` 临时 Key。
- 快速测试成功、失败、超时和阶段级错误展示。
- 手动运行全部启用规则并返回逐条结果。
- 手动运行写入 `switch:run:{clientId}:{runId}` 和 `switch:run-result:{clientId}`；部分失败、整体超时也能通过 `GET /runs/latest` 读取运行摘要。
- 通知标题、正文和用户可见条件不出现规则 A/B、H/L 或内部公式，调试字段仍可保留内部标识。
- stale 分类通知包含上一次分类日期和打开 App 确认数据的提示；classification_expired 不发送正式通知。
- 推荐请求有前端 debounce、inflight/abort 去重、Worker 端组合缓存（TTL 至少 10 分钟）和客户端限流。
- 新结构通知的 eventId 仍按旧格式生成，`gte/lte` 能稳定反映射为虚拟 `B/A`，旧客户端去重和跳转不失效。
- 无规则时手动运行不会请求 Worker。
- 空状态、三步创建、详情、候选排序、停用和重新启用。
- `pending_classification` / `classification_expired` 详情显示“重新分析候选基金”，成功后原规则更新，失败后保留原配置且可重试。
- 页面用户可见 DOM 不出现 H/L、规则 A/B、Worker、Cron 和内部公式。

提交前至少运行：

```bash
node --test <相关 node 测试文件>
npm run check:refactor
npm run lint -- --quiet
git diff --check
```

## 9. 不变项和最终验收标准

- `WorkspacePage` 仍通过 `FundSwitchExperience` 进入基金切换页面。
- 持仓继续以 `aiDcaFundHoldingsLedger` 为唯一来源。
- 不修改行情中心、持仓总览、交易记录和云端同步冲突处理。
- 现有回测引擎和 Worker 定时运行能力继续可用。
- 用户不需要理解或配置基金分类、候选匹配、触发方向和底层阈值。
- 每只持仓最多一条切换规则。
- 列表轻量、详情按需、回测显式触发。
- 快速测试和手动跑一次的语义、请求范围和副作用完全不同。
- 所有失败、超时、空数据和缓存缺失状态都有明确降级文案。
