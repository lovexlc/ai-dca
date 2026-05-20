# Design accessibility second follow-up plan

## Goal
继续修复设计与可访问性反馈：优先 P0/P1（移动隐藏导航空控件、交易计划 tab 状态、通知 iOS/Android 内容切换、新建策略首步减重、基金切换数字输入标签、disabled 原因就近展示），同时压缩行情中心移动端信息层级和统一空状态文案。

## Steps
- [done] 1. 探查当前工作树和相关文件：ConsoleLayout/MobileTabBar、持仓、交易计划、新建策略、基金切换、通知、备份、行情中心。
- [done] 2. 修 P0：移动端关闭导航空控件、交易计划 tab aria/content 同步、通知 iOS/Android 面板内容切换。
- [done] 3. 修 P1：压缩新建策略第一步、补齐基金切换无标签数字输入、disabled 按钮就近原因。
- [done] 4. 修 P2/P3：行情中心移动信息层级和空状态语言；持仓重复主操作文案；过长 accessible name。
- [done] 5. Focused lint，检查 diff，提交并推送。

## Decisions
- 保持业务逻辑不变，只调整 UI 层级、ARIA、文案和可访问性。
- 前端真实浏览器验证按项目规则应执行；若当前 MCP 未提供 browser/cf-browser 工具，则记录限制并用 focused lint 替代。

## Verification record
- 移动导航：关闭态 sidebar 增加 `hidden` + `aria-hidden` + `inert`，避免空 button/link 残留在可访问树。
- 持仓页：空状态按钮文案改为“录入第一笔交易 / 录入交易流水”，避免和页头、移动底栏重复。
- 交易计划：二级 tab 增加 `role=tablist/tab/tabpanel`、`aria-selected`、`aria-pressed`、`aria-controls`，内容 panel 随 subView 变化。
- 新建策略：第一步只保留策略名称 + 标的选择；金额、均线/高点、现金留存和频率移到第 3 步，价格默认显示到 3 位。
- 通知页：通知接入折叠按钮使用短 `aria-label`；iOS/Android/PC tab 增加 ARIA；面板标题分别为 iOS Bark 配置、Android 设备绑定、PC 浏览器通知；Bark/Android/PC disabled 按钮均有就近原因。
- 基金切换：场外强/弱信号阈值数字输入补 `aria-label`；手动跑一次 disabled 旁显示原因。
- 备份页：保存/测试/上传/恢复按钮旁显示就近原因。
- 行情中心：移动端隐藏高密度侧栏和二级资讯卡，只保留市场概况 + 研究入口；空状态文案统一为未配置 / 暂未加载 / 今日暂无。
- Focused ESLint：`npx eslint src/components/console-layout.jsx src/pages/HoldingsExperience.jsx src/pages/TradePlansExperience.jsx src/pages/NewPlanExperience.jsx src/pages/SwitchStrategyExperience.jsx src/pages/NotifyExperience.jsx src/pages/BackupExperience.jsx src/pages/MarketsExperience.jsx` 已通过，0 errors，56 warnings（既有 unused/hook dependency 提示）。
- 浏览器 MCP 工具未在当前 MCP 工具列表中提供，未做真实浏览器截图验收。
