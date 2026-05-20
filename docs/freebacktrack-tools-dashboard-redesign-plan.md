# FreeBacktrack Tools 网站设计改版计划

## 目标
把当前“策略说明文档型首页”改成“投资工具工作台”，优先提升首屏任务入口、核心功能页空状态、移动端可用性和页面语义结构；不改业务逻辑、不新增依赖。

## 步骤清单
- [done] 1. 探查首页、工作区布局、核心模块页与移动导航实现。
- [done] 2. 重组首页为 Dashboard：4 个状态入口、主操作、新手辅助入口、策略指南压缩模块。
- [done] 3. 补齐核心页稳定页头与更短空状态：持仓、交易计划、行情、通知、备份。
- [done] 4. 调整导航层级与移动端安全留白/底部快捷栏职责。
- [done] 5. 做可访问性与语义收敛：可见 h1、图标按钮 aria-label、主操作唯一化。
- [done] 6. 运行 focused lint / smoke check，提交并推送。

## 关键决策
- 不新增 UI 依赖，复用 Tailwind、现有 Card/Button/PageTabs 等组件。
- 不改变本地存储 key、策略计算、通知推送、WebDAV 同步等业务逻辑。
- 首页默认仍由 `?tab=strategy` 承载，但内容从长文指南变为工作台；策略长文移入折叠/模块卡片。
- 避免触碰当前已有未提交文件 `src/pages/FundSwitchAnalysisExperience.jsx`。

## 待确认项
- 暂无；按用户给定计划直接落地。

## 产出与验证记录
- 已新增 Dashboard 首屏、折叠策略指南、核心页头与行动型空状态。
- Focused ESLint 已通过：0 errors；剩余 warnings 为既有未使用变量 / hook 依赖提示。
- 浏览器 MCP 工具未在当前 MCP 工具列表中提供，未做真实浏览器截图验收。
