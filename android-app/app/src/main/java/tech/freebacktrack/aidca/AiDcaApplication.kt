package tech.freebacktrack.aidca

import android.app.Application
import com.google.firebase.FirebaseApp

class AiDcaApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    FirebaseApp.initializeApp(this)
    NotifyMessagingService.ensureNotificationChannel(this)
  }
}
