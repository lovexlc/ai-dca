# Plan: 持仓页每日收盘推送入口

分支：`feat/holdings-daily-push-cn`（基于 origin/cn b05fa971，2026-09-25 应用户要求改推 cn；deploy-cn-frontend.yml 会在 push 后部署 CN 前端）

## 背景
每日持仓收益推送开启率约 2/30。入口藏在通知 Tab 的 NotifyRulesCard 深处，持仓 Tab 没有醒目入口。

## 方案（已确认）
- PC：在总资产同行右侧放 pill（铃铛图标 + 每日收盘推送 + 副文案 + 开关）。
- 移动端：在三列 KPI 下、四个 tile 上放整宽卡片。
- 与通知 Tab 的 `holdings-rule` 共用同一份服务端状态，复用 `load/saveHoldingsNotifyRule`。

## 变更
- `src/pages/holdings/useHoldingsDailyPush.js`（新）：读取/切换 holdings-rule；未登录不上报；开启前校验通知渠道；埋点。
- `src/pages/holdings/HoldingsDailyPushEntry.jsx`（新）：`variant="pill" | "card"` 两种形态。
- `src/app/income/IncomeSummary.jsx`：桌面端 header 行加 pill；移动端 KPI 下加 card。
- `test/holdingsDailyPush.test.mjs`（新）：渠道判断逻辑 3 个用例。

## 边界交互
- 未登录：入口可见，副文案提示「登录后可开启」；点击 toast 提示登录。
- 未配置通知渠道：开启时 toast 提示并自动跳转通知 Tab（`?tab=notify`）配置渠道。
- 无持仓数据：允许开启（与通知 Tab 行为一致），digest 为空。
- 保存中/加载中：入口置灰禁用。

## 埋点
- `holdings_daily_push_entry_view`（曝光，每挂载一次）
- `holdings_daily_push_toggle_click`（点击，带 nextEnabled）
- `holdings_daily_push_toggle` success/error/blocked_not_logged_in/blocked_no_channel

## 验证（2026-09-25）
- eslint：新增文件干净；全量 2 个错误为 main 已有（useNotifyExperience.js:683）。
- `node --test test/*.test.mjs`：493/482 通过，11 失败与 main 一致（预存失败，notify/wechat 相关）。
- `npm run build`（含 check:refactor）：通过。
- 组件 SSR 渲染检查：12 项全部通过。

## 待定
- 上线：需用户明确批准后再 push + 部署验证。
