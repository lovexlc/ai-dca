# 通知帮助引导气泡 plan

## 目标
通知渠道输入框挂载后约 1 分钟仍为空时，在对应 FeatureHelp 帮助图标上浮出引导气泡，引导用户点击查看帮助；填写输入或点开帮助后气泡消失。

## 关键决策
- 计时起点：对应面板（含该 FeatureHelp）挂载时；切换平台标签即重新计时。
- 触发条件由父组件传入 `hintActive`（输入框为空且未配置），FeatureHelp 保持通用。
- 接入位置：`android-notify`（Server酱³ UID/SendKey 均空）、`ios-notify`（Bark 输入空）。`notify-test` 无对应输入框，不加气泡。
- 点开帮助后本次不再提示（dismissedRef）；输入填写后 `hintActive` 变 false，气泡即时消失。

## 步骤
- [x] FeatureHelp.jsx：新增 `hintText` / `hintActive` / `hintDelayMs` props；useEffect 延时控制 `showHint`；按钮外包 relative span，气泡绝对定位于图标上方，可点击打开帮助。
- [x] NotifyConfigCard.jsx：新增 `serverChan3InputEmpty` / `barkInputEmpty`；为两处 FeatureHelp 传 hint props。
- [x] eslint 验证 0 error。
- [x] 提交（feat）。

## 产出与验证记录
- FeatureHelp.jsx +44/-14：新增 `hintText` / `hintActive` / `hintDelayMs`(默认 60000ms) props；useEffect 启动 setTimeout，超时且 hintActive 仍为 true 时 `setShowHint(true)`；hintActive 变 false 或点开帮助（dismissedRef）即隐藏。按钮外包 relative span，气泡绝对定位 bottom-full + 下方箭头，可点击打开帮助。
- NotifyConfigCard.jsx +12/-2：新增 `serverChan3InputEmpty`(未配置且 UID/SendKey 均空) / `barkInputEmpty`(未配置且 Bark 输入空)；android-notify / ios-notify 两处 FeatureHelp 传 hintText + hintActive。
- 验证：`npx eslint src/components/FeatureHelp.jsx src/pages/NotifyConfigCard.jsx` → EXIT:0（0 error）。纯前端 UI 改动，无后端接口，不涉 curl 冲烟。
