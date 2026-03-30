package tech.freebacktrack.aidca

data class RegistrationSnapshot(
  val state: String,
  val title: String,
  val detail: String,
  val updatedAt: String,
  val tokenMasked: String,
  val projectId: String,
  val packageName: String,
  val deviceName: String,
  val senderId: String,
  val appId: String,
  val trigger: String
) {
  companion object {
    fun idle(identity: AppIdentity): RegistrationSnapshot {
      return RegistrationSnapshot(
        state = "idle",
        title = "等待自动注册",
        detail = "应用会在启动后自动拉取 FCM token 并注册到 AI DCA 通知服务。",
        updatedAt = "",
        tokenMasked = "",
        projectId = identity.projectId,
        packageName = identity.packageName,
        deviceName = identity.deviceName,
        senderId = identity.senderId,
        appId = identity.appId,
        trigger = ""
      )
    }
  }
}

data class AppIdentity(
  val projectId: String,
  val packageName: String,
  val deviceName: String,
  val senderId: String,
  val appId: String
)
