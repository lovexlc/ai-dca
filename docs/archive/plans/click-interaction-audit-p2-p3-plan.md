# 点击式交互审计 P2/P3 修复计划

## 目标
继续修复点击式交互审计中的 P2/P3：移动端行情研究助手面板化、基金切换移动端去掉双层分段、通知配置 Android/PC 内容差异强化。

## 步骤清单
- [done] 1. 定位行情中心、基金切换、通知配置相关组件与移动端状态逻辑。
- [done] 2. 修复 P2：行情中心移动端研究助手改为 bottom sheet 或全屏面板，展开后弱化/隐藏市场主体交互。
- [done] 3. 修复 P2：基金切换移动端只保留一层 `机会 / 规则 / 复盘` 分段，移除重复的 `机会概览 / 规则配置` 嵌套歧义。
- [done] 4. 修复 P3：通知 Android 面板直接显示 `Android 设备绑定` 与设备 ID 输入/绑定空状态，并强化 PC 内容差异。
- [done] 5. 做源码核对与可行验证；如浏览器工具不可用，记录替代验证证据。
- [done] 6. 检查 git diff/status 并提交。

## 关键决策
- 本轮不扩大到视觉重构，优先处理点击审计指出的移动端层级和语义问题。
- 不新增 UI 依赖，复用现有 React/Tailwind/lucide 组件。
- 行情中心移动端保留 130px peek 状态；点击 `打开研究助手` 或上拉进入全屏研究面板，用白色覆盖层隐藏市场主体交互。
- 基金切换移动端由父层分段控制 `机会 / 规则 / 复盘`，内层 `机会概览 / 规则配置` 在嵌入模式隐藏。
- Android 通知绑定输入常驻显示，空状态收敛为明确的 `未绑定 Android 设备`。

## 待确认项
- 无。用户已明确要求继续 P2/P3。

## 产出与验证记录
- 2026-05-20 15:20：开始 P2/P3 定位与计划。
- 已修改 `src/pages/MarketsExperience.jsx`：移动端研究助手展开时全屏化，并用覆盖层隐藏主体内容。
- 已修改 `src/pages/FundSwitchExperience.jsx` 与 `src/pages/SwitchStrategyExperience.jsx`：移动端只保留一层 `机会 / 规则 / 复盘`。
- 已修改 `src/pages/NotifyExperience.jsx`：Android 面板直接展示设备 ID / 测试 URL 输入与未绑定空状态；PC 面板保留独立的浏览器通知说明。
- 浏览器自动化：当前可用 MCP 工具列表只有 local notion 文件/命令/Git 工具，未暴露 cf-browser-mcp 或 agent-browser；本轮采用源码核对和聚焦静态验证替代。
- 聚焦静态验证：`npx eslint src/pages/MarketsExperience.jsx src/pages/FundSwitchExperience.jsx src/pages/SwitchStrategyExperience.jsx src/pages/NotifyExperience.jsx` 退出码 0；仅剩既有 warning，无 error。
- Git 检查：提交前已查看 `git diff` 与 `git status`，确认仅包含 P2/P3 相关源码与本计划文件。
