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
val DEV_VERSION_CODE = 1
val MAX_ANDROID_VERSION_CODE = 2_100_000_000

val rawVersionName = providers.environmentVariable("TABAKPP_VERSION_NAME").orNull?.trim()

val (resolvedVersionName: String, resolvedVersionCode: Int) = run {
    if (rawVersionName.isNullOrEmpty()) {
        DEV_VERSION_NAME to DEV_VERSION_CODE
    } else {
        val clean = if (rawVersionName.startsWith("v", ignoreCase = true)) {
            rawVersionName.substring(1)
        } else {
            rawVersionName
        }
        require(!clean.contains('-')) {
            "Prerelease tags are not permitted for release versions: '$rawVersionName'. Expected strict MAJOR.MINOR.PATCH format."
        }
        val parts = clean.split('.')
        require(parts.size == 3) {
            "Version string must have exactly three numeric segments (MAJOR.MINOR.PATCH): '$rawVersionName'"
        }
        val major = requireNotNull(parts[0].toIntOrNull()) {
            "Major version segment '${parts[0]}' is not a valid non-negative integer in '$rawVersionName'"
        }
        val minor = requireNotNull(parts[1].toIntOrNull()) {
            "Minor version segment '${parts[1]}' is not a valid non-negative integer in '$rawVersionName'"
        }
        val patch = requireNotNull(parts[2].toIntOrNull()) {
            "Patch version segment '${parts[2]}' is not a valid non-negative integer in '$rawVersionName'"
        }
        require(major >= 0) { "Major version cannot be negative: $major in '$rawVersionName'" }
        require(minor in 0..99) {
            "Minor version ($minor) must be in 0..99 to avoid versionCode collision: '$rawVersionName'"
        }
        require(patch in 0..99) {
            "Patch version ($patch) must be in 0..99 to avoid versionCode collision: '$rawVersionName'"
        }
        val derived = major.toLong() * 10000L + minor.toLong() * 100L + patch.toLong()
        require(derived in 1L..MAX_ANDROID_VERSION_CODE.toLong()) {
            "Calculated versionCode $derived is outside permitted Android range (1..$MAX_ANDROID_VERSION_CODE): '$rawVersionName'"
        }
        clean to derived.toInt()
    }
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

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
        getByName("debug") {
            // testInstrumentationRunner is configured in defaultConfig
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
    sourceSets {
        getByName("androidTest") {
            manifest.srcFile("src/androidTest/AndroidManifest.xml")
        }
    }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.appcheck.debug)
    implementation(libs.firebase.appcheck.playintegrity)
    implementation(project(":composeApp"))
    implementation(project(":shared"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.koin.android)
    implementation(libs.androidx.core.splashscreen)
    testImplementation(kotlin("test"))

    // Android instrumentation test dependencies
    androidTestImplementation(platform(libs.firebase.bom))
    androidTestImplementation(libs.firebase.gitlive.firestore)
    androidTestImplementation(libs.firebase.gitlive.auth)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation("androidx.test:runner:1.6.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1") {
        exclude(group = "org.hamcrest", module = "hamcrest-core")
    }
    androidTestImplementation(kotlin("test"))
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation("com.google.firebase:firebase-firestore")
    androidTestImplementation("com.google.firebase:firebase-auth")
    androidTestImplementation("androidx.test.ext:truth:1.6.0")
    androidTestImplementation("org.hamcrest:hamcrest:2.2") {
        because("Needed for assertThat matchers in Firestore assertions")
    }
}

// Exclude hamcrest-core (1.3) from androidTest configs because hamcrest:2.2
// provides the same classes in an incompatible package layout.
// hamcrest-core comes transitively from junit:4.13.2 (via kotlin("test") and
// androidx.test.ext:junit). We want hamcrest:2.2 exclusively.
configurations.configureEach {
    if (name.contains("androidTest")) {
        exclude(group = "org.hamcrest", module = "hamcrest-core")
    }
}