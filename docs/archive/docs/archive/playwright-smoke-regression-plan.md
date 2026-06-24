# Playwright smoke / visual / a11y / Lighthouse 计划

## 目标
- 以最低成本补齐关键路径 Playwright Chromium smoke test。
- 为高风险页面补截图回归入口，覆盖 desktop 1440x900 与 mobile 390x844。
- 建立 @axe-core/playwright 与 Lighthouse CI 的基础健康检查。

## 步骤清单
- done：确认现有测试基础设施：已有 `playwright.config.js`、`tests/e2e/app-smoke.spec.js`、`app-visual.spec.js`、`app-a11y.spec.js`、GitHub Actions acceptance workflow。
- done：扩展第一阶段 Chromium smoke 覆盖行情中心、持仓页、策略指南、通知配置、账户菜单。
- done：扩展第二阶段截图回归覆盖 desktop/mobile 高风险页面。
- done：扩展第三阶段 a11y 与 Lighthouse CI 配置。
- done：做静态检查与可用验证，记录受限项。
- done：检查 git diff，避免纳入无关业务源码改动。

## 关键决策
- 复用现有 Playwright 配置和测试文件，不新建重复测试框架。
- smoke 只跑 Chromium，保持低成本；截图、a11y、Lighthouse 通过 workflow_dispatch full 模式运行。
- 行情中心测试通过 Playwright route mock 关键 `/api/markets/**`、`/api/holdings/nav*`、`/api/notify/**` 接口，降低 CI 对外部服务抖动的依赖。
- 因当前仓库已有未提交行情中心改动，本次只修改测试/CI/计划相关文件，避免覆盖业务源码。
- `?tab=strategyGuide` 当前会安全回落到策略指南页；测试覆盖该入口不崩、指南卡片可打开、移动端无横向溢出。

## 产出
- 新增 `tests/e2e/acceptance-helpers.js`：统一 viewport、网络 mock、行情详情页打开、基金参数切换、通知配置展开等 helper。
- 更新 `tests/e2e/app-smoke.spec.js`：覆盖行情中心 A 股 513100、5 天、净值/溢价图表 SVG；持仓新增交易弹窗；策略指南 `strategyGuide` 入口与移动端 overflow；通知 Android/iOS 链接输入；账户登录入口。
- 更新 `tests/e2e/app-visual.spec.js`：覆盖行情中心详情页、A 股基金参数状态、持仓页、策略指南、通知配置；desktop 1440x900 与 mobile 390x844。
- 更新 `tests/e2e/app-a11y.spec.js`：扩展 axe 检查到 strategyGuide、holdings、markets 详情、notify 配置、账户登录弹窗。
- 新增 `.lighthouserc.cjs`：Lighthouse CI 移动端健康检查，覆盖 markets/holdings/strategyGuide/notify。
- 更新 `.github/workflows/playwright-acceptance.yml`：full 手动工作流增加 Lighthouse CI，并上传 `.lighthouseci` 报告；触发路径纳入 `.lighthouserc.cjs`。

## 验证记录
- passed：`git diff --check`。
- not run：`npm run build:app`、`npm run test:e2e:smoke`、`npm run test:e2e:visual`、`npm run test:e2e:a11y`、Lighthouse CI。本地环境未提供 `node` / `npm`，需在 GitHub Actions 或具备 Node 20 的环境中运行。

## Git 注意事项
- 本次目标变更文件：`.github/workflows/playwright-acceptance.yml`、`.lighthouserc.cjs`、`docs/playwright-smoke-regression-plan.md`、`tests/e2e/acceptance-helpers.js`、`tests/e2e/app-smoke.spec.js`、`tests/e2e/app-visual.spec.js`、`tests/e2e/app-a11y.spec.js`。
- 工作区原有无关 dirty 文件仍存在，未纳入本次修改范围：`docs/market-center-google-finance-comparison-plan.md`、`src/app/marketsApi.js`、`src/pages/MarketsExperience.jsx`。
