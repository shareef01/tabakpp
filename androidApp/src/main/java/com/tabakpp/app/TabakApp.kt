package com.tabakpp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.tabakpp.app.di.initKoin
import org.koin.android.ext.koin.androidContext

class TabakApp : Application() {
    override fun onCreate() {
        // Force IPv4 before any Firebase/network initialization.
        // The Android emulator's 10.0.2.2 loopback alias is IPv4-only;
        // connecting via IPv6 (source ::) fails with ENETUNREACH.
        // Must be set BEFORE FirebaseApp.initializeApp() so that gRPC/OkHttp
        // channels created by the Firebase SDK use IPv4. TestTabakApp.onCreate()
        // also sets this but is not the Application class used by AndroidJUnitRunner
        // (it falls back to TabakApp from the debug build), so the property must
        // be set here to cover the actual initialization path.
        System.setProperty("java.net.preferIPv4Stack", "true")
        super.onCreate()
        // App Check provider selection is build-variant-aware via source sets:
        //   debug   → src/debug/.../AppCheckInstaller.kt → DebugAppCheckProviderFactory
        //   release → src/release/.../AppCheckInstaller.kt → PlayIntegrityAppCheckProviderFactory
        // Enforcement remains off in Firebase Console; see SETUP_GUIDE.md → "Why App Check is not enforced".
        FirebaseApp.initializeApp(this)
        AppCheckInstaller.install()
        initKoin {
            androidContext(this@TabakApp)
        }
    }
}
