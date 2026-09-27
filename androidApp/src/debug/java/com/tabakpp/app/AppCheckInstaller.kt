package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds use a debug token (register in Console → App Check). */
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
