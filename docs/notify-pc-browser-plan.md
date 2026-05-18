# 通知中心 · PC 浏览器前台通知（方案 A）

## 目标
在 NotifyExperience（通知中心）增加 PC tab，让 Chromium 系浏览器（Chrome / Edge / Brave / Arc 等）能在页面打开时收到桌面通知。**不**做 Web Push（SW + VAPID），不改 Worker；只走「前台 Notification API + 客户端轮询 `/api/notify/events`」。

## 决策记录
- 方案 = A（用户 2026-05-18 10:49 确认）
- 不引入 Service Worker、不引入 VAPID、不改 `workers/notify`
- 触发链路：客户端定期拉 `/api/notify/events`，diff 出新事件后用 `new Notification(...)` 弹本地
- 与现有 iOS Bark / Android FCM 是平行渠道（用户三个都开就收三份）

## 步骤

| # | 步骤 | 状态 |
|---|------|------|
| 1 | 读懂现有 NotifyExperience tab/notifySync events 接口 | done |
| 2 | 新建 `src/app/webNotifyClient.js`：权限、本地弹窗、轮询、localStorage 配置 | done |
| 3 | `NotifyExperience.jsx` 增加 'pc' tab + 配置面板（权限徽章/授权按钮/本地测试/开关） | done |
| 4 | `entry-screen.jsx` 启动全局 poller（与 NotifyExperience 解耦） | done |
| 5 | esbuild + ESLint 验证 | done (0 errors) |
| 6 | cf-browser-mcp 真机验证 | skipped (M14 已证 cf-mcp 对该 SPA 不可用) |
| 7 | commit + push | in_progress |

## 产出
- 新文件：`src/app/webNotifyClient.js`（6748B）
- 修改：`src/entry-screen.jsx` +21；`src/pages/NotifyExperience.jsx` +137 -3 （含修正 L763 全角空格）
- esbuild NotifyExperience · 111.8kb
- ESLint: 0 errors, 8 warnings（均为预存 _unused vars）

## 后续可选
- B 方案（SW + VAPID + Worker web-push）让关页面也能推送
- iOS Safari 16.4+ PWA 模式下也可走该路径（现仅文案寫为"PC 浏览器"）
