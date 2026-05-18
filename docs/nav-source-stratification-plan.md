# Phase 1：NAV 来源分层 plan

> 主审计：`docs/data-consistency-audit-plan.md`。
> 用户决策（2026-05-18）：实时态走 `latestNav`，历史/累计图走 `fetchNavHistory`，**接受 T-1 漂移**。Phase 1 的目标不是消除漂移，而是把分层规则**显性化**（代码注释 + UI 感知标记 + 文档），并修掉 SwitchStrategy 离线 NAV 在新代码路径下的过期风险。

## 目标

1. 把"哪条链路用哪套 NAV"写死成文档（代码注释 + `docs/data-glossary.md`）。
2. 给所有可能呈现 T-1 末端的位置加用户可感知的标记（tooltip / 时间戳后缀），避免再发生"持仓页 +X% 但累计图末端比昨天小"的对账困惑。
3. SwitchStrategy 离线 `data/<code>/latest-nav.json` 失效时降级到 `/api/holdings/nav`，与主链路同源。
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
- [x] step-6：SwitchStrategy（`src/pages/SwitchStrategyExperience.jsx:loadEtfLatestNav` 调用站点 loadNav）：对 `loadEtfLatestNav` 返回 null 的 code 批量降级调 `requestHoldingsNav(fallbackCodes)`（同 /api/holdings/nav）补齐 navByCode，与持仓页 KPI 同源
- [x] step-7：建 `docs/data-glossary.md`（最小版）：罗列 `latestNav` / `previousNav` / `navHistory[].nav` / `marketValue` / `pricePulse.changePct` 五个字段的来源、时效、计算口径
- [ ] step-8：最小单测 / 冒烟：
  - 单测：mock 交易时段时间，确保 navHistoryClient 末端日期 ≤ T-1
  - 冒烟：cf-browser-mcp 真实跑
    - 收益看板首屏 → 看到末端 tooltip 文案
    - 持仓页 KPI 实时态正常
    - SwitchStrategy 选一只 ETF → 看到 latestNav 与持仓 KPI 同源
- [ ] step-9：commit + push + Actions 验证（src/ 触发 deploy-pages 自动）
- [ ] step-10：回报四件证据：commit SHA / Actions run / Pages HTTP 200 / cf-browser-mcp 截图关键文本

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
