package com.tabakpp.app.data

import dev.gitlive.firebase.firestore.Timestamp
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ErrorAndInputPolicyTest {
    @Test
    fun registrationErrorsDoNotRevealExistingAccounts() {
        val existing = AuthErrorMapper.map(
            Exception("EMAIL_ALREADY_IN_USE"),
            AuthErrorMapper.Context.REGISTER
        )
        val unknown = AuthErrorMapper.map(
            Exception("SOME_OTHER_FAILURE"),
            AuthErrorMapper.Context.REGISTER
        )

        assertEquals(unknown, existing)
        assertFalse(existing.contains("registered", ignoreCase = true))
    }

    @Test
    fun resetAcknowledgmentIsAlwaysTheSame() {
        val missing = AuthErrorMapper.map(
            Exception("USER_NOT_FOUND"),
            AuthErrorMapper.Context.RESET
        )
        val success = AuthErrorMapper.map(null, AuthErrorMapper.Context.RESET)

        assertEquals(success, missing)
    }

    @Test
    fun loginMapsCancellation() {
        assertEquals(
            "Sign-in cancelled.",
            AuthErrorMapper.map(Exception("Google sign-in cancelled"), AuthErrorMapper.Context.LOGIN)
        )
    }

    @Test
    fun blockedAndroidClientErrorLeaksNoBuildInternals() {
        // A misconfigured API key / SHA-1 restriction is the maintainer's problem.
        // The user gets a plain retry message — never the package name, the raw
        // Firebase text, or remediation steps naming SHA-1 / API keys.
        val mapped = AuthErrorMapper.map(
            Exception(
                "An internal error has occurred. [ Requests from this Android client " +
                    "application com.tabakpp.app are blocked. ]"
            ),
            AuthErrorMapper.Context.LOGIN
        )

        assertFalse(mapped.contains("SHA", ignoreCase = true))
        assertFalse(mapped.contains("API key", ignoreCase = true))
        assertFalse(mapped.contains("com.tabakpp.app"))
        assertFalse(mapped.contains("internal error", ignoreCase = true))
        assertTrue(mapped.isNotBlank())
    }

    @Test
    fun registryErrorsNeverExposeRawBackendText() {
        val raw = "INTERNAL: projects/example/databases/(default) unavailable"
        val mapped = RegistryErrorMapper.map(Exception(raw))

        assertEquals("Network error. Check your connection.", mapped)
        assertFalse(mapped.contains("projects/example"))
    }

    @Test
    fun registryMapperHandlesStableDomainCodes() {
        assertTrue(
            RegistryErrorMapper.map(Exception("LOG_NOT_FOUND"))
                .contains("no longer exists")
        )
        assertTrue(
            RegistryErrorMapper.map(Exception("CONFIG_NOT_FOUND"))
                .contains("no longer exists")
        )
        assertTrue(
            RegistryErrorMapper.map(Exception("NOTHING_TO_ARCHIVE"))
                .contains("Nothing to archive")
        )
    }

    @Test
    fun deleteMapperSurfacesDataWipedRecovery() {
        val mapped = AuthErrorMapper.map(
            Exception("DATA_WIPED_AUTH_REMAINED: Auth delete failed"),
            AuthErrorMapper.Context.DELETE
        )
        assertTrue(mapped.contains("erased", ignoreCase = true))
        assertTrue(mapped.contains("retry", ignoreCase = true))
    }

    @Test
    fun inputSanitizerBoundsAndRemovesMarkup() {
        val tracker = InputSanitizer.trackerName("  <script>${"x".repeat(100)}  ")
        val displayName = InputSanitizer.displayName("A\u0000lice>")

        assertFalse(tracker.contains('<'))
        assertTrue(tracker.length <= 80)
        assertEquals("Alice", displayName)
    }

    @Test
    fun displayNameSanitizerTrimsOptionalRegistrationNames() {
        assertEquals("", InputSanitizer.displayName("   "))
        assertEquals("Ada", InputSanitizer.displayName("  Ada  "))
    }

    @Test
    fun logEntryAcceptsLegacyMillisTimestampsViaSerializer() {
        // Regression: GitLive Timestamp serializer crashes on raw epoch millis
        // (e.g. 1784128326208) that older clients wrote into clientTimestamp.
        val millis = 1_784_128_326_208L
        val seconds = millis / 1000
        val nanos = ((millis % 1000) * 1_000_000).toInt()
        val entry = LogEntry(
            id = "x",
            logDate = "2026-07-24",
            clientTimestamp = Timestamp(seconds, nanos)
        )
        assertEquals("x", entry.id)
        assertEquals(seconds, (entry.clientTimestamp as Timestamp).seconds)
    }

    @Test
    fun countSanitizerRejectsInvalidValuesAndBoundsMapSize() {
        val values = buildMap {
            repeat(55) { put("valid-$it", it.toDouble()) }
            put("negative", -1.0)
            put("infinite", Double.POSITIVE_INFINITY)
            put("excessive", 10_001.0)
            put("bad key!", 1.0)
            put("x".repeat(65), 1.0)
        }

        val normalized = InputSanitizer.counts(values)

        assertEquals(50, normalized.size)
        assertFalse("negative" in normalized)
        assertFalse("infinite" in normalized)
        assertFalse("excessive" in normalized)
        assertFalse("bad key!" in normalized)
        assertFalse("x".repeat(65) in normalized)
    }
}
