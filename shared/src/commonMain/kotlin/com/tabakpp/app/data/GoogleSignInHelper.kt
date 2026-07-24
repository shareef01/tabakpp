package com.tabakpp.app.data

/**
 * Platform Google Sign-In that returns a Firebase-compatible ID token.
 * Android uses Credential Manager; iOS reports unavailable until wired.
 */
interface GoogleSignInHelper {
    /** False on platforms where Google Sign-In is not implemented. */
    val isAvailable: Boolean
    suspend fun getIdToken(): String
}
