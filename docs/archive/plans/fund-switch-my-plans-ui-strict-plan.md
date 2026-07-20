# 基金切换「我的方案」UI 严格还原与前后端实施计划

## 0. 计划状态与参考物

本文件只定义实施方案，本轮不修改业务代码、不改变现有 API 行为。

参考 UI：

- [ChatGPT UI 分享图](https://chatgpt.com/s/m_6a5e270ff2988191a0f09740335316c4)
- 仓库本地稿：`data/ChatGPT.png`
- 当前实施分支：`test`

目标是严格还原本地稿中的“基金切换 / 我的方案”页面：页面标题、副标题、Tab、运行状态横幅、方案卡片、四项指标、候选基金表、折叠卡片和“添加新的切换方案”入口必须保持同一信息层级和交互顺序。

本计划继承 [`fund-switch-rule-redesign-plan.md`](./fund-switch-rule-redesign-plan.md) 的业务规则、H 组默认名单、费用单位、回测、快速测试隔离和删除清理约束；本文件只补充 UI 严格还原所需要的前后端契约和实现边界。

## 1. 当前代码基线与差距

当前入口和组件树：

```text
WorkspacePage
└── FundSwitchExperience
    └── switchStrategy/SwitchRuleExperience
        ├── StrategyRunStatus
        ├── SwitchStrategyCard
        │   └── CandidateFundList
        ├── StrategyEditor
        ├── SwitchRuleDetailView
        └── StrategyTestModal
```

当前接口封装在 `src/app/switchStrategySync.js`，Worker 路由在 `workers/notify/src/switchStrategyRoutes.js`，核心运行时和推荐逻辑分别在 `switchStrategy.js`、`switchRecommendation.js`。

| UI 区域 | 当前实现 | 严格还原所需改动 |
| --- | --- | --- |
| 页面头部 | 已有标题、Tab 和手动运行按钮，但布局较紧凑，副标题和右侧运行信息未形成一行 | 采用 UI 图的左右结构：左侧标题/副标题，右侧“上次运行 + 成功 + 手动跑一次” |
| 运行结果 | `StrategyRunStatus` 是单个横向提示条 | 改为三列信息横幅：运行结果、下一次运行、提醒设置；移动端堆叠 |
| 方案卡片 | 已有四项指标和操作，但背景、图标、按钮顺序、标题层级与稿件不一致 | 重做视觉壳，保留现有事件回调和规则数据来源 |
| 当前优势 | 已由 `switchStrategyViewModel.js` 计算方向和最佳候选 | 统一消费 Worker 的 canonical runtime view；前端只负责格式化，不重复 H/L 和费用业务计算 |
| 候选表 | 已有四列，但默认全量渲染、移动端和状态文案不完全符合稿件 | 默认四条、支持“查看全部”，增加“更优选择/接近提醒/未达到”状态语义 |
| 折叠行为 | 已默认展开第一条，可切换展开 | 保证同一时间最多展开一条；卡片主体展开，操作按钮不触发主体跳转 |
| 新增入口 | 当前是普通按钮/空状态入口 | 改为底部虚线大按钮，主文案“添加新的切换方案”，副文案说明自动生成提醒条件 |
| 运行统计 | 当前 latest run 主要展示规则数、触发、推送、候选数 | 增加成功规则、触发信号、未触发规则、失败规则、下一次计划运行和通知状态 |
| 自动运行 | 生产 Worker 有 cron；`wrangler.test.toml` 没有同步声明 cron | 测试环境补齐与生产一致的 cron，且 API 返回下一次计划时间；没有计划时不得展示“自动运行” |

## 2. 严格 UI 信息架构

### 2.1 页面整体

桌面端按稿件保持以下顺序：

```text
基金切换                         上次运行：05-14 15:45  ● 成功  [▷ 手动跑一次]
根据持仓、费用和历史数据，自动为您寻找更优切换机会并提醒。

推荐机会       我的方案       切换记录

[运行结果]              [下一次运行]              [提醒设置]

[展开的方案卡片]
[折叠的方案卡片]
[添加新的切换方案]
```

页面仍保留应用顶栏、底部导航、登录和持仓来源，不在本页面加入云端同步、合并本机数据或清除本机数据入口。

### 2.2 头部和 Tab

- 标题固定为“基金切换”。
- 副标题固定为“根据持仓、费用和历史数据，自动为您寻找更优切换机会并提醒。”。
- Tab 顺序固定为“推荐机会 / 我的方案 / 切换记录”，当前 Tab 使用白色卡片、紫色文字和底部/外框高亮。
- “我的方案”列表页右侧显示最近一次正式运行时间和成功/失败状态。
- “手动跑一次”是紫色主按钮；没有启用规则时不请求 Worker，显示“请先添加规则”。

### 2.3 运行结果横幅

`StrategyRunStatus` 改为独立三列组件：

```text
运行结果                 下一次运行                 提醒设置
成功 1 条                今天 16:00 自动运行        已开启推送通知
触发 4 条                                          [设置提醒]
未触发 0 条
```

状态行为：

- 首次无正式运行：运行结果显示“暂无运行记录”，下一次运行显示“等待首次运行”，提醒设置仍显示真实通知状态。
- 运行中：三列保留布局，运行结果显示加载图标和“正在检测…”，手动按钮禁用。
- 成功：显示成功/触发/未触发统计。
- 部分失败：显示成功、失败、触发统计，并以橙色或红色提示，不把失败规则计入成功规则。
- `latestRun.stale === true`：显示“上次运行结果已过期”，不得冒充当前运行成功。
- “设置提醒”跳转现有通知设置入口；如果没有可用通知配置，显示“未开启推送通知”，不伪造已开启状态。

### 2.4 方案卡片

每条卡片必须包含：

1. 左侧紫色渐变方形基金图标，使用现有图标体系，不为每只基金请求图标图片。
2. 基金代码和名称，例如“159632 纳斯达克ETF”。
3. 持仓数量，例如“当前持仓 29,300 份”。
4. 状态徽章，例如“已启用”“接近提醒”“检测失败”。
5. 右侧操作顺序：快速测试、编辑规则、停用/启用、展开/收起。
6. 展开后四个彩色指标卡：

```text
当前最大切换优势       推荐提醒条件       当前状态       切换费用（每次预估）
-0.54%                 3.00%              尚未触发       ¥20.00
越低越好               当切换优势达到...   当前优势未达到   已包含在计算中
```

指标卡颜色仅表达状态，不改变业务含义：优势使用淡紫色、阈值使用淡绿色、状态使用淡橙色、费用使用淡蓝色。

卡片交互：

- 默认只展开第一条规则。
- 其他规则默认折叠；展开一条时自动收起上一条。
- 点击卡片主体进入规则详情；点击按钮、候选行或折叠按钮不得冒泡触发详情跳转。
- 删除按钮保留现有确认提示和 Worker KV 清理流程。
- 分类待分析、过期、失败状态必须保留费用信息；没有有效行情时优势显示“—”，不能显示 0%。

### 2.5 候选基金表

展开卡片后显示：

```text
候选基金（按当前切换优势排序）                         查看全部 >

基金名称                 当前切换优势（已扣除费用）  距离提醒条件  状态  >
```

规则：

- 默认展示排序后的前 4 条；点击“查看全部”展示完整候选池，再次点击收起。
- 高侧规则按优势从高到低；低侧规则按优势从低到高。排序方向来自 Worker 的 `triggerOperator`，前端不可写死为单一方向。
- “当前切换优势”必须是扣除本次切换费用后的值。
- 触发判断沿用业务严格比较：高侧 `advantagePct > thresholdValue`，低侧 `advantagePct < thresholdValue`。
- `distancePct = abs(thresholdValue - advantagePct)`；已达到时显示“已达到”，未达到时显示“还差 X%”。
- 排名第一且已达到的候选显示“更优选择”；未达到但距离不超过 1 个百分点显示“接近提醒”；其余显示“未达到”。
- 缺少优势或阈值时显示“暂无数据”，不根据缺失值推断状态。
- 移动端将每行转为两行卡片，保留基金名、优势、距离、状态和右箭头，不显示表头网格。

### 2.6 添加方案入口与空状态

列表底部使用虚线边框大按钮：

```text
⊕  添加新的切换方案
   选择一只持仓基金，系统会为您生成推荐提醒条件
```

无规则时保留空状态，但主操作视觉统一为“添加新的切换方案”；“手动跑一次”保留为次操作，并直接提示先添加规则。

## 3. 前后端统一数据契约

### 3.1 规则运行视图

不改变 `SwitchRule` 的持久化兼容字段，在 `GET /switch/snapshot`、`POST /switch/run` 和 `GET /switch/runs/latest` 的响应中增加统一的展示投影：

```ts
interface SwitchRuleRuntimeView {
  ruleId: string;
  status:
    | 'ready'
    | 'near_trigger'
    | 'triggered'
    | 'pending_classification'
    | 'classification_expired'
    | 'stale'
    | 'failed';
  triggerOperator: 'gte' | 'lte';
  direction: 'high' | 'low';
  bestAdvantagePct: number | null;
  thresholdValue: number | null;
  distancePct: number | null;
  estimatedSwitchCost: number | null;
  holdingNotional: number | null;
  evaluatedAt: string | null;
  candidates: Array<{
    code: string;
    name: string;
    currentAdvantagePct: number | null;
    distancePct: number | null;
    status: 'better' | 'reached' | 'near' | 'not_reached' | 'no_data';
  }>;
}
```

`bestAdvantagePct` 是当前方向下的最佳候选值；低侧可以为负数，UI 仍显示“越低越好”。前端不再从 `premiumClass`、H/L 或旧 `spreadVsBenchmarkPct` 自行推导展示值。

### 3.2 运行汇总

扩展正式运行结果，不删除旧字段：

```ts
interface SwitchRunSummary {
  runId: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  enabledRuleCount: number;
  successRuleCount: number;
  failedRuleCount: number;
  triggeredSignalCount: number;
  notTriggeredRuleCount: number;
  pushedCount: number;
  nextScheduledAt: string | null;
  scheduleStatus: 'enabled' | 'disabled' | 'unknown';
  notificationStatus: 'enabled' | 'disabled' | 'unconfigured' | 'unknown';
  stale?: boolean;
  ruleResults: SwitchRuleRuntimeView[];
}
```

兼容映射：旧 `triggered` 映射为 `triggeredSignalCount`，旧 `pushed` 映射为 `pushedCount`，旧 `ruleCount` 保留但前端新 UI 优先使用新字段。

### 3.3 费用和持仓金额

- `holdingNotional` 必须来自当前持仓份额 × 可用最新价格；能够读取持仓市值时优先使用持仓市值。
- 明细费用按当前持仓金额计算卖出和买入费用，并分别应用最低佣金，再加其他费用。
- 预计总费用模式直接使用 `estimatedTotalFee`。
- 默认最低佣金为 0；缺失价格时费用显示“待行情”，不得用 0 元掩盖计算失败。
- Worker 返回 `estimatedSwitchCost` 和 `feeCalculationStatus`，前端只格式化金额。
- 推荐接口、回测接口、列表卡片和详情页必须使用同一份费用适配函数，避免推荐显示 ¥20 而回测使用另一套费用。

## 4. 后端改动清单

### 4.1 `workers/notify/src/switchStrategy.js`

1. 在现有快照投影之后增加 `buildSwitchRuleRuntimeView()`，统一生成当前状态、最佳优势、距离、排序后的候选行和费用。
2. 保持默认 H 组 `159501`、`513100` 及用户 H 组覆盖逻辑不变。
3. 保持高侧 `H-L > thresholdValue`、低侧 `H-L < 1%` 的触发方向，不把低侧阈值重新开放成普通可编辑阈值。
4. 分类快照刷新失败时沿用上一次持久化分类并标记 `stale`，不得把当前优势伪装成 0。
5. 对外通知仍保持旧 `rule: A/B` 和 eventId 兼容，但 App 页面只消费 `direction/status`。

### 4.2 `workers/notify/src/switchRecommendation.js`

1. 推荐结果增加与运行视图一致的 `recommendedCandidate`、`candidatesResult[].currentAdvantagePct`、`distancePct`、`status` 和 `estimatedSwitchCost`。
2. 回测推荐仍严格以当前持仓作为初始代码和初始持仓金额。
3. 保留高侧阈值自动选择、低侧 1% 业务规则固定的现有约束，并在结果中明确 `selectionStatus`，避免 UI 把固定值显示为“自动最优”。
4. 候选基金名称统一从 Worker 候选目录或已有轻量元数据返回，列表页不额外请求 K 线、NAV 历史或雪球详情。
5. 推荐缓存输入继续包含持仓代码、持仓金额、费用、候选池、H 组名单、回测参数和引擎版本。

### 4.3 `workers/notify/src/switchStrategyRoutes.js`

1. `GET /switch/snapshot` 返回 `config`、原始 snapshot 和每条规则的 `runtimeView`。
2. `POST /switch/run` 返回扩展后的 `SwitchRunSummary`，并将同一结构写入 `switch:run-result:{clientId}`；正式运行仍产生业务信号，快速测试不写正式 KV。
3. `GET /switch/runs/latest` 返回 `run`、`nextScheduledAt`、`scheduleStatus` 和 `notificationStatus`。
4. 运行统计区分启用规则、成功规则、失败规则、已触发信号和未触发规则，不能使用候选数量代替规则数量。
5. 通知状态从现有 client settings/通知配置读取；读取失败时返回 `unknown`，前端显示降级文案。
6. 运行失败、超时、分类过期和无行情均返回稳定的 `status`、`errorCode`、`failureStage`，供卡片和横幅渲染。
7. 保留配置删除时对 `switch:snapshot`、`switch:state`、`switch:push-digest` 的清理和 `switch:run-result` 的 stale 标记。

### 4.4 `workers/notify/wrangler.test.toml`

测试环境需要复制生产 Worker 的 cron 声明，否则 UI 不能真实展示“自动运行”。仅复制调度声明，不改变测试 KV、Cookie、服务绑定或测试域名：

```toml
[triggers]
crons = [
  "30 7 * * MON-FRI",
  "30 12 * * MON-FRI",
  "30 13 * * MON-FRI",
  "* 1-7 * * MON-FRI",
  "* 13-21 * * MON-FRI"
]
```

如果测试环境明确不启用 cron，则必须返回 `scheduleStatus = 'disabled'`，UI 显示“未配置自动运行”，不能显示截图中的“今天 16:00 自动运行”。

## 5. 前端改动清单

### 5.1 页面调度层

修改 `src/pages/switchStrategy/SwitchRuleExperience.jsx`：

- 保留现有配置加载、持仓 ledger、推荐、回测、快速测试和删除行为。
- 将 `snapshot`、`latestRun` 统一转换为 `SwitchRuleRuntimeView`，页面只向展示组件传 view model。
- 头部运行信息、横幅和卡片使用同一份运行状态，避免上次运行和卡片状态互相矛盾。
- 手动运行开始、完成、失败、超时都更新横幅和卡片；成功后刷新 config/snapshot/latest run。
- 规则删除后清空本地 snapshot 和对应 view model，最后一条规则立即进入 UI 空状态。
- “设置提醒”接入现有通知设置导航，不新建第二套通知配置。

### 5.2 `src/components/fund-switch/StrategyRunStatus.jsx`

重写为三列横幅组件，新增 props：

```ts
{
  latestRun,
  scheduleStatus,
  nextScheduledAt,
  notificationStatus,
  running,
  onRun,
  onRetry,
  onOpenNotificationSettings
}
```

组件本身不请求接口、不计算规则，不保存状态；只处理加载、成功、部分失败、无记录和通知未配置五种展示状态。

### 5.3 `src/components/fund-switch/SwitchStrategyCard.jsx`

- 按截图重做卡片背景、圆角、边框、紫色图标、四格指标色块和操作按钮。
- “停用”使用红色描边按钮；“快速测试/编辑规则”使用紫色描边按钮。
- 显示“切换费用（每次预估）”“已包含在计算中”等 UI 文案，实际金额来自 `runtimeView.estimatedSwitchCost`。
- 优势指标显示方向副标题“越低越好/越高越好”，不可根据正负号猜测方向。
- 统一接收 `runtimeView`，移除组件内部对 snapshot 原始结构的业务推导。
- 状态异常时保留操作可用性矩阵：待分析/分类过期禁用快速测试，编辑/删除/重新分析仍可用。

### 5.4 `src/components/fund-switch/CandidateFundList.jsx`

- 增加 `showAll` 状态和“查看全部/收起”按钮。
- 使用 Worker 返回的 `statusLabel` 或标准状态枚举，不在组件中重新计算 H/L。
- 桌面端严格四列；移动端转卡片行。
- 表格行支持点击进入候选详情/行情，但只有用户主动点击候选时才请求详情级行情；列表渲染不得预取 K 线或 NAV 历史。

### 5.5 `src/pages/switchStrategy/switchStrategyViewModel.js`

- 保留兼容旧 snapshot 的适配函数，但优先读取 `runtimeView`。
- 仅做字段归一化、金额/百分比格式化和空值降级。
- 如果 Worker 没有返回新字段，明确降级为“暂无数据”，不能根据不完整字段产生错误的“已达到”。
- 增加 `getPlanCardStatus()`、`getCandidateStatusLabel()` 和 `formatNextScheduledAt()` 等纯函数，便于单元测试。

### 5.6 `src/components/fund-switch/ui.jsx` 与样式

- 增加 UI 图对应的颜色 token、指标卡背景和状态徽章样式。
- 桌面端使用与截图相近的宽内容区和间距；移动端使用现有 Tailwind `sm` 断点，不硬编码 390px。
- 页面列表卡片指标使用 `grid-cols-2 sm:grid-cols-4`；候选表使用 CSS grid，避免固定宽度溢出。
- 不新增全局 CSS，不影响行情中心、持仓总览和其他页面。

## 6. API 与兼容策略

本轮优先扩展现有响应，不新增公共路径：

```text
GET  /api/notify/switch/config
POST /api/notify/switch/config
GET  /api/notify/switch/snapshot
POST /api/notify/switch/recommend
POST /api/notify/switch/run
POST /api/notify/switch/test
GET  /api/notify/switch/runs/latest
GET  /api/notify/switch/runs/:runId
```

要求：

- 旧客户端仍可读取旧 `ruleCount/triggered/pushed` 字段。
- 新客户端优先读取 `runtimeView` 和扩展后的 `SwitchRunSummary`。
- 快速测试继续使用 `isTest: true`、`testId` 和测试 Key，不改变正式 snapshot/state/run-result。
- API 错误必须携带 `failureStage`、`errorCode` 和可展示的中文原因；前端不从错误字符串猜失败环节。
- 推荐/运行接口的 CORS、鉴权、Cookie、Service Binding 和 test 域名保持现有部署边界。

## 7. 实施顺序

### Phase 1：契约和运行时投影

1. 在 Worker 单元测试中先固定 `SwitchRuleRuntimeView`、`SwitchRunSummary` 和费用计算样例。
2. 实现 Worker runtime view 和 run summary 扩展。
3. 补齐测试 Worker cron，确认 `nextScheduledAt` 的时区和工作日规则。
4. 更新前端同步层的兼容解析，不改 UI。

验收：现有配置、推荐、正式运行、快速测试、删除和旧客户端字段全部兼容。

### Phase 2：页面骨架和运行横幅

1. 调整 `SwitchRuleExperience` 的头部和 Tab 布局。
2. 重写 `StrategyRunStatus` 三列结构。
3. 接入运行结果、下一次运行和提醒设置真实数据。

验收：无规则、首次运行、成功、部分失败、超时均不出现假数据。

### Phase 3：卡片和候选表

1. 重写 `SwitchStrategyCard` 视觉结构。
2. 重写 `CandidateFundList` 的四条默认、查看全部和移动端行布局。
3. 接入 runtime view 的状态、方向、费用和距离。
4. 添加底部虚线“添加新的切换方案”入口。

验收：截图中的两条规则、一展开一折叠、四项指标和候选表顺序一致。

### Phase 4：交互和异常状态

1. 接入快速测试弹层、手动运行确认和运行中状态。
2. 接入编辑、停用/启用、删除、重新分析和设置提醒。
3. 验证分类过期、stale、无行情、费用变更和推荐失效时的卡片降级。

### Phase 5：视觉回归与发布

1. 以 1440px/1536px 桌面视口对照 `data/ChatGPT.png`。
2. 以 390px、375px 和 360px 视口验证指标两列、候选卡片和底部入口。
3. 验证列表页没有预取 K 线、NAV 历史、雪球 raw detail 或 AI summary。
4. 在 `test.freebacktrack.tech` 完成 Worker/API/Pages 联调后再合并 UI 代码。

## 8. 测试计划

### 单元测试

- `test/switchStrategyViewModel.test.mjs`：高侧/低侧排序、负优势、距离、达到/接近/未达到和无数据。
- `test/switchRuleModel.test.mjs`：持仓金额费用、最低佣金为 0、百分比单位转换、低侧固定 1%。
- `test/switchStrategyConfigSync.test.mjs`：新旧 run summary/runtime view 字段兼容、删除后的 stale 结果。
- Worker route tests：`/snapshot`、`/run`、`/runs/latest` 的成功/部分失败/超时/无规则响应；快速测试不写正式 KV。
- `test/switchRecommendationSelection.test.mjs`：推荐候选、回测推荐值、费用和持仓金额传递不回归。

### E2E 与视觉验收

- 无规则：底部虚线新增入口、手动运行提示先添加规则。
- 两条规则：第一条默认展开，第二条折叠，展开第二条后第一条收起。
- 卡片操作：快速测试、编辑、停用、删除均不误触发卡片详情。
- 候选表：默认 4 条、查看全部、排序、状态颜色和距离文案。
- 运行横幅：加载、成功、部分失败、失败、stale 和通知未配置。
- 费用不足行情：显示“待行情”，不显示 0 元；候选无数据显示“暂无数据”。
- 移动端：390/375/360px 不横向溢出，指标两列，候选表转卡片。
- 保持现有 `test/e2e/switch-strategy-classification.spec.js` 和全局 UI smoke 不回归。

### 提交前检查

```text
node --test test/switchStrategyViewModel.test.mjs test/switchRuleModel.test.mjs test/switchRecommendationSelection.test.mjs
npm run check:refactor
npm run lint -- --quiet
npm run build:app
git diff --check
```

## 9. 不在本计划内的改动

- 不修改行情中心、持仓总览、交易记录或其他 Tab 的业务逻辑。
- 不更换持仓来源、雪球源、Worker Service Binding、KV/R2 数据归属或登录体系。
- 不删除 H/L、A/B、回测内部字段；只禁止它们出现在普通“我的方案” UI。
- 不新增云端同步、合并本机数据或清除本机数据交互。
- 不为了候选列表预取详情级行情数据。

## 10. 完成标准

只有同时满足以下条件才算完成：

1. `data/ChatGPT.png` 中的页面层级、卡片顺序、按钮位置、候选表结构和空状态入口在桌面端一致。
2. 移动端没有横向溢出，信息顺序与桌面端一致。
3. 所有金额、优势、距离和状态都来自统一运行时契约，费用基于当前持仓金额。
4. “下一次运行”和“已开启推送通知”均来自真实 Worker/通知配置；无数据时明确降级。
5. 快速测试不污染正式运行状态，手动跑一次能够运行全部启用规则并保存正式结果。
6. 现有回测、规则删除、持仓数据和远端 Worker 定时能力保持可用。
