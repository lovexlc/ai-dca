package tech.freebacktrack.aidca

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class NotifyMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    RegistrationRepository.syncFromService(applicationContext, token, "token-refresh")
  }

  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    ensureNotificationChannel(applicationContext)

    val title = message.notification?.title
      ?: message.data["title"]
      ?: getString(R.string.incoming_message_fallback_title)
    val body = message.notification?.body
      ?: message.data["body"]
      ?: message.data["message"]
      ?: "收到一条新的 AI DCA 推送消息。"
    val launchIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      1,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = android.app.Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(android.app.Notification.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .build()

    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.notify(message.messageId?.hashCode() ?: System.currentTimeMillis().toInt(), notification)
  }

  companion object {
    private const val CHANNEL_ID = "ai_dca_messages"

    fun ensureNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < 26) {
        return
      }

      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

      if (notificationManager.getNotificationChannel(CHANNEL_ID) != null) {
        return
      }

      val channel = NotificationChannel(
        CHANNEL_ID,
        context.getString(R.string.notification_channel_name),
        NotificationManager.IMPORTANCE_DEFAULT
      ).apply {
        description = context.getString(R.string.notification_channel_description)
      }

      notificationManager.createNotificationChannel(channel)
    }
  }
}
