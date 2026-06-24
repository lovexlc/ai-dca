# /api/notify/events 改造

## 目标
1. PC 浏览器前台轮询（webNotifyClient）在非 A 股交易时段直接跳过，不再无谓打 `/api/notify/events`。
2. 改造 `/api/notify/events` 返回值：过滤掉 `status === 'delivered'` 的事件；同时把 `delivered` 的定义改严：**当且仅当 event.channels 全部是 `delivered` 或 `skipped`，且至少有一个 `delivered`**，才认为这条事件已 delivered。

## 关键决策
- 「非交易时间不请求」仅限 webNotifyClient 的后台 30s 轮询。NotifyExperience.jsx 的手动加载是用户主动行为，不限制。
- status=delivered 在新规则下不允许出现 `queued`（如 PC 渠道）或 `failed`。即 PC 客户端事件（channel=pc / status=queued）天然不会被过滤掉，前端轮询仍然可以拿到，符合预期。
- 前端复用 `workers/notify/src/switchStrategy.js:160` 的 `isInTradingSession` 语义：周一至周五 09:30-11:30 / 13:00-15:00 Asia/Shanghai。节假日不做单独排除（A 股节假日表暂不进前端）。

## 步骤
- [done] 探测：webNotifyClient.js 轮询点、handleEvents/getClientRecentEvents、deliverNotification status 计算、event channels 结构、isInTradingSession 现状。
- [todo] 新增 `src/app/tradingSession.js`：导出 `isInTradingSession(date)`，逻辑照搬 worker 实现，时区 Asia/Shanghai。
- [todo] 改 `src/app/webNotifyClient.js`：tick 函数在权限/pcEnabled 校验后追加 `isInTradingSession(new Date())` 检查；非交易时间直接 return，仅 debug 时打日志。
- [todo] 改 `workers/notify/src/evaluator.js:533-536` deliverNotification 的 status 计算：`allTerminal && anyDelivered ? 'delivered' : (configuredCount > 0 ? 'failed' : 'skipped')`。
- [todo] 改 `workers/notify/src/index.js:715-717` handleEvents：返回前 `.filter(event => event.status !== 'delivered')`。
- [todo] commit + push（src + workers 各一个 commit）+ 等 deploy-pages 和 deploy-worker-notify 两个 workflow 跑过。
- [todo] 验证：curl `/api/notify/events?clientId=...` 返回不含 `status: 'delivered'` 的事件；浏览器 webNotifyClient 在交易时间外不会触发 fetch。

## 风险 / 待观察
- 历史 client 数据里某些 event.status 是按旧规则写入的 `delivered`（其实可能 channels 含 `failed`）。新规则下这部分历史事件会被过滤；可接受，因为 `MAX_RECENT_EVENTS=30` 自然滚动。
- PC 单渠道用户：channels 只含 `{ channel: 'pc', status: 'queued' }`，新规则下永远不会 delivered，每次轮询都会回到客户端。客户端有 `lastSeenEventId` 去重，可接受。
