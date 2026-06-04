# 多端同步稳定性加固 Plan（safe-sync-hardening）

## 目标（一句话）
消除「安全密码不正确或云端数据已损坏」的高频误报，让多端加密同步可恢复、可诊断、不丢数据。

## 现状架构
- 端侧加密：`src/app/secureVault.js`（PBKDF2-SHA256 310000 次 + AES-GCM-256，envelope v2）。
- 同步编排：`src/app/cloudSync.js`（快照签名 + 版本号乐观并发 + 按记录 LWW 合并）。
- 服务端：`workers/sync/src/index.js`（D1 存版本/元数据/content_hash，KV `SYNC_BACKUPS` 存密文 blob）。
- UI：`src/components/account-menu.jsx`。
- 报错出处：`src/app/secureVault.js:137`（AES-GCM 解密 catch 的兜底文案）。

## 根因诊断（按严重度，含证据）

### A.〔最可能〕记住本设备的 RAW key envelope，密码端无法解密
- `secureVault.js:95-97,108` 当设备有 remembered raw key 但没有 `cryptoMeta` 时，走 `RAW-AES-GCM` 分支：用 raw key 加密，写入 envelope 的 `salt=''`、`iterations=0`、`kdf='RAW-AES-GCM'`。
- `secureVault.js:130-132` 解密时**只有**当传入字符串以 `raw:` 开头才用 raw key；它**从不读取** `crypto.kdf==='RAW-AES-GCM'`。
- 后果：另一台设备（或本机走冲突明细 `prepareCloudSyncConflict`）用「密码」解密时，`deriveKey(password, salt='', iterations=0||310000)` 得到与 raw key 完全无关的 key → GCM 校验失败 → 报「安全密码不正确或云端数据已损坏」。这是跨设备必现的结构性 bug。

### B. iterations=0 被 falsy 吞掉
- `secureVault.js:129,145` `Number(cryptoMeta.iterations) || DEFAULT_ITERATIONS`：合法的 `0`（RAW 路径）被强制变成 310000，注定 key 不一致；也会掩盖任何未来参数漂移。应改为 `Number.isFinite` 判断而非 `||`。

### C. 一个错误文案混淆三种完全不同的故障
- 「密码错」「envelope 格式/KDF 不兼容」「blob 真的损坏」都抛同一句话（`secureVault.js:134-138`）。没有 KDF 校验器（known-plaintext / MAC），所以永远无法判断该「重输密码」还是「重传/恢复」。这是「经常出问题且无从恢复」的体感来源。

### D. 解密不做格式/版本协商
- `decryptBackupEnvelope` 忽略 `payload.version`、`crypto.alg`、`crypto.kdf`，envelope 结构一旦演进就静默失败。

### E.〔服务端〕KV 与 D1 双存储、非原子、KV 最终一致
- `workers/sync/src/index.js:338` 先 `SYNC_BACKUPS.put(kvKey, encoded)`，:342/:345 再写 D1 版本。两步非事务。
- 读路径 :305-307 先从 D1 取 version+kv_key，再 `SYNC_BACKUPS.get(kvKey)`。KV 跨区域传播有秒级~分钟级延迟：
  - 第二台设备可能读到「D1 已是新 version」但「KV 还是旧/空 blob」→ ciphertext 为 null/截断 → 报损坏；
  - 写入半途失败 → version 与 blob 不一致。
- 缺少服务端对 ciphertext 的独立校验和（D1 里有 `content_hash` 但那是明文内容 hash，不是密文完整性校验）。

### F.〔次要〕base64 用标准 atob/btoa（`secureVault.js:33,37`），传输异常时 atob 抛错也归入「损坏」。

### G.〔非崩溃，但影响体感〕冲突模型是版本号乐观并发 + 按记录时间戳 LWW（`cloudSync.js:98-122`、worker :332 的 409）。并发编辑时易「云端覆盖本地 / 反复 409」，给人「同步老出问题」的印象。

## 主流多端同步方案调研（结论摘要）
1. **KEK/DEK 密钥分层**（Trail of Bits 2025、crypto.SE 共识）：密码经 KDF 派生 KEK，KEK 只用来「包裹」一个随机 DEK；DEK 真正加密数据。改密码只重包裹 DEK，历史密文仍可解；多设备共享同一 DEK。→ 解决「记住本设备/改密码后旧密文打不开」。
2. **E2EE 多设备密钥共享（Bitwarden 模型）**：账户级主密钥，各设备解包；服务端只存密文，永不见明文/密码。
3. **KDF 选择**：口令低熵场景优先 Argon2id（内存硬）；若坚持纯 WebCrypto 无依赖，则 PBKDF2 提高迭代并显式存参数；切勿用口令 hash 直接当数据密钥。
4. **wrong-password vs corruption 区分**：envelope 内放「验证块」（用 DEK 加密一个固定常量）或对密文存 HMAC/摘要；解密前先验，能明确区分两类故障。
5. **冲突解决**：LWW（带逻辑时钟/版本向量，Ditto 模型）适合个人多端；多端实时协作才需要 CRDT（Automerge/Yjs）。冲突必须在「明文」上做（端侧解密后合并）。
6. **存储一致性**：密文与版本放在同一强一致存储（D1 行内 BLOB，或 R2 单对象 + 条件写），避免 KV 最终一致导致的 version/blob 漂移。

## 推荐方案（分层，先止血再加固）

### 阶段 0 — 止血与可诊断（最高优先，低风险）
- [x] 0.1 修 iterations falsy bug：`secureVault.js` 新增 `normalizeIterations`（`Number.isFinite(n)&&n>0 ? n : DEFAULT_ITERATIONS`），用于 decrypt 与 rememberKey 两处。commit 00845a8。
- [x] 0.2 解密支持 RAW-AES-GCM envelope：`decryptBackupEnvelope` 用 `isRawKeyEnvelope`（`kdf==='RAW-AES-GCM'` 或 salt 为空）判定；用密码解 RAW 信封抛 `ERR_NEED_DEVICE_KEY`，`raw:` 路径正常解。设备密钥仍仅本地，未改上传 payload。commit 00845a8。
- [x] 0.3 错误分型 + UI 接线：`SecureVaultError` + `SECURE_VAULT_ERROR_CODES`（WRONG_PASSWORD / NEED_DEVICE_KEY / CORRUPTED / FORMAT）落地（commit 00845a8）；`account-menu.jsx` 新增 `errorCode` state、`renderSyncError()` 按 `.code` 分支出动作按钮（WRONG_PASSWORD→重新输入密码；NEED_DEVICE_KEY/CORRUPTED→`handleForceReupload` 用安全密码 `force:true,useRemembered:false` 重加密覆盖云端，密钥仅本地）。验证：`npx eslint src/components/account-menu.jsx` exit 0、`node --test test/secureVault.test.mjs` 7/7。commit 2ad195c。
- [x] 0.4 解密前做格式校验：检查空密文、`payload.version>2`、`crypto.alg!==AES-GCM`、坏 base64，分别报 `ERR_CORRUPTED`/`ERR_FORMAT`。commit 00845a8。

### 阶段 1 — envelope v3：KEK/DEK + 验证块（中风险，需迁移）
- [ ] 1.1 新增随机 DEK；用 KEK（密码派生）AES-GCM 包裹 DEK 存入 envelope。
- [ ] 1.2 envelope 内加「verifier」：用 DEK 加密固定常量；解密先验 verifier → 精确区分「密码错」与「数据损坏」。
- [ ] 1.3 「记住本设备」改为存 DEK（而非某次派生的 AES key），彻底消除 A 类不一致。
- [ ] 1.4 v2→v3 兼容读取 + 首次写自动升级；保留 v2 解密路径一个过渡期。
- [ ] 1.5 （可选）KDF 升级 Argon2id（评估包体积/WASM）或 PBKDF2 迭代提至当前推荐值。

### 阶段 2 — 服务端一致性（中风险，Worker 改动走 GitHub Actions）
- [ ] 2.1 密文与版本写入单一强一致存储：密文 BLOB 直接进 D1 backups 行（或 R2 单对象 + 条件写），淘汰 D1+KV 双写漂移。
- [ ] 2.2 写入加密文完整性校验和（sha256(ciphertext)）入库；读出时校验，不一致返回明确错误码而非把坏 blob 发给端侧。
- [ ] 2.3 读路径保证 version 与 blob 同源原子返回。

### 阶段 3 — 冲突体验（低风险，增量）
- [ ] 3.1 给可同步记录补充逻辑时钟/版本向量，LWW 之外保留并集合并，减少「云端覆盖本地」。
- [ ] 3.2 冲突 UI 收敛为单一「合并/采用云端/采用本地」三选一（沿用现有 409 流程）。

## 验证计划（证据留痕）
- 端侧单测：扩展 `test/secureVault.test.mjs` —
  - 正确密码可解、错误密码报 `ERR_WRONG_PASSWORD`、RAW envelope 用 raw key 可解且密码端报 `ERR_NEED_DEVICE_KEY`、iterations=0 round-trip、v2→v3 兼容、verifier 命中。
- 跨设备模拟：设备 A（记住本设备）上传 → 设备 B（仅密码）拉取解密成功。
- 后端冲烟（Worker 改动）：对 sync 接口 `curl` 正常上传/下载 + 异常路径（坏 baseVersion 409、坏 ciphertext 校验失败、并发覆盖），记录 HTTP 状态与关键字段；部署走 `.github/workflows`，回报附四件证据。
- 不在本机 `npx wrangler deploy`。

## 风险与回滚
- envelope 升级有「写坏导致旧端读不了」风险 → 必须保留 v2 读路径 + 自动升级，灰度先只升级读、再升级写。
- 服务端存储迁移需一次性把现有 KV blob 回填进 D1/R2，迁移脚本先 dry-run。
- 任一阶段独立可发布、独立可回滚。

## 待确认项（需你拍板）
1. 是否接受「一次性重置云端备份」作为立即止血（用当前能解密的设备强制重传一份干净 envelope，覆盖坏数据）？
2. KDF 是否升级 Argon2id（更安全但要引 WASM/增体积），还是保留 PBKDF2 仅提高迭代？
3. 服务端密文存储：迁到 D1 行内 BLOB，还是 R2 单对象？（都比现在 KV 强一致）

## 进度表
| 状态 | 步骤 | 备注 |
| --- | --- | --- |
| done | 现状调研 + 根因定位 | 见上「根因诊断」，含文件行号证据 |
| done | 阶段 0 止血 | 0.1–0.4 全部完成：错误分型+RAW信封+iterations 修复 00845a8；UI 接线 2ad195c；eslint exit 0 + `node --test` 7/7 |
| todo | 阶段 1 envelope v3 | 依赖阶段 0 |
| todo | 阶段 2 服务端一致性 | Worker 改动走 Actions |
| todo | 阶段 3 冲突体验 | 增量 |
