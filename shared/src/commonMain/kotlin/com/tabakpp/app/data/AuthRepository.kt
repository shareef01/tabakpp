package com.tabakpp.app.data

import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    val currentUser: Flow<User?>
    /** False on platforms without a Google Sign-In implementation (e.g. iOS stub). */
    val isGoogleSignInAvailable: Boolean
    suspend fun signInWithGoogle(): Result<Unit>
    suspend fun signInWithEmail(email: String, password: String): Result<Unit>
    suspend fun signUpWithEmail(email: String, password: String, displayName: String? = null): Result<Unit>
    suspend fun sendPasswordResetEmail(email: String): Result<Unit>
    suspend fun updateDisplayName(name: String): Result<Unit>
    suspend fun signOut()
    /**
     * Reauth, wipe Firestore user subtree, then delete Auth user.
     * Pass a password for email/password accounts; omit (or blank) to reauth via Google.
     */
    suspend fun deleteAccount(password: String? = null): Result<Unit>
}

data class User(
    val uid: String,
    val email: String?,
    val displayName: String?,
    val photoUrl: String?,
    val hasPasswordProvider: Boolean = false,
    val hasGoogleProvider: Boolean = false,
)
