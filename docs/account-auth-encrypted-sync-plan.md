# 账户注册/登录与端侧加密同步计划

## 目标

为「美股策略助手」增加账户注册/登录能力。用户登录后自动同步当前「数据同步」范围内的本地数据；服务端只保存密文备份与必要账号元数据，不直接保存用户明文投资记录、通知配置、交易流水等内容。数据加密/解密在网页侧完成，安全密码由用户填写或浏览器生成。

## 现状梳理

- 当前「数据同步」入口：`src/pages/BackupExperience.jsx`。
- 当前备份核心：`src/app/webdavBackup.js`。
- 当前备份范围：`localStorage` 中所有 `aiDca*` key，排除 transient key。
- 当前 WebDAV 备份格式：`{ version, exportedAt, source, keyCount, keys, payload }`。
- 当前问题：
  - WebDAV 配置仍需要用户自己找服务。
  - WebDAV 凭据保存在本地。
  - 没有统一账户体系。
  - 没有端侧加密的官方同步通道。

## 设计原则

1. **端侧加密**：浏览器内加密后再上传；服务端永远不拿到明文 payload。
2. **账户密码 ≠ 数据安全密码**：登录密码只用于登录；安全密码用于数据加解密。
3. **服务端只做密文仓库**：保存账号、认证信息、密文 blob、版本号、更新时间、设备元数据。
4. **不新增前端依赖优先**：优先使用 Web Crypto API：`crypto.subtle`、AES-GCM、PBKDF2。
5. **兼容现有数据同步**：复用 `collectBackupPayload()` / `applyBackupEnvelope()` 的数据范围。
6. **保留 WebDAV**：账户云同步作为默认推荐；WebDAV 作为高级/自托管选项保留。
7. **冲突安全优先**：自动上传前比较远端版本；冲突时提示用户选择本地覆盖、远端恢复或另存本地。

## 推荐架构

### 前端模块

新增：

- `src/app/authClient.js`
  - 注册、登录、登出、刷新 session。
  - 保存 session token 到 localStorage 或 sessionStorage。
  - 不保存用户登录明文密码。

- `src/app/secureVault.js`
  - 生成安全密码。
  - 根据安全密码派生加密 key。
  - 加密/解密 backup envelope。
  - 生成/校验加密头信息。

- `src/app/cloudSync.js`
  - 构建当前本地备份 envelope。
  - 调用 `secureVault` 加密。
  - 上传/下载账户密文备份。
  - 自动同步队列、debounce、冲突检测。

改造：

- `src/pages/BackupExperience.jsx`
  - 新增「账户同步」卡片：登录状态、注册/登录入口、安全密码设置、立即同步、从云端恢复。
  - 原 WebDAV 卡片改成「高级备份 / WebDAV」。

- `src/pages/WorkspacePage.jsx`
  - 登录成功后启动自动同步监听。
  - 用户本地数据发生变化后触发 debounce 上传。

### 后端 / Worker

新增独立 Cloudflare Worker：`workers/sync/`。

接口草案：

- `POST /auth/register`
  - 入参：`email`, `passwordHash`。
  - 出参：`userId`, `accessToken`, `refreshToken`。

- `POST /auth/login`
  - 入参：`email`, `passwordHash`。
  - 出参：`userId`, `accessToken`, `refreshToken`, `latestBackupMeta`。

- `POST /auth/logout`
  - 可选：让 refresh token 失效。

- `GET /sync/meta`
  - 只返回版本、更新时间、大小、设备名，不返回 blob。

- `GET /sync/latest`
  - 返回当前用户最新密文备份元数据与 blob。

- `PUT /sync/latest`
  - 上传密文备份。
  - 入参：`ciphertext`, `iv`, `salt`, `kdf`, `version`, `clientUpdatedAt`, `baseVersion`。
  - 服务端只保存密文，不解密。

存储建议：

- Cloudflare D1：用户、session、备份元数据。
- Cloudflare KV：MVP 保存最新密文备份 blob。
- 后续如果要多版本历史或更大文件，再迁移 R2。

## 加密方案

### 安全密码来源

两种模式都支持：

1. **浏览器生成**
   - 使用 `crypto.getRandomValues` 生成 128-bit 或 192-bit 随机密码。
   - 展示给用户复制/保存。
   - 本地可选择「记住本设备」。

2. **用户自填**
   - 用户输入一段安全密码。
   - 前端做强度提示，但不上传明文。

### 密钥派生

MVP：

- PBKDF2-HMAC-SHA-256
- `salt`: 16 bytes random
- iterations：建议 310,000 起
- 输出：AES-GCM 256-bit key

密文 envelope 示例：

```json
{
  "version": 2,
  "source": "ai-dca-secure-sync",
  "crypto": {
    "alg": "AES-GCM",
    "kdf": "PBKDF2-SHA-256",
    "iterations": 310000,
    "salt": "base64...",
    "iv": "base64..."
  },
  "meta": {
    "keyCount": 12,
    "exportedAt": "2026-05-21T...Z",
    "schemaVersion": 1
  },
  "ciphertext": "base64..."
}
```

明文只在浏览器内短暂存在，格式继续沿用当前 WebDAV 备份 envelope。

## 登录与安全密码关系

推荐 UX：

1. 用户注册账号：邮箱 + 登录密码。
2. 注册成功后进入「创建数据安全密码」。
3. 用户选择自动生成安全密码，或自己填写安全密码。
4. 系统用安全密码加密本地数据并上传。
5. 新设备登录后：先输入登录密码进入账号，再输入安全密码解密云端数据。

重要限制：

- 忘记登录密码：可做邮箱重置。
- 忘记安全密码：服务端无法恢复用户数据，只能重新开始或导入本地备份。

## 自动同步策略

### 触发时机

- 登录成功后：
  - 拉取云端 meta。
  - 若云端有数据且本地无数据：提示恢复。
  - 若本地有数据且云端无数据：自动上传。
  - 若两边都有：比较 `updatedAt` 和 `baseVersion`，必要时提示冲突。

- 本地数据变化后：
  - 监听 `storage` event。
  - 对现有保存函数难统一监听的场景，先在关键入口手动 dispatch `aiDca:data-changed`。
  - debounce 3–5 秒上传。

- 用户手动点击「立即同步」。

### 冲突处理

MVP 简化：

- 云端 `version` 与本地 `lastSyncedVersion` 一致：允许上传。
- 不一致：提示冲突，提供：
  - 使用本地覆盖云端。
  - 使用云端覆盖本地。
  - 下载本地备份后再恢复云端。

## UI 计划

### 数据同步页结构

1. **账户同步**（新增，默认在顶部）
   - 未登录：注册 / 登录。
   - 已登录：账号、同步状态、立即同步、退出登录。
   - 安全密码状态：已解锁 / 未解锁。

2. **安全密码**
   - 创建安全密码。
   - 输入安全密码解锁数据。
   - 重新加密 / 更换安全密码。

3. **同步操作**
   - 上传到云端。
   - 从云端恢复。
   - 冲突处理。

4. **高级备份 / WebDAV**
   - 保留现有 WebDAV 配置。
   - 默认折叠。

5. **备份清单**
   - 继续展示当前会同步的 `aiDca*` 数据。

### 全局入口

- 顶部或侧边栏账户状态：未登录 / 已同步 / 需解锁 / 同步失败。
- 不做强打扰弹窗；同步失败用 toast + 数据同步页状态呈现。

## 实施步骤

| 状态 | 步骤 | 内容 |
|---|---|---|
| done | 1. 现状调研 | 已确认现有 WebDAV 同步入口、备份范围、localStorage key 规则。 |
| todo | 2. 确认产品决策 | 确认后端存储选型、注册方式、安全密码 UX。 |
| todo | 3. 设计加密模块 | 新增 `secureVault.js`，实现随机密码、PBKDF2、AES-GCM、加密/解密 envelope。 |
| todo | 4. 设计账户 API | 新增 sync/auth worker 路由与数据结构。 |
| todo | 5. 设计前端 auth client | 新增登录态、token 刷新、登出、本地 session 保存。 |
| todo | 6. 设计云同步 client | 上传/下载密文 blob、版本冲突检测、自动同步队列。 |
| todo | 7. 改造数据同步页 | 添加账户同步卡片，WebDAV 降级为高级备份。 |
| todo | 8. 全局自动同步接入 | Workspace 启动登录态检测和 data-changed debounce 同步。 |
| todo | 9. 验证 | 加密解密单测、Worker API curl、前端浏览器登录/同步/恢复路径验证。 |
| todo | 10. 部署 | Worker 通过 GitHub Actions 部署；前端通过 GitHub Actions 发布。 |

## 关键决策待确认

1. **注册方式**
   - A. 邮箱 + 密码（MVP 最快）
   - B. 邮箱验证码 + 密码（更安全，需要邮件通道）
   - C. 仅用户名 + 密码（最简单，但找回困难）

2. **后端存储**
   - A. Cloudflare Worker + KV（MVP 最快）
   - B. Cloudflare Worker + D1 + KV（用户/版本更清晰）
   - C. Cloudflare Worker + D1 + R2（长期更稳）

3. **安全密码默认策略**
   - A. 默认自动生成，用户也可改成自填。
   - B. 默认用户自填，提供生成按钮。

4. **是否记住安全密码**
   - A. 默认不记住，每次新设备需要输入。
   - B. 用户勾选「记住本设备」后存在本机，仅本机自动解锁。

5. **同步范围是否包含通知配置**
   - 当前 WebDAV 会同步 `aiDcaNotifyClientConfig`。
   - 该配置可能包含通知 token / endpoint。
   - 如果云端只存密文，则可以同步；但 UI 需要明确这是端侧加密同步。

## 风险与注意事项

- 安全密码忘记后无法恢复云端数据，需要明确提示。
- 自动同步可能覆盖本地数据，必须有版本冲突保护。
- 登录密码和安全密码不能混用；否则重置登录密码会让用户误以为能恢复数据。
- Web Crypto API 需要 HTTPS 环境，GitHub Pages/生产域名满足；本地 dev 通常也可用。
- 不要把安全密码、派生 key、明文 payload 发给 Worker。
- 当前仓库本地状态显示 `main...origin/main [ahead 4]`，实施前需要先确认是否有未推送提交/远端状态，避免混入不相关变更。
- 当前存在未提交的 `src/pages/NewPlanExperience.jsx` 本地修改；后续实施不要混入，除非明确需要。

## 验证计划

### 前端逻辑

- 加密同一明文两次，因 IV 不同 ciphertext 不同。
- 正确安全密码可解密。
- 错误安全密码解密失败且不写入 localStorage。
- 解密后 `applyBackupEnvelope()` 恢复 key 数正确。

### Worker API

- 注册成功。
- 重复注册返回 409。
- 登录成功返回 token。
- 错误密码返回 401。
- 未授权访问 `/sync/latest` 返回 401。
- 上传密文成功，服务端不解析明文 payload。
- baseVersion 冲突返回 409。

### 浏览器验证

- 新用户注册 → 生成安全密码 → 上传同步。
- 退出登录 → 登录 → 输入安全密码 → 恢复数据。
- 本地修改持仓/计划 → 自动同步状态更新。
- 错误安全密码不会覆盖本地数据。

## 建议 MVP 范围

第一版建议做：

- 邮箱 + 密码注册/登录。
- 安全密码自动生成 + 支持自填。
- 端侧 AES-GCM 加密当前 WebDAV 同步范围。
- Cloudflare Worker + KV 保存最新一份密文备份。
- 手动同步 + 登录后自动检查/恢复。
- 自动上传先做 debounce，不做复杂多端实时合并。

暂缓：

- 邮箱验证码。
- 多版本历史。
- 多设备实时合并。
- 找回安全密码。
- 第三方登录。
