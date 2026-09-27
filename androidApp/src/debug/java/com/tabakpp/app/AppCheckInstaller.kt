package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds use a debug token (register in Console → App Check). */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance()
        )
        // Explicitly enable token auto-refresh (matches Web: isTokenAutoRefreshEnabled = true).
        // Auto-refresh is enabled by default in the App Check SDK, but we set it
        // explicitly so future SDK changes cannot silently disable refresh.
        FirebaseAppCheck.getInstance().setTokenAutoRefreshEnabled(true)
    }
}
