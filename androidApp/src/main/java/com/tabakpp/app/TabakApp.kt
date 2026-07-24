package com.tabakpp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.tabakpp.app.di.initKoin
import org.koin.android.ext.koin.androidContext

class TabakApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Release: Play Integrity guards Auth/Firestore quotas.
        // Debug: no App Check provider. A debug client that hammers the App Check
        // token-exchange endpoint with an unregistered/abuse-flagged identity gets
        // server-side blocked ("Requests from this Android client are blocked"),
        // which also cascades into Auth's reCAPTCHA fallback. To enable App Check
        // in debug later, register a debug token in Console → App Check → Manage
        // debug tokens, then install DebugAppCheckProviderFactory here.
        FirebaseApp.initializeApp(this)
        if (!BuildConfig.DEBUG) {
            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
                PlayIntegrityAppCheckProviderFactory.getInstance()
            )
        }
        initKoin {
            androidContext(this@TabakApp)
        }
    }
}
