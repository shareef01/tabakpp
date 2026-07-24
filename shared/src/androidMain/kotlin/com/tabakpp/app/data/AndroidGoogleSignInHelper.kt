package com.tabakpp.app.data

import android.app.Activity
import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AndroidGoogleSignInHelper(
    private val context: Context
) : GoogleSignInHelper {

    override val isAvailable: Boolean = true

    override suspend fun getIdToken(): String = withContext(Dispatchers.Main) {
        val activity: Activity = ActivityHolder.get()
            ?: throw IllegalStateException("Sign-in UI is not ready")

        val webClientId = resolveWebClientId(context)
            ?: throw IllegalStateException("Missing default_web_client_id — add a Web OAuth client in Firebase")

        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(webClientId)
            .setAutoSelectEnabled(false)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        try {
            val response = CredentialManager.create(context)
                .getCredential(activity, request)
            val credential = response.credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                GoogleIdTokenCredential.createFrom(credential.data).idToken
            } else {
                throw IllegalStateException("Unexpected credential type")
            }
        } catch (e: GetCredentialCancellationException) {
            throw Exception("Google sign-in cancelled")
        } catch (e: NoCredentialException) {
            throw Exception("No Google account available on this device")
        }
    }

    private fun resolveWebClientId(context: Context): String? {
        val resId = context.resources.getIdentifier(
            "default_web_client_id",
            "string",
            context.packageName
        )
        if (resId == 0) return null
        return context.getString(resId).takeIf { it.isNotBlank() }
    }
}
