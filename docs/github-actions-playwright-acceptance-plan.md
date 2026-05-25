# GitHub Actions Playwright 验收计划

## 目标
为 ai-dca 增加 GitHub Actions Playwright 验收能力：默认在 CI 中跑 Chromium 功能 smoke，手动模式可跑截图回归与 axe a11y，符合前端改动使用 Playwright 功能 + 截图 + a11y 的约定。

## 步骤清单
- done：检查现有 package scripts、lockfile、GitHub Actions workflow 与测试目录。
- done：新增 Playwright 配置与测试目录结构。
- done：新增功能 smoke、截图、a11y 验收用例。
- done：新增 GitHub Actions workflow，支持 push / PR / 手动 full 模式。
- done：安装 Playwright 与 axe 依赖声明；本机无 npm，CI 使用 npm install 安装。
- done：执行本地静态检查；本机无 node/npm，Playwright 实跑交给 GitHub Actions。
- done：提交 focused commit。

## 关键决策
- 默认 CI 只跑 Chromium，控制 GitHub Actions 分钟消耗。
- `workflow_dispatch` 提供 `full` 输入；full=true 时额外跑截图与 a11y 验收并上传报告/截图。
- 本地与 CI 都通过 `npm run build:app` 生成 `.frontend-build`，Playwright 使用静态文件服务验收构建产物。
- 后端/API 行为仅放入轻量 smoke；涉及 Worker 的更深验证仍由对应 Worker workflow 负责。

## 待确认项
- 暂无。

## 产出与验证记录
- 新增：`playwright.config.js`
- 新增：`tests/e2e/app-smoke.spec.js`
- 新增：`tests/e2e/app-a11y.spec.js`
- 新增：`.github/workflows/playwright-acceptance.yml`
- 依赖：已在 `package.json` 声明 `@playwright/test` 与 `@axe-core/playwright`；本机 shell 无 npm，未改 package-lock。
- 本地检查：`python3` 校验 package JSON、workflow 关键步骤、测试文件非空，结果 `STATIC_CHECK_OK`。
- 本地限制：当前 MCP 环境无 `node/npm/npx`，无法本地安装浏览器或执行 Playwright；CI workflow 会在 GitHub runner 上安装 Node 20、依赖与 Chromium 后实跑。
- commit SHA：`3596ad8c8b0d8eaa6b4db2aa320dc56781a11592`。
