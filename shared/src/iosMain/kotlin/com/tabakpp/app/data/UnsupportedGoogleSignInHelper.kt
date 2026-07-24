package com.tabakpp.app.data

class UnsupportedGoogleSignInHelper : GoogleSignInHelper {
    override val isAvailable: Boolean = false

    override suspend fun getIdToken(): String {
        throw UnsupportedOperationException("Google Sign-In is not available on this platform")
    }
}
