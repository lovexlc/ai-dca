# 按 Tab REST 同步与持仓交易冲突处理

## Summary

- 只有 `aiDcaFundHoldingsLedger` 的交易记录继续使用安全密码端侧加密。
- 其它 Tab 数据改为登录态明文 JSON REST：GET/POST/PUT/DELETE，不再要求安全密码。
- 登录不再执行全量账户水合、`/v2` 快照同步或写端租约。
- 仅在持仓交易记录 hash 或版本不一致时，打开交易明细冲突界面。
- `/api/notify/status` 只由通知管理页读取，交易计划等其它 Tab 不做通知状态探测。
- `/api/sync/holdings/transactions` 只同步交易记录投影；持仓总览、收益明细、清仓分析和持仓分析均从该交易记录在本机派生。

## 关键改造

### 1. Tab 资源接口

没有现成领域接口的数据按 Tab 分组，使用 `/api/sync/{tab}/{resource}` 的 GET/POST/PUT/DELETE 接口。只有 holdings/transactions 使用加密 envelope；其余资源返回明文 JSON 和 revision/contentHash 元数据。已有领域 REST 接口的数据不重复注册通用同步路由。

资源分组：

- holdings：transactions、allocation-settings、accumulation
- trade-plans：plans、plan-state、dca、dca-state、sell-plans、vix
- fund-switch：prefs、watchlist；Worker 配置由 `/api/notify/switch/config` 负责，不能再进入通用 sync
- notify：不注册 `/api/sync/notify/*`；通知配置、通知策略和通知规则继续使用 `/api/notify/*` 领域接口（例如 `/api/notify/switch/config`）或浏览器本地存储。
- markets：watchlist、groups、column-visibility、table-view
- global：workspace-prefs、home-dashboard、analytics-opt-out、premium-state

### 2. 前端同步模型

- 登录后不再请求全量 manifest 或启动全局账户同步。
- 当前 Tab 激活时懒加载该 Tab 资源，并复用 cache、inflight、abort 和 revision 保护。
- 非交易资源直接 debounce 写入对应 REST endpoint；冲突时重新拉取云端值，不弹账户同步冲突框。
- 持仓交易记录独立维护加密、hash、revision 和冲突状态。

### 3. 持仓交易冲突

- 先比较本地 canonical transaction hash 与云端 hash；一致时不请求安全密码。
- 不一致时解密远端交易并按稳定 `transaction.id` 展示同 ID 修改、单端新增和删除差异。
- 每条冲突提供“合并/放弃本机修改”，并提供全部合并/全部放弃。
- 合并保留本机版本和本机新增；云端独有记录始终保留。
- 放弃采用云端版本并删除本机独有记录。
- 提交只上传加密交易 envelope，不上传行情快照或其它派生字段。

### 4. 旧数据迁移

旧版整包/逐资源密文只在用户打开对应 Tab 时按需迁移。解密成功后写入新 REST 资源并校验 hash，成功前不删除旧数据。旧 `/data/*`、`/secure-config`、`/v2/*` 和 `/latest` 只作为兼容迁移入口。

## 测试与验收

- 非交易 Tab 不请求 manifest、v2、secure-config 或安全密码。
- Tab 懒加载、明文 REST CRUD、revision/hash、鉴权和幂等写入均有覆盖。
- 交易 hash 相同不解密；hash 不同展示逐条冲突并覆盖合并/放弃、错误密码、损坏密文和 CAS 重试。
- 旧数据迁移失败不得清空本地或云端数据。
- 提交前运行相关 `node --test`、`npm run check:refactor`、`npm run lint -- --quiet` 和 `git diff --check`。

## 默认假设

- 按产品决策，已有领域接口的通知配置等数据直接走 `/api/notify/*`，不再经过通用账号同步资源。
- 非交易资源并发冲突采用云端值，不引入逐字段冲突 UI。
- 交易同 ID 的“合并”保留本机版本，避免同一交易重复计入持仓。
- 不改变现有 localStorage key 和交易记录字段格式。
