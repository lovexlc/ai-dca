# 行情详情页高信息密度改版计划

## 目标
把标的详情页从大卡片展示改成接近 Google Finance 的高信息密度布局：隐藏详情态冗余顶部控件和 metadata，压缩标题/价格/工具条/图表/tabs，明确图表与表格联动，并优化移动端表格与对比弹窗。

## 步骤清单
- [done] 定位详情页、图表、表格、对比弹窗相关实现。
- [done] 实现详情态顶部减法与整体密度压缩。
- [done] 调整图表高度、tooltip 与 hover/cursor 联动数据流。
- [done] 优化移动端表格列显示与无横向滑动。
- [done] 调整对比弹窗为贴近触发按钮的小型浮层。
- [done] 增加 GitHub Actions 构建逻辑，并以远端 Actions 返回作为验证依据。
- [in_progress] 检查 git diff 并提交聚焦 commit。

## 关键决策
- 详情态只保留返回、标题、价格、操作按钮；市场切换栏与刷新按钮仅保留在行情总览态。
- 图表 tooltip 只显示代码和价格，不显示涨跌幅；涨跌额/涨跌幅交由表格展示。
- 移动端优先完整展示涨跌幅列，隐藏昨收盘等低优先级列。
- 对比弹窗应锚定触发按钮左侧，不使用居中大弹窗。

## 待确认项
- 暂无。若代码结构中不存在独立详情页或表格组件，将按现有结构最小改动实现。

## 产出与验证记录
- 已定位主实现：`src/pages/MarketsExperience.jsx`。
- 已隐藏详情态顶部市场切换/刷新栏，并移除详情标题上方 metadata 行。
- 已压缩详情头部、操作按钮、工具条、图表高度、时间 tabs 与对比弹窗尺寸。
- 构建验证尝试：`npm run build:app` 失败，原因是当前 MCP 工作机缺少 `npm`。

- 已新增独立 GitHub Actions workflow：`.github/workflows/build-app.yml`，push/PR 时运行 `npm install` 和 `npm run build:app`。
