# Income Dashboard v4 plan — 第六刀：子页全屏覆盖 + 5 tile chip 化

> 上下文：v3 第五刀后用户反馈 (1) 进收益子页时下方「基金汇总」表格一直在，不够「全屏覆盖」；(2) 继续按上一轮思路收敛信息密度。

## 目标
- 点 IncomeSummary 5 tile 任意入口 → **整个页面替换为子页**（隐藏「投资组合概览」薄条 + 「基金汇总/已卖出/成交流水」section）。返回 ← 时恢复完整主页。
- 5 tile 由方块格改横向 chip 一行排（进一步降低视觉占面）。

## 切片
### 6.1 HoldingsExperience 顶层 route 判断
- import `{ useIncomeRoute, ROUTES }`
- 顶层调 `const { route: incomeRoute } = useIncomeRoute();`
- `content` 内部根据 route 分两种渲染：
  - `incomeRoute !== ''` → 只渲染外层 wrapper + `<IncomeSection>`
  - `incomeRoute === ''` → 仍然渲染完整主页

### 6.2 IncomeSummary 5 tile chip 化
- `grid grid-cols-5` → `flex flex-wrap gap-2`
- 每个 chip：`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs` icon + label 横排

### 6.3 ESLint 0 error

### 6.4 commit + push + Actions verify
