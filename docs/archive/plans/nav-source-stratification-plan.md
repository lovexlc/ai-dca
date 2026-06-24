# Phase 1：NAV 来源分层 plan

> 主审计：`docs/data-consistency-audit-plan.md`。
> 用户决策（2026-05-18）：实时态走 `latestNav`，历史/累计图走 `fetchNavHistory`，**接受 T-1 漂移**。Phase 1 的目标不是消除漂移，而是把分层规则**显性化**（代码注释 + UI 感知标记 + 文档），并修掉 SwitchStrategy 离线 NAV 在新代码路径下的过期风险。

## 目标

1. 把"哪条链路用哪套 NAV"写死成文档（代码注释 + `docs/data-glossary.md`）。
2. 给所有可能呈现 T-1 末端的位置加用户可感知的标记（tooltip / 时间戳后缀），避免再发生"持仓页 +X% 但累计图末端比昨天小"的对账困惑。
3. SwitchStrategy 前端统一走 markets Worker 指标，后端信号不再依赖离线净值文件。
4. 添加最小回归用例：navHistoryClient T-1 边界 / latestNav 覆盖逻辑 / SwitchStrategy fallback。

**显式不做**（用户已拍板"接受漂移"）：

- ❌ 不把 latestNav 回灌到 navHistory 序列末端
- ❌ 不强制两路对齐
- ❌ 不改 portfolioSeries 收益算法（归 Phase 2）

## 步骤清单

- [x] step-1：在 `src/app/navHistoryClient.js` 顶部加分层说明注释，明确 `items` 末端语义 = T-1
- [x] step-2：在 `src/app/portfolioSeries.js` 顶部加分层说明注释，明确 `dailySeries` 末端 = 公布单位净值，**不**等于持仓页 KPI 的实时 marketValue
- [x] step-3：IncomeSummary 收益曲线：`useCumulativeSparkline` 返回 `{ series, lastIso }`；IncomeSection 透传 `cumulativeLastIso`；IncomeSummary PC sparkline 下方渲染「截至 YYYY-MM-DD 公布净值」，鼠标悬停有补充 tooltip
- [x] step-4：IncomeDetail 主图（ReturnChart）：ChartTooltip 收 `lastIso` prop，`label === lastIso` 时末行追加「公布单位净值，不含今日实时变动」（已在上一轮 commit 775f975 随 IncomeDetail 交互一同入仓）
- [x] step-5：ReturnCalendar：当前日单元如果用 latestNav 推算盈亏，给单元加 tooltip「实时估算，明日定盘后更新」；如果未推算只显示 0，加 tooltip「今日定盘后更新」
- [x] step-6：SwitchStrategy（`src/pages/SwitchStrategyExperience.jsx` 的 loadNav）：直接调用 `requestHoldingsNav(codes)` 拉取全量 navByCode，与持仓页 KPI 同源
- [x] step-7：建 `docs/data-glossary.md`（最小版）：罗列 `latestNav` / `previousNav` / `navHistory[].nav` / `marketValue` / `pricePulse.changePct` 五个字段的来源、时效、计算口径
- [x] step-8：冒烟验证（降级方案）
  - cf-browser-mcp 在该 SPA 上 hydrate 失败（`evaluate` 报 `Cannot read properties of undefined (reading 'slice')`，`#root` 20s 超时），无法用 UI 截图；改用 **bundle 内容 grep** 作为证据。
  - 部署后从 `https://tools.freebacktrack.tech/react-assets-v2/` 下载各 chunk，命中：
    - `ReturnChart.js`（25303 字节）：`公布` × 1（来自「公布单位净值，不含今日实时变动」）
    - `HoldingsExperience.js`（154647 字节）：`公布` × 2 / `cumulativeLastIso` × 1 / `截至` × 1（IncomeSummary + IncomeSection 被打包进同一 chunk）
    - `HomeExperience.js`（29981 字节）：`截至` × 1
  - 单测改在 Phase 1 收尾后补（不阻塞部署证据闭环）。
- [x] step-9：commit + push + Actions 验证
  - `26e188c feat(income): show T-1 "as of" caption under PC sparkline`（agent push）
  - 用户随后接力提交：`0873d94 fix(income): restore mobile calendar and daily details`、`ea1a86a fix(income): center mobile KPI rates`
  - Actions run `26031843723`（ea1a86a）completed success，job 总耗时 32s（install 7s / vite build 9s / upload 2s / deploy 7s）。
- [x] step-10：四件证据回报
  - commit SHA：`26e188c`（agent push）+ `ea1a86a`（用户最终 HEAD）
  - raw 验证：`raw.githubusercontent.com/lovexlc/ai-dca/ea1a86a.../src/app/income/IncomeSummary.jsx` 含 `公布`×2 / `截至`×1 / `cumulativeLastIso`×3
  - Actions run：<https://github.com/lovexlc/ai-dca/actions/runs/26031843723>
  - Pages HTTP 200 + bundle grep：见上面 step-8 列表

## 关键决策（在 step-2 开工前补 ask-survey 如需）

- 末端 tooltip 文案："截至 YYYY-MM-DD 公布单位净值" vs "末端为 T-1 净值，今日实时见持仓页" → 默认用前者，简洁
- 是否给 IncomeSummary 顶部 KPI（profit / returnRate）也加 T-1 标注？
  - 用户未明确，**暂不加**（KPI 实际是持仓 ledger 计算，不是 navHistory，跟实时持仓一致；只有曲线末端是 T-1）

## 受影响文件清单

- `src/app/navHistoryClient.js`（注释）
- `src/app/portfolioSeries.js`（注释）
- `src/app/income/IncomeSummary.jsx`（末端 tooltip）
- `src/app/income/useCumulativeSparkline.js`（注释 + 末端时间戳暴露）
- `src/app/ReturnChart.jsx`（hover tooltip 末端标记）
- `src/app/ReturnCalendar.jsx`（当前日 tooltip）
- `src/pages/SwitchStrategyExperience.jsx:loadEtfLatestNav`（fallback）
- `docs/data-glossary.md`（新建）

## 验证产出

- 修复前 vs 修复后对账截图：同一时刻打开收益看板 + 持仓页 + SwitchStrategy，三处显示一致或有清晰的 T-1 标记
- Actions run URL
- Pages 部署 HTTP 200
- 关键代码 file:line + commit SHA
