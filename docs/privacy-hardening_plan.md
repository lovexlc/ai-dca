# 隐私加固计划 (privacy-hardening)

## 目标
落地隐私审查给出的三条建议：①新增隐私/数据采集说明，②增加埋点开关并尊重 Do Not Track，③弱化/匿名化 visitorId / userAgent / 设备上下文采集。仅前端改动，不涉及 Worker/API。

## 关键决策
- 采用 **opt-out（默认采集，可关闭）** 模型，保留现有行为，不破坏管理员看板的 UV/活跃用户统计。
- **尊重浏览器 DNT**：navigator.doNotTrack === '1' 时自动停止采集，且开关锁定为关闭态。
- **visitorId 保留**（看板 UV/活跃数依赖它），但在说明中披露；通过 opt-out / DNT 可彻底停止生成与上报。
- **userAgent 粗化**：只上报「浏览器族 / 系统族」（如 Chrome / Windows），不再上报完整 UA。
- **设备上下文精简**：移除指纹性字段（screen 尺寸、devicePixelRatio、maxTouchPoints、deviceMemory、hardwareConcurrency、connectionType、saveData、languages 列表、platform），仅保留 deviceClass(mobile/tablet/desktop)、language、timezone、online、standalone。
- 隐私说明以**应用内弹窗**为唯一事实来源，入口放在账户菜单（登录态设置区 + 未登录登录弹窗）。

## 步骤清单
1. [done] src/app/analytics.js：opt-out 存储 + DNT 判断 + 采集总开关；trackAnalyticsEvent 命中关闭时直接 return。
2. [done] src/app/analytics.js：coarseUserAgent() 替换完整 UA；精简 getDeviceContext()。
3. [done] 新建 src/components/PrivacyNotice.jsx：开关 + 「查看数据说明」弹窗。
4. [done] src/components/account-menu.jsx：在登录态设置区与未登录弹窗各插入 <PrivacyNotice />。
5. [done] 验证：npm run lint；前端无后端接口改动，无需 curl。
6. [done] 聚焦提交。

## 产出与验证记录
- 2026-06-13：`src/app/analytics.js` 已在 `trackAnalyticsEvent()` 入口尊重 opt-out / DNT，关闭时不生成 visitorId/sessionId、不写本地事件、不发 beacon；`userAgent` 改为浏览器族 / 系统族；设备上下文仅保留 deviceClass / language / timezone / online / standalone；高指纹字段也会从传入 meta 中过滤。
- 2026-06-13：新增 `src/components/PrivacyNotice.jsx`，并接入 `src/components/account-menu.jsx` 登录态设置区与未登录登录弹窗。
- `node --test test/analyticsPrivacy.test.mjs`：通过。
- `npx eslint src/app/analytics.js src/components/PrivacyNotice.jsx src/components/account-menu.jsx`：通过，0 errors，6 warnings（`analytics.js` 既有 `_error` unused）。
- `npm run lint`：通过，0 errors，184 warnings（仓库既有 warning；包含当前工作区未完成的 `ScenarioSwitcher.jsx` unused React warning）。
- `git diff --check -- src/app/analytics.js src/components/PrivacyNotice.jsx src/components/account-menu.jsx test/analyticsPrivacy.test.mjs docs/privacy-hardening_plan.md`：通过。
