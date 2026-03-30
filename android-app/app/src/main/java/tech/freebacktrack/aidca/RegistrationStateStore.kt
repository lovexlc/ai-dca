package tech.freebacktrack.aidca

import android.content.Context
import org.json.JSONObject

object RegistrationStateStore {
  private const val PREFERENCES_NAME = "ai_dca_notify_state"
  private const val SNAPSHOT_KEY = "registration_snapshot"

  fun read(context: Context, fallbackIdentity: AppIdentity): RegistrationSnapshot {
    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    val rawValue = preferences.getString(SNAPSHOT_KEY, null) ?: return RegistrationSnapshot.idle(fallbackIdentity)

    return try {
      val payload = JSONObject(rawValue)
      RegistrationSnapshot(
        state = payload.optString("state"),
        title = payload.optString("title"),
        detail = payload.optString("detail"),
        updatedAt = payload.optString("updatedAt"),
        tokenMasked = payload.optString("tokenMasked"),
        projectId = payload.optString("projectId", fallbackIdentity.projectId),
        packageName = payload.optString("packageName", fallbackIdentity.packageName),
        deviceName = payload.optString("deviceName", fallbackIdentity.deviceName),
        senderId = payload.optString("senderId", fallbackIdentity.senderId),
        appId = payload.optString("appId", fallbackIdentity.appId),
        trigger = payload.optString("trigger")
      )
    } catch (_error: Exception) {
      RegistrationSnapshot.idle(fallbackIdentity)
    }
  }

  fun write(context: Context, snapshot: RegistrationSnapshot) {
    val payload = JSONObject()
      .put("state", snapshot.state)
      .put("title", snapshot.title)
      .put("detail", snapshot.detail)
      .put("updatedAt", snapshot.updatedAt)
      .put("tokenMasked", snapshot.tokenMasked)
      .put("projectId", snapshot.projectId)
      .put("packageName", snapshot.packageName)
      .put("deviceName", snapshot.deviceName)
      .put("senderId", snapshot.senderId)
      .put("appId", snapshot.appId)
      .put("trigger", snapshot.trigger)

    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(SNAPSHOT_KEY, payload.toString())
      .apply()
  }
}
