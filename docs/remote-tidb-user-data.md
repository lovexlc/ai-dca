# 统一远端用户数据（Hyperdrive）

## 目标

`freebacktrack.tech` 与 `cn.freebacktrack.tech:5000` 共用同一个 Web user-data Worker。用户业务数据以 TiDB 为唯一权威；D1 只负责 Web 用户/session 身份认证，浏览器 localStorage 只保留可重建缓存。

## 数据链路

```text
global Web / CN Web
        -> api.freebacktrack.tech/api/user-data
        -> ai-dca-user-data Cloudflare Worker
        -> Cloudflare Hyperdrive
        -> TiDB Cloud (ai_dca_market)
```

Hyperdrive 使用 `mysql2/promise` 连接 TiDB，Worker 不再依赖额外的 TiDB HTTP user-data service。

## Worker 数据表

- `user_data_state`
- `user_data_records`
- `user_data_mutations`

写入支持：

- 每个用户、每个 key 的 revision/CAS；
- tombstone 删除；
- `mutationId` 幂等；
- 事务写入；
- 服务端从 D1 session 派生 `user_id`，不接受浏览器声明的 owner。

## Cloudflare 配置

`workers/user-data/wrangler.toml` 需要：

- `nodejs_compat`；
- D1 `DB` binding，用于认证；
- Hyperdrive `HYPERDRIVE` binding。

部署 workflow 使用 GitHub repository variable：

```text
HYPERDRIVE_ID
```

部署所需 GitHub secrets：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

TiDB 密码由 Hyperdrive 保存，不写入仓库、Wrangler 配置、前端变量或日志。TiDB Cloud 的网络访问控制必须允许 Hyperdrive 访问；只允许开发者当前电脑 IP 不足以支持 Worker 连接。

## 本地/CI 依赖

Worker 使用 `mysql2 >= 3.13.0`，并在连接参数中设置 `disableEval: true`。验证和部署 workflow 会在 `workers/user-data` 下安装该依赖。

## 发布顺序

1. 轮换曾经暴露的 TiDB 密码；
2. 创建 Hyperdrive 配置并用轮换后的 TiDB 连接信息配置；
3. 把 Hyperdrive ID 写入 GitHub repository variable `HYPERDRIVE_ID`；
4. 配置 Cloudflare API secret；
5. 合并 global PR 到 `main`；
6. GitHub workflow 部署 `ai-dca-user-data` Worker；
7. 验证 `/api/user-data/health` 返回 `authority: tidb` 且 `configured: true`；
8. 再部署 global/CN 前端并验证登录、写入、切换、冲突和账号隔离。

本改造不执行真实用户数据迁移，不删除旧 D1/KV 备份，也不在没有明确发布批准时自动推生产。
