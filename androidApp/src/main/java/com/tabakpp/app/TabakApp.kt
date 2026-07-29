package com.tabakpp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.tabakpp.app.di.initKoin
import org.koin.android.ext.koin.androidContext

class TabakApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Debug + GitHub release: DebugAppCheckProviderFactory (register device token
        // in Console → App Check). Play Integrity is unused — APKs are sideloaded.
        FirebaseApp.initializeApp(this)
        AppCheckInstaller.install()
        initKoin {
            androidContext(this@TabakApp)
        }
    }
}
