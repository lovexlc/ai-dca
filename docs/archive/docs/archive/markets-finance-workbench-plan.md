# 行情中心金融工作台剩余功能计划

## 目标
完成行情中心参考 Google Finance 信息层级后的剩余功能：P3 详情 tab（概览/财报/财务）、P4 右侧研究助手、P5 交互细节、P6 视觉规范统一。

## 步骤清单
- [done] Probe：定位 markets worker、API client、行情中心 React 组件、样式与发布链路。
- [done] P3 后端：为 markets worker 增加 `/financials/:symbol`，拉取 Yahoo quoteSummary 的损益表、资产负债表、现金流量并归一化。
- [done] P3 前端：实现财务二级 tab、季度/年度切换、柱状图 + 固定指标列表格。
- [done] P4 前端：重做右侧研究助手为常驻上下文面板，3 个推荐问题 chip、输入框、普通/深度 pill，自动注入当前标的上下文。
- [done] P5/P6：统一浮层关闭、skeleton、键盘可用性、圆角 8-12、tabular-nums、去重阴影、卡片层级一致。
- [done] 验证：worker 接口 smoke、前端构建/发布、浏览器查看行情中心核心路径，最后 git diff/status 并提交。

## 关键决策
- P0/P1/P2 已按用户描述完成，本轮不重做已完成能力，只补齐剩余功能并统一细节。
- Worker 部署不在本机跑 wrangler deploy；本轮先实现与本地 smoke，部署证据如需上线按 GitHub Actions 链路补。
- 前端发布必须同步 `docs/` 产物；若执行 `npm run build` 资源不足，再记录失败证据并采用最小可行发布路径。

## 待确认项
- 暂无；按用户要求直接实现剩余功能。

## 产出与验证记录
- 2026-05-22：创建计划，开始代码定位。

- 2026-05-22：后端/API/前端主体实现：`/financials/:symbol`、财务 tab、研究助手、浮层 Esc/skeleton/表格固定列。

- 2026-05-22：验证：`npx eslint src/pages/MarketsExperience.jsx src/app/marketsApi.js` 通过（仅历史 warning），`node --check` 通过，`/financials/INVALID@@@` 返回 400，`/financials/600000` 返回空财务结构 200，`/sectors?market=us` 路由正常。
- 2026-05-22：完整 `npm run build` 在本地 Vite 阶段超过 5 分钟无输出且占用较高内存，已取消；未执行本地 wrangler deploy，按仓库约定仍需通过 GitHub Actions 发布链路验证上线产物。
