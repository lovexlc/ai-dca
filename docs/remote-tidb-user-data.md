# 统一远端用户数据迁移

## 目标

`freebacktrack.tech`、`cn.freebacktrack.tech:5000` 和小程序不再各自维护可写的浏览器业务副本。登录用户的业务数据以 TiDB 行为单位保存；D1 的用户/session 表只负责 Web 身份认证，旧的加密整包同步只保留为迁移期备份。

## 本次实现

- 新增 `workers/user-data`，复用 sync Worker 的 D1 `users` / `sessions` 表校验登录身份。
- Web 端把业务 `localStorage` key 适配为内存镜像，启动时先从 `/api/user-data/bootstrap` 加载；成功前不会把远端失败渲染成空账户。
- `/session/exchange` 将旧 Bearer 登录态换成 API 域名的 `Secure; HttpOnly; SameSite=None` cookie。两个站点使用 `credentials: include` 访问同一个 API，因此切换地址不再依赖另一站点的 `localStorage`。
- 区域切换前等待远端写入完成；写入采用每个 key 的 revision/CAS，冲突不会静默覆盖。
- 第一次登录且 TiDB 账户尚未初始化时，将当前浏览器副本作为一次性 legacy import 写入 TiDB；已有 TiDB 数据优先，不会被另一站点的旧副本覆盖。
- 新增 `cloudfunctions/userData`（位于 `ai-dca-miniprogram` 仓库）作为 TiDB HTTP/小程序统一入口，业务表和 Web 端共用同一 `user_id` 行模型。

## 配置边界

代码不会猜测数据库凭据或生产 URL。部署 `ai-dca-user-data` 前必须设置：

- `TIDB_USER_DATA_URL`：小程序 `userData` 云函数的 HTTP trigger URL。
- `TIDB_USER_DATA_SERVICE_TOKEN`：Worker 与 TiDB 云函数之间的服务令牌（Wrangler secret）。
- 小程序云函数的 `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`。
- 小程序云函数的 `WEB_USER_DATA_SERVICE_TOKEN`，与 Worker secret 相同。

在这些配置完成前，Worker 健康检查会明确返回 `configured: false`，业务请求返回 503；不会回退到 D1、KV 或浏览器副本作为第二个写入权威。

## 发布顺序

1. 发布小程序 `userData` 云函数并执行其幂等建表 SQL。
2. 设置服务令牌和 HTTP trigger URL，验证 `/api/user-data/health`。
3. 部署 Web user-data Worker。
4. 先用测试账号验证两站点登录、写入、切换、退出和 revision 冲突。
5. 执行 legacy importer，确认旧 D1/KV 密文备份、小程序 CloudBase 数据都有不可变来源记录后，再启用旧客户端写入围栏。
6. 最后把小程序其他计划、提醒、偏好模块接到同一 `userData` API；`holdingsTx` 的 TiDB 表只作为已有行模型参考，不再让本地 outbox 作为正常 authority。

## 明确未做

本分支不部署生产、不创建数据库凭据、不迁移真实用户数据，也不删除旧备份。上线前必须完成服务配置、数据冲突预览和按用户 cutover/write fence。
