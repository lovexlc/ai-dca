# Mobile navigation shortcuts plan

## Goal
在 APP / 移动端增加两个快捷能力：返回上一页（tab 内跳转后可回到原 tab）和快速回到顶部（长指南/长列表滑到底后不用手动滑回）。保持桌面端不受影响，UI 尽量轻量。

## Steps
- [done] 1. 探查 WorkspacePage、MobileTabBar 和现有 tab 切换逻辑。
- [done] 2. 增加移动端 tab 历史栈：普通 tab 切换记录来源，返回按钮回到上一 tab 且不重复入栈。
- [done] 3. 增加移动端悬浮快捷按钮：返回上一页、回到顶部；仅移动端显示，滚动后显示回顶。
- [done] 4. 验证 lint / diff，提交并推送。

## Decisions
- 不改业务逻辑，只改 WorkspacePage 层的移动导航体验。
- 返回上一页按 tab 级别处理，适配“策略指南 → 查看持仓 → 回策略指南”的场景。
- 回到顶部使用 `window.scrollTo({ top: 0, behavior: 'smooth' })`。

## Verification record
- `npx eslint src/pages/WorkspacePage.jsx` 已通过：0 errors，1 warning（既有 `handleSelectTab` hook dependency warning）。
- `git diff --check` 已通过。
- 仅提交 `src/pages/WorkspacePage.jsx` 与本计划文件；未混入已有未提交改动 `src/pages/NewPlanExperience.jsx`。
