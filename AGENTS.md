# AI DCA Agent Notes

## 行情接口边界

- 列表页只能请求列表所需的轻量数据：`/quotes`、必要的列表增强接口，以及已缓存的小元数据。
- 列表页不得为每个标的批量请求 `/kline`、净值历史、财务报表、雪球 raw detail、AI summary 或其它详情级接口。
- 详情页在用户选中标的后再请求 K 线、净值历史、财务报表、对比标的 K 线等重数据。
- 当前不可展示的数据不要预取；例如列被隐藏时不得为了该列请求接口。
- 不再被 UI 消费的 props、state、effect 和刷新函数应删除，不得保留后台预取。
- 没有数据源的模块应在前端本地短路，不要调用固定返回空数据的接口。

## 缓存优先级

- 请求前先查最近层缓存：组件内 inflight/memory -> localStorage 列表增强缓存 -> Worker KV 小对象 -> R2 大对象 -> 外部源站。
- 批量接口和单标的接口必须复用同一份缓存 key；例如 `/quotes` 和 `/quote/:symbol` 统一使用 `quote:<code>` 短 TTL 缓存。
- R2 存完整 K 线等大对象；列表页不得通过读取或扫描 R2 大对象来派生展示字段。
- 从 R2 或历史序列派生出的列表字段必须写成 KV 小对象供列表读取，例如 `kline-high:<market>:<symbol>:1d`。
- 缓存缺失时，如果字段不是列表核心字段，应展示 `—` 或降级状态，不要同步触发重接口兜底。

## 基金列表规则

- 场内基金高点下跌只使用缓存的 `highPoint` / `yearHigh`，来源应为 1d K 线派生高点。
- CN 场内基金不得用 `high52w`、`highest` 等 quote 字段兜底高点；数据缺失时显示 `—`。
- `/quotes` 可返回 `highPoint` 小元数据，但不得返回 K 线 candles。
- 场外基金 `/quotes` 已有可用净值/价格时，不再额外调用 `getNavSnapshots`；只在 quote 缺失或无价格时使用净值快照兜底。
- 场外基金申购限额只在场外列表展示时请求；ETF/指数/美股列表不得预拉该接口。

## Worker 约束

- 外部源站请求必须限并发，优先使用 `mapLimit`，批量入口继续执行现有数量上限。
- Worker live fetch 成功后应写入对应 KV/R2 缓存；同类入口必须读同一缓存。
- 缓存读取要校验 source、时间和数据形态，避免把错误源字段当作有效行情。
- K 线缓存策略：详情可按需读 R2；列表只读 `kline-high:*` 等小元数据。
- `forceRefresh` 只能由明确刷新入口传入，普通列表渲染不得使用。

## 前端约束

- `MarketsExperience` 负责调度，重逻辑应抽到 `src/pages/markets/*` 或 `src/app/*`，保持 refactor guard 通过。
- 列表请求应基于可见行或当前 active list，继续使用 `useVisibleMarketSymbols` 控制请求范围。
- 列表增强数据要有本地缓存和缺失集请求，不得每次刷新全量重拉。
- effect 中的网络请求要有去重、inflight、abort 或缓存保护，避免同一 render 周期重复请求。

## 测试要求

- 修复接口调用混乱时必须补覆盖“不会调用”的测试，例如可用 quote 不再触发净值快照。
- 修改缓存策略时必须覆盖命中、过期、source 不匹配和写入 key 防御。
- 修改列表字段派生时必须覆盖缺缓存显示空值，避免隐式走重接口或错误字段兜底。
- 提交前至少运行相关 `node --test`、`npm run check:refactor`、`npm run lint -- --quiet` 和 `git diff --check`。
