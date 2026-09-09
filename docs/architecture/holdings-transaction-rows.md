# 持仓交易行账本

> 状态：已实现于 `refactor/cn-holdings-transaction-rows`，待合并到 `cn`。

## 结论

持仓页面的账户事实现在只有交易记录。`holdingsLedgerCore.aggregateByCode(transactions, snapshotsByCode)` 仍负责页面展示，但 `snapshotsByCode` 只接收实时 NAV/行情结果，属于运行时输入，不再写入 `aiDcaFundHoldingsLedger`，也不再进入账号同步、导出或存量迁移。

## 服务端存储

账号 Worker 会自动创建两张 D1 表：

- `account_holdings_transactions`：一条交易一行，主键为 `(user_id, transaction_id)`，保存交易 payload、行 revision、content hash、软删除标记和最后写入端信息。
- `account_holdings_transaction_meta`：按用户保存交易行集合的 revision、canonical hash、字节数和 itemCount，用于 manifest 和增量同步。

每一行最大 64 KiB；集合 hash 对交易按日期和 id 排序后计算。行写入使用 `If-Match` / `baseRevision`，并返回 `409 REVISION_MISMATCH`，不会把整个持仓集合作为一次写入单元。

## REST 接口

基地址：`https://api.freebacktrack.tech/api/account/v1`，鉴权沿用 `Authorization: Bearer <accessToken>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/holdings/ledger/items?cursor=&limit=` | 分页读取交易行 |
| `GET` | `/holdings/ledger/items/{id}` | 读取一行 |
| `PUT` / `PATCH` | `/holdings/ledger/items/{id}` | 新增或更新一行；支持 `baseRevision` |
| `DELETE` | `/holdings/ledger/items/{id}` | 软删除一行 |
| `GET` | `/manifest` | 返回 holdings/ledger 的集合 revision/hash/itemCount |
| `GET` | `/exports/envelope` | 导出交易行兼容 envelope，但不包含 position snapshot |

旧的 `GET|PUT|DELETE /holdings/ledger` 仍保留为兼容门面；新前端不再通过它同步整块账本。

## 前端同步

- `holdingTransactionsSync.js` 读取本地交易行，按 id 做增量 PUT/DELETE；本地状态存放在 `aiDcaHoldingTransactionSyncState`。
- 首次 pull 遇到本地存在、远端不存在的交易，会保留本地行并自动排入 push 队列。
- 远端 pull 写回本地后派发 `holdings:ledger-updated`，来源为 `cloud-transactions`；持仓页重新读取账本并重新聚合。
- 普通账号资源继续走 `resourceSync`；`holdings/ledger` 不再进入通用 blob 上传，`position-snapshot` 标记为 deprecated 并跳过新同步。
- 本地 envelope / 手动导出仍可携带 `aiDcaFundHoldingsLedger`，用于兼容和回滚；这不代表它会被作为服务端 blob 写入。

## 存量用户迁移

1. 客户端只在本地解密旧整包 envelope。
2. `splitEnvelopeIntoResources` 只把旧 ledger 的 `transactions` 送到 `/migrations/legacy`；`snapshotsByCode` 和 `holdings/position-snapshot` 被忽略。
3. Worker 逐行写入交易表。
4. 对已经完成旧版迁移的用户，首次访问新 manifest/交易接口时会从旧 `account_resources` 的 `holdings/ledger` payload 自动 backfill 交易行，避免因旧迁移状态为 `imported` 而漏迁。
5. 旧密文和旧资源仍保留作回滚依据，但不会成为新的持仓事实来源。

## 部署与验证

- Worker 仍通过 `.github/workflows/deploy-worker-account.yml` 在 `workers/account/**` 变更推送到 `cn` 后自动部署。
- 已覆盖：交易 id 校验、canonical 排序、单行大小限制、旧 envelope 提取、前后端资源目录一致性，以及本地账本不持久化 snapshot。
- 本地已通过 account/catalog/patch/transactions 与资源一致性测试；完整生产 lint/build 需在有项目依赖和网络的 CI 环境执行。
