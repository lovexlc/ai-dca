# Design accessibility and empty-state follow-up plan

## 目标
根据 2026-05-20 的全站设计审查反馈，优先落地 P0/P1：统一页头与语义、移动端可访问性、上下文底部快捷动作、禁用原因提示，以及核心空状态下一步分流。默认不改业务逻辑、不新增依赖。

## 步骤清单
- [done] 1. 探查当前工作树、布局组件、底部快捷栏、持仓/交易/行情/通知/备份/基金切换页面入口。
- [done] 2. 修复 P0：关闭状态移动侧栏从可访问性树隐藏；底部第三快捷按钮按当前模块上下文化；补齐基金切换页可见 H1/页头。
- [done] 3. 修复 P0：备份/通知关键 disabled 按钮旁显示启用条件或原因。
- [done] 4. 修复 P1：持仓 ticker 默认折叠不抢占首屏；交易计划空状态提供多目标分流；备份空状态/风险说明分区收敛。
- [done] 5. 运行 focused lint，检查 diff，提交并推送。

## 关键决策
- 本轮聚焦 P0/P1 可快速落地项；新建加仓策略分步化、基金切换专家模式拆层、策略指南深度拆分作为后续 P2/P3。
- 不新增 UI 依赖，复用 Tailwind 与现有 `experience-ui.jsx` 按钮/Card 风格。
- 不改投资策略、行情数据、通知推送、WebDAV 同步逻辑，仅调整 UI 组织与可访问性提示。

## 待确认项
- 真实浏览器验证依赖 cf-browser-mcp；当前 MCP 工具列表此前未提供浏览器工具，如仍不可用则只能做 lint/smoke 验证并记录限制。

## 产出与验证记录
- 已新增移动端关闭侧栏 `aria-hidden` + `inert`，打开后才暴露导航。
- 已将移动底栏第三快捷动作上下文化：备份=刷新预览，通知=测试通知，交易计划=新建策略，基金切换=查看机会，其他页保留新增交易。
- 已补持仓总览、基金切换页可见 H1/页头；持仓页市场 ticker 改为默认折叠。
- 已给备份保存/上传/恢复、PC 通知授权/测试/轮询等关键 disabled 状态增加原因提示。
- 已把交易计划空状态改为按目标分流：回撤加仓、定投、卖出规则、VIX 规则。
- 行情中心已移除未接入的全屏入口，保留统一自选 onboarding。
- Focused ESLint 已通过：`0 errors, 48 warnings`；warnings 为既有 unused/hook dependency 提示。
- 浏览器 MCP 工具此前未在工具列表中提供，未做真实浏览器截图验收。

## P2/P3 续做范围（2026-05-20）
- [done] 6. 新建加仓策略表单分步化：选标的 → 选模板 → 调参数 → 预览确认；降低首屏候选按钮密度。
- [done] 7. 纳指 ETF / 标的选择增加搜索与分组入口，保留快捷标的。
- [done] 8. 基金切换拆成“机会概览 / 规则配置”两层；移动端不依赖拖拽，H/L 通过明确按钮操作。
- [done] 9. 基金切换阈值 / spinbutton 增加清晰标签与默认值解释；移动说明移除“拖拽优先”。
- [done] 10. 策略指南进一步收敛为指南索引 + 折叠详情；默认主页设置移到独立偏好区。
- [done] 11. Focused lint / smoke check，提交并推送。


## P2/P3 验证记录
- 新建策略：已改为 4 步流程（选标的 / 选模板 / 调参数 / 预览确认），并增加纳指 ETF 搜索。
- 基金切换：已拆为机会概览 / 规则配置；移动端新增“规则”tab；H/L 提供“设为 H / 设为 L”明确按钮，拖拽仅保留为桌面辅助。
- 策略指南：默认主页设置已移到独立偏好卡；长内容改为“指南索引与折叠详情”。
- Focused ESLint：`npx eslint src/pages/NewPlanExperience.jsx src/pages/FundSwitchExperience.jsx src/pages/SwitchStrategyExperience.jsx src/pages/StrategyGuideExperience.jsx` 已通过，0 errors，9 warnings（既有未使用变量 / hook 依赖提示）。
- 浏览器 MCP 工具未在当前 MCP 工具列表中提供，未做真实浏览器截图验收。
