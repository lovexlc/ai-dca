# 通知 Worker

这个 Worker 负责把前端保存的交易计划同步到后台，并按周期检查是否需要发送提醒。

## 已实现

- `GET /api/notify/status`
- `GET /api/notify/events`
- `POST /api/notify/sync`
- `POST /api/notify/test`
- `POST /api/notify/gcm/check`
- `POST /api/notify/gcm/register`
- `POST /api/notify/gcm/pairing-key`
- `POST /api/notify/gcm/pair`
- `POST /api/notify/run`
- cron 定时检查价格提醒和定投提醒

## 环境变量

通过 `wrangler secret put` 写入：

- `BARK_DEVICE_KEY`
- `GOTIFY_BASE_URL`
- `GOTIFY_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

`FIREBASE_SERVICE_ACCOUNT_JSON` 使用 Firebase Admin / Google service account 的整段 JSON。Worker 会用它申请 access token，再调用 FCM HTTP v1 做 `validateOnly` 连接检查。

## KV

需要创建一个 KV namespace 并填入 `wrangler.toml`：

- `NOTIFY_STATE`

## 本地调试

```bash
npx wrangler dev --config workers/notify/wrangler.toml --port 8788
```

## 说明

- 第一版是单用户设计
- Web 前端会在本地生成一个浏览器 `clientId`
- Android app 注册成功后会向 Worker 申请一次性 8 位配对码
- 用户把配对码填到前端页面后，Worker 会把那台 Android 设备和当前浏览器 `clientId` 建立配对关系
- 手动测试通知会优先只发送到当前浏览器最近关联的一台 Android 设备
- 计划规则由前端整包同步到后台
- 价格提醒按当前策略重算后决定是否触发
- 同一触发区只提醒一次，离开触发区后才允许再次提醒
- Android 端已经接入 FCM 实际下发；定时规则会发送到所有已配对的 Android 设备
