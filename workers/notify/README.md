# 通知 Worker

这个 Worker 负责把前端保存的交易计划同步到后台，并按周期检查是否需要发送提醒。

## 已实现

- `GET /api/notify/status`
- `GET /api/notify/events`
- `POST /api/notify/sync`
- `POST /api/notify/test`
- `POST /api/notify/run`
- cron 定时检查价格提醒和定投提醒

## 环境变量

通过 `wrangler secret put` 写入：

- `BARK_DEVICE_KEY`
- `GOTIFY_BASE_URL`
- `GOTIFY_TOKEN`

## KV

需要创建一个 KV namespace 并填入 `wrangler.toml`：

- `NOTIFY_STATE`

## 本地调试

```bash
npx wrangler dev --config workers/notify/wrangler.toml --port 8788
```

## 说明

- 第一版是单用户设计
- 计划规则由前端整包同步到后台
- 价格提醒按当前策略重算后决定是否触发
- 同一触发区只提醒一次，离开触发区后才允许再次提醒
