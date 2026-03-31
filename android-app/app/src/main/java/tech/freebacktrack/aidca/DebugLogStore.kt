package tech.freebacktrack.aidca

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object DebugLogStore {
  private const val PREFERENCES_NAME = "ai_dca_notify_state"
  private const val DEBUG_ENABLED_KEY = "debug_enabled"
  private const val DEBUG_LINES_KEY = "debug_lines"
  private const val MAX_LINES = 200

  fun isEnabled(context: Context): Boolean {
    return preferences(context).getBoolean(DEBUG_ENABLED_KEY, false)
  }

  fun toggleEnabled(context: Context): Boolean {
    val enabled = !isEnabled(context)
    preferences(context)
      .edit()
      .putBoolean(DEBUG_ENABLED_KEY, enabled)
      .apply()
    return enabled
  }

  fun clear(context: Context) {
    preferences(context)
      .edit()
      .remove(DEBUG_LINES_KEY)
      .apply()
  }

  fun readJoined(context: Context): String {
    return preferences(context).getString(DEBUG_LINES_KEY, "").orEmpty()
  }

  fun append(context: Context, tag: String, message: String) {
    synchronized(this) {
      val entry = buildString {
        append(nowLabel())
        append(" [")
        append(tag.ifBlank { "app" })
        append("] ")
        append(message.replace('\n', ' ').trim())
      }
      val lines = readJoined(context)
        .lineSequence()
        .filter { it.isNotBlank() }
        .toMutableList()

      lines += entry

      preferences(context)
        .edit()
        .putString(DEBUG_LINES_KEY, lines.takeLast(MAX_LINES).joinToString("\n"))
        .apply()
    }
  }

  private fun preferences(context: Context): SharedPreferences {
    return context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
  }

  private fun nowLabel(): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
  }
}
