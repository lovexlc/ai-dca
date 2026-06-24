# 功能内联帮助图标（B 方案：弹窗）计划

## 目标
在产品里给用户高频问到的功能旁加一个「页面状帮助图标」（lucide FileText），点击弹出 Modal 显示对应常见问题解答；需要配图处留空白占位，由用户后续截图补上。

## 关键决策
- 交互形式：B 方案 = 点击图标打开居中弹窗（复用 `src/components/ui/dialog.jsx`）。（用户已确认）
- 图标：lucide `FileText`，极简 ghost 风格，贴合「类似页面的图标」与项目极简 UI 偏好。
- 内容数据化：集中放在 `src/components/FeatureHelp.jsx` 的 `HELP_CONTENT`，后续好维护。
- 落点只选非交互标题，避免在可点击元素内嵌套按钮。

## 落点（覆盖 5 个用户问题）
1. 删持仓 / 改成本 → `src/pages/holdings/TransactionDraftPanel.jsx` 头部「编辑交易/新增交易」标签旁。topic=`holdings-edit`
2. 改交易计划 → `src/pages/TradePlansExperience.jsx` `<h1>交易计划</h1>` 旁。topic=`trade-plans`
3. 测试通知在哪点 → `src/pages/NotifyConfigCard.jsx` 头部「消息推送配置」旁。topic=`notify-test`
4. 安卓下载哪个 + 5. 安卓通知配置 → `NotifyConfigCard.jsx` Server酱³ 面板 `<h3>Server酱³ 推送设置</h3>` 旁。topic=`android-notify`

## 步骤清单
- [x] 新建 `src/components/FeatureHelp.jsx`（组件 + HELP_CONTENT + 截图占位渲染）
- [x] 接入 TransactionDraftPanel（import + 图标）
- [x] 接入 TradePlansExperience（import + 图标）
- [x] 接入 NotifyConfigCard（import + 两个图标：notify-test / android-notify）
- [x] 验证：`npx eslint` 改动文件
- [ ] 小步提交（feat: 内联功能帮助图标）

## 待确认项
- 截图占位文案是否合适，待用户截图后微调。

## 产出与验证记录
- 新增：`src/components/FeatureHelp.jsx`（FileText 图标 + Dialog 弹窗 + HELP_CONTENT：holdings-edit / trade-plans / notify-test / android-notify，含截图虚线占位）。
- 接入 4 处：TransactionDraftPanel 头部、TradePlansExperience `<h1>`、NotifyConfigCard 头部 + Server酱³ 面板 `<h3>`。
- 验证：`npx eslint` 4 个改动文件 exit_code=0（0 errors；唯一 warning `TAG_PILL_TONES` 为既有问题，非本次引入）。
