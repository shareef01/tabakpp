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
 * Prerequisites for Play Integrity/App Check token issuance:
 *
 * Google Play Console:
 * 1. The Android app is registered and the Play Integrity API is enabled,
 *    linked to the correct Cloud/Firebase project.
 *
 * Firebase Console → App Check → Apps:
 * 2. The app is registered with the Play Integrity provider.
 * 3. The production signing certificate SHA-256 is supplied.
 *
 * Enforcement rollout (separate later step — not required for attestation):
 * - Distribute the App Check-enabled client and observe App Check metrics.
 * - Enable enforcement only when legitimate users are verified compatible.
 * See SETUP_GUIDE.md → "App Check rollout sequence" for the step-by-step plan.
 */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        )
        // Explicitly keep App Check token auto-refresh enabled independently of
        // Firebase's global data-collection default flag. When using
        // installAppCheckProviderFactory(), auto-refresh follows that global
        // default; this call ensures tokens refresh unless disabled elsewhere.
        FirebaseAppCheck.getInstance().setTokenAutoRefreshEnabled(true)
    }
}