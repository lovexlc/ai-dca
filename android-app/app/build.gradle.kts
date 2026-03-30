plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("com.google.gms.google-services")
}

android {
  namespace = "tech.freebacktrack.aidca"
  compileSdk = 35

  defaultConfig {
    applicationId = "tech.freebacktrack.aidca"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"

    buildConfigField("String", "NOTIFY_BASE_URL", "\"https://tools.freebacktrack.tech/api/notify\"")
  }

  buildFeatures {
    buildConfig = true
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }
}

dependencies {
  implementation(platform("com.google.firebase:firebase-bom:34.7.0"))
  implementation("com.google.firebase:firebase-messaging")
}
