# cn 分支账号体系重构：按功能拆分的 RESTful 数据同步

> 状态：方案 + 一期实现（服务端 workers/account、前端资源同步引擎）
> 关联分支：`refactor/cn-account-resource-sync` → `cn`

## 1. 背景

当前 cn 分支的账号数据同步是「一大块」模式：

- 前端把所有白名单 localStorage key 打成一个 envelope（`webdavBackup.buildBackupEnvelope`）；
- 用 PBKDF2 + AES-GCM 整包加密（`secureVault.js`，v2 RAW / v3 KEK-DEK 两种信封）；
- 通过 `PUT /api/sync/latest` 整包上传，服务端存 D1 `backups` 表一行 + KV 镜像；
- 任一功能改一个字段，都要重新加密并上传全部数据，冲突也只能整包判定（`baseVersion` 不匹配 → 409）。

带来的问题：改一条交易流水要重传全部持仓/计划/自选；跨端冲突只能整包合并；数据被整包加密后服务端完全不可用（无法做服务端校验、无法按功能灰度、无法排障）；「安全密码 / 记住本设备」成为同步失败的主要来源（换设备无法解密 → 数据看似丢失）。

## 2. 目标（对齐 ai-dca-miniprogram 的做法）

小程序侧的既有约定是：**每个功能只读写自己的接口**、读多写少的数据走各自的只读快照、慢接口必须超时降级、功能开关控制灰度。本次把 Web / APP 的账号体系对齐到同一范式：

1. 每个功能一组 RESTful 资源接口，增量读写，互不阻塞；
2. 逐资源版本号（revision）+ `If-Match` 乐观锁，冲突只发生在单个功能内；
3. **移除持仓等业务数据的端到端加密**，服务端存明文 JSON（传输仍走 HTTPS，访问仍需 Bearer 会话）；
4. 存量用户可平滑迁移，且「无法解密」的用户也有确定的出路；
5. 旧接口在过渡期保持可用（只读），随时可回滚。

## 3. 资源目录

资源名 = `{feature}/{resource}`，与前端 `src/app/syncRegistry.js` 的 key 一一对应（`workers/account/src/catalog.js` 与 `src/app/accountResources.js` 双向校验，测试保证不漂移）。

| feature | resource | 旧 localStorage key | 合并策略 |
| --- | --- | --- | --- |
| holdings | `holdings/ledger` | aiDcaFundHoldingsLedger | holdingsLedger |
| holdings | `holdings/state` | aiDcaFundHoldingsState | lww |
| holdings | `holdings/allocation` | aiDcaAccountAllocationSettings | lww |
| holdings | `holdings/accumulation` | aiDcaAccumulationState | lww |
| holdings | `holdings/position-snapshot` | aiDcaPositionSnapshot | lww |
| trades | `trades/ledger` | aiDcaTradeLedger | arrayById |
| trades | `trades/archive` | aiDcaTradeLedgerArchive | arrayById |
| plans | `plans/store` `plans/state` | aiDcaPlanStore / aiDcaPlanState | planStore / lww |
| dca | `dca/store` `dca/state` | aiDcaDcaStore / aiDcaDcaState | dcaStore / lww |
| sell-plans | `sell-plans/store` `sell-plans/draft` | aiDcaSellPlanStore / aiDcaSellPlanDraft | arrayById / lww |
| vix | `vix/state` | aiDcaVixState | lww |
| fund-switch | `fund-switch/prefs` `fund-switch/worker-config` | aiDcaSwitchStrategyPrefs / aiDcaSwitchStrategyWorkerConfig | lww |
| notify | `notify/client-config` `notify/web-config` `notify/market-alerts` `notify/holding-alerts` | aiDcaNotifyClientConfig / aiDcaWebNotifyConfig / aiDcaMarketAlerts / aiDcaHoldingAlerts | lww / arrayById |
| markets | `markets/watchlist` | markets:watchlist:v1 | watchlist |
| prefs | `prefs/workspace` `prefs/home-dashboard` `prefs/analytics-opt-out` `prefs/premium` | aiDcaWorkspacePrefs / aiDcaHomeDashboardState / aiDcaAnalyticsOptOut_v1 / aiDcaPremiumState | lww |

## 4. 接口契约（`https://api.freebacktrack.tech/api/account/v1`）

鉴权沿用现有会话：`Authorization: Bearer <accessToken>`（`sessions` 表，30 天）。注册 / 登录仍在 `workers/sync` 的 `/api/sync/auth/*`，本次不动。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | 健康检查（免鉴权） |
| `GET /manifest` | 所有资源的 revision / contentHash / updatedAt + 迁移状态；增量拉取的唯一入口 |
| `GET /bundle?resources=a,b` | 批量取若干资源（首次登录冷启动用，仍是逐资源载荷） |
| `GET /{feature}/{name}` | 取单个功能的数据，返回 `ETag: "<revision>"` |
| `GET /{feature}/{name}?history=1` | 该资源最近 10 个版本的元信息（逐功能回滚依据） |
| `PUT /{feature}/{name}` | 整资源覆盖；`If-Match: "<revision>"` 或 body `baseRevision` 做乐观锁 |
| `PATCH /{feature}/{name}` | 增量修改：数组资源 `{upsert:[],remove:[]}`，对象资源 `{set:{},unset:[]}` |
| `DELETE /{feature}/{name}` | 逻辑删除（tombstone，保留 revision 递增） |
| `PUT /{feature}/{name}/items/{id}` | 条目级 upsert（如单条提醒、单条交易） |
| `DELETE /{feature}/{name}/items/{id}` | 条目级删除 |
| `GET /exports/envelope` | 把逐资源明文拼回旧 envelope 形态（本地导出备份 / 回滚用） |
| `GET /migrations/legacy` | 存量状态：是否还有旧密文、加密类型、迁移进度 |
| `POST /migrations/legacy` | 提交解密后的存量数据（幂等，默认不覆盖已有资源） |
| `POST /migrations/legacy/skip` | 记录「放弃旧密文、用本机数据重新开始」 |

冲突返回 `409`：

```json
{ "error": "REVISION_MISMATCH", "resource": "trades/ledger", "merge": "arrayById",
  "currentRevision": 12, "updatedAt": "...", "data": [ ... ] }
```

服务端**不做业务合并**，只把该功能的服务端副本回传，客户端按 `syncRegistry` 的策略就地合并后带新 revision 重试。相比过去整包 409，冲突面缩小到单个功能，一次往返即可解决。

## 5. 数据模型（D1，与旧表并存）

- `account_resources(user_id, resource, feature, revision, content_hash, bytes, item_count, payload, deleted, updated_at, updated_by_end_id, updated_by_end_type)`，主键 `(user_id, resource)`；`payload` 为明文 JSON 字符串。
- `account_resource_history(user_id, resource, revision, payload, content_hash, ...)`，每个资源保留最近 10 个版本，写入时自动裁剪 → 替代过去的整包 `backup_versions`。
- `account_migrations(user_id, status, source, legacy_version, imported_resources, note, ...)`，`status ∈ pending | imported | skipped`。
- 旧表 `backups` / `backup_versions` **不删不改**，只读用于迁移与回滚。

## 6. 去掉加密：影响与边界

- 客户端不再执行 PBKDF2/AES-GCM，`secureVault.js` 降级为「只解密存量信封」的迁移工具，新链路不再产生任何密文。
- 安全边界改为：HTTPS 传输 + Bearer 会话 + 逐用户行级隔离（所有 SQL 均按 `user_id` 过滤）+ 资源白名单 + 单资源 2MB / 单次导入 8MB 上限。
- 明确权衡：服务端从此可读用户业务数据（持仓、交易、计划）。收益是可排障、可按功能校验、可服务端聚合；代价是不再具备「服务端零知识」。**不得**将任何密钥、口令、第三方 token 写入这些资源（沿用基线红线：严禁存放密钥）。
- 「安全密码 / 记住本设备」从主链路移除：不再出现「换设备解不开 → 数据看似丢失」这一类故障。

## 7. 存量数据用户怎么办

存量用户分三类，全部有确定路径，且**旧密文永不主动删除**：

### A. 本设备有安全密码或「记住本设备」密钥（绝大多数）

1. 登录后拉 `GET /migrations/legacy`：`legacy.exists = true`、`needsMigration = true`；
2. 前端用现有 `secureVault.decryptBackupEnvelope` 在本地解密旧信封（密码或 `raw:` 设备密钥）；
3. 按资源目录把 envelope.payload 拆成 25 个资源；
4. `POST /migrations/legacy`（`overwrite=false`，幂等：已存在的资源自动 skip，可重复重试）；
5. 标记 `status=imported`，之后所有读写都走新接口；本机数据与云端按逐资源策略合并，不做整包覆盖。

### B. 旧信封是「记住本设备」RAW 密钥，且当前设备没有该密钥

服务端能从信封元数据识别（`cryptoKind = device-key`），前端据此给出两条路，不再让用户反复试密码：

- **回原设备迁移**：在原设备登录一次即可自动完成上面 A 流程（旧密文一直保留）；
- **就地重开**：`POST /migrations/legacy/skip`，用本机现有数据作为新的起点（本机数据本来就是完整的业务数据），旧密文继续留存，日后回到原设备仍可用 `overwrite=true` 补迁。

### C. 忘记安全密码 / 无任何设备密钥

与 B 的「就地重开」相同：先用本机数据建立新账本，旧密文保留（默认保留 180 天，到期前不做任何清理动作）。前端文案必须说明：**旧云端备份无法解密，不会被自动删除，也不会被覆盖**。

### 迁移期的一致性保证

- 迁移是**幂等**的：重复提交只会跳过已存在资源；
- 迁移前后都可用 `GET /exports/envelope` 导出一份明文备份到本地；
- 迁移过程中旧接口仍可读（`GET /api/sync/latest`），老版本前端不受影响；
- 新前端只写新接口，不再写旧 `backups` 表，避免两份事实来源互相覆盖。

## 8. 灰度与回滚

- 前端开关：`window.__AI_DCA_ACCOUNT_SYNC_V2__`（或 localStorage `aiDcaAccountSyncV2`）关闭时回落到旧整包链路；
- 服务端两套接口并存，旧 worker 不改代码，回滚 = 回滚前端产物；
- 回滚窗口内的差异数据可用 `GET /exports/envelope` 导出后由用户在旧版本重新上传；
- 旧接口下线节奏：新链路全量 2 周 → 旧 `PUT /api/sync/latest` 转只读 → 观察 4 周 → 归档 `backups` 表。

## 9. 测试

- `workers/account/test/catalog.test.mjs`：资源目录唯一性、路由解析、形态与体积校验；
- `workers/account/test/patch.test.mjs`：数组 / 对象 / 条目级增量修改；
- `test/accountResourceSync.test.mjs`：前后端资源目录一致性、存量 envelope 拆分、逐资源合并与冲突重试、迁移状态机；
- 回归：`test/syncRegistry.test.mjs`、`test/cloudSyncMerge.test.mjs`、`test/cloudSyncConflict.test.mjs`、`test/secureVault.test.mjs` 保持通过（合并算法与解密能力都未删除）。

## 10. 后续（本 PR 未覆盖）

- `src/components/account-menu.jsx` 的「安全密码 / 记住本设备」文案与入口清理（当前保持兼容，密码参数被忽略）；
- 服务端按功能的字段级校验（例如交易流水必填字段）；
- `workers/sync` 中整包接口的最终下线与 `backups` 表归档脚本。
