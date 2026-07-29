package com.tabakpp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.tabakpp.app.di.initKoin
import org.koin.android.ext.koin.androidContext

class TabakApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Release: Play Integrity. Debug: DebugAppCheckProviderFactory (token in logcat;
        // register under Console → App Check → Manage debug tokens while APIs are Enforced).
        FirebaseApp.initializeApp(this)
        AppCheckInstaller.install()
        initKoin {
            androidContext(this@TabakApp)
        }
    }
}
