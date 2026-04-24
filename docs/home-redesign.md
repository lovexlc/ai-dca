# 加仓计划（HomeExperience）重构设计文档

> Status: draft v1 · 2026-04-24
> Owner: dudu · Target: `src/pages/HomeExperience.jsx`

---

## 0. 本文档目的

现在的 `src/pages/HomeExperience.jsx` 2002 行，移动端/桌面端几乎整页复制两份，信息层级混乱，截图中的几张卡（策略选择、4 张 StatCard、建仓计划详情表）挤在同一屏顶部。

这篇文档给出一个**以开源仪表盘模板为参考**的新结构，并落成一份可直接照着写代码的组件清单 + 交互规格。

---

## 1. 参考来源（均为可自由复用的开源项目）

| 用途 | 项目 | 协议 | 参考链接 |
|---|---|---|---|
| 整体页面骨架 + KPI 卡片网格 | **Tremor Dashboard Template (OSS)** | Apache 2.0 | https://dashboard.tremor.so/overview · https://github.com/tremorlabs/template-dashboard-oss |
| 侧栏导航 + 命令面板范式 | **shadcn/ui dashboard example** | MIT | https://ui.shadcn.com/examples/dashboard |
| KPI Card / Delta Badge / Tracker 等图形元件 | Tremor React components | Apache 2.0 | https://tremor.so/components |

**实施约定：**

- 任何**文件级**直接 fork 自 Tremor/shadcn 的模块，在文件头加注释：`// Adapted from tremorlabs/template-dashboard-oss (Apache-2.0)` 并附原仓库 URL。
- **不**引入 Tremor NPM 包，避免再加依赖。保留现有 Tailwind + 自制 `experience-ui.jsx` 组件，只在视觉层向 Tremor/shadcn 对齐。
- **不**复制 Linear.app、Vercel、Stripe 任何专有站点的代码或素材；它们只是视觉方向参考。

---

## 2. 设计语言

对齐 Linear / Vercel / shadcn 那一派：

- 背景底色：`bg-white`（内容区）/ `bg-slate-50`（页面 shell）
- 卡片：`rounded-xl border border-slate-200 bg-white`，阴影最多一层 `shadow-sm`，不要彩色渐变卡
- 分隔线：`border-slate-200` / `divide-slate-100`，比当前更细更克制
- 字号尺度：KPI 数字 `text-2xl font-semibold tabular-nums`，卡片标题 `text-sm font-medium text-slate-900`，元信息 `text-xs text-slate-500`
- 不要 uppercase tracking，不要彩色胶囊堆叠；状态用**单色 dot + 文字**（`● 未触发` / `● 已完成`）
- 极限克制动效：只保留 `transition-colors` / `hover:bg-slate-50`，不要 hover scale / shadow pop
- 暗色模式**本期不做**，只做浅色；类名结构为后续加 `dark:` 前缀留好位置

---

## 3. 新信息架构（IA）

```
┌─ PageShell (已存在) ───────────────────────────────────────────────┐
│ TopBar (已存在，不改动)                                            │
├────────────────────────────────────────────────────────────────────┤
│ ┌─ PlanBar ─────────────────────────────────────────────────────┐ │
│ │ 策略切换下拉 + 当前标的/基准简述 + [新建策略] [测试通知]        │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ ┌─ KpiRow (4 列，桌面 grid-cols-4 / 平板 2 / 手机 1) ─────────────┐ │
│ │ 可投入预算 │ 预留现金 │ 下一触发价 │ 估算均价                 │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ ┌─ MainGrid (lg: 5fr / 3fr，md/sm: 单列) ────────────────────────┐ │
│ │ ┌─ PlanDetailCard（左，主区）─────────┐ ┌─ PriceChartCard (右) ┐│ │
│ │ │ 表格：批次/状态/信号/价格/跌幅/金额 │ │ 迷你图 + Timeframe   ││ │
│ │ │ 顶部：basemeta row (基准/标的/高点) │ │                      ││ │
│ │ └───────────────────────────────────┘ └──────────────────────┘│ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ ┌─ SecondaryGrid (lg: 2 列) ─────────────────────────────────────┐ │
│ │ ┌─ CapitalModelCard ──────────┐ ┌─ StrategyListCard ─────────┐│ │
│ │ │ 资金配置 8 档条形图           │ │ 已创建策略列表 + 测试通知  ││ │
│ │ └─────────────────────────────┘ └────────────────────────────┘│ │
│ └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

**关键取舍：**

1. **把"当前执行策略" Hero 卡降级成一行 `PlanBar`**。现在它占大半屏幕，但信息量其实只值一行。
2. **StatCard 移到 KpiRow 作为页面第一视觉区块**（不再被策略卡挤到下面）。这是 Tremor/shadcn dashboard 都在用的 KPI-first 范式。
3. **建仓计划详情上升为主视觉**（MainGrid 左 5/8 宽），**价格走势图改为侧栏（右 3/8 宽）**并显著变小（从 `h-[560px]` 改到 `h-[320px]`），因为这页核心是"我下一档买什么"而不是"K线解读"。
4. **策略列表沉到次要区域**（SecondaryGrid 右）：它是切换器不是主内容。
5. **资金配置模型桌面端补全**（目前桌面端几乎空着，IA 里把它放回 SecondaryGrid 左）。
6. **彻底删掉整段移动端 `MobileFoldSection` 复制**。新版用 Tailwind responsive 类在同一套 JSX 内完成：
   - `< md`：所有区块纵向单列；`PlanDetailCard` 的表格在 `< md` 下自动降级为卡片列表（复用现有的 `md:hidden` 档位卡设计，保留但迁入子组件）
   - `md-lg`：KpiRow 2 列，MainGrid 单列
   - `>= lg`：如上图

---

## 4. 组件拆分（落地到文件）

从 `HomeExperience.jsx` 拆出来的新文件，都放到 `src/pages/home/`：

| 新文件 | 职责 | 输入 props |
|---|---|---|
| `src/pages/home/PlanBar.jsx` | 策略切换 + 基础元信息 + 主操作按钮 | `planList, planState, onSelectPlan, onCreatePlan, onTestNotify` |
| `src/pages/home/KpiRow.jsx` | 4 张 KPI StatCard | `strategyPlan, selectedStrategy, reserveRatio, isBelowRiskControl, isBelowPeakExtreme, benchmarkCodeLabel, selectedFundCodeLabel, strategyDisplayCurrency, nextBuyPrice, nextTriggerLayer` |
| `src/pages/home/PlanDetailCard.jsx` | 建仓计划详情：meta row + 表格（桌面）/ 卡片列表（手机） | `executionLayers, selectedStrategy, strategyDisplayCurrency, displayStageHighPrice, displayTriggerPrice, displayRiskControlPrice, strategyDisplayCurrentPrice, completedLayerCount, benchmarkCodeLabel, selectedFundCodeLabel` |
| `src/pages/home/PriceChartCard.jsx` | 迷你 K 线 + Timeframe + MA 对照 | `pricePulse, chartGeometry, timeframe, setTimeframe, activeBar, activeMa120, activeMa200, selectedFund, selectedFundCurrency, ...` |
| `src/pages/home/CapitalModelCard.jsx` | 资金配置 8 档条形图 | `strategyPlan, selectedStrategy, strategyDisplayCurrency` |
| `src/pages/home/StrategyListCard.jsx` | 策略列表 + 测试通知 + 新建入口 | `planList, planState, testingPlanId, handleSelectPlan, handlePlanTestNotify, planTestNotice, planTestError, links` |
| `src/pages/home/helpers.js` | 搬出原文件 1–285 行里的图表几何、bars、MA 管道 | （纯函数） |

重构后 `HomeExperience.jsx` 只保留：
- 所有 `useState` / `useEffect` / `useMemo`（状态中枢）
- 顶层 return：`<PageShell><TopBar /><PlanBar /><KpiRow /><MainGrid /><SecondaryGrid /></PageShell>`

预期行数：`HomeExperience.jsx` ~700 行（纯容器），每个子组件 80–250 行。

---

## 5. 组件细节（逐个给骨架）

### 5.1 PlanBar（替换当前行 1032 Hero 卡 + 行 1525 策略卡）

视觉：一行高度约 56px 的横条，左边 `SelectField` 切换策略（下拉里列出 planList 名字），右边 2–3 个按钮。

```
┌─────────────────────────────────────────────────────────────────┐
│ [策略 ▾ nqsdqa 固定回撤] · 标的 nas-daq100 · 基准 nas-daq100 │
│                                     [测试通知] [+ 新建策略]    │
└─────────────────────────────────────────────────────────────────┘
```

Tailwind 骨架：
```jsx
<div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
  <div className="flex min-w-0 items-center gap-3">
    <SelectField value={planState.id} options={planList.map(p => ({ value: p.id, label: p.name }))} onChange={onSelectPlan} />
    <div className="hidden text-xs text-slate-500 md:flex md:items-center md:gap-3">
      <span>标的 {selectedFundCodeLabel}</span>
      <span className="h-3 w-px bg-slate-200" />
      <span>基准 {benchmarkCodeLabel}</span>
    </div>
  </div>
  <div className="flex items-center gap-2">
    <button className={subtleButtonClass} onClick={() => onTestNotify(planState)}>测试通知</button>
    <a className={primaryButtonClass} href={links.accumNew}><Plus className="h-4 w-4" /> 新建策略</a>
  </div>
</div>
```

### 5.2 KpiRow（替换当前 行 1632 的 4 StatCard 网格）

参考 Tremor 的 `Card + Metric + BadgeDelta + BarChartSmall` 组合，但我们用自己的 `StatCard`。

```jsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <StatCard label="可投入预算" value={formatCurrency(strategyPlan.investableCapital)} hint="按策略分配" progress={100 - reserveRatio} />
  <StatCard label="预留现金"   value={formatCurrency(strategyPlan.reserveCapital)}   hint={reserveHint} />
  <StatCard label="下一触发价" value={formatFundPrice(nextBuyPrice, strategyDisplayCurrency)} hint={nextTriggerHint} />
  <StatCard label="估算均价"   value={formatFundPrice(displayStrategyPlan.averageCost, strategyDisplayCurrency)} hint={`${benchmarkCodeLabel} 映射`} accent="emerald" />
</div>
```

StatCard 视觉迭代（需同步改 `experience-ui.jsx`）：
- 移除 `uppercase tracking-[0.18em]` 的 eyebrow，改成 `text-xs text-slate-500` 普通 label
- 数字用 `text-2xl font-semibold tabular-nums`
- hint 行 `text-xs text-slate-500`，最多两行，溢出 `line-clamp-2`
- 移除彩色 accent 渐变背景，改为**左侧 2px 色条**（`border-l-2 border-indigo-500`）作为 accent 指示

### 5.3 PlanDetailCard（替换行 1647）

保留现有 executionLayers 表格结构，但视觉对齐 Tremor 的 `Table`：
- 表头 `bg-white border-b border-slate-200 text-xs font-medium text-slate-500`，不要 `bg-slate-50`
- 行分隔用 `divide-y divide-slate-100`
- 状态列从 `Pill` 换成 **dot + label**：`● 已完成`（emerald-500）/ `● 下一档`（indigo-500）/ `● 待触发`（slate-300）
- "当前标的现价 / 已完成 0/8 档 / 阶段高点" 不再全是 Pill，改为**右上 meta row**：
  ```
  标题：建仓计划详情                          当前 $26,937 · 0/8 档 · 峰 $26,942
  ```
- 手机视图（`md:hidden`）保留现有档位卡布局，但去掉彩色背景，改成白卡 + 左侧 2px 色条

### 5.4 PriceChartCard（简化版）

从 `h-[480px] md:h-[560px]` 改到 `h-[280px] lg:h-[320px]`。取消"走势监测 + MA 面板"横排，改为图下方一行紧凑 legend（code · close · Δ%）。Timeframe 切换保留 pill tabs 样式但去掉 shadow。

### 5.5 CapitalModelCard

现在的 8 档彩色渐变条形图视觉冲突太强，降级为**水平条形图（类似 Tremor `<BarList>`）**：
- 每档一行：`label | [████████] | amount`
- 条形用 `bg-slate-900/10`（非触发）/ `bg-indigo-500/70`（下一档）/ `bg-emerald-500/70`（已完成）单色
- 宽度 = 权重 / max(权重) × 100%

### 5.6 StrategyListCard

保留行 1559 现有结构，但：
- 去掉 `bg-indigo-50 shadow-indigo-100` 当前项高亮，改为 `border-slate-900`（深色细边）
- 每项之间用 `divide-y divide-slate-100`，不再每项独立卡片
- `Pill tone="emerald"` 当前查看 → 改成一个小 dot + "当前" 文字

---

## 6. 响应式断点规则

| 断点 | PlanBar | KpiRow | MainGrid | SecondaryGrid |
|---|---|---|---|---|
| `< sm` (< 640) | 纵向，按钮全宽 | 1 列 | 单列，图表在表格下方 | 单列 |
| `sm - md` | 同上 | 2 列 | 同上 | 单列 |
| `md - lg` | 横向 | 2 列 | 单列 | 2 列 |
| `>= lg` | 横向 | 4 列 | `grid-cols-[5fr_3fr]` | 2 列 |

表格在 `< md` 自动切卡片列表（复用现有 `md:hidden` / `hidden md:block` 二选一模式，但不再重复整块 JSX，而是放到 `PlanDetailCard` 内部）。

---

## 7. 交互变化（相对现在）

1. **策略切换**：从"列表里点击每一项"改为顶部下拉选择（`PlanBar` 的 SelectField）。策略列表卡只保留"只读浏览 + 测试通知"，不再承担切换职责（避免两处都能切换）。
2. **测试通知**：主按钮移到 `PlanBar` 针对当前策略；列表里的按钮作为次要入口。
3. **移动端折叠**：废弃 `MobileFoldSection` 折叠范式。所有区块默认全展开，靠纵向滚动阅读。只保留 KpiRow 在 `< md` 时 2 列（更紧凑）。
4. **图表点击 bar 高亮**：保留 `activeBarId` 逻辑。
5. **watchlist 增删**：现在散落在多处，合并到 `PriceChartCard` 的 header，点击 code chip 右侧 x 删除，加号菜单增加。

---

## 8. 实施步骤（执行顺序）

1. **[chore]** 新建 `src/pages/home/` 目录，搬出 `helpers.js`（纯函数，零风险），跑 `npm run build` 确认无回归 → commit `refactor(home): extract chart helpers into src/pages/home/helpers.js`
2. **[refactor]** 拆 `CapitalModelCard.jsx` + `StrategyListCard.jsx`（叶子组件，无内部状态）→ commit
3. **[refactor]** 拆 `PriceChartCard.jsx`（含 timeframe state 下放）→ commit
4. **[refactor]** 拆 `PlanDetailCard.jsx` → commit
5. **[refactor]** 拆 `KpiRow.jsx` + 新建 `PlanBar.jsx`，删除旧 Hero 卡和 `MobileFoldSection` → commit
6. **[feat]** 按第 2 节设计语言刷新 `experience-ui.jsx` 的 `StatCard` / `SectionHeading` / `Pill` 样式 → commit
7. **[refactor]** 移除整段移动端复制 JSX，合并为单套响应式 → commit
8. **[docs]** 更新 `AGENTS.MD` / `README.md` 里提到首页的部分（如果有）

每一步之间跑 `npm run build` + 肉眼过 3 个断点（375 / 768 / 1440）。

---

## 9. 验收清单

- [ ] 页面 3 个断点布局正确，无水平滚动
- [ ] 4 张 KPI 数字与重构前完全一致（同一 `strategyPlan` 输入）
- [ ] 建仓计划表格列顺序/数值/状态标签与重构前一致
- [ ] 策略切换、测试通知、新建策略跳转均功能不变
- [ ] 图表 timeframe 切换、candle 点击高亮、MA 线条不变
- [ ] `HomeExperience.jsx` 行数 <= 800；`src/pages/home/*` 单文件 <= 300
- [ ] 无 `eslint` 新增 error
- [ ] 视觉上去掉了所有 uppercase tracking / 渐变 hero / 彩色 Pill 堆叠

---

## 10. dudu 确认的设计决策（2026-04-24）

| 问题 | 决策 | 对设计的影响 |
|---|---|---|
| PlanBar 策略切换形态 | **tabs 平铺**（3 条策略） | >= md 平铺 pill tabs；< md 横向滚动 pill 组 |
| 资金配置模型卡 | **删除** | `CapitalModelCard` 不再拆，直接删；SecondaryGrid 变单列，只放 StrategyListCard；PlanDetailCard 横跨到全宽 |
| 暗色模式 | **不做** | 不为 `dark:` 预留类名，保持纯浅色样式 |
| 测试通知按钮 | **只留 PlanBar** | StrategyListCard 每项不再带按钮，只负责点击切换；PlanBar 的按钮针对当前选中策略 |

### 因此调整的 IA

```
PageShell
  TopBar
  PlanBar                    ── tabs + [测试通知] [+ 新建策略]
  KpiRow (4 列)
  PlanDetailCard (全宽)       ── 以前在 MainGrid 左，现在独占一行
  MiniChartCard (全宽或半宽) ── 原价格走势图，高度 h-[280px]
  StrategyListCard (半宽)     ── 单独一行或与 MiniChart 左右并列
```

> 更新后的最终耦合：教不严格分 MainGrid / SecondaryGrid，以 stack 为主。细节见第 5 节更新。
