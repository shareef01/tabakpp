package com.tabakpp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.tabakpp.app.di.initKoin
import org.koin.android.ext.koin.androidContext

class TabakApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Both build types use DebugAppCheckProviderFactory (register the device
        // token in Console → App Check), so App Check is left unenforced.
        // See SETUP_GUIDE.md → "Why App Check is not enforced".
        FirebaseApp.initializeApp(this)
        AppCheckInstaller.install()
        initKoin {
            androidContext(this@TabakApp)
        }
    }
}
