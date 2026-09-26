package com.tabakpp.app.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.gitlive.firebase.firestore.FirebaseFirestoreException
import dev.gitlive.firebase.firestore.FirestoreExceptionCode
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Instrumentation tests for structured Firestore exception mapping.
 *
 * These tests construct real [FirebaseFirestoreException] instances that resolve
 * to the native [com.google.firebase.firestore.FirebaseFirestoreException] on Android.
 * They run on-device via AndroidJUnit4, where the full Android framework is available.
 *
 * Platform-neutral mapper/fallback logic is tested in commonTest; this source set
 * covers the native Firebase exception behavior that cannot be exercised on the JVM.
 */
@RunWith(AndroidJUnit4::class)
class RegistryErrorStructuredCodeTest {

    @Test
    fun structuredPermissionDenied_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Missing permissions", FirestoreExceptionCode.PERMISSION_DENIED),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("security rules"), msg)
    }

    @Test
    fun structuredAborted_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Too much contention", FirestoreExceptionCode.ABORTED),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("conflict"), msg.lowercase())
    }

    @Test
    fun structuredUnavailable_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Offline", FirestoreExceptionCode.UNAVAILABLE),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("Network error"), msg)
    }

    @Test
    fun structuredDeadlineExceeded_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Deadline exceeded", FirestoreExceptionCode.DEADLINE_EXCEEDED),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("Network error"), msg)
    }

    @Test
    fun structuredResourceExhausted_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Quota exceeded", FirestoreExceptionCode.RESOURCE_EXHAUSTED),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("Too many requests"), msg)
    }

    @Test
    fun structuredFailedPrecondition_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Condition not met", FirestoreExceptionCode.FAILED_PRECONDITION),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("not available"), msg.lowercase())
    }

    @Test
    fun structuredUnauthenticated_isMappedToUserMessage() {
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Unauthenticated", FirestoreExceptionCode.UNAUTHENTICATED),
            fallback = "Could not save."
        )
        assertTrue(msg.contains("Sign-in required"), msg)
    }

    @Test
    fun structuredUnknownCode_fallsThroughToFallback() {
        val fallback = "Could not save that change. Your count was restored."
        val msg = RegistryErrorMapper.map(
            FirebaseFirestoreException("Something weird", FirestoreExceptionCode.UNKNOWN),
            fallback = fallback
        )
        assertEquals(fallback, msg)
    }

    @Test
    fun diagnostics_capturesFirestoreExceptionDetails() {
        val exc = FirebaseFirestoreException("Too much contention", FirestoreExceptionCode.ABORTED)
        val diag = RegistryErrorMapper.diagnostics(
            throwable = exc,
            operation = "updateLiveCounter",
            documentPath = "users/uid123/days/2026-09-20",
            uid = "uid123",
            projectId = "demo-tabakpp-test",
            emulatorMode = true
        )
        assertEquals("updateLiveCounter", diag.operation)
        assertEquals(FirestoreExceptionCode.ABORTED, diag.firestoreCode)
        assertEquals(true, diag.uidPresent)
        assertTrue(diag.causeChain.contains("FirebaseFirestoreException"))
        assertEquals("demo-tabakpp-test", diag.projectId)
        assertTrue(diag.emulatorMode)
    }
}
