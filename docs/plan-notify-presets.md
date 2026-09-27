# 通知 Tab 预设开关模式

## 背景
用户原声："我设置了邮件，但不会设置触发条件"。通知漏斗断在规则配置这一步。
当前通知 Tab 的"提醒规则"是一张规则表 + "新建规则"（跳去交易计划），要求用户理解规则类型、阈值、标的，心智负担高。

## 方案
把"提醒规则"卡片改成**预设开关模式**：
- 6 个一键预设，每个：图标 + 名称 + 一句话说明（含当前阈值）+ 开关。
- 点行展开微调：阈值步进器、适用范围说明。
- 开关即生效，底层复用现有规则存储（holdingAlerts / marketAlerts / holdingsRule / plan.notify），preset 生成的规则打 `presetId` 标记，开关关闭时整体移除。
- 原规则表退到"高级规则"折叠区，保留按标的细调能力（AlertRuleDialog 不动）。
- worker 侧零改动：预设展开成标准 alert 规则走现有 sync/evaluate 链路。

## 预设清单
| 预设 | 底层映射 | 默认阈值 |
|---|---|---|
| 每日收盘汇总 | holdingsRule（服务端） | — |
| 持仓大涨提醒 | holdingAlerts(alertType=gain) × 持仓标的 | 5% |
| 持仓大跌提醒 | holdingAlerts(alertType=loss) × 持仓标的 | 5% |
| 溢价异常提醒 | holdingAlerts(alertType=premium) × 场内标的 | 8% |
| 定投执行提醒 | dcaPlans[].notify.enabled | 提前 1 天 |
| 交易计划提醒 | tradePlans[].notify.enabled | — |

## 原型
`~/workspace/your_files/notify-preset-prototype.html`（可交互：开关、阈值步进、展开/收起、toast）

## 进展
- [x] 现状调研（NotifyExperience / NotifyRulesCard / alertRules / worker evaluator）
- [x] 可交互原型（用户已确认：按照这个来）
- [x] 实现：notifyPresets 存储+展开层、useNotifyPresets hook、NotifyPresetCard/NotifyPresetSection、NotifyRulesCard 高级模式（title/subtitle/hideHoldingsRow + 预设标记）
- [x] worker：plan/dca 规则支持 notify.enabled（默认开，兼容）；涨跌预设走 holding-alert（需 holdingCost），溢价预设走 market-alert（仅 6 位代码）
- [x] plan.js/dca.js：setAllPlansNotifyEnabled / setAllDcaNotifyEnabled（直接改 store，绕开 serialize 丢 notify 字段的坑）
- [x] 测试：test/notifyPresets.test.mjs（10）+ workers/notify/test/presetNotifyEnabled.test.mjs（5），全过；组件 SSR 渲染冒烟通过
- [x] eslint 0 error、check:refactor 通过、vite build 通过
- [ ] push cn 并验证部署（等用户确认）
