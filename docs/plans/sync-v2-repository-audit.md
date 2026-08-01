# ai-dca 同步 V2 仓库核对（test-only）

核对分支：`test`
核对基线：`41c3ef4b6730cd404d9074e432b1d441a0a9884a`
核对范围：V2 功能实现，不执行旧数据迁移、不改 production 部署。

## 计划符号与实际实现

| 计划名称 | 实际路径或符号 | 是否存在 | 差异与本次决定 |
| --- | --- | --- | --- |
| `ACCOUNT_SYNC_REGISTRY` | `src/app/syncRegistry.js` 的 `SYNC_REGISTRY` | 不存在 | 扩展现有注册表，新增 `scope`、`role`、`syncMode`、`adapter`；不创建同义注册表。 |
| `ensureSyncV2Schema` | `workers/sync/src/index.js` 的 `ensureSchema` | 计划名称不存在 | 在现有 schema 初始化中创建独立 `sync_v2_items` 表；不读取或回填旧 `backups`。 |
| `src/app/syncV2/syncEngine.js` | 同路径新建 | 不存在 | 本次新建；只在 `test` 环境的工作台和账户菜单启用。 |
| `/api/sync/v2` | `workers/sync/src/index.js` V2 路由 | 存在 | 唯一同步入口为 `/v2/items/meta`、`/v2/items`、`PUT /v2/items/:syncKey`；production host 返回 404。 |
| `handlePutLatest` | `workers/sync/src/index.js` | 不存在 | 旧整包写入接口已移除；按 key 的 CAS 写入由 `handleSyncV2ItemPut` 负责。 |
| `startCloudAutoSync` | `src/app/syncV2/syncEngine.js` 的 `startCloudAutoSyncV2` | 不存在 | 工作台只启动 V2 自动同步。 |
| `collectBackupPayload` / `applyBackupEnvelope` | `src/app/syncV2/syncEngine.js` 的 `collectV2BackupPayload` | 不存在 | 旧整包收集/恢复模块已移除；V2 只读写注册表中的 canonical key。 |
| `aiDcaCloudSyncSession` | `src/app/authSession.js` | 存在 | 登录会话继续使用；Worker V2 只从 Bearer Token 解析 `user.id`。 |
| `aiDcaNotifySettings` / `aiDcaNotifyClientConfig` | `src/app/notifySync.js`、`src/app/syncRegistry.js` | 已拆分 | 渠道配置进入账户 V2；`notifyClientId`、`notifyClientSecret`、标签保留设备本地。 |
| `aiDcaWebNotifyConfig` / `aiDcaWebNotifyDeviceState` | `src/app/webNotifyClient.js`、`src/app/syncRegistry.js` | 已拆分 | PC 通知开关进入账户 V2；已读游标保留设备本地。 |
| `aiDcaHoldingsNotifyRule` | `src/app/notifySync.js`、`src/app/syncRegistry.js` | 已新增 | 持仓收益提醒的启用状态和脱敏权重摘要进入账户 V2。 |
| `aiDcaSwitchStrategyWorkerConfig` | `src/app/switchStrategySync.js`、`src/app/syncRegistry.js` | 已纳入 | 换基通知规则的本地缓存作为账户 V2 数据，拉取后投影到当前通知设备。 |
| `aiDcaSyncClientId` | 仓库运行时代码 | 不存在 | 账户同步不再生成或读取端标识；通知设备仍独立使用 `notifyClientId`。 |
| `workers/sync/wrangler.test.toml` | test Worker 配置 | 存在 | 仅使用 test D1 和 test 路由；旧备份 KV 绑定已移除，本次不执行部署。 |

## V2 实施边界

- 账户同步主键为 Worker 从 Token 得到的 `user.id` 与 URL 中的 `syncKey`。
- 目前同步 18 个 account/canonical localStorage key；derived、legacy、draft、device、cache 均不进入 V2。
- 每个 key 单独拥有 revision、contentHash、cipherSha256、encryptedPayload、updatedAt、deletedAt。
- PUT 使用 `baseRevision` 条件更新；不同 key 不共享版本，只有同一 key 的 CAS 失败才进入局部合并/重试。
- 安全密码只用于登录/当前会话首次解锁；会话内复用内存 DEK，勾选“记住本设备”时才写入 account-scoped V2 remembered key。
- V2 不读取旧 `backups`，不导入旧 envelope；本阶段不迁移线上数据。

## 停止条件核对

- 未发现两个 V2 远端事实来源：V2 唯一事实表为 `sync_v2_items`。
- 未删除任何现有 storage key；通知设备 key 仍由通知模块使用。
- test/production Worker 路由和资源 ID 可由两份 wrangler 配置确认隔离。
- 旧整包接口和全局 revision 语义不存在；新接口只接受 Bearer Token 和 key 级密文。
