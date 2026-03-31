package tech.freebacktrack.aidca

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
  private lateinit var titleTextView: TextView
  private lateinit var statusBadgeTextView: TextView
  private lateinit var statusTitleTextView: TextView
  private lateinit var statusDetailTextView: TextView
  private lateinit var statusUpdatedAtTextView: TextView
  private lateinit var deviceNameTextView: TextView
  private lateinit var projectIdTextView: TextView
  private lateinit var packageNameTextView: TextView
  private lateinit var senderIdTextView: TextView
  private lateinit var tokenTextView: TextView
  private lateinit var deliveryStatusTextView: TextView
  private lateinit var debugCardView: LinearLayout
  private lateinit var debugLogTextView: TextView
  private lateinit var clearDebugLogsButton: Button
  private lateinit var copyDebugLogsButton: Button
  private lateinit var refreshButton: Button
  private var titleTapCount = 0
  private var lastTitleTapAtMs = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    bindViews()
    setupDebugToggle()
    setupDebugActions()
    DebugLogStore.append(applicationContext, "ui", "MainActivity onCreate")

    val identity = RegistrationRepository.currentIdentity(this)
    renderSnapshot(RegistrationStateStore.read(this, identity))
    renderDeliveryReceipt()
    renderDebugPanel()
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
      DebugLogStore.append(applicationContext, "permission", "POST_NOTIFICATIONS denied")
    } else if (requestCode == REQUEST_NOTIFICATIONS) {
      DebugLogStore.append(applicationContext, "permission", "POST_NOTIFICATIONS granted")
    }

    renderDebugPanel()
  }

  override fun onResume() {
    super.onResume()
    renderDeliveryReceipt()
    renderDebugPanel()
  }

  private fun bindViews() {
    titleTextView = findViewById(R.id.titleTextView)
    statusBadgeTextView = findViewById(R.id.statusBadgeTextView)
    statusTitleTextView = findViewById(R.id.statusTitleTextView)
    statusDetailTextView = findViewById(R.id.statusDetailTextView)
    statusUpdatedAtTextView = findViewById(R.id.statusUpdatedAtTextView)
    deviceNameTextView = findViewById(R.id.deviceNameTextView)
    projectIdTextView = findViewById(R.id.projectIdTextView)
    packageNameTextView = findViewById(R.id.packageNameTextView)
    senderIdTextView = findViewById(R.id.senderIdTextView)
    tokenTextView = findViewById(R.id.tokenTextView)
    deliveryStatusTextView = findViewById(R.id.deliveryStatusTextView)
    debugCardView = findViewById(R.id.debugCardView)
    debugLogTextView = findViewById(R.id.debugLogTextView)
    clearDebugLogsButton = findViewById(R.id.clearDebugLogsButton)
    copyDebugLogsButton = findViewById(R.id.copyDebugLogsButton)
    refreshButton = findViewById(R.id.refreshButton)
  }

  private fun setupDebugToggle() {
    titleTextView.setOnClickListener {
      val nowMs = System.currentTimeMillis()

      if (nowMs - lastTitleTapAtMs > DEBUG_TAP_WINDOW_MS) {
        titleTapCount = 0
      }

      lastTitleTapAtMs = nowMs
      titleTapCount += 1
      val remaining = DEBUG_TAP_TARGET - titleTapCount

      if (remaining in 1..2) {
        Toast.makeText(this, getString(R.string.debug_mode_hint, remaining), Toast.LENGTH_SHORT).show()
      }

      if (remaining <= 0) {
        val enabled = DebugLogStore.toggleEnabled(applicationContext)
        titleTapCount = 0
        DebugLogStore.append(
          applicationContext,
          "ui",
          if (enabled) "Debug mode enabled from title taps" else "Debug mode disabled from title taps"
        )
        renderDebugPanel()
        Toast.makeText(
          this,
          if (enabled) R.string.debug_mode_enabled else R.string.debug_mode_disabled,
          Toast.LENGTH_SHORT
        ).show()
      }
    }
  }

  private fun setupDebugActions() {
    copyDebugLogsButton.setOnClickListener {
      val logText = DebugLogStore.readJoined(applicationContext).ifBlank {
        getString(R.string.debug_log_empty)
      }
      val clipboardManager = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
      clipboardManager.setPrimaryClip(ClipData.newPlainText("AI DCA Debug Logs", logText))
      Toast.makeText(this, R.string.debug_logs_copied, Toast.LENGTH_SHORT).show()
    }

    clearDebugLogsButton.setOnClickListener {
      DebugLogStore.clear(applicationContext)
      renderDebugPanel()
      Toast.makeText(this, R.string.debug_logs_cleared, Toast.LENGTH_SHORT).show()
    }
  }

  private fun startRegistration(trigger: String) {
    DebugLogStore.append(applicationContext, "ui", "Starting registration, trigger=$trigger")
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
      renderDeliveryReceipt()
      DebugLogStore.append(applicationContext, "ui", "Registration finished with state=${snapshot.state}")
      renderDebugPanel()
    }
  }

  private fun renderSnapshot(snapshot: RegistrationSnapshot) {
    val badge = when (snapshot.state) {
      "validated", "connected" -> BadgeStyle("已校验", R.drawable.status_badge_connected, R.color.emerald_600)
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

  private fun renderDeliveryReceipt() {
    val receipt = DeliveryReceiptStore.read(this)

    deliveryStatusTextView.text = if (receipt == null) {
      getString(R.string.delivery_status_empty)
    } else {
      val prefix = if (receipt.status == "display-error") {
        getString(R.string.delivery_status_error_prefix)
      } else {
        getString(R.string.delivery_status_received_prefix)
      }

      buildString {
        append(prefix)
        append(receipt.receivedAt)

        if (receipt.title.isNotBlank()) {
          append('\n')
          append("标题: ")
          append(receipt.title)
        }

        if (receipt.body.isNotBlank()) {
          append('\n')
          append("内容: ")
          append(receipt.body)
        }

        if (receipt.messageId.isNotBlank()) {
          append('\n')
          append("Message ID: ")
          append(receipt.messageId)
        }
      }
    }
  }

  private fun renderDebugPanel() {
    val enabled = DebugLogStore.isEnabled(this)
    debugCardView.visibility = if (enabled) View.VISIBLE else View.GONE

    if (enabled) {
      debugLogTextView.text = DebugLogStore.readJoined(this).ifBlank {
        getString(R.string.debug_log_empty)
      }
    }
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < 33) {
      DebugLogStore.append(applicationContext, "permission", "POST_NOTIFICATIONS not required on this Android version")
      return
    }

    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      DebugLogStore.append(applicationContext, "permission", "POST_NOTIFICATIONS already granted")
      return
    }

    DebugLogStore.append(applicationContext, "permission", "Requesting POST_NOTIFICATIONS")
    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
  }

  private data class BadgeStyle(
    val label: String,
    val backgroundRes: Int,
    val textColorRes: Int
  )

  companion object {
    private const val REQUEST_NOTIFICATIONS = 1001
    private const val DEBUG_TAP_TARGET = 7
    private const val DEBUG_TAP_WINDOW_MS = 1800L
  }
}
