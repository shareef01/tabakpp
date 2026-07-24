package com.tabakpp.app.data

/**
 * Maps Firebase Auth failures to generic, non-enumerating user copy.
 */
object AuthErrorMapper {
    fun map(throwable: Throwable?, context: Context = Context.LOGIN): String {
        val message = throwable?.message.orEmpty()
        val lower = message.lowercase()
        return when (context) {
            Context.RESET -> "If an account exists for that email, a reset link was sent."
            Context.DELETE -> when {
                lower.contains("data_wiped") || lower.contains("auth_remained") ->
                    "Your data was erased but login removal failed. Sign in again and retry Delete Account."
                lower.contains("cancel") -> "Deletion cancelled."
                lower.contains("password required") -> "Password required."
                lower.contains("password") || lower.contains("credential") || lower.contains("invalid") ->
                    "Incorrect password or Google confirmation failed."
                lower.contains("recent") -> "Please sign in again, then retry deletion."
                else -> "Could not delete account. Try again."
            }
            Context.REGISTER -> when {
                lower.contains("weak") -> "Use a password with at least 12 characters."
                lower.contains("network") -> "Network error. Check your connection."
                else -> "Could not create account."
            }
            Context.LOGIN -> when {
                lower.contains("not available on this platform") || lower.contains("unsupportedoperation") ->
                    "Google Sign-In is not available on this device."
                lower.contains("cancelled") || lower.contains("canceled") ->
                    "Sign-in cancelled."
                lower.contains("are blocked") || lower.contains("android client") ->
                    "This Android build is blocked by Firebase. Add the debug SHA-1 to the Android API key."
                lower.contains("password") || lower.contains("credential") ||
                    lower.contains("user-not-found") || lower.contains("invalid") ->
                    "Invalid email or password."
                lower.contains("too-many") -> "Too many attempts. Try again later."
                lower.contains("network") -> "Network error. Check your connection."
                else -> "Sign-in failed. Try again."
            }
        }
    }

    enum class Context { LOGIN, REGISTER, RESET, DELETE }
}
