# 行情监控列表选中联动计划

## 目标
- 点击左侧「监控列表」里的任一标的后，中间主内容更新为该标的详情。
- 中间详情区域提供类似 Google Finance 的标的 tab。
- 右侧「研究」面板同步展示当前选中的标的，并提供针对该标的的快捷问题。

## 步骤清单
- [done] 定位行情页左侧监控列表、主内容、右侧研究面板的数据流。
- [done] 增加当前选中标的状态与详情 tab 状态。
- [done] 将 PC / App 左侧监控列表行改为可点击，并增加选中态。
- [done] 在主内容区插入选中标的详情与 tab。
- [done] 让右侧研究面板显示当前标的上下文与标的快捷问题。
- [done] 运行前端静态检查和 diff 检查。
- [done] 提交、推送，并等待 GitHub Pages 部署。

## 关键决策
- 点击整行只负责选中标的与同步右侧研究上下文；不会自动发起 AI 请求，避免误触消耗。
- 原有行内「AI 分析」按钮仍保留，点击它才自动发起深度分析。
- 中间详情先复用当前已有 quote / sparkline / 新闻 / 财报数据，避免引入新的后端接口风险。

## 待确认项
- 如果后续需要完整财务、财报、估值 tab，可再接入 profile / financials 接口。

## 产出与验证记录
- 已修改 `src/pages/MarketsExperience.jsx`：左侧监控列表行支持点击选中，PC / App 均有选中态。
- 已增加当前标的详情卡与 `概览 / 动态 / 财报` tab。
- 已让右侧研究面板显示当前标的，并将快捷问题切换为该标的上下文。
- `npx eslint src/pages/MarketsExperience.jsx`：通过，0 errors，仅保留既有 warnings。
- `git diff --check -- src/pages/MarketsExperience.jsx docs/markets-watchlist-selection-plan.md`：通过。

- GitHub Pages 部署成功：`https://github.com/lovexlc/ai-dca/actions/runs/26224235812`。
- Commit：`b0e96a1 fix(markets): link watchlist selection to research`。


## 交互修正：未点击保留原内容，点击后全页切换
- 用户反馈：未点击左侧监控列表时应保持原市场页内容；点击后中间区域要完全覆盖为标的详情，而不是叠加在原内容上方。
- [done] 取消默认自动选中第一个监控标的。
- [done] 仅当用户点击监控列表标的后渲染标的详情页。
- [done] 标的详情页出现时隐藏原指数、市场概况、新闻、财报模块。
- [done] 在标的详情页顶部增加“首页”返回入口，清空选中标的并恢复原市场页内容。
- 验证：`npx eslint src/pages/MarketsExperience.jsx` 通过，0 errors，22 个既有 warnings。
- 验证：`git diff --check -- src/pages/MarketsExperience.jsx docs/markets-watchlist-selection-plan.md` 通过。
