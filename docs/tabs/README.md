# Tab 文档索引

本目录下每个文件对应 `WorkspacePage` 左侧菜单的一个一级 tab，结构来自 `src/pages/WorkspacePage.jsx` 中的 `WORKSPACE_TITLES`。

| Tab key | 标题 | 入口组件 | 文档 |
|---|---|---|---|
| `holdings` | 持仓总览（默认页） | `src/pages/HoldingsExperience.jsx` | [holdings.md](./holdings.md) |
| `tradePlans` | 交易计划中心 | `src/pages/TradePlansExperience.jsx` | [trade-plans.md](./trade-plans.md) |
| `fundSwitch` | 基金切换收益分析 | `src/pages/FundSwitchExperience.jsx` | [fund-switch.md](./fund-switch.md) |
| `history` | 交易历史 | `src/pages/HistoryExperience.jsx` | [history.md](./history.md) |
| `notify` | 通知设置 | `src/pages/NotifyExperience.jsx` | [notify.md](./notify.md) |
| `backup` | 数据同步/备份 | `src/pages/BackupExperience.jsx` | [backup.md](./backup.md) |

## 编排原则

- 所有 tab 的视觉 primitives 共用 `src/components/experience-ui.jsx` 导出的 `Card / Pill / SectionHeading / StatCard / primaryButtonClass / secondaryButtonClass / cx`。
- 多数业务状态走浏览器 `localStorage`；和后端的双向通道集中在 `notify-worker`（`https://tools.freebacktrack.tech`）和 `ocr-proxy` worker 上。
- 切换 tab 时仍使用 React 内部状态 + URL hash（`tradePlans` 用 `#list/#home/#dca/#switch/#new`，`fundSwitch` 用 `#doc-<id>`），不会 reload 页面。
- 默认主 tab 在 `WorkspacePage` 中固定为 `holdings`。
- AI 助手悬浮按钮 (`src/components/ai-chat/ai-chat-widget.jsx`) 不属于任何 tab，但在所有 tab 都可见。

## 同步策略

本目录中的所有 `*.md` 都被 `.github/workflows/build-knowledge-base.yml` 的 `paths: ['README.md', 'docs/**', 'workers/README.md', 'AGENTS.MD']` 监听；任意一次 push 都会触发 `Build AI knowledge base` 把内容向量化写入 Cloudflare Vectorize 索引 `ai-dca-kb`，AI 助手立刻可以基于最新文档回答。
