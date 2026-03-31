package tech.freebacktrack.aidca

import android.content.Context
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class DeliveryReceipt(
  val status: String,
  val receivedAt: String,
  val title: String,
  val body: String,
  val messageId: String
)

object DeliveryReceiptStore {
  private const val PREFERENCES_NAME = "ai_dca_notify_state"
  private const val RECEIPT_KEY = "last_delivery_receipt"

  fun read(context: Context): DeliveryReceipt? {
    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    val rawValue = preferences.getString(RECEIPT_KEY, null) ?: return null

    return try {
      val payload = JSONObject(rawValue)
      DeliveryReceipt(
        status = payload.optString("status"),
        receivedAt = payload.optString("receivedAt"),
        title = payload.optString("title"),
        body = payload.optString("body"),
        messageId = payload.optString("messageId")
      )
    } catch (_error: Exception) {
      null
    }
  }

  fun writeReceived(context: Context, title: String, body: String, messageId: String) {
    write(
      context,
      DeliveryReceipt(
        status = "received",
        receivedAt = nowLabel(),
        title = title,
        body = body,
        messageId = messageId
      )
    )
  }

  fun writeDisplayError(context: Context, title: String, body: String, messageId: String, errorMessage: String) {
    write(
      context,
      DeliveryReceipt(
        status = "display-error",
        receivedAt = nowLabel(),
        title = title,
        body = "$body\n通知展示失败: $errorMessage",
        messageId = messageId
      )
    )
  }

  private fun write(context: Context, receipt: DeliveryReceipt) {
    val payload = JSONObject()
      .put("status", receipt.status)
      .put("receivedAt", receipt.receivedAt)
      .put("title", receipt.title)
      .put("body", receipt.body)
      .put("messageId", receipt.messageId)

    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(RECEIPT_KEY, payload.toString())
      .apply()
  }

  private fun nowLabel(): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
  }
}
