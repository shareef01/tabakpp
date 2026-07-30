package com.tabakpp.app

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Release builds use the debug App Check provider, so App Check is effectively
 * inert here and is left unenforced in the Console.
 *
 * Note this is a *configuration* limit, not a technical one: Play Integrity does
 * support apps distributed outside Google Play. It needs a Play Console entry to
 * link the Play Integrity API, plus App Check advanced settings that stop
 * requiring the PLAY_RECOGNIZED verdict (which non-Play apps never receive).
 * Since this app ships via GitHub Releases only, that link does not exist, and
 * each debug token has to be registered by hand per device.
 *
 * SETUP_GUIDE.md → "Why App Check is not enforced" has the full upgrade path.
 */
internal object AppCheckInstaller {
    fun install() {
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            DebugAppCheckProviderFactory.getInstance()
        )
    }
}
