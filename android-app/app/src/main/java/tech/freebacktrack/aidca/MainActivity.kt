package tech.freebacktrack.aidca

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
  private lateinit var statusBadgeTextView: TextView
  private lateinit var statusTitleTextView: TextView
  private lateinit var statusDetailTextView: TextView
  private lateinit var statusUpdatedAtTextView: TextView
  private lateinit var deviceNameTextView: TextView
  private lateinit var projectIdTextView: TextView
  private lateinit var packageNameTextView: TextView
  private lateinit var senderIdTextView: TextView
  private lateinit var tokenTextView: TextView
  private lateinit var refreshButton: Button

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    bindViews()

    val identity = RegistrationRepository.currentIdentity(this)
    renderSnapshot(RegistrationStateStore.read(this, identity))
    requestNotificationPermissionIfNeeded()

    refreshButton.setOnClickListener {
      startRegistration("manual-refresh")
    }

    startRegistration("app-launch")
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)

    if (requestCode == REQUEST_NOTIFICATIONS && grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) {
      Toast.makeText(this, R.string.permission_denied_message, Toast.LENGTH_LONG).show()
    }
  }

  private fun bindViews() {
    statusBadgeTextView = findViewById(R.id.statusBadgeTextView)
    statusTitleTextView = findViewById(R.id.statusTitleTextView)
    statusDetailTextView = findViewById(R.id.statusDetailTextView)
    statusUpdatedAtTextView = findViewById(R.id.statusUpdatedAtTextView)
    deviceNameTextView = findViewById(R.id.deviceNameTextView)
    projectIdTextView = findViewById(R.id.projectIdTextView)
    packageNameTextView = findViewById(R.id.packageNameTextView)
    senderIdTextView = findViewById(R.id.senderIdTextView)
    tokenTextView = findViewById(R.id.tokenTextView)
    refreshButton = findViewById(R.id.refreshButton)
  }

  private fun startRegistration(trigger: String) {
    val identity = RegistrationRepository.currentIdentity(this)
    renderSnapshot(
      RegistrationSnapshot(
        state = "idle",
        title = "正在自动注册",
        detail = "正在向 Firebase 请求 token 并同步到 AI DCA 通知服务。",
        updatedAt = "",
        tokenMasked = "",
        projectId = identity.projectId,
        packageName = identity.packageName,
        deviceName = identity.deviceName,
        senderId = identity.senderId,
        appId = identity.appId,
        trigger = trigger
      )
    )

    RegistrationRepository.refresh(this, trigger) { snapshot ->
      renderSnapshot(snapshot)
    }
  }

  private fun renderSnapshot(snapshot: RegistrationSnapshot) {
    val badge = when (snapshot.state) {
      "connected" -> BadgeStyle("已连接", R.drawable.status_badge_connected, R.color.emerald_600)
      "registered" -> BadgeStyle("已注册", R.drawable.status_badge_registered, R.color.amber_700)
      "error" -> BadgeStyle("失败", R.drawable.status_badge_error, R.color.red_600)
      else -> BadgeStyle(getString(R.string.status_idle), R.drawable.status_badge_idle, R.color.slate_700)
    }

    statusBadgeTextView.text = badge.label
    statusBadgeTextView.setBackgroundResource(badge.backgroundRes)
    statusBadgeTextView.setTextColor(getColor(badge.textColorRes))
    statusTitleTextView.text = snapshot.title
    statusDetailTextView.text = snapshot.detail
    statusUpdatedAtTextView.text = if (snapshot.updatedAt.isBlank()) "尚未完成自动注册" else "最近更新: ${snapshot.updatedAt}"
    deviceNameTextView.text = snapshot.deviceName.ifBlank { "Android Device" }
    projectIdTextView.text = "Firebase Project: ${snapshot.projectId.ifBlank { "未读取到" }}"
    packageNameTextView.text = "包名: ${snapshot.packageName.ifBlank { "未读取到" }}"
    senderIdTextView.text = "Sender ID: ${snapshot.senderId.ifBlank { "未读取到" }}"
    tokenTextView.text = if (snapshot.tokenMasked.isBlank()) "FCM token 尚未可用" else "Token: ${snapshot.tokenMasked}"
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < 33) {
      return
    }

    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      return
    }

    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
  }

  private data class BadgeStyle(
    val label: String,
    val backgroundRes: Int,
    val textColorRes: Int
  )

  companion object {
    private const val REQUEST_NOTIFICATIONS = 1001
  }
}
