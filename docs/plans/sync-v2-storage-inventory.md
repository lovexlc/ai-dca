# ai-dca 同步 V2 Storage 清单（test-only）

V2 第一阶段只把下表中 `account / canonical` 的 key 送入按 key 同步。其余 key 不进入账户同步。

| key | 业务用途 | 写入/读取主要模块 | 分类 | V2 | 合并 | 处理 |
| --- | --- | --- | --- | --- | --- | --- |
| `aiDcaFundHoldingsLedger` | 持仓流水 | holdings ledger 模块 | account/canonical | 是 | holdingsLedger | 直接按 key 加密 |
| `aiDcaFundHoldingsState` | 持仓派生状态 | holdings | account/derived | 否 | lww | 保留本地派生值 |
| `aiDcaAccountAllocationSettings` | 账户比例 | holdings | account/canonical | 是 | lww | 直接按 key 加密 |
| `aiDcaTradeLedger` | 交易流水 | trade ledger | account/canonical | 是 | arrayById | 直接按 key 加密 |
| `aiDcaTradeLedgerArchive` | 交易归档 | trade ledger | account/canonical | 是 | arrayById | 直接按 key 加密 |
| `aiDcaAccumulationState` | 加仓配置 | accumulation | account/canonical | 是 | lww | 直接按 key 加密 |
| `aiDcaPositionSnapshot` | 仓位快照 | holdings | account/derived | 否 | lww | 不同步 |
| `aiDcaPlanStore` | 策略库 | plan/trade plans | account/canonical | 是 | planStore | 同 key 局部合并 |
| `aiDcaPlanState` | 策略派生状态 | trade plans | account/derived | 否 | lww | 不同步 |
| `aiDcaDcaStore` | 定投库 | dca/trade plans | account/canonical | 是 | dcaStore | 同 key 局部合并 |
| `aiDcaDcaState` | 定投派生状态 | trade plans | account/derived | 否 | lww | 不同步 |
| `aiDcaSellPlanStore` | 卖出计划 | sell plans | account/canonical | 是 | arrayById | 直接按 key 加密 |
| `aiDcaSellPlanDraft` | 卖出草稿 | sell plans | device/draft | 否 | lww | 不同步 |
| `aiDcaSwitchStrategyPrefs` | 换基偏好 | switch strategy | account/canonical | 是 | lww | 直接按 key 加密 |
| `aiDcaSwitchStrategyWorkerConfig` | Worker 配置 | switch strategy | cache/derived | 否 | lww | 不同步 |
| `aiDcaVixState` | VIX 缓存状态 | VIX 模块 | cache/derived | 否 | lww | 不同步 |
| `aiDcaNotifyClientConfig` | 通知设备凭据 | notifySync | device/canonical | 否 | lww | 仅通知系统使用 |
| `aiDcaWebNotifyConfig` | 浏览器通知设备配置 | web notify | device/canonical | 否 | lww | 不同步 |
| `aiDcaMarketAlerts` | 行情提醒规则 | notify | account/canonical | 是 | arrayById | 直接按 key 加密 |
| `aiDcaHoldingAlerts` | 持仓提醒规则 | notify | account/canonical | 是 | arrayById | 直接按 key 加密 |
| `aiDcaWorkspacePrefs` | 工作台偏好 | workspace | account/canonical | 是 | lww | 直接按 key 加密 |
| `aiDcaHomeDashboardState` | 首页看板 | home dashboard | account/canonical | 是 | lww | 直接按 key 加密 |
| `markets:watchlist:v1` | 自选清单 | markets watchlist | account/canonical | 是 | watchlist | 同 key 局部合并 |
| `aiDcaPremiumState` | 会员派生状态 | monetization | cache/derived | 否 | lww | 不同步 |
| `aiDcaAnalyticsOptOut_v1` | 分析隐私偏好 | analytics | device/canonical | 否 | lww | 不同步 |

## 迁移决定

本阶段没有迁移入口。已有 localStorage canonical 值在登录后的 V2 初次同步中作为本设备当前值参与 CAS/合并；本阶段不读取或迁移旧云端数据。
