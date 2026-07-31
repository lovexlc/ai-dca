# AI-DCA（美股策略助手）视觉改版 + 门户首页 实施计划

> 关联设计稿：`personal/网站改版-P0P1高保真设计稿.html`（P0 设计Token / P1 Header与导航 / P2 门户首页 三块画板）
> 视觉参考站：https://data.xiaoyinsi.com/
> 代码仓库：https://github.com/lovexlc/ai-dca（branch: `test`）→ 部署至 test.freebacktrack.tech
> 编写日期：2026-07-30
> 状态：**计划已完整写出，尚有 1 项决策未确认（见第 1 节），确认前不建议动代码**

---

## 0. 前置状态确认

- ✅ commit `6ff9693`（收敛顶栏导航分类）已部署到 test.freebacktrack.tech（用户 2026-07-30 18:05 确认）
- 建议动作：重新在浏览器里验证一次"策略"下拉导航是否已正常展开/跳转。此前（当天 15:44）实测点击"策略"无任何下拉弹出、也不跳转，但拉取 `test` 分支源码核对后发现 `src/components/nav-dropdown.jsx` 的 hover 展开 + 点击切换 + 点外部关闭逻辑是完整的，怀疑当时测的是本次部署之前的旧版本。**本次部署后应重新验证，不要假设它仍然是坏的**，也不要在没验证的情况下重复修复一个可能已经好了的问题。

---


**问题**：新的门户首页（P2，对应设计稿"画板三"）顶替 `markets` 成为新的默认落地页（`src/app/screens.js` 里的 `DEFAULT_WORKSPACE_TAB`）？

- ** 顶替默认**
  - `DEFAULT_WORKSPACE_TAB` 由 `'markets'` 改为 `'portal'`
  - 同步检查 `resolveDefaultWorkspaceTab()`（`src/pages/WorkspacePage.jsx`）里对该常量的引用是否需要跟着变
  - 必须同步更新 `AGENTS.MD` 里"主页默认为行情中心"那条决策记录，写明推翻理由，否则文档和代码会自相矛盾
  - 需要制定至少 7-30 天的数据观察计划（复用项目现有"下次检查日期"机制），验证新首页有没有拉低行情 tab 使用率或造成用户找不到核心功能

> 下面第 4 节"路由接入"里，3 处文件改动两条路径都要做，只有 `DEFAULT_WORKSPACE_TAB` 那一行是路径 B 独有的。

---

## 2. P0 · 设计 Token 替换

### 2.1 品牌色变量

- 文件：`src/styles/app.css`
- 行 99-100：
  ```css
  --brand: #4f46e5;
  --brand-text: #4338ca;
  ```
  改为绿色系（与 data.xiaoyinsi.com 的品牌绿对齐，但要避开撞色，见下方"关键约束"）
- 暗色模式对应块（约行 181-183）同步改：
  ```css
  --brand: #818cf8;
  --brand-text: #a5b4fc;
  --brand-tint: rgba(99, 102, 241, 0.2);
  ```

**关键约束（撞色风险，必须遵守）**：同一份变量表里，`--green-text: #107d32` 已经被 `--market-fall`（跌）占用（第89/113行）。如果品牌绿直接取同一个色值，会导致"品牌色"和"跌"在视觉上完全等同，用户可能把导航高亮误读成下跌提示。落地时：

1. 品牌绿必须选一个和 `--green-text` 有可辨识差异的色值（比如加深或降低饱和度），不能直接复用 `#107d32`
2. 不管选哪个绿，都只允许用在文字链接／图标／导航高亮态，**禁止用作按钮实心背景、状态徽章背景**（这两类场景离价格/涨跌色视觉距离太近）
3. 按钮的"主操作"改用黑色系（见 2.2），不用品牌绿做底色

### 2.2 主按钮改黑底白字

- `src/components/ui/button.jsx` 第11行：
  ```js
  default: "bg-[var(--brand)] text-white hover:bg-[var(--brand-text)]",
  ```
  改为：
  ```js
  default: "bg-[var(--fg-1000)] text-white hover:bg-[var(--fg-900)]",
  ```
- `src/components/experience-ui.jsx` 第7行 `primaryButtonClass`，同样把 `border-[var(--brand)] bg-[var(--brand)]` 改成 `border-[var(--fg-1000)] bg-[var(--fg-1000)]`，hover 态改 `--fg-900`
- 第8-9行 `secondaryButtonClass` / `subtleButtonClass` 的 focus ring（`ring-[var(--brand)]/30`）可以保留引用 `--brand`，因为 focus ring 是细线不是实心块，风险低

### 2.3 硬编码 indigo/violet 类名清理

现状：**55 个文件、242 处**硬编码的 Tailwind `indigo-*`/`violet-*` 类名，完全绕开了 `--brand` 变量，改变量本身不会带动它们变色，需要单独一轮扫描替换。

定位命令：
```
grep -rl "indigo-[0-9]\{2,3\}\|violet-[0-9]\{2,3\}" src --include="*.jsx"
```

按出现次数排序的重点文件（前10）：

| 文件 | 出现次数 |
|---|---|
| `src/components/markets/BacktestSidePanel.jsx` | 19 |
| `src/pages/NewPlanConfigCards.jsx` | 18 |
| `src/pages/switchStrategy/SwitchRuleExperience.jsx` | 17 |
| `src/pages/SwitchStrategyPanels.jsx` | 15 |
| `src/pages/NewPlanSelectionCards.jsx` | 12 |
| `src/components/account-menu.jsx` | 11 |
| `src/pages/holdings/TransactionDraftPanel.jsx` | 10 |
| `src/pages/TradePlansExperience.jsx` | 10 |
| `src/pages/BacktestExperience.jsx` | 9 |
| `src/pages/NewPlanPreviewSidebar.jsx` | 6 |

其余 45 个文件每个 1-6 处不等，包括 `src/pages/holdings/TodaySignalPanel.jsx`、`src/components/data-table/data-table-column-header.jsx`、`src/components/RealTimeSignalCard.jsx`、`src/components/MetricCard.jsx` 等。

替换原则（不是无脑全局替换成绿色）：

- `indigo-*` 用于"强调/选中态"背景或文字（如 `bg-indigo-50 text-indigo-700`）→ 改为中性深色系 `bg-[var(--a-100)] text-[var(--fg-1000)]` 或用 2.1 定的品牌绿文字色（不带底色）
- `indigo-*` 用于图表/标签配色（如 `RealTimeSignalCard.jsx`、`MetricCard.jsx` 的 tone 映射）→ 可保留一个"强调"色位，但换成不撞色的色值
- 不要用一次性全局查找替换处理，因为语义不同（选中态/hover态/图表配色各不相同），需要逐文件确认

### 2.4 圆角/边框规范

已有 token：`--radius-sm: 4px` / `--radius: 6px` / `--radius-lg: 12px` / `--radius-pill: 9999px`（`src/styles/app.css` 第125-128行），和设计稿的 6px/12px/pill 规范已经一致，**不需要新增变量**。只需排查各页面是否有裸写 `rounded-2xl` 等不一致写法，统一收敛，属于低优先级清理项，可放在 P0 收尾一起处理。

---

## 3. P1 · Header 与导航

### 3.1 Header 毛玻璃

- 文件：`src/styles/topbar.css`
- 目标规则块：`.app-header`（第10-17行），当前：
  ```css
  .app-header {
    position: sticky;
    top: 0;
    z-index: 100;
    min-height: var(--app-header-h);
    border-bottom: 1px solid var(--topbar-border);
    background: var(--topbar-bg);
  }
  ```
- 改法：直接照抄同文件里 `.mobile-bottom-nav` 已经在生产验证过的写法（第308-322行）：
  ```css
  background: color-mix(in srgb, var(--bg-100) 90%, transparent);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  backdrop-filter: blur(12px) saturate(140%);
  ```
  用同一套数值，不用重新试参数，风险低。

### 3.2 下拉菜单交互规范化

- 文件：`src/components/nav-dropdown.jsx`
- 现状：第20-29行手写了 `document.addEventListener('pointerdown', ...)` 来实现点外部关闭
- 问题：**违反了 `AGENTS.MD` 里的强制规则**——"所有自定义弹窗、下拉菜单、浮层必须使用 `useClickOutside` Hook"（位置：`src/hooks/useClickOutside.js`）
- 改法：
  ```js
  import { useClickOutside } from '../hooks/useClickOutside.js';
  // ...
  useClickOutside(containerRef, () => setOpen(false), open);
  ```
  删除原来手写的 `useEffect` 监听块。这项改动是消除代码规范违规，不是修复功能 bug——该下拉菜单是否有实际功能问题需要先按第0节重新验证。

### 3.3 移动端底部导航高亮色

- 文件：`src/styles/topbar.css` 第341-344行
- 已经引用 `var(--brand)`，2.1 改完变量后自动联动变色，**这里不用单独改代码**，只需验收时确认视觉效果。

---

## 4. P2 · 门户首页

### 4.1 新增文件

- `src/pages/PortalExperience.jsx`（容器组件）
- 子组件放 `src/pages/portal/`（例如 `PortalHero.jsx`、`PortalTicker.jsx`、`PortalTodaySignal.jsx`、`PortalSideCards.jsx`、`PortalModuleGrid.jsx`），单文件控制在 300 行以内，遵守项目 `check_refactor_guard.mjs` 的 1300 行硬限

> 注：`docs/design/home-redesign.md` 是另一份现存文档，规划的是"加仓计划"页面（`src/pages/HomeExperience.jsx`）的重构，和本计划的门户首页是**完全不同的两个功能**，不要混淆。经核对，该文档提到的 `HomeExperience.jsx`（重构前2002行）在当前 `test` 分支未找到同名文件，可能已被重命名或合并；这不影响本计划，只需注意下面 4.2 节的 tab key 命名即可。

### 4.2 路由接入（3 处文件，两条路径都要做）

1. **`src/app/screens.js`**：
   - `PRIMARY_TAB_META` / `WORKSPACE_TAB_META` 新增：
     ```js
     portal: { label: '首页', hrefKey: 'portal' }
     ```
   - `PRIMARY_TAB_ORDER` 数组开头插入 `'portal'`
   - `createPageLinks()` 函数体新增一行：
     ```js
     portal: `${indexHref}?tab=portal`,
     ```
   - ⚠️ **tab key 不能用 `home`**：`LEGACY_TAB_REDIRECTS.home` 已经占用这个 key，指向"交易计划"里的加仓计划子视图。本计划统一用 `portal` 作为门户首页的 tab key，避免路由冲突。

2. **`src/pages/WorkspacePage.jsx`**：
   - 第69行 `WORKSPACE_VISIBLE_TABS` 数组加入 `'portal'`
   - `renderActivePanel()`（约第492-514行）的 `switch (activeTab)` 增加：
     ```js
     case 'portal':
       return <PortalExperience {...sharedProps} />;
     ```
   - 顶部新增懒加载导入：
     ```js
     const PortalExperience = lazy(() => import('./PortalExperience.jsx').then((m) => ({ default: m.PortalExperience })));
     ```

3. **仅路径 B 需要额外改**：`DEFAULT_WORKSPACE_TAB` 由 `'markets'` 改为 `'portal'`（`src/app/screens.js`），并同步检查 `resolveDefaultWorkspaceTab()`（`src/pages/WorkspacePage.jsx`）里对该常量的引用。

### 4.3 数据接入（全部复用现有实现，不新开重接口）

| 设计稿模块 | 复用的现成数据源 | 文件 |
|---|---|---|
| 今日信号卡 | `useTodaySignals` Hook + `TodaySignalPanel` 展示组件，已实现换仓/出场信号统计、关闭/恢复逻辑 | `src/pages/holdings/useTodaySignals.js`、`src/pages/holdings/TodaySignalPanel.jsx` |
| 行情速览条（S&P Futures / Dow / Nasdaq...） | `useMarketSummaryStrip` Hook，`MarketsExperience.jsx` 已在用 | `src/pages/markets/useMarketSummaryStrip.js` |
| 涨跌幅榜 / 回撤深度榜 | 已有派生字段，取自现成的 watchlist 数据/高点回撤模块 | `src/pages/markets/marketsWatchData.js`、`src/pages/markets/marketHighDrawdown.js` |
| Hero 统计数字（监控基金数/策略数/回测次数/累计信号） | **需要新写一个轻量聚合**，不能拉重接口 | 建议新建 `src/pages/portal/portalStats.js`，本地聚合已加载的 watchlist/plan/backtest 计数，不额外请求 K 线/净值/财报等详情接口（遵守 `AGENTS.md` 的行情接口边界规则） |

### 4.4 需要边做边定的细节（非阻塞）

- Hero 统计数字具体展示哪 5 个指标，是否要精确对应现有埋点分类（行情中心/换基策略/转换分析/持仓总览/交易计划），而不是照抄设计稿里的示意文案
- 今日信号卡在门户首页展示时，是否要复用持仓页那套"关闭/恢复"状态（`aiDcaDismissedTodaySignals_v1` localStorage key），还是门户首页只做只读展示

---

## 5. 验收清单（收尾前必须过一遍，来自项目 `AGENTS.MD` 强制要求）

- [ ] `npm run check:refactor`（依次跑 `check_refactor_guard.mjs` + `check_resources.mjs` + `check_architecture_boundaries.mjs`）
- [ ] `npm run lint -- --quiet`
- [ ] 涉及下拉/弹层改动（3.2节）后跑 `npm run test:e2e:visual`
- [ ] `git diff --check`
- [ ] 根目录零产物自检（不留 `.txt` 总结、截图、空文件）
- [ ] 新增文档统一放 `docs/design/`，命名 `{task}-plan.md`，不要平铺多版本
- [ ] 3 个断点（375/768/1440）肉眼过一遍门户首页布局
- [ ] 涨跌色（红涨绿跌）改动后没有被误动——对照 `--market-rise`/`--market-fall` 两个变量值确认未变

---

## 6. 建议执行顺序

1. 先做 P0（设计 token + indigo 清理），影响面广但风险可控，是后续所有改动的基础
2. 再做 P1（Header 毛玻璃 + 下拉规范化），改动集中在 2 个文件
3. 门户首页路由接入（4.2 节的 3 处文件改动）先做，用占位内容占住路由，验证导航跳转正常
4. 最后做门户首页内容开发（4.1/4.3 节），数据接入分模块逐个验证
5. 每完成一个子任务提交一次 commit，每次改动后跑 `npm run build` 并肉眼过 3 个断点
