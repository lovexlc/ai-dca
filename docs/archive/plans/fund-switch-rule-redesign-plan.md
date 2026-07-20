# 基金切换「我的方案」页面重构实施计划

## 1. 目标、范围与实施原则

本计划基于 test 分支实际代码和 UI 稿 data/ChatGPT.png，重构 App 端基金切换的“我的方案”页面。

普通用户只需要看到：

- 当前持仓
- 当前切换优势
- 推荐提醒条件
- 候选基金
- 切换费用
- 快速测试
- 手动跑一次

普通页面不得展示 H/L、规则 A/B、H-L 公式、premiumClass、intraSellLowerPct、intraBuyOtherPct、Worker 输出或 Cron 表达式；仅规则编辑页的“高级设置”允许用户维护 H 组名单。

保留现有顶部应用栏、底部导航、登录体系、持仓 ledger、行情数据源、回测引擎、Worker 定时运行、切换记录和云端恢复/本地冲突逻辑。

不修改行情中心、持仓总览、交易记录及其他业务模块。不修改 HTTP API 路径；允许为支持有符号阈值修正 Worker 内部触发和回测逻辑。

实施顺序必须是：先确认数据和 Worker 契约，再拆 UI；每个阶段单独验证，避免一次性修改页面、数据和触发引擎。

## 2. 当前代码基线

当前入口：

~~~text
WorkspacePage
└── FundSwitchExperience
    └── SwitchRuleExperience
~~~

当前主要文件：

| 文件 | 当前职责 | 计划处理 |
| --- | --- | --- |
| src/pages/FundSwitchExperience.jsx | 基金切换入口壳 | 保持入口不变 |
| src/pages/switchStrategy/SwitchRuleExperience.jsx | 页面状态、规则列表、详情、编辑、回测、快速测试 | 降为调度层 |
| src/app/switchStrategySync.js | 配置、快照、推荐、运行、快速测试接口封装 | 保留并补充错误元数据和适配函数 |
| src/app/switchRuleModel.js | 费用、规则和运行时字段归一化 | 支持有符号阈值和视图模型输入 |
| workers/notify/src/switchStrategy.js | 快照、分类、触发和通知运行时 | 保持旧字段兼容，支持新阈值语义 |
| workers/notify/src/switchStrategyRoutes.js | 配置、推荐、运行、快速测试、运行记录接口 | 不新增路径，修正测试隔离和运行状态契约 |
| workers/notify/src/switchRecommendation.js | 已存在；候选匹配、分类调用、回测推荐和推荐缓存输入 | 明确与快照/触发引擎的职责边界，不重复实现 |
| src/pages/SwitchStrategyExperience.jsx 及旧面板 | 旧版 H/L 配置页面 | 新页面稳定后确认无引用再清理 |

持仓唯一来源继续使用 readLedgerState() 和 aggregateByCode()。列表页不得为每个候选基金预取 K 线、净值历史或详情数据。

## 3. 数据与 Worker 契约

### 3.1 用户规则结构

继续使用现有配置结构，并保持新字段与旧运行时投影并存：

~~~ts
interface SwitchFeeConfig {
  mode: 'detailed' | 'estimated_total';
  sellCommissionRate?: number;
  buyCommissionRate?: number;
  minimumCommission?: number;
  otherFee?: number;
  estimatedTotalFee?: number;
}

interface SwitchRule {
  id: string;
  name: string;
  enabled: boolean;
  holdingFundCode: string;
  holdingFundName: string;
  holdingQuantity?: number;
  thresholdMode: 'backtest' | 'fixed';
  thresholdValue: number;
  backtestRecommendedValue?: number;
  recommendationStatus?: 'valid' | 'fee_changed' | 'expired';
  highPremiumCodes?: string[];
  premiumClassSource?: 'default' | 'user';
  feeConfig: SwitchFeeConfig;
  candidateFundCodes?: string[];
  runtimeConfig?: SwitchRuleRuntimeConfig;
  lastResult?: SwitchRuleRuntimeResult;
}

interface SwitchRuleRuntimeResult {
  status:
    | 'pending_classification'
    | 'ready'
    | 'near_trigger'
    | 'triggered'
    | 'failed'
    | 'classification_expired'
    | 'stale';
  maxAdvantagePct?: number;
  thresholdValue?: number;
  distancePct?: number;
  evaluatedAt?: string;
  errorCode?: string;
}

interface SwitchRuleRuntimeConfig {
  recommendationId: string;
  premiumClass: Record<string, 'H' | 'L'>;
  highPremiumCodes: string[];
  premiumClassSource: 'default' | 'user';
  premiumClassUpdatedAt: string;
  classificationSource: string;
  classificationStatus: 'fresh' | 'stale' | 'pending_classification' | 'classification_expired';
  classificationWarning?: string;
  intraSellLowerPct: number;
  intraBuyOtherPct: number;
  holdingSideAtRecommendation: 'high' | 'low';
  triggerOperatorAtRecommendation: 'gte' | 'lte';
}
~~~

默认 H 组固定为 `159501`、`513100`，其它基金默认归为 L 组。规则编辑页提供高级 H 组名单，用户修改后将 `highPremiumCodes` 和 `premiumClassSource = 'user'` 一起保存；Worker 和回测都只使用这份名单，不再按历史平均溢价自动切半。保存到 Worker 时必须同时写入 benchmarkCodes、enabledCodes、highPremiumCodes、premiumClass、runtimeConfig.premiumClass、intraSellLowerPct、intraBuyOtherPct、thresholdMode 和 thresholdValue。

高侧持仓只编辑 thresholdValue，对应 `H-L > thresholdValue`；低侧持仓的条件固定为 `H-L < 1%`，不开放低侧阈值输入。两个方向不再要求 `intraBuyOtherPct > intraSellLowerPct`，因为每条规则只运行当前持仓所属方向。

recommendationStatus 必须随规则持久化：

- valid：推荐结果与当前费用一致；
- fee_changed：费用已修改，旧推荐只能作为历史参考；
- expired：分类、回测或推荐结果已过期，不能直接作为当前推荐。

### 3.2 现有接口和 KV

前端继续通过 src/app/switchStrategySync.js 调用：

~~~text
GET  /api/notify/switch/config
POST /api/notify/switch/config
GET  /api/notify/switch/snapshot
POST /api/notify/switch/recommend
POST /api/notify/switch/run
POST /api/notify/switch/test
GET  /api/notify/switch/runs/latest
GET  /api/notify/switch/runs/:runId
~~~

最近一次正式运行结果固定保存到：

~~~text
switch:run-result:{clientId}
~~~

单次正式运行详情保存到：

~~~text
switch:run:{clientId}:{runId}
~~~

删除规则时由 POST /api/notify/switch/config 的 Worker 保存流程比较删除前后的规则 ID，并执行以下清理：

- 删除任意规则：清除 switch:snapshot:{clientId}、switch:state:{clientId} 和 switch:push-digest:{clientId}，避免快照、触发去重状态和推送摘要继续引用已删除规则；
- 删除最后一条规则：保存空 rules 配置并 enabled = false；上述三个 Key 置空或删除；
- switch:run-result:{clientId} 不删除，保留历史展示，但增加 stale = true、staleReason = 'rules-deleted' 和当前 ruleCount；
- switch:run:{clientId}:{runId} 历史详情保留，不回写到当前规则列表；
- 推荐结果缓存不作为当前规则状态读取，按原 TTL 自然过期。

前端保存成功后立即清空本地 snapshot，并以 Worker 返回的 config 为准；删除操作不得只更新本地规则数组。

推荐接口必须对 holdingFundCode、feeConfig、candidateCodes、backtestParams 做至少 10 分钟 Worker 缓存；前端生成推荐时做 debounce 和重复请求去重；缓存哈希包含回测引擎版本和候选代码；失败推荐不得长期命中缓存。

推荐职责边界：

- workers/notify/src/switchRecommendation.js：候选池筛选、应用默认/用户 H 组名单、历史数据准备、回测场景、推荐阈值选择、推荐结果组装和推荐输入哈希；
- workers/notify/src/switchStrategy.js：规则归一化、固定/用户 H 组投影、快照、触发判断、状态去重和通知构建；
- workers/notify/src/switchStrategyRoutes.js：鉴权、请求参数校验、KV 缓存读写、配置保存、正式运行和测试运行编排。

Phase 1 先确认上述现有文件职责，不新建第二套 switchRecommendation.js，也不把推荐逻辑复制到 switchStrategy.js。

### 3.3 H 组名单和运行时分类

分类不依赖当前行情或历史样本数量：

1. 没有 `highPremiumCodes` 时使用默认名单 `['159501', '513100']`；
2. 用户保存 `highPremiumCodes` 后，以用户名单为准，名单之外的候选统一为 L；
3. Worker 每次归一化配置时生成完整 `premiumClass`，保证 benchmark 和 enabledCodes 中的每个代码都有 H/L；
4. 推荐请求的缓存哈希必须包含 H 组名单，避免用户改组后命中旧推荐；
5. H 组名单变化会使原推荐和回测失效，前端引导用户重新生成推荐；
6. 不再因行情、净值或历史样本不足把规则挂起，行情缺失只影响当前优势值和回测数据质量。

### 3.4 快速测试隔离

POST /switch/test 必须使用 isTest: true 和安全 testId。

测试写入只能使用：

~~~text
switch:snapshot:{clientId}:test:{testId}
switch:state:{clientId}:test:{testId}
~~~

不得写入正式 snapshot、state、push digest、run-result 或正式通知状态。前端异常对象必须保留 Worker 返回的 steps、failureStage 和 error，不能只保留错误字符串。

## 4. 正负优势和距离提醒语义

### 4.1 统一原始差值

内部原始差值固定为：

~~~text
hlPremiumDiff = highPremiumRate - lowPremiumRate
~~~

maxAdvantagePct 是兼容现有字段的名称，实际表示当前方向下“最优候选”的优势值。

### 4.2 按触发方向解释优势

当前持仓为高侧：

~~~text
triggerOperator = gte
advantagePct = hlPremiumDiff
数值越高越好
达到条件：advantagePct > thresholdValue
~~~

当前持仓为低侧：

~~~text
triggerOperator = lte
advantagePct = hlPremiumDiff
数值越低越好
达到条件：advantagePct < thresholdValue，其中 thresholdValue 固定为 1%。
~~~

优势值可以是负数，但阈值本身必须是非负数。负值不能脱离触发方向单独解释：

- 高侧按“越高越好”判断
- 低侧按“越低越好”判断
- UI 副标题由 triggerOperator 决定显示“越高越好”或“越低越好”

### 4.3 距离提醒条件

取当前方向下最优候选的优势值 bestAdvantagePct，统一计算：

~~~js
distancePct = Math.abs(thresholdValue - bestAdvantagePct);
~~~

达到条件的判断：

~~~js
const reached = triggerOperator === 'gte'
  ? bestAdvantagePct > thresholdValue
  : bestAdvantagePct < thresholdValue;
~~~

文案：

- reached 为 true：已达到
- reached 为 false：还差 distancePct.toFixed(2)%
- 无有效数据：暂无数据

接近提醒统一定义为：未达到条件且 distancePct 小于等于 1.00 个百分点。

候选排序：

- 高侧：优势从高到低
- 低侧：优势从低到高

前端不得重新计算 H/L 分类，只消费 Worker 返回的方向、优势和状态。

### 4.4 阈值校验

在 src/app/switchRuleModel.js 与 Worker 归一化层增加同语义的 validateThresholdValue(value, operator)：

| 操作符 | 允许范围 | 默认快捷值 |
| --- | --- | --- |
| gte | 0.5% 至 5% | 2.65% |
| lte | 固定 1% | 1% |

阈值范围是用户输入和当前规则阈值的范围，不是优势展示值的范围。前端保存前阻止负数、空值和超范围值；Worker 保存时再次校验，返回现有配置接口的 400 错误，不写入非法配置。

legacy 配置读取时不得静默把负阈值当成有效规则：使用对应操作符的最近合法边界修正，并写入 migration warning；推荐结果必须经过同一校验后才能回填。

## 5. UI 页面实现

### 5.1 页面头部

按 UI 图实现：

~~~text
基金切换
根据持仓、费用和历史数据，自动为您寻找更优切换机会并提醒。

推荐机会     我的方案     切换记录
~~~

“我的方案”右侧展示上次运行时间、成功状态和紫色主按钮“手动跑一次”。

### 5.2 StrategyRunStatus

新增 src/components/fund-switch/StrategyRunStatus.jsx，按三列卡片展示：

~~~text
运行结果          下一次运行          提醒设置
成功 1 条          自动运行            已开启推送通知
触发 4 条
未触发 0 条
~~~

提供“设置提醒”按钮。没有规则时手动运行不请求 Worker，直接提示“请先添加规则”。

### 5.3 SwitchStrategyCard

输入统一 ViewModel：

~~~ts
{
  rule,
  holdingFund,
  holdingAmount,
  enabled,
  bestAdvantagePct,
  thresholdValue,
  distancePct,
  currentStatus,
  fee,
  candidates,
  expanded
}
~~~

卡片头部展示基金图标、代码、名称、持仓数量、状态徽章和操作按钮：

~~~text
快速测试
编辑规则
停用/启用
删除
展开/收起
~~~

展开后展示四个指标：

~~~text
当前最大切换优势
推荐提醒条件
当前状态
切换费用（每次预估）
~~~

指标区域使用现有 Tailwind 响应式断点，不硬编码 390px：基础布局（sm 以下）为两列，sm 及以上为四列，即使用 grid-cols-2 sm:grid-cols-4。390px 只作为 E2E 验收视口，不作为 CSS breakpoint。默认只展开第一条规则，其余折叠，同一时间只展开一条。

### 5.4 CandidateFundList

新增 src/components/fund-switch/CandidateFundList.jsx，按以下列渲染：

~~~text
基金名称
当前切换优势（已扣除费用）
距离提醒条件
状态
~~~

状态枚举：

~~~ts
type CandidateStatus = 'reached' | 'near' | 'notReached';
~~~

展示：

- reached：已达到 / 更优选择
- near：接近提醒
- notReached：未达到
- 无数据：暂无数据

列表默认展示前 4 条，点击“查看全部”展开完整候选池。

### 5.5 状态降级对照

| 状态 | 徽章 | 指标显示 | 当前状态 | 操作可用性 |
| --- | --- | --- | --- | --- |
| ready | 绿色“已启用” | 实时数值 | 尚未触发 | 快速测试、编辑、停用、删除可用 |
| near_trigger | 橙色“接近提醒” | 实时数值 | 接近提醒 | 全部可用 |
| triggered | 绿色“已达到提醒” | 实时数值 | 已达到提醒条件 | 全部可用 |
| pending_classification | 灰色“等待分析” | 优势和阈值显示 —，费用保留 | 等待分析 | 快速测试禁用，重新分析可用 |
| classification_expired | 橙色“需要重新分析” | 无有效快照显示 — | 需要重新分析 | 快速测试禁用，重新分析可用 |
| failed | 红色“检测失败” | 指标显示 —，费用保留 | 检测失败 | 快速测试显示重新测试 |
| stale | 橙色“使用上次分析结果” | 展示旧快照 | 使用上次分析结果 | 全部可用并显示过期提示 |

编辑、停用/启用、删除在上述状态下均保留；只有无法完成分类或没有可运行数据时禁用快速测试。

## 6. 新增和编辑流程

新增 src/components/fund-switch/StrategyEditor.jsx，新增和编辑共用三步流程。

### Step 1：选择持仓

持仓来自 aggregateByCode()，默认第一只有效持仓；已有规则的持仓不可重复创建；支持手动输入基金代码；不展示内部分类。

### Step 2：设置提醒条件

新增 src/components/fund-switch/ThresholdSelector.jsx：

- gte 规则快捷值 0.5% 至 5%，步长 0.5%
- lte 规则固定显示 H-L < 1%，不提供可编辑输入
- 支持高侧自定义
- 范围校验
- 根据 gte/lte 生成用户文案

实际实现以 triggerOperator 分支选择范围；不得继续使用统一的 -3% 至 3% 快捷值。

在 validateFeeConfig() 同级增加 validateThresholdValue(value, operator)，并在“生成推荐规则”“保存规则”“采用回测值”三个入口都调用。阈值校验失败时保留用户输入并显示字段级错误，不发起保存或推荐请求。阈值范围必须按操作符校验：gte 为 0.5% 至 5%，lte 只能为 1%；负数、空值和超范围值均拒绝。低侧不展示可编辑输入。

必须同步调整 src/app/switchRuleModel.js、workers/notify/src/switchStrategy.js、App/Worker premium spread 回测引擎和推荐策略阈值适配，但优势展示值仍允许按方向出现负数。

保留 API 字段 thresholdMode 和 thresholdValue，费用仍不得为负。

### Step 3：设置费用

支持按明细计算和直接填写预计总费用，字段包括买入手续费、卖出手续费、最低佣金、其他费用和预计单次切换总费用。

统一调用 validateFeeConfig() 和 toSwitchBacktestCosts()，不能把百分比点直接传给回测模拟器。

若当前编辑流程已经生成 recommendation 或 backtestRecommendedValue，用户再次修改任一费用字段时：

1. 立即把规则的 recommendationStatus 持久化为 fee_changed；
2. 显示“费用已变更，推荐条件可能不再准确，是否重新生成？”；
3. 点击“重新生成”时清除旧 recommendation、backtestRecommendedValue 和旧回测对比，使用新费用重新调用 POST /api/notify/switch/recommend；
4. 用户暂不重新生成时保留编辑内容，但旧推荐只能显示为“费用变更后待重新分析”，不能直接作为新费用下的可靠推荐；
5. 点击“使用推荐规则”前再次检查 fee_changed，阻止误用旧推荐，并提供重新生成入口。

费用变更只使推荐和回测结果失效，不清空持仓、候选基金或已有正式运行状态；recommendationStatus 必须写入规则，而不能只放在 React state 或 recommendation 临时对象中，刷新页面后仍需显示“费用变更后待重新分析”。

## 7. 回测、快速测试和正式运行

编辑页增加“回测当前策略”。回测页面展示历史最佳提醒值、触发次数、胜率、年化提升、最大回撤和阈值对比。

点击“采用该值”后：

- 返回编辑页
- 设置推荐值模式
- 将本次回测值 B 同时写入 thresholdValue 和 backtestRecommendedValue
- 设置 recommendationStatus = valid
- 保留费用
- 不覆盖持仓、候选池和分类快照

字段优先级和竞态处理：

- thresholdValue 表示用户当前确认并实际使用的阈值；
- backtestRecommendedValue 表示最近一次有效回测给出的建议值；
- 采用回测值时两个字段都写入 B，thresholdMode 设置为 backtest；
- 费用变更时清空 backtestRecommendedValue，保留 thresholdValue = B，并将 thresholdMode 切换为 fixed，保证用户最后确认的 B 不被旧推荐或新推荐覆盖；
- 费用变更后重新生成推荐得到 C 时，只更新 backtestRecommendedValue = C 和 recommendationStatus = fee_changed，不自动修改 thresholdValue；
- 只有用户再次点击“采用推荐值”时，才将 thresholdValue 和 backtestRecommendedValue 同时更新为 C，并恢复 recommendationStatus = valid；
- 回测对比图始终以当前请求的费用和回测参数生成，不以 thresholdValue 作为隐式输入基准。

无有效历史样本时显示“参考值”，不能标记为可靠推荐。

新增 src/components/fund-switch/StrategyTestModal.jsx，调用 runSwitchQuickTest(rule.id)，必须使用测试 Key，不发送正式通知，不写正式运行状态。

“手动跑一次”调用 runSwitchOnce()，运行全部启用规则，并保存正式运行结果。

## 8. 迁移与旧组件清理

旧规则迁移时：

- 不自动合并相同持仓的不同候选池
- 保留主记录
- 其他记录保存为停用备份
- 保留原费用、候选基金和阈值
- 根据迁移后的 triggerOperator 对每条 thresholdValue 调用 validateThresholdValue；
- 非法、负数、空值或超范围阈值修正到对应操作符的最近合法边界，并写入 migration warning；
- 迁移后的 recommendationStatus 默认根据推荐和费用是否匹配设置为 valid、fee_changed 或 expired；
- 迁移必须保留 thresholdValue 与 backtestRecommendedValue 的字段优先级，不能把旧推荐值无条件覆盖用户当前阈值。

以下旧组件在新页面和 E2E 稳定后确认无引用再删除或归档：

~~~text
src/pages/SwitchStrategyExperience.jsx
src/pages/SwitchStrategyPanels.jsx
src/pages/SwitchStrategyOpportunityPanels.jsx
src/pages/SwitchStrategyClassificationPanel.jsx
~~~

不得删除同步层、回测引擎、Worker 触发引擎、持仓 ledger 和真实切换记录计算逻辑。

## 9. 测试与验收

新增或更新单元测试：

- validateThresholdValue 对 gte/lte 的范围、负数、空值和超范围输入的校验
- 推荐生成和规则保存拒绝非法阈值
- 费用变更后 recommendation 标记 fee_changed，旧推荐不能直接采用
- Worker 删除规则时清理 snapshot、state、push-digest，并将 run-result 标记 stale
- recommendationStatus 刷新页面后仍保留 valid、fee_changed 或 expired
- 迁移规则逐条调用 validateThresholdValue 并记录修正 warning
- 采用回测值 B 后修改费用、重新推荐 C 的字段优先级和不自动覆盖行为
- distancePct 计算
- gte/lte 的已达到判断
- 高侧越高越好、低侧越低越好
- 正负优势值保存和读取
- 候选排序和状态映射
- 六种运行状态的卡片降级
- 空规则和删除最后一条规则
- 快速测试错误步骤保留
- 回测推荐值回填且费用不丢失

Playwright 覆盖：

1. 三个 Tab 切换
2. 运行状态 Banner
3. 第一条卡片默认展开、第二条折叠
4. 候选基金排序
5. “已达到”和“还差 X%”文案
6. pending、expired、stale、failed 状态
7. 快速测试成功、失败、超时
8. 手动跑一次
9. 新增、编辑、停用、启用、删除
10. 删除最后一条进入空状态
11. 回测采用推荐值
12. 360px、390px 和 639px 视口均使用两列指标布局，640px 以上使用四列
13. 普通页面不出现 H/L、规则 A/B、Worker、Cron

提交前执行：

~~~bash
node --test test/*.mjs
npm run check:refactor
npm run lint -- --quiet
npm run build:app
git diff --check
~~~

最终验收：用户进入页面 5 秒内能看懂持仓、当前优势、提醒条件、候选基金、费用和下一步操作；技术字段只保留在数据层、Worker 和调试日志中。
