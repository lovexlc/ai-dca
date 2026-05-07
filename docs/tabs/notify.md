# 通知设置（notify）

- 入口组件：[`src/pages/NotifyExperience.jsx`](../../src/pages/NotifyExperience.jsx)（约 870 行）
- 同步层：[`src/app/notifySync.js`](../../src/app/notifySync.js)
- 后端 worker：`workers/notify`（部署在 `tools.freebacktrack.tech`，wrangler 名 `ai-dca-notify`）

## 一、tab 主体结构

顶部 3 张 StatCard：

| 卡片 | 数据 |
|---|---|
| 通道状态 | `summary.channelStatus` + `summary.channelNote`，由 Bark / Android 是否任意配置决定 |
| 已关联 Android | `summary.androidDeviceCount` 台 |
| iOS Bark | `barkConfigured ? '已配置' : '未配置'` |

下面是平台切换：`notifyPlatform = ios | android`。

### iOS（Bark）子区域

- 字段：Bark device key、自定义 Bark 服务地址（默认 `https://api.day.app`，可换自建）。
- 保存：`saveNotifySettings(payload)` → `POST /settings`。
- 测试：`sendNotifyTest(payload)` → `POST /test`。
- 状态徽章：emerald = 至少配置一种通道。

### Android（FCM 直绑）子区域

- 流程：在 Android app 拿到 `deviceInstallationId` → 粘贴到「设备 ID」输入框 → `pairAndroidDevice({ pairingCode })` → 服务端用 `pairingCode` 查找 → 把 deviceInstallationId 直接绑到当前 clientId。
- 已绑定列表：`pairedAndroidDevices[]`，每条带「最近健康检查状态」（`lastCheckStatus = validated | unregistered | ...`），可单独 `unpairAndroidDevice`。
- APK 下载：常量 `ANDROID_APK_DOWNLOAD_URL`（来自 `src/app/tradePlansHelpers.js`）。

## 二、规则配置区

两类规则：

### 1. 计划规则（来自 trade-plans）

- 在 trade-plans / dca / new-plan 任一处保存计划时，会自动调用 `syncTradePlanRules` → `POST /sync` 把规则全集下发。
- 本 tab 提供「立即同步」按钮（`isSyncingRules`）和上次同步时间 (`rulesLastSyncedAt`)。
- 计划规则在 worker 里走 `holdings-rule` / `run` / `switch` 等具体路由触发；计划本身在 worker 中只存最近一份覆盖式 snapshot。

### 2. 持仓推送规则（每日盘后 digest）

- 开关：`holdingsRule.enabled`，写入 `aiDcaHoldingsRule` + `POST /holdings-rule`。
- 摘要：`buildHoldingsNotifyDigest({ aggregates, summary })`（来自 holdings tab 的核心）。
- 立即测试：`POST /admin/holdings-all-test`（不会写入历史，仅触发一次推送）。
- 立即同步：`isSyncingHoldingsDigest = true` 时把最新摘要推到 worker 缓存（用于 20:30 / 21:30 全量推送）。

## 三、提醒历史（events）

- `loadNotifyEvents(clientId)` → `GET /events`，返回最近 N 条推送事件。
- 显式过滤：`isTestEvent(event)` 命名为「测试通知」并且时间窗 ≤ 30 分钟才保留，超过 `TEST_EVENT_TTL_MS = 30 * 60 * 1000` 就从前端隐藏，避免长期堆积测试日志。
- 每条事件用 `resolveEventStatusMeta` 映射 `status → { tone, label }`：emerald = 已送达 / slate = 队列中 / red = 失败。
- 时间格式化：`formatEventTimeLabel`（短格式，相对时间或绝对日期）。
- 列表头部「刷新」按钮：`isLoadingEvents = true` → 重新拉取；`eventsLastSyncedAt` 显示上次同步时间。

可展开的「Strategy」分组：`expandedStrategy` 控制点击某个计划展开它的事件子集。

## 四、`notifySync.js` 函数全集

```
readNotifyClientConfig()                 # localStorage → notifyConfig（含 clientId / barkKey / barkBaseUrl）
persistNotifyClientConfig(nextConfig)
buildNotifySyncPayload()                 # 把所有 plan / dca 规则打包成 worker 期望的形状
loadNotifyStatus(clientId)               # GET /status
loadNotifyEvents(clientId)               # GET /events
syncTradePlanRules(payload)              # POST /sync
sendNotifyTest(payload)                  # POST /test
saveNotifySettings(payload)              # POST /settings
pairAndroidDevice(payload)               # POST /gcm/pair
unpairAndroidDevice(payload)             # POST /gcm/unpair
loadHoldingsNotifyRule()                 # 本地 rule 状态
saveHoldingsNotifyRule({ enabled, digest }) # 本地 + POST /holdings-rule
```

## 五、状态键速查

React state：

```
notifyStatus / notifyError / notifyMessage
isSavingSettings / isPairingAndroid / unpairingRegistrationId
notifyPlatform                # ios | android
androidPairingCode
notifyConfig                  # clientId / barkKey / barkBaseUrl
holdingsRule                  # { enabled, digest, updatedAt }
isSavingHoldingsRule / isSyncingHoldingsDigest / isTestingHoldingsNotify
notifyEvents / eventsLoading / eventsError / eventsLastSyncedAt / eventsTick
isSyncingRules / rulesLastSyncedAt
configCollapsed               # 折叠通道配置卡片（默认根据是否已配置自动决定）
expandedStrategy              # 展开某个 plan 下的事件
```

localStorage：

```
aiDcaNotifyClientConfig
aiDcaHoldingsRule
```

## 六、worker 路由速查（部分）

| 路由 | 作用 |
|---|---|
| `GET /status` | 通道状态、配额、最近 push 时间 |
| `GET /events` | 提醒历史 |
| `POST /settings` | 保存 Bark 配置 |
| `POST /sync` | 全量下发规则 |
| `POST /test` | 测试通知 |
| `POST /holdings-rule` | 启用 / 关闭持仓 digest 规则 |
| `POST /admin/holdings-all-test` | 触发一次持仓推送 |
| `POST /gcm/{register, check, pair, unpair, unpair-from-device, pairing-key}` | Android 直绑 |
| `POST /run` / `POST /switch/{config,snapshot,run}` | 计划执行入口 |
| `WS /ws/*` | 实时通道 push2（A 股盘中价格回灌到前端 ledger） |

## 七、相关文档

- 实时通道 / push2 来源：[`docs/architecture/realtime-channel.md`](../architecture/realtime-channel.md)
- worker 部署规约：[`docs/ops/notify-worker-deploy.md`](../ops/notify-worker-deploy.md)
