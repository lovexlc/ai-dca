package tech.freebacktrack.aidca

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

object RegistrationRepository {
  private val executor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  fun currentIdentity(context: Context): AppIdentity {
    val firebaseApp = resolveFirebaseApp(context)
    val options = firebaseApp?.options

    return AppIdentity(
      projectId = options?.projectId.orEmpty(),
      packageName = context.packageName.orEmpty(),
      deviceName = buildDeviceName(),
      senderId = options?.gcmSenderId.orEmpty(),
      appId = options?.applicationId.orEmpty()
    )
  }

  fun refresh(context: Context, trigger: String, callback: (RegistrationSnapshot) -> Unit) {
    val appContext = context.applicationContext
    DebugLogStore.append(appContext, "register", "Refresh requested, trigger=$trigger")
    executor.execute {
      val snapshot = registerCurrentToken(appContext, null, trigger)
      mainHandler.post {
        callback(snapshot)
      }
    }
  }

  fun syncFromService(context: Context, token: String, trigger: String) {
    val appContext = context.applicationContext
    DebugLogStore.append(appContext, "register", "Sync requested from service, trigger=$trigger token=${maskToken(token)}")
    executor.execute {
      registerCurrentToken(appContext, token, trigger)
    }
  }

  private fun registerCurrentToken(context: Context, explicitToken: String?, trigger: String): RegistrationSnapshot {
    val identity = currentIdentity(context)
    val firebaseApp = resolveFirebaseApp(context)
    DebugLogStore.append(
      context,
      "register",
      "registerCurrentToken started, trigger=$trigger package=${identity.packageName.ifBlank { "-" }} explicitToken=${if (explicitToken.isNullOrBlank()) "no" else "yes"}"
    )

    if (firebaseApp == null) {
      DebugLogStore.append(context, "register", "Firebase app missing, aborting registration")
      val snapshot = RegistrationSnapshot(
        state = "error",
        title = "缺少 Firebase 配置",
        detail = "应用还没有接入 Firebase。请把 google-services.json 放到 android-app/app/ 后重新构建安装。",
        updatedAt = nowLabel(),
        tokenMasked = "",
        projectId = identity.projectId,
        packageName = identity.packageName,
        deviceName = identity.deviceName,
        senderId = identity.senderId,
        appId = identity.appId,
        trigger = trigger
      )
      RegistrationStateStore.write(context, snapshot)
      return snapshot
    }

    val token = explicitToken?.trim().orEmpty().ifBlank {
      fetchTokenBlocking(context)
    }

    DebugLogStore.append(context, "register", "Using token ${maskToken(token)}")

    if (token.isBlank()) {
      DebugLogStore.append(context, "register", "Firebase returned empty token")
      val snapshot = RegistrationSnapshot(
        state = "error",
        title = "获取 FCM token 失败",
        detail = "Firebase 没有返回可用的 registration token，请稍后再试。",
        updatedAt = nowLabel(),
        tokenMasked = "",
        projectId = identity.projectId,
        packageName = identity.packageName,
        deviceName = identity.deviceName,
        senderId = identity.senderId,
        appId = identity.appId,
        trigger = trigger
      )
      RegistrationStateStore.write(context, snapshot)
      return snapshot
    }

    return try {
      DebugLogStore.append(context, "register", "Submitting token to ${BuildConfig.NOTIFY_BASE_URL}/gcm/register")
      val registerPayload = JSONObject()
        .put("projectId", identity.projectId)
        .put("packageName", identity.packageName)
        .put("deviceName", identity.deviceName)
        .put("senderId", identity.senderId)
        .put("appId", identity.appId)
        .put("token", token)
      val registerResponse = postJson("${BuildConfig.NOTIFY_BASE_URL}/gcm/register", registerPayload)
      val registeredCount = registerResponse.body.optJSONObject("setup")?.optInt("gcmRegistrationCount") ?: 0
      DebugLogStore.append(context, "register", "Register API success, registrationCount=$registeredCount")

      try {
        DebugLogStore.append(context, "register", "Running validateOnly check against ${BuildConfig.NOTIFY_BASE_URL}/gcm/check")
        val checkPayload = JSONObject()
          .put("projectId", identity.projectId)
          .put("packageName", identity.packageName)
          .put("token", token)
        val checkResponse = postJson("${BuildConfig.NOTIFY_BASE_URL}/gcm/check", checkPayload)
        val detail = checkResponse.body
          .optJSONObject("result")
          ?.optString("detail")
          .orEmpty()
          .ifBlank { "FCM 凭证和当前 Android token 已通过服务端检查。" }
        val snapshot = RegistrationSnapshot(
          state = "validated",
          title = "FCM 凭证已校验",
          detail = "$detail 这一步只说明 Firebase 服务账号、包名和当前 token 可以通过 FCM validateOnly 校验，不代表手机已经收到真实推送。",
          updatedAt = nowLabel(),
          tokenMasked = maskToken(token),
          projectId = identity.projectId,
          packageName = identity.packageName,
          deviceName = identity.deviceName,
          senderId = identity.senderId,
          appId = identity.appId,
          trigger = trigger
        )
        DebugLogStore.append(context, "register", "ValidateOnly check passed")
        RegistrationStateStore.write(context, snapshot)
        snapshot
      } catch (checkError: Exception) {
        DebugLogStore.append(
          context,
          "register",
          "ValidateOnly check failed: ${checkError.message ?: "未知错误"}"
        )
        val snapshot = RegistrationSnapshot(
          state = "registered",
          title = "设备已注册",
          detail = "token 已提交到服务端（当前共登记 $registeredCount 台设备），但服务端连接检查失败: ${checkError.message ?: "未知错误"}",
          updatedAt = nowLabel(),
          tokenMasked = maskToken(token),
          projectId = identity.projectId,
          packageName = identity.packageName,
          deviceName = identity.deviceName,
          senderId = identity.senderId,
          appId = identity.appId,
          trigger = trigger
        )
        RegistrationStateStore.write(context, snapshot)
        snapshot
      }
    } catch (error: Exception) {
      DebugLogStore.append(context, "register", "Registration failed: ${error.message ?: "未知错误"}")
      val snapshot = RegistrationSnapshot(
        state = "error",
        title = "自动注册失败",
        detail = error.message ?: "注册通知设备时发生未知错误。",
        updatedAt = nowLabel(),
        tokenMasked = maskToken(token),
        projectId = identity.projectId,
        packageName = identity.packageName,
        deviceName = identity.deviceName,
        senderId = identity.senderId,
        appId = identity.appId,
        trigger = trigger
      )
      RegistrationStateStore.write(context, snapshot)
      snapshot
    }
  }

  private fun fetchTokenBlocking(context: Context): String {
    val latch = CountDownLatch(1)
    val tokenRef = AtomicReference("")
    val errorRef = AtomicReference<Exception?>(null)

    DebugLogStore.append(context, "firebase", "Requesting FCM token from FirebaseMessaging")
    FirebaseMessaging.getInstance().token
      .addOnSuccessListener { token ->
        tokenRef.set(token.orEmpty())
        DebugLogStore.append(context, "firebase", "FCM token received: ${maskToken(token.orEmpty())}")
        latch.countDown()
      }
      .addOnFailureListener { error ->
        errorRef.set(Exception(error))
        DebugLogStore.append(context, "firebase", "FCM token request failed: ${error.message ?: "未知错误"}")
        latch.countDown()
      }

    val completed = latch.await(20, TimeUnit.SECONDS)

    if (!completed) {
      DebugLogStore.append(context, "firebase", "Timed out while waiting for FCM token")
      throw IllegalStateException("等待 Firebase 返回 token 超时。")
    }

    val capturedError = errorRef.get()

    if (capturedError != null) {
      DebugLogStore.append(context, "firebase", "Throwing captured token error")
      throw capturedError
    }

    return tokenRef.get().orEmpty()
  }

  private fun resolveFirebaseApp(context: Context): FirebaseApp? {
    val existing = FirebaseApp.getApps(context).firstOrNull()

    if (existing != null) {
      DebugLogStore.append(context, "firebase", "Reusing existing Firebase app")
      return existing
    }

    DebugLogStore.append(context, "firebase", "Initializing Firebase app on demand")
    return FirebaseApp.initializeApp(context)
  }

  private fun postJson(url: String, payload: JSONObject): HttpResponse {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15000
      readTimeout = 15000
      doInput = true
      doOutput = true
      setRequestProperty("Content-Type", "application/json; charset=utf-8")
      setRequestProperty("Accept", "application/json")
    }

    try {
      connection.outputStream.use { output ->
        output.write(payload.toString().toByteArray(Charsets.UTF_8))
      }

      val code = connection.responseCode
      val body = readStream(
        if (code in 200..299) connection.inputStream else connection.errorStream
      )
      val jsonBody = if (body.isBlank()) JSONObject() else JSONObject(body)

      if (code !in 200..299) {
        throw IllegalStateException(jsonBody.optString("error").ifBlank { "服务端返回状态 $code" })
      }

      return HttpResponse(code, jsonBody)
    } finally {
      connection.disconnect()
    }
  }

  private fun readStream(stream: InputStream?): String {
    if (stream == null) {
      return ""
    }

    return BufferedReader(InputStreamReader(stream)).use { reader ->
      buildString {
        while (true) {
          val line = reader.readLine() ?: break
          append(line)
        }
      }
    }
  }

  private fun buildDeviceName(): String {
    val manufacturer = Build.MANUFACTURER.orEmpty().trim()
    val model = Build.MODEL.orEmpty().trim()

    return listOf(manufacturer, model)
      .filter { it.isNotBlank() }
      .joinToString(" ")
      .ifBlank { "Android Device" }
  }

  private fun maskToken(token: String): String {
    return if (token.length <= 14) token else "${token.take(8)}...${token.takeLast(6)}"
  }

  private fun nowLabel(): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
  }

  private data class HttpResponse(
    val code: Int,
    val body: JSONObject
  )
}
