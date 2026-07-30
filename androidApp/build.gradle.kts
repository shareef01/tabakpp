plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.kotlinAndroid)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.google.services)
}

/**
 * Version comes from the release tag so every published APK is distinguishable.
 * The workflow passes TABAKPP_VERSION_NAME=<tag without "v">; locally (and in CI
 * builds that are not releases) it falls back to the dev placeholder below.
 *
 * versionCode is derived as MAJOR*10000 + MINOR*100 + PATCH, so 1.0.1 -> 10001
 * and it increases monotonically with semver. Previously both were hardcoded,
 * which shipped v1.0.0 and v1.0.1 as an identical versionCode 1 / "1.0".
 */
val DEV_VERSION_NAME = "0.0.0-dev"

val resolvedVersionName: String =
    providers.environmentVariable("TABAKPP_VERSION_NAME").orNull
        ?.trim()
        ?.removePrefix("v")
        ?.takeIf { it.isNotEmpty() }
        ?: DEV_VERSION_NAME

val resolvedVersionCode: Int = run {
    val parts = resolvedVersionName
        .substringBefore('-')
        .split('.')
        .mapNotNull { it.toIntOrNull() }
    val derived =
        if (parts.size < 3) 0
        else parts[0] * 10000 + parts[1] * 100 + parts[2]
    // AGP rejects versionCode 0, which the 0.0.0-dev fallback would produce.
    derived.coerceAtLeast(1)
}

val releaseStorePath = providers.environmentVariable("TABAKPP_KEYSTORE_PATH").orNull
val releaseStorePassword = providers.environmentVariable("TABAKPP_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("TABAKPP_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("TABAKPP_KEY_PASSWORD").orNull
val hasReleaseSigning =
    releaseStorePath != null &&
        releaseStorePassword != null &&
        releaseKeyAlias != null &&
        releaseKeyPassword != null

android {
    namespace = "com.tabakpp.app"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.tabakpp.app"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = resolvedVersionCode
        versionName = resolvedVersionName
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(requireNotNull(releaseStorePath))
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.firebase.bom))
    // Sideloaded GitHub APKs cannot use Play Integrity; debug provider + registered tokens.
    implementation(libs.firebase.appcheck.debug)
    implementation(project(":composeApp"))
    implementation(project(":shared"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)
    implementation(libs.androidx.core.splashscreen)
}
