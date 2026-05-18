# PC 端 IncomeSummary hero 布局方案

## 目标

现状 PC 端单卡 hero 纵向拉得太长（总市值/sparkline/3 列 KPI/4 入口/底部按钮，5 行堆叠）。需要在 sm↑ 视口压缩纵向占用，移动端布局保持不变（v7.0 已 ok）。

## 4 个候选方案

### A. 横向 stat-bar（左金额 · 中 sparkline · 右 3 KPI 一行）
左：总市值 + 起算日 / 中：sparkline 大尺寸 200×56 / 右：3 列 KPI 紧凑。
参考：Robinhood / Wealthfront web。
优：信息密度最高，一行解决；劣：移动端无法套用（已自然分离）。

### B. 单行紧凑 stat-bar（金额 + 4 KPI 一行 · sparkline 浮于底部 1px 高度区）
极薄设计：所有数字横排在 80px 高度内，下方仅留 12px sparkline 作为装饰条。
参考：Linear dashboard top bar。
优：最瘦；劣：sparkline 几乎丢失。

### C. 左主右辅 2 列（左 60% 金额+sparkline · 右 40% 3 KPI 竖排）
左大 hero（金额大字 + sparkline）/ 右 3 列 KPI 改为 1 列 3 行。
参考：Mint / Personal Capital。
优：金额仍是焦点，sparkline 保留；劣：右侧 1×3 KPI 也占垂直空间。

### D. 4 宫格扁平 grid（总市值 / 今日 / 持有 / 累计 平权 1×4）
金额从 hero 降级为 grid cell 之一，去掉 sparkline，纯数据展示。
参考：Stripe dashboard。
优：最简洁；劣：总市值视觉重心丢失，与移动端单卡 hero 风格脱节。

## 步骤

- [done] step-1 设计 4 个方案
- [done] step-2 写 standalone HTML demo（public/income-hero-demos.html）
- [done] step-3 commit + push + Actions success
- [done] step-4 验 Pages last-modified 推进
- [todo] step-5 用户访问 demo URL 选择
- [todo] step-6 落地选中方案到 IncomeSummary.jsx

## 验证证据（填入）

- commit: 
- Actions run: 
- Pages lm: 
- Demo URL: https://tools.freebacktrack.tech/income-hero-demos.html
