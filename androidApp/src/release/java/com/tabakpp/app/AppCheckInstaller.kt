package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * GitHub-distributed release APKs are sideloaded, so Play Integrity attestation
 * fails. Use the debug App Check provider and register each device token in
 * Firebase Console → App Check → Manage debug tokens (see SETUP_GUIDE.md).
 */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance()
        )
    }
}
