package com.tabakpp.app.data

import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.functions.functions
import dev.gitlive.firebase.functions.httpsCallable
import kotlinx.serialization.Serializable

/**
 * Result of a trusted financial operation (Phase 3).
 *
 * @param applied false when the receipt already existed (idempotent retry).
 * @param raw the server result payload, if any.
 */
data class TrustedOperationResult(
    val applied: Boolean,
    val raw: Map<String, Any?> = emptyMap()
)

/**
 * Wire shape of the `executeFinancialOperation` envelope. Only the fields the
 * client actually consumes are declared; unknown keys are ignored because the
 * response is a free-form JSON object.
 */
@Serializable
private data class TrustedOperationResponse(
    val applied: Boolean = true,
)

/**
 * The trusted write gateway for OPTION_B accounts. Every OPTION_B mutation goes
 * through the `executeFinancialOperation` callable; the client never computes or
 * persists canonical credit, and never falls back to a direct Firestore write.
 */
interface TrustedFinancial {
    suspend fun execute(type: String, payload: Map<String, Any?>): TrustedOperationResult
}

/** Firebase implementation backed by the GitLive callable SDK. */
class FirebaseTrustedFinancial(
    /** Callable region (the trusted function is deployed to europe-west1). */
    private val region: String? = null,
    /** When set, the Functions EMULATOR is used (tests only — never production). */
    private val emulatorHost: String? = null,
    private val emulatorPort: Int = 5001,
) : TrustedFinancial {
    override suspend fun execute(type: String, payload: Map<String, Any?>): TrustedOperationResult {
        val functions = if (region != null) Firebase.functions(region) else Firebase.functions
        if (emulatorHost != null) functions.useEmulator(emulatorHost, emulatorPort)
        val callable = functions.httpsCallable("executeFinancialOperation")
        // GitLive decodes the callable envelope with its own (non-Json) decoder,
        // so the result must be a @Serializable type — not a JsonElement.
        val data = callable.invoke(mapOf("type" to type) + payload)
            .data<TrustedOperationResponse>()
        return TrustedOperationResult(applied = data.applied)
    }
}
