package com.tabakpp.app.data

import dev.gitlive.firebase.auth.EmailAuthProvider
import dev.gitlive.firebase.auth.FirebaseAuth
import dev.gitlive.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class FirebaseAuthRepository(
    private val auth: FirebaseAuth,
    private val registryRepository: RegistryRepository,
    private val googleSignInHelper: GoogleSignInHelper
) : AuthRepository {

    override val isGoogleSignInAvailable: Boolean = googleSignInHelper.isAvailable

    override val currentUser: Flow<User?> = auth.authStateChanged.map { firebaseUser ->
        firebaseUser?.let {
            val providers = it.providerData.map { info -> info.providerId }
            User(
                uid = it.uid,
                email = it.email,
                displayName = it.displayName,
                photoUrl = it.photoURL,
                hasPasswordProvider = providers.any { id -> id == "password" },
                hasGoogleProvider = providers.any { id -> id == "google.com" }
            )
        }
    }

    override suspend fun signInWithEmail(email: String, password: String): Result<Unit> = runCatching {
        val result = auth.signInWithEmailAndPassword(email, password)
        val uid = result.user?.uid ?: throw Exception("Auth failed")
        registryRepository.ensureUserDocument(uid, result.user?.displayName)
    }

    override suspend fun signUpWithEmail(
        email: String,
        password: String,
        displayName: String?
    ): Result<Unit> = runCatching {
        val result = auth.createUserWithEmailAndPassword(email, password)
        val user = result.user ?: throw Exception("Auth failed")
        val safeName = displayName?.let(InputSanitizer::displayName)?.takeIf(String::isNotBlank)
        if (safeName != null) user.updateProfile(displayName = safeName)
        registryRepository.ensureUserDocument(user.uid, safeName ?: user.displayName)
    }

    override suspend fun sendPasswordResetEmail(email: String): Result<Unit> = runCatching {
        auth.sendPasswordResetEmail(email)
    }

    override suspend fun updateDisplayName(name: String): Result<Unit> = runCatching {
        auth.currentUser?.updateProfile(displayName = name)
    }

    override suspend fun signInWithGoogle(): Result<Unit> = runCatching {
        if (!googleSignInHelper.isAvailable) {
            throw UnsupportedOperationException("Google Sign-In is not available on this platform")
        }
        val idToken = googleSignInHelper.getIdToken()
        val result = auth.signInWithCredential(GoogleAuthProvider.credential(idToken, null))
        val uid = result.user?.uid ?: throw Exception("Auth failed")
        registryRepository.ensureUserDocument(uid, result.user?.displayName)
    }

    override suspend fun signOut() {
        auth.signOut()
    }

    override suspend fun deleteAccount(password: String?): Result<Unit> = runCatching {
        val user = auth.currentUser ?: throw Exception("Not signed in")
        val providers = user.providerData.map { it.providerId }
        val hasPassword = providers.any { it == "password" }
        val hasGoogle = providers.any { it == "google.com" }

        when {
            !password.isNullOrBlank() && hasPassword -> {
                val email = user.email ?: throw Exception("Email account required")
                user.reauthenticate(EmailAuthProvider.credential(email, password))
            }
            hasGoogle && password.isNullOrBlank() -> {
                val idToken = googleSignInHelper.getIdToken()
                user.reauthenticate(GoogleAuthProvider.credential(idToken, null))
            }
            hasPassword -> throw Exception("Password required")
            hasGoogle -> {
                val idToken = googleSignInHelper.getIdToken()
                user.reauthenticate(GoogleAuthProvider.credential(idToken, null))
            }
            else -> throw Exception("No supported sign-in method for deletion")
        }

        registryRepository.deleteAllUserData(user.uid)
        var lastError: Exception? = null
        repeat(3) { attempt ->
            try {
                user.delete()
                return@runCatching
            } catch (e: Exception) {
                lastError = e
                if (attempt < 2) kotlinx.coroutines.delay(400L * (attempt + 1))
            }
        }
        throw Exception(
            "DATA_WIPED_AUTH_REMAINED: ${lastError?.message ?: "Auth delete failed"}"
        )
    }
}
