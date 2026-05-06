# 实时通道设计：自建 WebSocket（FCM 之外的第二条通道）

## 背景

现状：notify worker 推送只走 FCM。在国内 MIUI / HyperOS 上 FCM 不稳定（GMS 缺失或厂商策略限制），到达率低、延迟大、被冻概率高。

国内厂商通道（小米/华为/OPPO/vivo）几乎全部要企业资质 + 应用商店上架，对个人项目不可行。极光/个推等聚合方案的免费长连接通道同样会被厂商杀进程，且越来越严的备案合规门槛与本项目「家用、闭环」定位不匹配。

选用 **自建 WebSocket 长连接 + 前台服务** 作为第二条通道。参考实现：

- [ntfy.sh](https://ntfy.sh/) — Go 后端 + 原生安卓客户端，纯 WebSocket / SSE。
- [Gotify](https://gotify.net/) — Go 后端 + 原生安卓客户端，WebSocket。

两者的安卓端都是「常驻 `ForegroundService` + OkHttp WebSocket + 指数退避重连」。本项目复用同样模式。

## 目标 / 非目标

### 目标

- 在国行 MIUI / HyperOS / 无 GMS 设备上，**消息到达率 ≥ 95%**（前提：用户开启自启动 + 电池白名单）。
- 端到端延迟 **< 1.5 秒**（实时通道命中时）。
- 完全复用已有 Bark payload 字段（`title`/`body`/`url`/`group`/`sound`/`level`/`copy`/...），客户端解析逻辑共享，不重复实现。
- 不依赖任何第三方推送服务、不需要任何开放平台账号、不需要 APP 备案。
- 不与 FCM 互斥：FCM 继续作为兜底，离线 / 长连接断开时仍能收到消息。

### 非目标

- 不追求「永不掉线」。客户端被系统强杀、设备进入深度休眠时允许短暂掉线，由 FCM 兜底 + 上线后 catch-up 拉漏。
- 不替代 FCM。海外 / 有 GMS 的设备 FCM 体验更好，保留为首选。
- 不做多租户 / 公开 SaaS。仅服务于已配对的设备。

## 整体架构

```
推送源 (规则触发 / Bark URL)
        │
        ▼
  Cloudflare Worker (notify)
        │
        ├──→ FCM (data message, 现状不变)
        │
        └──→ Durable Object: WsHub
                 │
                 └──→ WebSocket → Android ForegroundService → 通知
```

双通道**并行下发**。客户端用 `messageId` 去重：

- 谁先到谁先弹。
- 后到的同 ID 消息丢弃，但仍写一次「已送达」回执（用于送达统计 / 调试）。
- 历史卡片以最早到达的那一条为准。

## Worker 端

### Durable Object：`WsHub`

```
workers/notify/src/wsHub.js
```

- 一个 DO 实例对应**一台已配对设备**（`deviceInstallationId` 作为 DO name）。
- 内部维护 `Set<WebSocket>`（同一台设备允许多个连接：APP 前台 + 后台 service 时短暂并存）。
- 暴露两个动作：
  - `fetch()`：处理 WebSocket upgrade（来自客户端连接请求）。
  - `dispatch(payload)`：从主 worker 调进来，向当前持有的所有 socket `send()`。
- 心跳：30 秒一次 server → client `{"type":"ping","ts":...}`，客户端必须回 `pong`，60 秒没回就 `socket.close(1000)` 主动关。

### 路由

挂在主 worker `index.js`，无需新独立 worker。

| 路径 | 方法 | 作用 |
|---|---|---|
| `/api/notify/ws/:deviceInstallationId` | `GET` (Upgrade) | 客户端建立 WebSocket。`Sec-WebSocket-Protocol` 携带 token 鉴权 |
| `/api/notify/ws/health/:deviceInstallationId` | `GET` | 返回该设备当前在线连接数（调试用） |

### 双发逻辑

现有 `sendGcmNotification(...)` 调用点改成：

```js
await Promise.allSettled([
  sendGcmNotification({ env, ..., data }),         // 现状
  sendWsNotification({ env, deviceInstallationId, data }),  // 新增
])
```

`sendWsNotification` 内部 = `env.WS_HUB.get(env.WS_HUB.idFromName(devId)).fetch("/dispatch", { method: "POST", body: JSON.stringify(data) })`。Durable Object 不在线（无活跃 socket）时 `fetch` 仍然成功，只是没人收，等同 no-op。

### 鉴权

- 复用现有 `pair` 流程产生的 token（已经存在 KV 里）。
- 客户端连接时带 `Sec-WebSocket-Protocol: ai-dca, <token>`。Worker 在 `fetch()` 升级前比对 KV 中该 `deviceInstallationId` 对应的 token，不匹配返回 401。
- 不在 URL query 里带 token（避免日志泄漏）。

### 配额

Cloudflare Workers 免费层：

- WebSocket 连接数：account-level 限制比较宽松，家用规模（< 50 设备）远低于上限。
- Durable Object 请求 / 时长：免费 100 万请求/月。心跳 30s/次，单设备一天 ≈ 2880 次心跳。10 台设备 30 天 ≈ 86 万次，临界值。**建议把心跳放宽到 60s 或仅在客户端发起心跳**（让 client → server 心跳计入「客户端 fetch」，不耗 DO alarms）。
- 实际策略：客户端每 60s 发一条 `{"type":"ping"}`；server 收到后 echo `pong`。Server 端不主动 alarm，连接空闲 90s 没 ping 就关。

## Android 端

### `RealtimeChannelService` (新)

```
app/src/main/java/tech/freebacktrack/aidca/RealtimeChannelService.kt
```

- `class RealtimeChannelService : Service()`。
- `onCreate`：拉起前台通知（小图标 + 静音通道，标题 "基金通知 实时连接已开启"），调用 `startForeground(...)`。
- `onStartCommand`：返回 `START_STICKY`，被杀后系统重启服务。
- 内部一个 OkHttp `WebSocket`：
  - URL：`wss://tools.freebacktrack.tech/api/notify/ws/<deviceInstallationId>`
  - `Sec-WebSocket-Protocol: ai-dca, <token>`
  - 心跳：60s 一次自发 ping。
  - 断线重连：指数退避 2s → 4s → 8s → 16s → 32s，封顶 60s；网络 callback (`ConnectivityManager.NetworkCallback`) 上线立即重置退避。
- 收到 message：`onMessage(text)` 解析 JSON，**直接交给 `BarkPayloadHandler`**（已经从 `NotifyMessagingService` 抽出来的共享类，见下方迁移项）走和 FCM 完全一致的处理路径。
- 通道 channel ID 仍然由 payload 决定（`bark_active`/`bark_passive`/...），不引入新的 channel。

### 共享 payload handler

现 `NotifyMessagingService.kt` 内的 Bark 字段解析、channel 创建、解密、剪贴板、archive 写入逻辑全部抽到：

```
app/src/main/java/tech/freebacktrack/aidca/BarkPayloadHandler.kt
```

签名：

```kotlin
object BarkPayloadHandler {
    fun handle(context: Context, data: Map<String, String>, source: String /* "fcm" | "ws" */)
}
```

两条通道都调它。`source` 仅用于日志和送达回执，业务行为一致。

### 去重

`BarkPayloadHandler.handle(...)` 的入口加：

```kotlin
val messageId = data["messageId"] ?: deriveStableId(data)
if (DeliveryReceiptStore.isAlreadyDisplayed(context, messageId)) return
```

`DeliveryReceiptStore` 已存在（`writeReceived`/`markDisplayed`），加一个 `isAlreadyDisplayed` 查询接口即可。`messageId` 优先用 worker 下发的，兜底用 `eventId + sentAt + body` 的 SHA-1。

### 启动 / 保活

- `MainActivity.onCreate()` 里启动一次 service：`ContextCompat.startForegroundService(this, Intent(this, RealtimeChannelService::class.java))`。
- 用 `WorkManager` 的 `PeriodicWorkRequest`（已有 `HEARTBEAT_WORK_NAME = "ai-dca-heartbeat"`）每 15 分钟检查 service 是否活，挂了就重新拉起。
- 设置页加一个开关 "实时连接"（默认开），关闭时停 service、降级到只用 FCM。
- 设置页第一次开启时引导跳：
  - **电池优化白名单**：`Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)`。
  - **MIUI 自启动**：`PackageManager` 检测厂商，给出引导文案 + `Intent` 跳到 MIUI 应用详情页（不同 ROM 路径不同，提供 fallback）。

## payload 格式

复用 worker 现有发给 FCM 的 `data` 字段，**完全不变**。Worker 在 `dispatch` 时把 data 直接 JSON.stringify 后通过 socket.send 发给客户端。

例：

```json
{
  "messageId": "evt_abc123",
  "title": "基金触发",
  "body": "沪深300 已跌破...",
  "body_md": "**沪深300** 已跌破...",
  "sound": "minuet",
  "level": "timeSensitive",
  "group": "fund-rules",
  "isArchive": "1",
  "sentAt": "2026-05-06T08:30:00Z",
  "source": "ai-dca",
  "type": "notify"
}
```

额外控制帧（不进通知）：

```json
{ "type": "ping", "ts": ... }
{ "type": "pong", "ts": ... }
{ "type": "hello", "server": "notify-worker", "version": "..." }
```

以 `type` 字段区分控制帧 vs 业务推送（业务推送没有 `type` 或 `type="notify"`）。

## 离线 catch-up

v1 不做。理由：

- FCM 路径已经覆盖了离线 → 上线的延迟送达。
- 引入 catch-up 需要在 worker 端持久化未送达消息，KV 写入成本和复杂度都大幅上升。

如果后续 v2 要做：在 KV 里 `notify:undelivered:<devId>` 存最近 24 小时未确认消息，客户端 `hello` 帧附带 `lastSeenMessageId`，server 把缺漏补发。

## 实施阶段

按顺序，每步独立 commit / 独立 PR：

1. **共享 payload handler**：把 `NotifyMessagingService` 的 Bark 解析逻辑抽到 `BarkPayloadHandler`，FCM 路径切过去。零新功能，仅重构 + 单测。
2. **Worker：Durable Object 骨架**：`wsHub.js` + 路由 + 鉴权。客户端先不接，用 `wscat` 验通。
3. **Worker：双发**：在所有调 `sendGcmNotification` 的地方并发调 `sendWsNotification`。DO 没在线时 no-op。
4. **Android：RealtimeChannelService**：前台服务 + WebSocket + 自动重连 + 接 `BarkPayloadHandler`。设置开关默认关，仅 dev 自测。
5. **Android：保活引导 UI**：电池优化 + MIUI 自启动入口。
6. **打开默认开关 + 灰度**：先在你和家人的几台设备上跑 1-2 周，看实际到达率和断线频率。
7. **观察期**：根据实战数据决定是否做 v2 catch-up / 心跳间隔调优。

## 风险与降级

| 风险 | 影响 | 缓解 |
|---|---|---|
| MIUI / 鸿蒙后台限制比预期严，service 仍被杀 | 实时通道形同虚设 | FCM 兜底；WorkManager 心跳重启；引导用户配权限 |
| Cloudflare DO 计费/限流意外触发 | worker 侧报错 | 双发用 `Promise.allSettled`，FCM 路径不受影响 |
| 客户端 ws 频繁断连导致电量异常 | 用户投诉 | 退避封顶 60s；网络不可用时彻底停止重连，等 NetworkCallback |
| 同一台设备多 socket 重复推送 | 同一条消息弹两次 | `messageId` 客户端去重；DO 端发送时也对每个 socket 去重 |
| WebSocket 升级被运营商 / 中间盒断 | 实时通道完全不工作 | 自动 fallback：客户端 ws 连续 N 次连接失败后停一段时间，期间纯靠 FCM |

## 部署

遵循 `docs/ops/notify-worker-deploy.md` 的硬规约：

- 改 `workers/notify/**` 后 push 到 `main`，自动触发 `deploy-worker-notify.yml`。
- DO 的 `migrations` 必须在 `wrangler.toml` 里声明：
  ```toml
  [[durable_objects.bindings]]
  name = "WS_HUB"
  class_name = "WsHub"

  [[migrations]]
  tag = "v1"
  new_classes = ["WsHub"]
  ```
- 部署后回报四件证据：本地路径行号、commit SHA + raw 链接、Actions run URL（success）、Worker `Current Version ID`。
- 升 wrangler 前先确认 runner Node 版本（v4 要 22+，目前锁 v3 配 Node 20）。

## 命名约定

- Worker 文件：`workers/notify/src/wsHub.js`（Durable Object 类）、`workers/notify/src/ws.js`（dispatch 辅助函数）。
- Android 类：`RealtimeChannelService`、`BarkPayloadHandler`、`RealtimeChannelStore`（保存开关状态）。
- Channel ID：保持与 FCM 路径完全一致（不另开「实时」专用 channel）。
- 日志 tag：`AiDcaRealtime`（worker 侧 console.log 前缀同名）。
