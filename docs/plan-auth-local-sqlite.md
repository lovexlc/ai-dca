# 本地 SQLite 认证服务实施计划

> Codex plan (2026-10-03)，dudu 已确认：会话有效期与 Worker 一致（30天），直接做本地 SQLite + 异步同步，异步同步带重试，Worker 侧加强唯一性。

## 架构

CN 本地认证 + SQLite 持久化 outbox + Worker 幂等接收。
注册、登录成功只依赖本地事务提交；用户和会话后台同步到 D1。

- CN 为用户注册、凭据写入的唯一入口
- 上线前将 D1 用户及未过期会话导入 SQLite，保留原 userId、密码哈希、salt 和过期时间
- 本地会话 30 天固定有效期（2,592,000 秒），同步重试不得重新计算过期时间
- 用户和 session 都同步，SQLite/D1 只存 token_hash
- 前端必须解耦：authClient.js 在保存会话后不再等待 ensureMigrationAfterAuth()

## 文件清单

| 文件 | 内容 |
|---|---|
| `services/auth/package.json` | 独立服务及 SQLite 依赖 |
| `services/auth/src/server.js` | HTTP 服务（127.0.0.1:8080） |
| `services/auth/src/auth.js` | 注册/登录逻辑 |
| `services/auth/src/db.js` | SQLite 初始化、WAL、外键 |
| `services/auth/src/outbox.js` | 同步队列 |
| `services/auth/src/syncWorker.js` | 后台同步消费者（重试、指数退避） |
| `services/auth/migrations/001-init.sql` | users/sessions/sync_outbox/sync_state 表 |
| `services/auth/test/*.test.mjs` | 认证、事务、重试、故障恢复测试 |
| `workers/sync/src/index.js` | 内部同步路由、幂等处理 |
| `workers/sync/src/internalAuthSync.js` | 幂等同步处理逻辑 |
| `src/app/authClient.js` | 解耦认证与云端初始化 |
| `scripts/auth-bootstrap.mjs` | D1 数据导入 |
| `scripts/auth-reconcile.mjs` | 一致性核对 |
| `.github/workflows/deploy-cn-frontend.yml` | nginx 本地认证路由持久化 |

## 关键设计

1. **事务**：注册在同一事务内写 users + sessions + outbox；UNIQUE 约束处理并发，返回 409
2. **密码**：sha256(salt:clientHash)，与 Worker 一致；恒定时间比较
3. **同步**：outbox 模式，至少一次投递，固定 event_id；指数退避 5s→30min；429 尊重 Retry-After
4. **幂等**：Worker 侧 sync_events(event_id PK) 去重；同事件同 payload 返回成功，不同 payload 返回 409
5. **禁止**：按 username 无条件覆盖密码；INSERT OR REPLACE 替换用户身份
6. **nginx**：`location ^~ /api/sync/auth/` → 本地服务；其他 /api/ 保持代理 CF

## 风险

- 双入口注册冲突 → CN 单写，上线前冻结注册并导入
- 本地成功但队列未落盘 → 同事务提交
- 回滚丢失本地账号 → 排空 outbox 并核对后才能回滚

## 验收标准

1. CF 完全不可达时，本地注册及已导入账号登录成功
2. 会话严格 30 天，重复投递不改变 expires_at
3. 100 并发同名注册仅 1 成功，其余 409
4. 重复投递后 D1 只有 1 个用户/session/事件记录
5. CF 恢复后 60 秒内新事件进入 D1
6. 相关 node --test、check:refactor、eslint、git diff --check 通过

## 进度

- [x] Codex plan 输出（2026-10-03）
- [x] Codely 实现本地服务（2026-10-03）：services/auth/，32 测试通过
- [x] Codely 实现 Worker 幂等接口（2026-10-03）：internalAuthSync.js，32 测试通过
- [x] 前端解耦（2026-10-03）：authClient 不再等待云端迁移，4 测试通过
- [ ] 部署演练（nginx 接线、systemd、INTERNAL_SYNC_TOKEN、D1 数据导入）
