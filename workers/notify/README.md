# 通知 Worker

这个 Worker 负责把前端保存的交易计划同步到后台，并按周期检查是否需要发送提醒。

## 已实现

- `GET /api/notify/status`
- `GET /api/notify/events`
- `POST /api/notify/sync`
- `POST /api/notify/test`
- `POST /api/notify/settings`
- `POST /api/notify/ws/register`
- `WS /api/notify/ws/:deviceInstallationId`
- `POST /api/notify/run`
- `POST /api/wechat/login`
- `GET /api/wechat/notification-prefs`
- `POST /api/wechat/notification-prefs`
- cron 定时检查价格提醒和定投提醒
  Worker 内部按北京时间 `Asia/Shanghai` 判断日期；Cloudflare cron 触发本身使用 UTC，因此 `wrangler.toml` 里的 cron 表达式已经换算到北京时间工作日。

## 环境变量

通过 `wrangler secret put` 写入：

- 通知配置主要通过 `/api/notify/settings` 按 client 保存到 KV。
- Server酱³、Bark 的密钥来自前端配置；不要把用户密钥硬编码进 Worker。
- 微信小程序登录需要配置 `WECHAT_APPID` 和 `WECHAT_APP_SECRET`。
- 微信小程序 session token 签名需要配置 `WECHAT_SESSION_SECRET`；未配置时会回退使用 `WECHAT_APP_SECRET`。

微信相关 secret 示例：

```bash
wrangler secret put WECHAT_APPID --config workers/notify/wrangler.toml
wrangler secret put WECHAT_APP_SECRET --config workers/notify/wrangler.toml
wrangler secret put WECHAT_SESSION_SECRET --config workers/notify/wrangler.toml
```

## KV

需要创建一个 KV namespace 并填入 `wrangler.toml`：

- `NOTIFY_STATE`

微信提醒偏好会写入：

- `wechat:user:<openid>:notification-prefs`
- `wechat:active-users`

## 本地调试

```bash
npx wrangler dev --config workers/notify/wrangler.toml --port 8788
```

## 说明

- 第一版是单用户设计
- Web 前端会在本地生成一个浏览器 `clientId`
- PC 浏览器会注册 `web-ws:` 虚拟设备并接入 WsHub Durable Object
- 计划规则由前端整包同步到后台
- 价格提醒按当前策略重算后决定是否触发
- 同一触发区只提醒一次，离开触发区后才允许再次提醒
- 旧 Android GCM/FCM 路由已下线，`/api/notify/gcm/*` 返回 410

## 通知 ACK

Worker 支持统一通知回执，用于区分“服务端已发送”和“客户端真实收到 / 展示 / 打开”。

- WebSocket：客户端收到 `notify` 后，可通过同一连接发送 ACK 帧：

```json
{
  "type": "ack",
  "messageId": "<eventId>",
  "eventId": "<eventId>",
  "stage": "received",
  "source": "ws",
  "deviceInstallationId": "<deviceInstallationId>",
  "ts": "2026-05-26T19:11:00+08:00"
}
```

- HTTP 回执：

```http
POST /api/notify/ack
Content-Type: application/json
```

```json
{
  "deviceInstallationId": "<deviceInstallationId>",
  "messageId": "<eventId>",
  "eventId": "<eventId>",
  "stage": "displayed",
  "source": "http",
  "ts": "2026-05-26T19:11:00+08:00"
}
```

`stage` 支持 `received`、`displayed`、`opened`、`deduped`、`failed`。Worker 会把 ACK 写入对应 client 的 `deliveryAcks`，并在 `/api/notify/status` 与 `/api/notify/events` 返回事件时合并到 `deliveryAck` 字段。
