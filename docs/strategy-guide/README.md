# 策略指南静态截图

这两个文件是「先把手机通知配好」卡片里展示的截图，由用户手动放置（不走构建流程）：

- `bark-example.png` —— iOS Bark 截图（api.day.app 链接示例）
- `android-example.jpg` —— Android 推送 App 截图（android-... ID 示例）

文件名固定，Vite 会把 `public/` 下的内容原样发布到根路径，因此在前端通过 `/strategy-guide/bark-example.png` / `/strategy-guide/android-example.jpg` 引用。

如需替换：直接覆盖同名文件即可，无需改代码。
