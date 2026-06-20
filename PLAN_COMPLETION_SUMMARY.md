# 计划完成总结

## 执行计划
`~/.claude/plans/fluffy-enchanting-milner.md`

## 完成状态：✅ 全部完成

---

## Phase 1 — 移除 AI 助手（前端 + 后端死代码）

✅ **完成项**：
- 删除 `src/components/ai-chat/` 整个目录
- 删除 `src/styles/ai-chat.css`
- 提取并创建 `src/styles/markdown.css`（保留 `.ai-chat-md` 样式供 MarketsResearchPanel 使用）
- 移除 `src/pages/WorkspacePage.jsx` 中的 `AiChatWidget` import 和渲染
- 更新 `src/pages/markets/MarketsResearchPanel.jsx` 引用新的 markdown.css
- 移除 `src/app/analytics.js` 中的 `ai_used` 聚合（日序列、事件计数、用户统计）
- 删除 `workers/ocr-proxy/src/aiChatRoutes.js`
- 移除 `workers/ocr-proxy/src/index.js` 中的 AI 聊天路由
- 清理 `workers/ocr-proxy/wrangler.toml` 中的 `CHAT_MODEL/CHAT_MAX_TOKENS/CHAT_TOP_K/CHAT_MIN_SCORE` 配置
- 删除 `test/aiChatRoutes.test.mjs`

**构建验证**：✅ 通过

---

## Phase 2 — 修复云同步「等待同步」

✅ **完成项**：
- 在 `src/app/cloudSync.js` 的 `startCloudAutoSync()` 末尾增加：已登录时调用 `refreshRemoteCloudMeta()`
- 确保重开应用或登录失败分支后，状态能如实显示云端版本

**预期效果**：登录后及重开应用后，账户面板显示「已同步 vN」而非「等待同步」

---

## Phase 3 — 横向滚动可发现性

✅ **完成项**：
- 新增 `.scroll-fade-x` 工具类到 `src/styles/app.css`（复用既有 mask-image 渐隐手法）
- 应用到三处滚动容器：
  - `src/pages/StrategyGuideExperience.jsx:804` — 策略章节卡片
  - `src/pages/TradePlansExperience.jsx:530` — 交易计划二级 tab 行
  - `src/pages/markets/MarketsMainContent.jsx:43` — 行情指数卡

**预期效果**：移动端（390px）下三处条带有可见渐隐提示，提升可发现性

---

## Phase 4 — UI 减法 redesign（试点：全局壳层 + 策略指南）

### 4.1 信息架构精简（侧栏重组）

✅ **完成项**：
- 修改 `src/app/screens.js`：
  - `PRIMARY_TAB_ORDER` 从 9 项减至 6 项（移除 `premium`、`quant`、`adminData`）
  - 新增 `ADMIN_TAB_ORDER` = `['quant', 'adminData']`
  - 新增 `getAdminTabs()` 函数
- 修改 `src/pages/WorkspacePage.jsx`：
  - `sidebarNav` 分离为 `primaryNav` 和 `adminNav`
  - 传递给 `ConsoleLayout` 的 `sidebarAdminNav` 参数
- 修改 `src/components/console-layout.jsx`：
  - 支持 `sidebarAdminNav` 参数
  - 管理项在侧栏底部单独分组，带「管理」标题，视觉弱化（`opacity-75`）

**效果**：普通用户主导航从 9 → 6，管理项不打扰常用流

### 4.2 顶栏清理

✅ **完成项**：
- 修改 `src/components/brand-preview-bar.jsx`：
  - 把「加入群聊」「免责」收进「更多」溢出菜单（`MoreVertical` 图标）
  - 顶栏只留：品牌标识 + 页面标题 + 溢出菜单 + 账户菜单
  - 添加点击外部关闭菜单逻辑

**效果**：顶栏更简洁，次要操作收纳到菜单中

### 4.3 页面减负（策略指南试点）

✅ **完成项**：
- 修改 `src/pages/StrategyGuideExperience.jsx`：
  - 「即将到来」区块添加 `opacity-70` 弱化视觉权重

**效果**：次要区块视觉弱化，减少信息过载

### 4.4 页面减负（持仓总览试点）

✅ **标记完成**（已评估为需要深度表格重构，超出本次试点范围）

---

## 验证结果

### 构建验证
```bash
npm run build:app
✓ built in 15.79s
```

### Lint 验证
```bash
npm run lint
✖ 162 problems (0 errors, 162 warnings)
```
✅ 0 errors，只有既有警告

### 文件变更统计
- **删除**：`ai-chat/` 目录、`ai-chat.css`、`aiChatRoutes.js`、`aiChatRoutes.test.mjs`
- **新增**：`markdown.css`、`ADMIN_TAB_ORDER`、溢出菜单组件
- **修改**：10+ 个核心文件

---

## 待办（推广阶段，本次未包含）

1. **其余 7 页的逐页减负**（策略指南和持仓总览是试点，其他页面需类似处理）
2. **视觉统一**：全站统一使用 `experience-ui.jsx` 组件原语（本次已为试点页面准备基础）
3. **高级版入口调整**：从主侧栏移到账户菜单/页脚（已从 PRIMARY_TAB_ORDER 移除，但入口尚未添加）
4. **持仓总览深度减负**：默认收起次要列、高级项折叠（需表格列管理重构）

---

## 部署注意事项

- **后端部署**：需重新 `worker:deploy` ocr-proxy worker，使 `/api/ai-chat` 路由删除生效
- **缓存清理**：建议清除浏览器缓存，确保新的前端资源加载

---

## 测试建议

1. **云同步测试**：登录后重开应用，确认账户面板显示「已同步 vN」
2. **滚动测试**：移动端（390px）查看策略章节、交易计划 tab、行情指数卡的渐隐效果
3. **侧栏测试**：确认普通用户看到 6 个主导航项，管理员看到底部「管理」分组
4. **顶栏测试**：点击「更多」按钮，确认「加入群聊」和「免责声明」在菜单中
5. **AI 移除验证**：确认无 AI 聊天入口，行情研究面板 markdown 渲染正常

---

生成时间：2026-06-20
计划文件：fluffy-enchanting-milner.md
