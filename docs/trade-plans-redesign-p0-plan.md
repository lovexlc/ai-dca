# 交易计划页面 P0 redesign 计划

## 目标

落地交易计划页 P0 redesign：通用「新建计划」入口、以计划类型为核心的 tab、统一空状态、增强计划卡片信息密度。

## 步骤清单

- [done] 读取交易计划页实现与数据结构，确认影响范围
- [done] 改造顶部主入口为「新建计划」下拉菜单
- [done] 重命名 tab 为「全部 / 加仓 / 定投 / 卖出 / VIX 信号 / 回测工具」，增加数量角标与下划线选中态
- [done] 统一全部/加仓/定投/卖出的空状态模板
- [done] 增强计划卡片：类型 pill、标的、层数/期数、进度条、下次执行/预计金额
- [done] 运行 focused lint/必要构建校验并检查 diff
- [done] 提交并推送

## 关键决策

- 本轮只做 P0；VIX 温度计、回测应用策略、操作图标直出属于 P1，避免扩大风险。
- 保留现有 hash 入口兼容：`#home/#new/#dca/#sell/#vix/#calc`；新增 `#dca-new/#sell-new` 只用于从「新建计划」进入具体表单。
- 前端发布仍以 GitHub Actions 为准，不强制本机完整 build。

## 待确认项

- 暂无。按用户给定设计直接执行。

## 产出与验证记录

- `src/pages/TradePlansExperience.jsx`：完成交易计划页 P0 redesign，新增顶部 header、通用「新建计划」下拉、下划线 tab、分类列表、统一空状态、增强计划卡片。
- `src/app/tradePlans.js`：补充卡片展示字段，按计划来源去重，支持类型计数与卡片进度展示。
- 验证：`npx eslint src/pages/TradePlansExperience.jsx src/app/tradePlans.js` 通过，0 errors。
