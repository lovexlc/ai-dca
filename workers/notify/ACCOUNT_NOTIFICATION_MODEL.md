# 账号级通知配置模型

## 不变量

- 所有业务通知配置统一归属登录用户的 `account:<userId>` 记录。
- 浏览器 `web:*` client 只表示设备及 PC WebSocket 注册，不保存 Bark、Server酱³、Email 或业务规则。
- `POST /api/notify/settings` 必须先通过 Bearer 会话验证，再由 `accountEntry.js` 的账号级快速路径处理。
- Bark Device Key 和 Server酱³ 凭证在 `notify_channel_bindings` 中只保存 SHA-256 标识；日志不得输出原始凭证。

## 保存与换绑

保存渠道时仅查询当前账号的 canonical channel 行及凭证冲突行，不再调用全量 `readSettings` / `writeSettings`。

- 同账号历史 client 上的相同渠道全部删除，canonical account 记录成为唯一来源。
- 其他账号上的 Bark 冲突要求显式 `rebindChannel=bark`。
- Server酱³ 冲突必须先匹配 UID 与 SendKey，再要求显式 `rebindChannel=serverchan3`；SendKey 不匹配时禁止换绑。
- 删除旧 channel 行、更新 canonical account 行和写入唯一 binding 使用 D1 batch 完成。
- PC/WebSocket registration 独立保留，不因清理业务配置而误删有效设备。

## 性能与观测

响应包含 `Server-Timing`，Worker 日志输出 `notify-settings-timing`，分为 schema、read、conflicts、write。日志只包含耗时、冲突数和清理数。

## 历史数据清理

账号保存 Bark 或 Server酱³ 时会懒迁移并清除该账号所有非 canonical client 的对应渠道行；相同 Token 的历史绑定也会被清除。规则同步已经通过 `handleFastSync` 写入 canonical account 记录。设备 client 可以继续用于 WebSocket，但不得再承载业务配置。

对于长期无活动、无规则、无渠道且无有效 registration 的 legacy client，后续离线清理必须先 dry-run 并核对统计，不能仅凭 clientId 删除有效设备。
