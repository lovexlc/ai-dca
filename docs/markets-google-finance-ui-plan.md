# 行情详情页 Google Finance UI 对齐计划

## 目标
把行情中心详情页的图表区域进一步贴近 Google Finance：工具栏、对比标签、图表区域、时间范围 tabs、下方对比表的视觉层级和布局按截图收敛。

## 步骤清单
- done：检查当前 MarketsExperience 图表组件、工具栏和对比表实现。
- done：调整工具栏顺序与样式，使其更接近 Google Finance 顶部灰底 pill 工具栏。
- done：调整对比标签 pill、图表卡片背景、图表高度和间距。
- done：调整时间范围 tabs 到图表下方，使用 Google Finance 风格选中浅灰 pill。
- done：调整对比表表头、定位行、颜色 marker 和价格/涨跌数据显示层级。
- done：执行静态检查和 diff 检查。
- in_progress：提交 focused commit。

## 关键决策
- 本次只改前端 UI，不改行情数据源逻辑。
- 不新增外部依赖，不抓取 Google 页面 DOM；以用户给的 Google Finance 截图和当前实现差异为基准。
- 保留当前已有的对比搜索与百分比归一化逻辑，仅调整呈现。
- 当前 MCP 未暴露真实浏览器验证工具，本轮只能做静态检查；前端真实渲染由 GitHub Actions / Pages 部署后检查。

## 待确认项
- 无。

## 产出与验证记录
- 已改：src/pages/MarketsExperience.jsx，图表工具栏、图表灰底卡片、对比 pill、时间范围 tab、对比表视觉层级。
- 已验证：git diff --check 通过。
- 已验证：Python 基础括号/花括号/方括号静态扫描通过。
- 受限：当前 MCP 工具未暴露真实浏览器验证工具，未能执行截图验证。
