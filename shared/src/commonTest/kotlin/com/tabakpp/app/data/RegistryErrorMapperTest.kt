package com.tabakpp.app.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RegistryErrorMapperTest {

    // --- Message-based fallback tests (existing behavior) ---

    @Test
    fun permissionDenied_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            RuntimeException("FirebaseFirestoreException: PERMISSION_DENIED: Missing or insufficient permissions."),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("security rules"), msg)
    }

    @Test
    fun aborted_transaction_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            RuntimeException("FirebaseFirestoreException: ABORTED: Transaction failed too many times."),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("conflict"), msg.lowercase())
    }

    @Test
    fun unrecognizedError_fallsThroughToFallback() {
        val fallback = "Could not save that change. Your count was restored."
        val msg = RegistryErrorMapper.map(RuntimeException("Some unknown error"), fallback = fallback)
        assertEquals(fallback, msg)
    }

    @Test
    fun networkError_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            RuntimeException("FirebaseFirestoreException: UNAVAILABLE: network error."),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("Network error"), msg)
    }

    // --- Diagnostics tests ---

    @Test
    fun diagnostics_capturesNonFirestoreException() {
        val exc = RuntimeException("NOTHING_TO_ARCHIVE")
        val diag = RegistryErrorMapper.diagnostics(
            throwable = exc,
            operation = "closeDay",
            documentPath = "users/uid123/days/2026-09-20",
            uid = null,
            projectId = "demo-tabakpp-test",
            emulatorMode = true
        )
        assertEquals("closeDay", diag.operation)
        assertEquals(null, diag.firestoreCode)
        assertEquals(false, diag.uidPresent)
        assertEquals("demo-tabakpp-test", diag.projectId)
    }
}
