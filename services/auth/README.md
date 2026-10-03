# auth-service（本地认证服务）

cn 主机上的本地注册/登录服务。用户数据先落本地 SQLite 并立即返回，
后台 `syncWorker` 再把变更异步同步到 Cloudflare Worker（D1），
避免注册/登录完全依赖 CF 链路。

## 运行

```bash
cd services/auth
npm install
npm test

# HTTP 服务（127.0.0.1:8080）
AUTH_DB_PATH=/var/lib/ai-dca-auth/auth.sqlite AUTH_PORT=8080 npm start

# 后台同步 worker（独立进程）
SYNC_WORKER_URL=https://api.freebacktrack.tech/api/sync/internal/sync-auth \
INTERNAL_SYNC_TOKEN=<token> \
AUTH_DB_PATH=/var/lib/ai-dca-auth/auth.sqlite npm run sync-worker
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_DB_PATH` | `/var/lib/ai-dca-auth/auth.sqlite` | SQLite 文件路径 |
| `AUTH_PORT` | `8080` | HTTP 监听端口（只绑 127.0.0.1） |
| `SYNC_WORKER_URL` | `https://api.freebacktrack.tech/api/sync/internal/sync-auth` | CF Worker 内部同步接口 |
| `INTERNAL_SYNC_TOKEN` | 空 | 同步接口的 Bearer token |

## 接口

- `POST /api/sync/auth/register` `{username, passwordHash}` → session JSON（409 用户名已存在）
- `POST /api/sync/auth/login` `{username, passwordHash}` → session JSON（401 用户名或密码不正确）
- `GET /health` → `{ok: true, outbox: {...}}`

密码哈希口径与 `workers/sync` 完全一致：
`stored = sha256(salt + ':' + clientHash)`，session 有效期 30 天，
token 以 `acc_`/`ref_` 开头，DB 只存 token 的 SHA256。

## nginx 接线（下一阶段）

```nginx
location /api/sync/auth/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

其余 `/api/` 保持代理到 CF Worker 不变。

## 同步语义

- 注册/登录在同一事务内写 `users`/`sessions` 并入 `sync_outbox` 队列
- 同步成功删除事件；网络错误/5xx/429 按指数退避重试（5s 起，最大 30min，429 尊重 Retry-After）
- 4xx（非 429）进入死信（`status='dead'`），不再重试，需人工处理
