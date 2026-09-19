package com.tabakpp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.tabakpp.app.di.initKoin
import org.koin.android.ext.koin.androidContext

class TabakApp : Application() {
    override fun onCreate() {
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
