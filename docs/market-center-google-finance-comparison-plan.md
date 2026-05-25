# 行情中心 Google Finance 风格补齐计划

## 目标
在保留现有美股/A股范围的前提下，补齐行情中心与 Google Finance 对齐所需的核心能力：完整行情表格、多自选列表、列表涨跌联动、跨市场搜索/ask、主题摘要深挖、财报字段与更多列表、自选同步可演进结构。

## 步骤清单
- done：确认范围决策：不增加 Europe/Asia/Currencies/Crypto/Futures 等全局市场分区，仅保留当前美股/A股。
- in_progress：梳理现有 MarketsExperience 状态、组件和 API contract。
- todo：实现多自选列表数据结构，保留旧 watchlist 兼容迁移。
- todo：补齐行情表格字段与可排序表格体验。
- todo：实现当前自选列表的 Top movers 联动模块。
- todo：实现跨美股/A股统一搜索入口和 Search or ask 体验。
- todo：强化主题摘要卡的 AI 深挖入口与来源展开。
- todo：补齐财报卡字段和 More earnings 展开体验。
- todo：执行静态检查/测试，必要时浏览器验证前端渲染。
- todo：提交 focused commit。

## 关键决策
- 不新增其他全球市场分区。
- 本次默认直接改本地 ai-dca 仓库。
- Google Finance 对齐重点放在信息架构和交互能力，不强行复制无关资产分类。

## 待确认项
- 暂无。若 API 上游缺字段，前端先做兼容展示与空值降级。

## 产出与验证记录
- 待补充：代码改动路径。
- 待补充：检查和测试命令结果。
- 待补充：浏览器验证证据或阻塞原因。
