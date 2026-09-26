package com.tabakpp.app.data

import dev.gitlive.firebase.firestore.FirebaseFirestoreException
import dev.gitlive.firebase.firestore.FirestoreExceptionCode

/**
 * Converts backend failures into stable, non-sensitive user-facing messages.
 * Raw Firebase exception text must never be displayed directly.
 *
 * Primary path is structured [FirestoreExceptionCode] from GitLive's
 * [FirebaseFirestoreException]. Message matching is a fallback only
 * for non-Firebase exceptions (e.g., client-side domain errors like
 * NOTHING_TO_ARCHIVE, DAY_CLOSED, CONFIG_NOT_FOUND).
 */
object RegistryErrorMapper {

    /**
     * Diagnostic record for instrumentation logs. Never contains secrets
     * or tokens — only exception type, structured code, message, and
     * operational context.
     */
    data class ErrorDiagnostics(
        val operation: String,
        val exceptionClass: String,
        val firestoreCode: FirestoreExceptionCode?,
        val message: String?,
        val causeChain: String,
        val documentPath: String?,
        val uidPresent: Boolean,
        val projectId: String?,
        val emulatorMode: Boolean,
    )

    fun map(throwable: Throwable, fallback: String = "Could not save. Try again."): String {
        return when (throwable) {
            is FirebaseFirestoreException -> mapFirestoreCode(throwable.code, fallback)
            else -> mapByMessage(throwable, fallback)
        }
    }

    /**
     * Structured code-based mapping — the primary path for Firestore errors.
     */
    fun mapFirestoreCode(code: FirestoreExceptionCode, fallback: String = "Could not save. Try again."): String {
        return when (code) {
            FirestoreExceptionCode.PERMISSION_DENIED ->
                "Save blocked by security rules. Refresh and try again."
            FirestoreExceptionCode.ABORTED ->
                "A conflict was detected. Slow down and try again."
            FirestoreExceptionCode.UNAVAILABLE,
            FirestoreExceptionCode.DEADLINE_EXCEEDED ->
                "Network error. Check your connection."
            FirestoreExceptionCode.UNAUTHENTICATED ->
                "Sign-in required. Refresh and try again."
            FirestoreExceptionCode.RESOURCE_EXHAUSTED ->
                "Too many requests. Slow down and try again."
            FirestoreExceptionCode.FAILED_PRECONDITION ->
                "This action is not available right now. Refresh and try again."
            else -> fallback
        }
    }

    /**
     * Message-based fallback for non-Firebase exceptions. Used for
     * application-layer errors (NOTHING_TO_ARCHIVE, DAY_CLOSED, etc.)
     * and for any exception that isn't a FirebaseFirestoreException.
     */
    private fun mapByMessage(throwable: Throwable, fallback: String): String {
        val message = throwable.message.orEmpty()
        val normalized = message.lowercase()

        return when {
            normalized.contains("permission_denied") ||
                normalized.contains("permission-denied") ->
                "Save blocked by security rules. Refresh and try again."
            normalized.contains("user_not_found") ->
                "Profile is not ready yet. Refresh and try again."
            normalized.contains("log_not_found") ->
                "That history entry no longer exists. Refresh and try again."
            normalized.contains("config_not_found") ->
                "That tracker no longer exists. Refresh and try again."
            normalized.contains("nothing_to_archive") ->
                "Nothing to archive — counters are at zero."
            normalized.contains("invalid_date") ->
                "Enter a valid date (YYYY-MM-DD)."
            normalized.contains("unavailable") ||
                normalized.contains("deadline-exceeded") ||
                normalized.contains("network") ->
                "Network error. Check your connection."
            normalized.contains("aborted") ->
                "A conflict was detected. Slow down and try again."
            else -> fallback
        }
    }

    /**
     * Build a diagnostic record for instrumentation tests and crash reports.
     * Captures structured context without exposing secrets.
     */
    fun diagnostics(
        throwable: Throwable,
        operation: String,
        documentPath: String? = null,
        uid: String? = null,
        projectId: String? = null,
        emulatorMode: Boolean = false,
    ): ErrorDiagnostics {
        val firestoreCode = (throwable as? FirebaseFirestoreException)?.code
        val causeChain = buildString {
            var cause: Throwable? = throwable
            while (cause != null) {
                append(cause.javaClass.name)
                cause = cause.cause
                if (cause != null) append(" -> ")
            }
        }
        return ErrorDiagnostics(
            operation = operation,
            exceptionClass = throwable.javaClass.name,
            firestoreCode = firestoreCode,
            message = throwable.message,
            causeChain = causeChain,
            documentPath = documentPath,
            uidPresent = uid != null,
            projectId = projectId,
            emulatorMode = emulatorMode,
        )
    }
}