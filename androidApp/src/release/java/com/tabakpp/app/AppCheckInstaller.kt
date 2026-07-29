package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

/** Release builds use Play Integrity. */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        )
    }
}
