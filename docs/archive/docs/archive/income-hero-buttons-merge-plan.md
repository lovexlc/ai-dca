# 收益看板 hero 行 A.1 落地：4 入口 pill + 右侧 复制表格/+新增交易

## 目标

PC 端：IncomeSummary 4 入口 grid tile 改为 inline pill chip + 同行右侧合并 复制表格 / +新增交易。
移动端：4 入口 grid tile 保持 v7.0。
清除 IncomeSection 主表 section L2690-L2718 hidden sm:flex header（合并后留下的 padding strip）。

## 步骤

- [ ] 1. IncomeSummary.jsx 加 quickActions prop
- [ ] 2. IncomeSummary.jsx PC 端 nav 改成 flex justify-between · 巧 4 pill / 右 2 actions
- [ ] 3. IncomeSection.jsx 透传 quickActions
- [ ] 4. HoldingsExperience.jsx L2671 调用 IncomeSection 加 quickActions
- [ ] 5. HoldingsExperience.jsx 删除 L2690-L2718 header
- [ ] 6. cf-browser-mcp 验证 + Actions deploy
