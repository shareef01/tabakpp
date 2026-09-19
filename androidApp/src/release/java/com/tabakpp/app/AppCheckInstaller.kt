package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

/**
 * Release builds use the production Play Integrity provider.
 *
 * This source-set separation (src/release vs src/debug) is the
 * structural guarantee: only this class can ever be compiled into
 * a release APK, and it unconditionally selects PlayIntegrity.
 * There is no runtime branch that can fall back to the debug factory.
 *
 * Prerequisites for production attestation to work:
 * 1. The app's signing SHA-256 is registered in Firebase Console
 *    → App Check → Play Integrity provider.
 * 2. App Check enforcement is enabled in the Firebase Console
 *    only for supported existing client versions.
 *
 * See SETUP_GUIDE.md → "App Check rollout sequence" for the
 * step-by-step enforcement plan.
 */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        )
    }
}