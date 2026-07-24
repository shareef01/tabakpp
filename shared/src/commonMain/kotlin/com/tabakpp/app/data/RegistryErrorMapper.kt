package com.tabakpp.app.data

/**
 * Converts backend failures into stable, non-sensitive user-facing messages.
 * Raw Firebase exception text must never be displayed directly.
 */
object RegistryErrorMapper {
    fun map(throwable: Throwable, fallback: String = "Could not save. Try again."): String {
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
            normalized.contains("nothing_to_archive") ->
                "Nothing to archive — counters are at zero."
            normalized.contains("invalid_date") ->
                "Enter a valid date (YYYY-MM-DD)."
            normalized.contains("unavailable") ||
                normalized.contains("deadline-exceeded") ||
                normalized.contains("network") ->
                "Network error. Check your connection."
            else -> fallback
        }
    }
}
