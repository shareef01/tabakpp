package com.tabakpp.app.viewmodels

import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.User
import com.tabakpp.app.data.UserProfile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// --- fakes ----------------------------------------------------------------

private class FakeAuthRepository(user: User?) : AuthRepository {
    val userFlow = MutableStateFlow(user)
    override val currentUser: Flow<User?> = userFlow
    override val isGoogleSignInAvailable = false
    val displayNameUpdates = mutableListOf<String>()
    override suspend fun signInWithGoogle() = Result.success(Unit)
    override suspend fun signInWithEmail(email: String, password: String) = Result.success(Unit)
    override suspend fun signUpWithEmail(email: String, password: String, displayName: String?) = Result.success(Unit)
    override suspend fun sendPasswordResetEmail(email: String) = Result.success(Unit)
    override suspend fun updateDisplayName(name: String): Result<Unit> { displayNameUpdates.add(name); return Result.success(Unit) }
    override suspend fun signOut() {}
    override suspend fun deleteAccount(password: String?) = Result.success(Unit)
}

private class FakeRegistryRepository : RegistryRepository {
    val profileFlow = MutableStateFlow<UserProfile?>(null)
    val configsFlow = MutableStateFlow<List<TrackerConfig>>(emptyList())
    val logsFlow = MutableStateFlow<List<LogEntry>>(emptyList())

    /** When set, every mutating call throws it (init bootstrap calls do not). */
    var failWith: Exception? = null
    /** When set, endDay suspends on it — lets a test observe the in-flight state. */
    var endDayGate: CompletableDeferred<Unit>? = null
    /** When set, updateLiveCounter suspends on it — for optimistic-flight tests. */
    var liveCounterGate: CompletableDeferred<Unit>? = null

    val liveCounterCalls = mutableListOf<Triple<String, String, Double>>()
    val endDayCalls = mutableListOf<Pair<String, String>>()
    val addConfigCalls = mutableListOf<Pair<String, TrackerConfig>>()

    private fun maybeFail() { failWith?.let { throw it } }

    override fun subscribeToUserProfile(uid: String): Flow<UserProfile?> = profileFlow
    override fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>> = configsFlow
    override fun subscribeToLogs(uid: String): Flow<List<LogEntry>> = logsFlow

    override suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double) {
        liveCounterGate?.await(); maybeFail(); liveCounterCalls.add(Triple(uid, trackerId, delta))
    }
    override suspend fun endDay(uid: String, trackingDate: String) {
        endDayGate?.await(); maybeFail(); endDayCalls.add(uid to trackingDate)
    }
    override suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>) { maybeFail() }
    override suspend fun deleteLog(uid: String, logId: String) { maybeFail() }
    override suspend fun restoreLog(uid: String, log: LogEntry) { maybeFail() }
    override suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>) { maybeFail() }
    override suspend fun addConfig(uid: String, config: TrackerConfig) { maybeFail(); addConfigCalls.add(uid to config) }
    override suspend fun updateConfig(uid: String, config: TrackerConfig) { maybeFail() }
    override suspend fun deleteConfig(uid: String, configId: String) { maybeFail() }
    override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) { maybeFail() }
    override suspend fun updateProfileSettings(uid: String, profile: UserProfile) { maybeFail() }
    override suspend fun ensureUserDocument(uid: String, displayName: String?) {}
    override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {}
    override suspend fun deleteAllUserData(uid: String) { maybeFail() }
}

private class FakeLocalSettings : LocalSettings {
    private val map = mutableMapOf<String, String>()
    override fun getString(key: String, defaultValue: String) = map[key] ?: defaultValue
    override fun putString(key: String, value: String) { map[key] = value }
}

private class FakeNetworkObserver : NetworkObserver {
    override val isOnline: StateFlow<Boolean> = MutableStateFlow(true)
}

// --- tests ----------------------------------------------------------------

@OptIn(ExperimentalCoroutinesApi::class)
class RegistryViewModelTest {

    private val scheduler = TestCoroutineScheduler()
    private val dispatcher = StandardTestDispatcher(scheduler)
    private val bg = CoroutineScope(dispatcher)

    @BeforeTest fun setup() { Dispatchers.setMain(dispatcher) }
    @AfterTest fun teardown() { bg.cancel(); Dispatchers.resetMain() }

    private val user = User(uid = "u1", email = "e@x.io", displayName = "N", photoUrl = null)

    private fun build(
        auth: FakeAuthRepository = FakeAuthRepository(user),
        reg: FakeRegistryRepository = FakeRegistryRepository(),
    ): Pair<RegistryViewModel, FakeRegistryRepository> {
        val vm = RegistryViewModel(auth, reg, FakeLocalSettings(), FakeNetworkObserver())
        scheduler.runCurrent() // let Eagerly authUser + init collectors settle (loop stays parked)
        return vm to reg
    }

    @Test
    fun increment_withUser_incrementsByOne() {
        val (vm, reg) = build()
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(listOf(Triple("u1", "cig", 1.0)), reg.liveCounterCalls)
    }

    @Test
    fun increment_withoutUser_isNoop() {
        val (vm, reg) = build(auth = FakeAuthRepository(null))
        vm.increment("cig")
        scheduler.runCurrent()
        assertTrue(reg.liveCounterCalls.isEmpty())
    }

    @Test
    fun decrement_atZero_isNoop() {
        val (vm, reg) = build()
        reg.profileFlow.value = UserProfile(activeCounts = mapOf("cig" to 0.0))
        scheduler.runCurrent() // accent-sync keeps userProfile subscribed, so .value updates
        vm.decrement("cig")
        scheduler.runCurrent()
        assertTrue(reg.liveCounterCalls.isEmpty())
    }

    @Test
    fun decrement_aboveZero_decrementsByOne() {
        val (vm, reg) = build()
        reg.profileFlow.value = UserProfile(activeCounts = mapOf("cig" to 3.0))
        scheduler.runCurrent()
        vm.decrement("cig")
        scheduler.runCurrent()
        assertEquals(listOf(Triple("u1", "cig", -1.0)), reg.liveCounterCalls)
    }

    @Test
    fun endDay_togglesEndingDayAndCallsRepo() {
        val (vm, reg) = build()
        val gate = CompletableDeferred<Unit>()
        reg.endDayGate = gate

        assertFalse(vm.endingDay.value)
        vm.endDay()
        scheduler.runCurrent()
        assertTrue(vm.endingDay.value) // in flight, blocked on the gate

        gate.complete(Unit)
        scheduler.runCurrent()
        assertFalse(vm.endingDay.value) // reset in finally
        assertEquals(1, reg.endDayCalls.size)
        assertEquals("u1", reg.endDayCalls.first().first)
    }

    @Test
    fun endDay_repositoryError_setsErrorAndResetsEndingDay() {
        val (vm, reg) = build()
        reg.failWith = RuntimeException("boom")
        vm.endDay()
        scheduler.runCurrent()
        assertNotNull(vm.error.value)
        assertFalse(vm.endingDay.value)
    }

    @Test
    fun increment_repositoryError_setsError() {
        val (vm, reg) = build()
        reg.failWith = RuntimeException("boom")
        vm.increment("cig")
        scheduler.runCurrent()
        assertNotNull(vm.error.value)
    }

    @Test
    fun addTracker_blankName_isNoop() {
        val (vm, reg) = build()
        vm.addTracker(TrackerConfig(id = "", name = "   ", limit = 5, order = 0))
        scheduler.runCurrent()
        assertTrue(reg.addConfigCalls.isEmpty())
    }

    @Test
    fun addTracker_validName_sanitizesAndAssignsNextOrder() {
        val (vm, reg) = build()
        bg.launch { vm.configs.collect {} } // subscribe so configs.value reflects the fake
        reg.configsFlow.value = listOf(
            TrackerConfig(id = "a", name = "A", limit = 10, order = 0),
            TrackerConfig(id = "b", name = "B", limit = 10, order = 2),
        )
        scheduler.runCurrent()

        vm.addTracker(TrackerConfig(id = "", name = "Cigarettes", limit = 99_999, order = 0))
        scheduler.runCurrent()

        assertEquals(1, reg.addConfigCalls.size)
        val added = reg.addConfigCalls.first().second
        assertEquals("Cigarettes", added.name)
        assertEquals(3, added.order)      // maxOf(0, 2) + 1
        assertEquals(10_000, added.limit) // coerced into [0, 10000]
    }

    @Test
    fun clearError_resetsError() {
        val (vm, reg) = build()
        reg.failWith = RuntimeException("boom")
        vm.increment("cig")
        scheduler.runCurrent()
        assertNotNull(vm.error.value)
        vm.clearError()
        assertEquals(null, vm.error.value)
    }

    @Test
    fun increment_bumpsActiveCountsOptimisticallyBeforeWriteSettles() {
        val (vm, reg) = build()
        reg.profileFlow.value = UserProfile(activeCounts = mapOf("cig" to 2.0))
        scheduler.runCurrent() // overlay follows the server: cig = 2
        reg.liveCounterGate = CompletableDeferred() // keep the write in flight

        vm.increment("cig")
        // the bump is synchronous — visible before the repo call (or runCurrent) settles
        assertEquals(3.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun increment_rollsBackOptimisticBumpOnFailure() {
        val (vm, reg) = build()
        reg.profileFlow.value = UserProfile(activeCounts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        reg.failWith = RuntimeException("denied")

        vm.increment("cig")
        assertEquals(3.0, vm.activeCounts.value["cig"]) // optimistic
        scheduler.runCurrent()
        assertEquals(2.0, vm.activeCounts.value["cig"]) // rolled back after the write fails
        assertNotNull(vm.error.value)
    }

    @Test
    fun serverSnapshot_isDeferredWhileWriteInFlight_thenReconciles() {
        val (vm, reg) = build()
        reg.profileFlow.value = UserProfile(activeCounts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        reg.liveCounterGate = CompletableDeferred()

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(3.0, vm.activeCounts.value["cig"]) // optimistic; write parked on the gate

        // A server snapshot arriving mid-flight must not stomp the optimistic value.
        reg.profileFlow.value = UserProfile(activeCounts = mapOf("cig" to 9.0))
        scheduler.runCurrent()
        assertEquals(3.0, vm.activeCounts.value["cig"])

        reg.liveCounterGate!!.complete(Unit)
        scheduler.runCurrent()
        assertEquals(9.0, vm.activeCounts.value["cig"]) // reconciled to the held server snapshot
    }
}
