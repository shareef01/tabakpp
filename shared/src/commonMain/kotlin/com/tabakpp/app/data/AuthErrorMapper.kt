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
                // AuthViewModel.signUp rejects short passwords before this point, so
                // a server-side policy rejection only reaches here if the Console
                // policy is stricter than the client's length check. Firebase reports
                // that as PASSWORD_DOES_NOT_MEET_REQUIREMENTS, which matches none of
                // the branches below and used to fall through to the generic message.
                lower.contains("weak") ||
                    lower.contains("does_not_meet") ||
                    lower.contains("does not meet") ||
                    lower.contains("password_does_not") ->
                    "Use a password with at least 12 characters."
                lower.contains("network") -> "Network error. Check your connection."
                else -> "Could not create account."
            }
            Context.LOGIN -> when {
                lower.contains("not available on this platform") || lower.contains("unsupportedoperation") ->
                    "Google Sign-In is not available on this device."
                lower.contains("cancelled") || lower.contains("canceled") ->
                    "Sign-in cancelled."
                // Misconfigured API-key/SHA-1 restrictions. The remedy is the
                // maintainer's, not the user's — don't print build internals into
                // a login screen (see SETUP_GUIDE.md → Android API key).
                lower.contains("are blocked") || lower.contains("android client") ->
                    "Sign-in is unavailable for this app build. Please try again later."
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
