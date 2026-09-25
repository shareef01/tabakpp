package com.tabakpp.app

import android.app.Application
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.firestore

/**
 * Test-only Application class used by Android instrumentation tests.
 * Configured via androidTest/AndroidManifest.xml with android:name=".TestTabakApp".
 *
 * This class lives ONLY in the androidTest source set, so release/debug
 * builds never include it — it cannot accidentally touch production.
 *
 * Emulator endpoints (accessible from Android emulator via 10.0.2.2):
 *   - Firestore: 10.0.2.2:8080
 *   - Auth:      10.0.2.2:9099
 * Project ID: demo-tabakpp-test
 */
class TestTabakApp : Application() {

    companion object {
        const val TAG = "TestTabakApp"
        const val TEST_UID = "test_instrumentation_uid"
        const val FIRESTORE_EMULATOR_HOST = "10.0.2.2"
        const val FIRESTORE_EMULATOR_PORT = 8080
        const val AUTH_EMULATOR_HOST = "10.0.2.2"
        const val AUTH_EMULATOR_PORT = 9099
    }

    override fun onCreate() {
        // Force IPv4 before any Firebase/network initialization.
        // The Android emulator's IPv6 routing to 10.0.2.2 (host loopback)
        // is unreliable on CI runners — connections via IPv6 source (::)
        // fail with ENETUNREACH. This property forces all sockets to use IPv4.
        System.setProperty("java.net.preferIPv4Stack", "true")
        super.onCreate()
        Log.d(TAG, "TestTabakApp.onCreate() START")

        // Initialize Firebase explicitly from the merged google-services config.
        val app = FirebaseApp.initializeApp(this)
        Log.d(TAG, "FirebaseApp initialized: ${app?.name}")
        if (app == null) {
            Log.e(TAG, "FirebaseApp is null — Firebase failed to initialize")
            return
        }

        // Configure Auth emulator using the NATIVE SDK directly.
        // This is more reliable than GitLive's wrapper because it ensures
        // the emulator host is set on the actual FirebaseAuth instance.
        try {
            val nativeAuth = FirebaseAuth.getInstance(app)
            nativeAuth.useEmulator(AUTH_EMULATOR_HOST, AUTH_EMULATOR_PORT)
            Log.d(TAG, "Native Auth emulator configured: $AUTH_EMULATOR_HOST:$AUTH_EMULATOR_PORT")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to configure Auth emulator: ${e.message}", e)
        }

        // Configure Firestore emulator via GitLive SDK
        val firestore = Firebase.firestore
        firestore.useEmulator(FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT)

        // Disable persistence for deterministic emulator tests.
        firestore.setSettings(
            persistenceEnabled = false,
            sslEnabled = false,
        )

        // Also ensure native FirebaseAuth emulator is set (in case GitLive
        // creates its own FirebaseAuth instance)
        try {
            val gitLiveAuth = Firebase.auth
            gitLiveAuth.useEmulator(AUTH_EMULATOR_HOST, AUTH_EMULATOR_PORT)
            Log.d(TAG, "GitLive Auth emulator configured: $AUTH_EMULATOR_HOST:$AUTH_EMULATOR_PORT")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to configure GitLive Auth emulator: ${e.message}", e)
        }

        Log.d(TAG, "TestTabakApp.onCreate() COMPLETE — emulators ready")
    }
}