package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds use a debug token (register in Console → App Check). */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance()
        )
    }
}
