# 把 tips 示例图迁入帮助弹窗

## 目标
把 NotifyConfigCard 里原有的两个「tips」示例图（iOS Bark、安卓 Server酱³）迁移到 FeatureHelp 帮助弹窗的预留图片位，并移除原来的 tips 按钮与其独立弹层。

## 关键决策
- Server酱³ 示例图 → FeatureHelp `android-notify` 话题的图片位（该面板已有帮助图标）。
- Bark 示例图 → iOS Bark 面板原本没有帮助图标，新增 `ios-notify` 话题 + 一个 FeatureHelp 图标承接（与 Server酱³ 一致），否则移除 tips 后图片无入口。
- FeatureHelp 的 `screenshots` 支持两种元素：字符串（虚线占位）或 `{ src, alt, caption }`（真实图片）。

## 步骤
- [x] FeatureHelp.jsx：新增两个图片 URL 常量；`android-notify` 图片位改为 Server酱³ 图；新增 `ios-notify` 话题（含 Bark 图）；渲染逻辑兼容字符串占位与图片对象。
- [x] NotifyConfigCard.jsx：移除两段 tips 按钮 + 两个独立图片弹层 + 两个 tip state + 两个图片 URL 常量；iOS Bark 标题旁加 `<FeatureHelp topic="ios-notify" />`；清理不再使用的 import（Info、X、useState）。
- [x] eslint 验证 0 error。
- [x] 提交（feat）。

## 产出与验证记录
- FeatureHelp.jsx +63/-10；`screenshots` 现支持 `{ src, alt, caption }` 图片对象（渲染 figure + img + figcaption）与字符串虚线占位两种。Server酱³ 图入 `android-notify`，Bark 图入新增 `ios-notify`。
- NotifyConfigCard.jsx +7/-88；移除 Bark / Server酱³ tips 按钮与 fixed 图片弹层、`isBarkTipOpen` / `isServerChan3TipOpen` state、两个图片 URL 常量；清理 import `useState` / `Info` / `X`；iOS Bark 标题旁新增 ios-notify 帮助图标。
- 验证：`npx eslint src/components/FeatureHelp.jsx src/pages/NotifyConfigCard.jsx` → EXIT:0（0 error）。
