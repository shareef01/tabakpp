package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Staging builds use a debug token (register it in the tabakpp-staging
 * Console → App Check). `staging` is `initWith(debug)`, but that copies build
 * settings only — not the src/debug source set — so it needs its own copy.
 */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance()
        )
        // Explicitly keep App Check token auto-refresh enabled independently of
        // Firebase's global data-collection default flag. When using
        // installAppCheckProviderFactory(), auto-refresh follows that global
        // default; this call ensures tokens refresh unless disabled elsewhere.
        FirebaseAppCheck.getInstance().setTokenAutoRefreshEnabled(true)
    }
}
