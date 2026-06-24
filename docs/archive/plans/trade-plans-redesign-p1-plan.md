# 交易计划页面 P1 redesign 计划

## 目标

继续完成交易计划 redesign P1：VIX 可视化升级、tab 切换动效、回测应用入口明确化、列表项快捷操作图标直出。

## 步骤清单

- [done] 读取 VIX、回测、交易计划列表实现，确认影响范围
- [done] VIX 面板增加温度计与横向阈值卡片，强化当前状态
- [done] VIX 刷新增加 loading 文案与更新 toast
- [done] 回测工具增加「应用此策略创建定投计划」入口并跳转新建定投表单
- [done] 交易计划 tab 面板增加 200ms 淡入动效
- [done] 计划卡片直出测试通知 / 删除快捷图标，保留更多菜单
- [done] 运行 focused lint 并检查 diff
- [done] 提交并推送

## 关键决策

- 本轮只做 P1，不展开 P2 sparkline、执行历史时间线、批量操作、实时徽章。
- 回测应用使用既有 sessionStorage 预填机制，但跳转到 `#dca-new`，符合 P0 的创建入口重构。
- VIX 阈值颜色沿用现有 `vixSignal.js` tone，并统一走势图阈值线颜色。

## 产出与验证记录

- `src/pages/VixDashboard.jsx`：增加 VIX 温度计、横向阈值卡片、刷新中状态和更新 toast，统一走势图阈值线颜色。
- `src/pages/DcaCalculatorExperience.jsx`：将「应用此策略」改为「应用此策略创建定投计划」，并跳转 `#dca-new` 预填新建定投表单。
- `src/pages/TradePlansExperience.jsx`：列表卡片直出测试通知 / 编辑 / 删除图标，更多菜单保留；支持卖出计划删除；tab 面板增加 200ms 动效。
- `src/styles/app.css`：新增交易计划 tab 面板淡入动画。
- 验证：focused ESLint 通过，0 errors。
