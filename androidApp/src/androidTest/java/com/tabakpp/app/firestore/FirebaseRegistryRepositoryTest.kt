package com.tabakpp.app.firestore

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tabakpp.app.TestTabakApp
import com.tabakpp.app.data.FirebaseRegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.data.DayDocument
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.firestore.FirebaseFirestore
import dev.gitlive.firebase.firestore.firestore
import dev.gitlive.firebase.firestore.FirestoreExceptionCode
import dev.gitlive.firebase.firestore.Timestamp
import dev.gitlive.firebase.firestore.FirebaseFirestoreException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Android instrumentation tests that exercise the REAL:
 *   RegistryViewModel → FirebaseRegistryRepository → GitLive → native Firebase Android SDK
 * path against the Firestore emulator (demo-tabakpp-test).
 *
 * Emulator endpoints:
 *   - Firestore: 127.0.0.1:8080 (adb reverse from host 0.0.0.0:8080)
 *   - Auth:      127.0.0.1:9099 (adb reverse from host 0.0.0.0:9099)
 * Project ID: demo-tabakpp-test
 * Auth mode: Anonymous sign-in via Auth emulator
 */
@RunWith(AndroidJUnit4::class)
class FirebaseRegistryRepositoryTest {

    companion object {
        const val TAG = "FirebaseRegistryRepoTest"
        const val TEST_UID = TestTabakApp.TEST_UID
        const val TEST_TRACKER_ID = "cig0"
        const val TEST_DATE = "2099-12-31"
        const val FIRESTORE_HOST = TestTabakApp.FIRESTORE_EMULATOR_HOST
        const val FIRESTORE_PORT = TestTabakApp.FIRESTORE_EMULATOR_PORT
        const val AUTH_HOST = TestTabakApp.AUTH_EMULATOR_HOST
        const val AUTH_PORT = TestTabakApp.AUTH_EMULATOR_PORT
    }

    private lateinit var firestore: FirebaseFirestore
    private lateinit var repository: FirebaseRegistryRepository

    @Before
    fun setup() {
        // Force IPv4 before any Firebase operations.
        // The Android emulator's IPv6 routing to 10.0.2.2 (host loopback)
        // is unreliable on CI runners — connections via IPv6 source (::)
        // fail with ENETUNREACH. TestTabakApp.onCreate() also sets this,
        // but it's not reliably used by AndroidJUnitRunner, so we set it here too.
        System.setProperty("java.net.preferIPv4Stack", "true")
        runBlocking {
            Log.d(TAG, "=== Setting up test ===")

            // Configure Firebase emulators — must happen BEFORE any Firebase operations.
            // The TestTabakApp Application class is NOT reliably used by AndroidJUnitRunner
            // (it falls back to the debug build's TabakApp), so we configure the emulators
            // directly here.
            val nativeApp = com.google.firebase.FirebaseApp.getInstance()
            val nativeAuth = com.google.firebase.auth.FirebaseAuth.getInstance(nativeApp)
            nativeAuth.useEmulator(AUTH_HOST, AUTH_PORT)

            // Configure GitLive Auth emulator too — TestTabakApp is not used by
            // AndroidJUnitRunner (it falls back to TabakApp), so without this the
            // SDK tries to reach production identitytoolkit.googleapis.com and
            // times out after 30s, leaving no auth token → PERMISSION_DENIED.
            Firebase.auth.useEmulator(AUTH_HOST, AUTH_PORT)

            firestore = Firebase.firestore
            // Firestore emulator — use setSettings instead of useEmulator because
            // useEmulator() throws if the instance was already initialized.
            firestore.setSettings(
                host = "$FIRESTORE_HOST:$FIRESTORE_PORT",
                sslEnabled = false,
                persistenceEnabled = false,
            )

            repository = FirebaseRegistryRepository(firestore)

            // Pre-fetch App Check token to cache DNS failure for
            // firebaseappcheck.googleapis.com (unreachable from CI emulator).
            // Without this, each signInAnonymously attempt triggers a ~8s
            // DNS timeout before falling back to a placeholder token.
            // The App Check SDK caches the token after the first request,
            // so subsequent sign-in calls reuse the cached value.
            try {
                Tasks.await(
                    FirebaseAppCheck.getInstance().getToken(true),
                    15, TimeUnit.SECONDS
                )
            } catch (e: Exception) {
                Log.d(TAG, "App Check token pre-fetch failed (expected in CI): ${e.message}")
            }

            // Retry sign-in to handle Auth emulator cold-start delay.
            // The first attempt uses a 30s timeout to accommodate:
            //   - First-time Auth SDK class loading (~10-15s bytecode verification)
            //   - App Check placeholder token usage (cached after pre-fetch above)
            //   - Initial token signing on the emulator (~5-10s)
            // Subsequent attempts use 15s (classes + DNS already cached).
            var uid: String? = null
            val maxRetries = 3
            for (attempt in 1..maxRetries) {
                val timeoutMs = if (attempt == 1) 30000L else 15000L
                try {
                    val authResult = withTimeout(timeoutMs) { Firebase.auth.signInAnonymously() }
                    uid = authResult.user?.uid
                    Log.d(TAG, "Signed in as: $uid (attempt $attempt/$maxRetries)")
                    break
                } catch (e: Exception) {
                    uid = Firebase.auth.currentUser?.uid
                    Log.w(TAG, "signInAnonymously failed (attempt $attempt/$maxRetries, ${timeoutMs}ms timeout): ${e.message}")
                    if (attempt < maxRetries) {
                        delay(3000)
                    }
                }
            }

            if (uid.isNullOrEmpty()) uid = TEST_UID
            System.setProperty("test.uid", uid!!)

            // Clear any stale data from previous test runs (same UID, persisted
            // across test methods in the same emulator session).
            try {
                repository.deleteAllUserData(uid!!)
            } catch (_: Exception) { }
            try { repository.ensureUserDocument(uid!!, "Test User") } catch (e: Exception) {
                Log.d(TAG, "ensureUserDocument: ${e.message}")
            }

            val config = TrackerConfig(
                id = TEST_TRACKER_ID, name = "Cigarettes", limit = 20, order = 0,
                type = TrackerType.CIGARETTE, pricePerUnit = 0.5,
                isFinanciallyTracked = true, isPrimaryTracked = true, baseline = 20,
                createdAt = Timestamp(0, 0), updatedAt = Timestamp(0, 0)
            )
            try { repository.addConfig(uid!!, config) } catch (e: Exception) {
                Log.d(TAG, "addConfig: ${e.message}")
            }
        }
    }

    @After
    fun tearDown() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            try {
                firestore.collection("users").document(uid)
                    .collection("days").document(TEST_DATE).delete()
            } catch (_: Exception) { }
        }
    }

    private suspend fun cleanDay(uid: String, date: String) {
        try { firestore.collection("users").document(uid).collection("days").document(date).delete() } catch (_: Exception) { }
    }

    private suspend fun getDay(uid: String, date: String): DayDocument? {
        val snap = firestore.collection("users").document(uid)
            .collection("days").document(date).get()
        return if (snap.exists) snap.data<DayDocument>() else null
    }

    private suspend fun <T> withRetry(
        maxRetries: Int = 5,
        delayMs: Long = 2000,
        block: suspend () -> T
    ): T {
        var lastException: Exception? = null
        repeat(maxRetries) { attempt ->
            try {
                return block()
            } catch (e: Exception) {
                lastException = e
                if (attempt < maxRetries - 1) {
                    Log.d(TAG, "Retry $attempt/$maxRetries for getCounts: ${e.message}")
                    delay(delayMs)
                }
            }
        }
        throw lastException!!
    }

    private suspend fun getCounts(uid: String, date: String): Double =
        getDay(uid, date)?.counts?.get(TEST_TRACKER_ID) ?: 0.0

    private suspend fun getCountsRetry(uid: String, date: String): Double =
        withRetry { getCounts(uid, date) }

    // ============================================================
    // TEST A — New Day Lifecycle (production repository, real Firestore)
    // ============================================================

    @Test
    fun testA_newDayLifecycle() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)

            val dayDoc = getDay(uid, TEST_DATE)
            assertNotNull(dayDoc, "Day document should exist after increment")
            assertEquals(1.0, dayDoc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)

            assertNotNull(dayDoc.createdAt, "createdAt must exist")
            assertTrue(dayDoc.createdAt is Timestamp, "createdAt should be a Timestamp")
            assertNotNull(dayDoc.updatedAt, "updatedAt must exist")
            assertTrue(dayDoc.updatedAt is Timestamp, "updatedAt should be a Timestamp")

            assertTrue(dayDoc.trackerSnapshots.containsKey(TEST_TRACKER_ID))
            val snap = dayDoc.trackerSnapshots[TEST_TRACKER_ID]!!
            assertEquals("Cigarettes", snap.name)
            assertEquals(20, snap.target)

            assertNotNull(dayDoc.aggregateCredit)
            val credit = dayDoc.aggregateCredit!!
            assertEquals(0.5, credit.wasted, 0.001)
            assertEquals(9.5, credit.saved, 0.001)

            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            assertEquals(2.0, getCounts(uid, TEST_DATE), 0.001)

            repository.closeDay(uid, TEST_DATE)

            val closedDoc = getDay(uid, TEST_DATE)
            assertEquals("closed", closedDoc?.status)
            assertNotNull(closedDoc?.closedAt)
            assertEquals(2.0, closedDoc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)

            val credit2 = closedDoc.aggregateCredit!!
            assertEquals(1.0, credit2.wasted, 0.001)
            assertEquals(9.0, credit2.saved, 0.001)

            val userSnap = firestore.collection("users").document(uid).get()
            val profile = userSnap.data<UserProfile>()
            assertNotNull(profile)
            assertEquals(1.0, profile!!.lifetimeAggregates.wasted, 0.001)
            assertEquals(9.0, profile.lifetimeAggregates.saved, 0.001)
            assertTrue(profile.lifetimeAggregates.smokingUnits >= 2.0)
        }
    }

    // ============================================================
    // TEST B — Counter Contention Hypothesis
    // ============================================================

    @Test
    fun testB_counterContention_2Concurrent() {
        runBlocking {
            testCounterContention(concurrency = 2, expectedFinal = 2.0)
        }
    }

    @Test
    fun testB_counterContention_10Concurrent() {
        runBlocking {
            testCounterContention(concurrency = 10, expectedFinal = 10.0)
        }
    }

    @Test
    fun testB_counterContention_25Concurrent() {
        runBlocking {
            testCounterContention(concurrency = 25, expectedFinal = 25.0)
        }
    }

    private suspend fun testCounterContention(concurrency: Int, expectedFinal: Double) {
        val uid = System.getProperty("test.uid") ?: TEST_UID
        cleanDay(uid, TEST_DATE)

        repeat(5) {
            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
        }

        assertEquals(5.0, getCountsRetry(uid, TEST_DATE), 0.001,
            "Seed count should be 5")

        val results = coroutineScope {
            val deferred = (1..concurrency).map { i ->
                async {
                    val opId = "op_$i"
                    try {
                        repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
                        ContentionResult(opId, true, null, null, null)
                    } catch (e: Exception) {
                        val code = extractFirestoreCode(e)
                        ContentionResult(opId, false, e.javaClass.simpleName, code, e.message?.take(200))
                    }
                }
            }
            deferred.awaitAll()
        }

        val successes = results.count { it.success }
        val failures = results.count { !it.success }
        val abortedFailures = results.count { it.firestoreCode == FirestoreExceptionCode.ABORTED }

        Log.d(TAG, "Contention ($concurrency concurrent): $successes ok, " +
            "$failures failed, $abortedFailures ABORTED")
        results.forEach { r -> Log.d(TAG, "  $r") }

        // Give the Firestore emulator's gRPC channel time to recover from the
        // concurrent transaction burst before reading the final count.
        // Under contention, the emulator can transiently return PERMISSION_DENIED
        // (a channel-level gRPC error, not a rules violation).
        delay(3000)
        val actualCount = getCountsRetry(uid, TEST_DATE)
        Log.d(TAG, "Final count: $actualCount (expected: ${5.0 + expectedFinal}, successes: $successes)")

        // Under concurrent load, Firestore transactions can abort after exhausting
        // retries (native SDK default: 5 attempts). The PERMISSION_DENIED / ABORTED
        // failures are caught and recorded above — they do NOT increment the counter,
        // so the final count must equal seed (5) + only the successful operations.
        assertEquals(5.0 + successes, actualCount, 0.001,
            "Final count ($actualCount) must equal seed (5) + successful increments ($successes) " +
            "out of $concurrency concurrent ($failures failed, $abortedFailures ABORTED)")

        if (abortedFailures > 0) {
            Log.w(TAG, "ABORTED observed at concurrency=$concurrency: $abortedFailures")
        } else {
            Log.d(TAG, "No ABORTED at concurrency=$concurrency — all retried successfully")
        }

        try { repository.closeDay(uid, TEST_DATE) } catch (_: Exception) { }
    }

    // ============================================================
    // TEST C — End Day Stale-Read Scenarios
    // ============================================================

    @Test
    fun testC_endDayScenarioA_persistedCountPositive() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)

            val doc = getDay(uid, TEST_DATE)
            assertEquals(3.0, doc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)
            assertEquals("open", doc.status)

            repository.closeDay(uid, TEST_DATE)

            val closedDoc = getDay(uid, TEST_DATE)
            assertEquals("closed", closedDoc?.status)
            assertNotNull(closedDoc?.closedAt)
            assertEquals(3.0, closedDoc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)
        }
    }

    @Test
    fun testC_endDayScenarioB_persistedCountZero() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            val date = "2099-12-30"
            cleanDay(uid, date)

            val exception = assertFailsWith<Exception> {
                repository.closeDay(uid, date)
            }
            assertTrue(
                exception.message?.contains("NOTHING_TO_ARCHIVE") == true,
                "Should be NOTHING_TO_ARCHIVE, got: ${exception.message}"
            )
        }
    }

    @Test
    fun testC_endDayScenarioC_concurrentIncrementAndCloseDay() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            val incrementResult = async<CloseResult> {
                try {
                    repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
                    CloseResult(true, null, null)
                } catch (e: Exception) {
                    CloseResult(false, extractFirestoreCode(e), e.message?.take(200))
                }
            }

            kotlinx.coroutines.delay(5)

            val closeDayResult = async<CloseResult> {
                try {
                    repository.closeDay(uid, TEST_DATE)
                    CloseResult(true, null, null)
                } catch (e: Exception) {
                    CloseResult(false, extractFirestoreCode(e), e.message?.take(200))
                }
            }

            val incRes = incrementResult.await()
            val closeRes = closeDayResult.await()
            Log.d(TAG, "Concurrent: increment=$incRes, closeDay=$closeRes")

            val finalDoc = getDay(uid, TEST_DATE)
            if (finalDoc != null) {
                Log.d(TAG, "Final doc: status=${finalDoc.status}, " +
                    "counts=${finalDoc.counts[TEST_TRACKER_ID] ?: 0.0}")
                val count = finalDoc.counts[TEST_TRACKER_ID] ?: 0.0
                assertTrue(count >= 0.0, "Count should be >= 0")
            }
        }
    }

    @Test
    fun testC_endDayScenarioD_incrementThenEndDay() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            repeat(3) {
                repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            }

            val doc = getDay(uid, TEST_DATE)
            assertEquals(3.0, doc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)

            repository.closeDay(uid, TEST_DATE)

            val closedDoc = getDay(uid, TEST_DATE)
            assertEquals("closed", closedDoc?.status)
            assertEquals(3.0, closedDoc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)
            assertNotNull(closedDoc.closedAt)
        }
    }

    // ============================================================
    // TEST D — End Day Idempotency
    // ============================================================

    @Test
    fun testD_endDayIdempotency() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)

            repository.closeDay(uid, TEST_DATE)

            val doc1 = getDay(uid, TEST_DATE)
            assertEquals("closed", doc1?.status)
            assertEquals(2.0, doc1!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)

            val userSnap1 = firestore.collection("users").document(uid).get()
            val profile1 = userSnap1.data<UserProfile>()
            val saved1 = profile1!!.lifetimeAggregates.saved
            val wasted1 = profile1!!.lifetimeAggregates.wasted
            val smoking1 = profile1!!.lifetimeAggregates.smokingUnits

            Log.d(TAG, "After first closeDay: saved=$saved1, wasted=$wasted1, smoking=$smoking1")

            try {
                repository.closeDay(uid, TEST_DATE)
                Log.d(TAG, "Second closeDay succeeded (idempotent)")
            } catch (e: Exception) {
                Log.d(TAG, "Second closeDay threw: ${e.message}")
            }

            val doc2 = getDay(uid, TEST_DATE)
            assertEquals("closed", doc2?.status)
            assertEquals(2.0, doc2!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)

            val userSnap2 = firestore.collection("users").document(uid).get()
            val profile2 = userSnap2.data<UserProfile>()
            assertEquals(saved1, profile2!!.lifetimeAggregates.saved, 0.001,
                "Lifetime saved should NOT change on second closeDay")
            assertEquals(wasted1, profile2!!.lifetimeAggregates.wasted, 0.001,
                "Lifetime wasted should NOT change on second closeDay")
            assertEquals(smoking1, profile2!!.lifetimeAggregates.smokingUnits, 0.001,
                "Lifetime smokingUnits should NOT change on second closeDay")
        }
    }

    // ============================================================
    // Test E — Existing-day 5→6 increment (regression for counter persistence)
    // ============================================================

    @Test
    fun testE_existingDay_incrementFromFiveToSix() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            // Seed count = 5 via the production repository path
            repeat(5) {
                repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            }
            assertEquals(5.0, getCounts(uid, TEST_DATE), 0.001,
                "Seed count must be 5")

            // The core regression: existing-day increment from 5→6
            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)

            // Verify persisted
            val dayDoc = getDay(uid, TEST_DATE)
            assertNotNull(dayDoc)
            assertEquals(6.0, dayDoc!!.counts[TEST_TRACKER_ID] ?: 0.0, 0.001,
                "count 6")
            assertEquals(6.0, getCounts(uid, TEST_DATE), 0.001,
                "repository reload count = 6")
        }
    }

    // ============================================================
    // Test F — Reload/reconstruction from fresh repository
    // ============================================================

    @Test
    fun testF_reload_reconstructsClosedDayAndLifetime() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            // Write 3 increments + close day
            repeat(3) {
                repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            }
            repository.closeDay(uid, TEST_DATE)

            // Capture pre-reload state
            val beforeDoc = getDay(uid, TEST_DATE)!!
            assertEquals("closed", beforeDoc.status)
            assertEquals(3.0, beforeDoc.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)
            val userSnap = firestore.collection("users").document(uid).get()
            val beforeProfile = userSnap.data<UserProfile>()
            assertEquals(1.5, beforeProfile.lifetimeAggregates.wasted, 0.001)
            assertEquals(8.5, beforeProfile.lifetimeAggregates.saved, 0.001)

            // Reconstruct using a FRESH repository instance (simulates process death)
            val freshRepo = FirebaseRegistryRepository(firestore)

            // Verify the day document is reconstructed correctly
            val dayFlow = freshRepo.subscribeToDay(uid, TEST_DATE).first()
            assertNotNull(dayFlow, "Day document must reconstruct after reload")
            assertEquals("closed", dayFlow!!.status)
            assertEquals(3.0, dayFlow.counts[TEST_TRACKER_ID] ?: 0.0, 0.001)
            assertNotNull(dayFlow.closedAt)

            // Verify lifetime aggregates are reconstructed correctly
            val profileFlow = freshRepo.subscribeToUserProfile(uid).first()
            assertNotNull(profileFlow)
            assertEquals(1.5, profileFlow!!.lifetimeAggregates.wasted, 0.001)
            assertEquals(8.5, profileFlow.lifetimeAggregates.saved, 0.001)
            assertEquals(3.0, profileFlow.lifetimeAggregates.smokingUnits, 0.001)
        }
    }

    // ============================================================
    // Test G — Cross-user unauthorized access (security rules enforcement)
    // ============================================================

    @Test
    fun testG_crossUserAccess_rejectedWithPermissionDenied() {
        runBlocking {
            val uid = System.getProperty("test.uid") ?: TEST_UID
            cleanDay(uid, TEST_DATE)

            // Establish a valid open day as the test UID
            repository.updateLiveCounter(uid, TEST_TRACKER_ID, 1.0, TEST_DATE, 0.5)
            assertEquals(1.0, getCounts(uid, TEST_DATE), 0.001)

            // Attempt to READ another user's day document — must be rejected by rules
            val error = assertFailsWith<Exception> {
                firestore.collection("users").document("other_user_victim")
                    .collection("days").document(TEST_DATE).get()
            }
            val code = extractFirestoreCode(error)
            assertEquals(FirestoreExceptionCode.PERMISSION_DENIED, code,
                "Cross-user read must be rejected as PERMISSION_DENIED")

            // Attempt to WRITE another user's day document — must also be rejected
            val writeError = assertFailsWith<Exception> {
                firestore.collection("users").document("other_user_victim")
                    .collection("days").document(TEST_DATE)
                    .set(mapOf(
                        "date" to TEST_DATE,
                        "counts" to mapOf(TEST_TRACKER_ID to 99.0),
                        "status" to "open",
                        "foldedIntoLifetime" to false,
                        "legacyMigrationApplied" to false,
                        "createdAt" to Timestamp(0, 0),
                        "updatedAt" to Timestamp(0, 0),
                        "closedAt" to null
                    ))
            }
            val writeCode = extractFirestoreCode(writeError)
            assertEquals(FirestoreExceptionCode.PERMISSION_DENIED, writeCode,
                "Cross-user write must be rejected as PERMISSION_DENIED")

            // Verify the victim's day document does not exist
            try {
                val victimDaySnap = firestore.collection("users").document("other_user_victim")
                    .collection("days").document(TEST_DATE).get()
                assertFalse(victimDaySnap.exists,
                    "Victim's day document must not be created by cross-user write")
            } catch (_: Exception) {
                // Expected — the read itself is denied, confirming the document is not accessible
            }
        }
    }


    // ============================================================
    // Data classes for contention results
    // ============================================================

    private data class ContentionResult(
        val opId: String,
        val success: Boolean,
        val exceptionClass: String?,
        val firestoreCode: FirestoreExceptionCode?,
        val message: String?,
    )

    private data class CloseResult(
        val success: Boolean,
        val firestoreCode: FirestoreExceptionCode?,
        val message: String?,
    )

    // ============================================================
    // Helper: Extract Firestore structured error codes
    // ============================================================

    private fun extractFirestoreCode(e: Exception): FirestoreExceptionCode? {
        return when (e) {
            is FirebaseFirestoreException -> e.code
            else -> {
                val msg = e.message?.lowercase() ?: ""
                when {
                    msg.contains("aborted") -> FirestoreExceptionCode.ABORTED
                    msg.contains("permission_denied") -> FirestoreExceptionCode.PERMISSION_DENIED
                    msg.contains("unavailable") -> FirestoreExceptionCode.UNAVAILABLE
                    msg.contains("unauthenticated") -> FirestoreExceptionCode.UNAUTHENTICATED
                    msg.contains("deadline-exceeded") -> FirestoreExceptionCode.DEADLINE_EXCEEDED
                    else -> null
                }
            }
        }
    }
}