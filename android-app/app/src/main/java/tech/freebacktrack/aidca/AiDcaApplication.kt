package tech.freebacktrack.aidca

import android.app.Application
import com.google.firebase.FirebaseApp

class AiDcaApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    DebugLogStore.append(this, "app", "Application onCreate")
    val firebaseApp = FirebaseApp.initializeApp(this)
    DebugLogStore.append(
      this,
      "app",
      if (firebaseApp == null) "Firebase initializeApp returned null" else "Firebase initialized"
    )
    NotifyMessagingService.ensureNotificationChannel(this)
    DebugLogStore.append(this, "app", "Notification channel ensured")
  }
}
