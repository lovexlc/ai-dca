# AI DCA Android App

这个目录提供一个最小 Android 原生 app。

目标很直接:

- 用户安装 app 后，不需要手动复制 token
- app 首次启动时自动获取 FCM registration token
- app 自动把当前设备注册到 `https://tools.freebacktrack.tech/api/notify/gcm/register`
- app 继续调用 `https://tools.freebacktrack.tech/api/notify/gcm/check` 做服务端连通性检查
- 当 Firebase token 轮换时，`FirebaseMessagingService` 会自动重新注册

## 你需要准备

1. 一个 Firebase Android App
2. 对应的 `google-services.json`
3. JDK 17
4. Android Studio / Android SDK

把 `google-services.json` 放到:

```text
android-app/app/google-services.json
```

这个文件已经在仓库 `.gitignore` 里忽略，不会被提交。

## 构建

```bash
cd android-app
./gradlew assembleDebug
```

首次成功构建后，debug apk 通常在:

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

## 行为说明

- 普通用户只需要安装 app 并打开一次
- app 会自动展示当前注册状态、失败原因、设备信息和 token 摘要
- 如果服务端还没配置 `FIREBASE_SERVICE_ACCOUNT_JSON`，app 仍然会先完成“设备注册”，但会把“服务端连接检查失败”的原因显示出来
- 当前仓库的服务端还没有把正式的 FCM 下发接入到交易提醒周期里；这个 app 先解决“自动注册”和“免手工 token”问题

## 参考

- Firebase Android 设置: https://firebase.google.com/docs/android/setup
- Firebase Cloud Messaging Android 客户端: https://firebase.google.com/docs/cloud-messaging/android/client
- Android 13 通知权限: https://developer.android.com/develop/ui/views/notifications/notification-permission
