package com.tabakpp.app.viewmodels

import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.DailyFinancialRecord
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.ProfileExtra
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrustedFinancial
import com.tabakpp.app.data.TrustedOperationResult
import com.tabakpp.app.data.User
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.domain.CompleteExportSnapshot
import com.tabakpp.app.domain.FinancialSource
import com.tabakpp.app.domain.SmokingCalculator
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
import kotlin.test.assertNull
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

data class LiveCounterCall(val uid: String, val trackerId: String, val delta: Double, val trackingDate: String, val defaultUnitPrice: Double)

private class FakeRegistryRepository : RegistryRepository {
    val profileFlow = MutableStateFlow<UserProfile?>(null)
    val configsFlow = MutableStateFlow<List<TrackerConfig>>(emptyList())
    val logsFlow = MutableStateFlow<List<LogEntry>>(emptyList())
    /** Today's dated day doc (item 1) — this, not the profile, is where live counts come from. */
    val dayFlow = MutableStateFlow<DayDocument?>(null)
    val daysFlow = MutableStateFlow<List<DayDocument>>(emptyList())
    val avatarFlow = MutableStateFlow<ProfileExtra?>(null)
    val ledgersFlow = MutableStateFlow<List<DailyFinancialRecord>>(emptyList())

    /** When set, every mutating call throws it (init bootstrap calls do not). */
    var failWith: Exception? = null
    /** When set, closeDay suspends on it — lets a test observe the in-flight state. */
    var closeDayGate: CompletableDeferred<Unit>? = null
    /** When set, updateLiveCounter suspends on it — for optimistic-flight tests. */
    var liveCounterGate: CompletableDeferred<Unit>? = null
    /** When set, updateProfileSettings suspends on it — for settings write serialization. */
    var profileSettingsGate: CompletableDeferred<Unit>? = null

    val liveCounterCalls = mutableListOf<LiveCounterCall>()
    val closeDayCalls = mutableListOf<Pair<String, String>>()
    val addConfigCalls = mutableListOf<Pair<String, TrackerConfig>>()
    val profileSettingsCalls = mutableListOf<Pair<String, UserProfile>>()
    val updateAvatarCalls = mutableListOf<Pair<String, String?>>()
    val deleteConfigCalls = mutableListOf<Triple<String, String, String?>>()
    val updateHistoricalDayCalls = mutableListOf<Triple<String, String, Map<String, Double>>>()

    private fun maybeFail() { failWith?.let { throw it } }

    override fun subscribeToUserProfile(uid: String): Flow<UserProfile?> = profileFlow
    override fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>> = configsFlow
    override fun subscribeToLogs(uid: String): Flow<List<LogEntry>> = logsFlow
    override fun subscribeToDay(uid: String, date: String): Flow<DayDocument?> = dayFlow
    override fun subscribeToDays(uid: String): Flow<List<DayDocument>> = daysFlow
    override fun subscribeToLedgers(uid: String): Flow<List<DailyFinancialRecord>> = ledgersFlow
    override fun subscribeToProfileExtra(uid: String): Flow<ProfileExtra?> = avatarFlow

    override suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double, trackingDate: String, defaultUnitPrice: Double) {
        liveCounterGate?.await(); maybeFail(); liveCounterCalls.add(LiveCounterCall(uid, trackerId, delta, trackingDate, defaultUnitPrice))
    }
    override suspend fun closeDay(uid: String, date: String) {
        closeDayGate?.await(); maybeFail(); closeDayCalls.add(uid to date)
    }
    override suspend fun reconcileStaleDays(uid: String, currentTrackingDate: String) { /* no-op */ }
    override suspend fun updateHistoricalDay(uid: String, date: String, counts: Map<String, Double>) {
        maybeFail(); updateHistoricalDayCalls.add(Triple(uid, date, counts))
    }
    override suspend fun migrateLegacyActiveCounts(uid: String) { /* no-op */ }
    override suspend fun migrateAvatarToProfileMeta(uid: String) { /* no-op */ }
    override suspend fun updateAvatar(uid: String, avatar: String?) { maybeFail(); updateAvatarCalls.add(uid to avatar) }
    override suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>) { maybeFail() }
    override suspend fun deleteLog(uid: String, logId: String) { maybeFail() }
    override suspend fun restoreLog(uid: String, log: LogEntry) { maybeFail() }
    override suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>) { maybeFail() }
    override suspend fun createManualLogAtomic(uid: String, logId: String, date: String, counts: Map<String, Double>, snapshots: Map<String, com.tabakpp.app.data.TrackerSnapshot>, defaultUnitPrice: Double, operationId: String) { maybeFail() }
    override suspend fun updateManualLogAtomic(uid: String, logId: String, date: String, counts: Map<String, Double>, snapshots: Map<String, com.tabakpp.app.data.TrackerSnapshot>, defaultUnitPrice: Double, operationId: String) { maybeFail() }
    override suspend fun deleteManualLogAtomic(uid: String, logId: String, date: String, defaultUnitPrice: Double, operationId: String) { maybeFail() }
    override suspend fun restoreManualLogAtomic(uid: String, log: com.tabakpp.app.data.LogEntry, defaultUnitPrice: Double, operationId: String) { maybeFail() }
    var financialMode: String = "LEGACY"
    val adjustCounterAtomicCalls = mutableListOf<LiveCounterCall>()
    override suspend fun getFinancialMode(uid: String): String = financialMode
    override suspend fun adjustCounterAtomic(uid: String, date: String, trackerId: String, delta: Double, snapshots: Map<String, com.tabakpp.app.data.TrackerSnapshot>, defaultUnitPrice: Double, operationId: String) { maybeFail(); adjustCounterAtomicCalls.add(LiveCounterCall(uid, trackerId, delta, date, defaultUnitPrice)) }
    override suspend fun foldLedgerIntoLifetime(uid: String, date: String) { maybeFail() }
    override suspend fun addConfig(uid: String, config: TrackerConfig) { maybeFail(); addConfigCalls.add(uid to config) }
    override suspend fun updateConfig(uid: String, config: TrackerConfig) { maybeFail() }
    override suspend fun deleteConfig(uid: String, configId: String, trackingDate: String?) {
        maybeFail(); deleteConfigCalls.add(Triple(uid, configId, trackingDate))
    }
    override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) { maybeFail() }
    override suspend fun updateProfileSettings(uid: String, profile: UserProfile) {
        profileSettingsGate?.await(); maybeFail(); profileSettingsCalls.add(uid to profile)
    }
    override suspend fun ensureUserDocument(uid: String, displayName: String?) {}
    override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {}
    override suspend fun deleteAllUserData(uid: String) { maybeFail() }
    override suspend fun clearLocalCache() { maybeFail() }
    override suspend fun readCompleteExportSnapshot(uid: String): CompleteExportSnapshot =
        CompleteExportSnapshot(
            generatedAt = "2026-09-16T08:15:00Z",
            profile = profileFlow.value,
            configs = configsFlow.value,
            days = daysFlow.value,
            logs = logsFlow.value
        )
}

private class FakeLocalSettings : LocalSettings {
    private val map = mutableMapOf<String, String>()
    override fun getString(key: String, defaultValue: String) = map[key] ?: defaultValue
    override fun putString(key: String, value: String) { map[key] = value }
}

private class FakeNetworkObserver(var online: Boolean = true) : NetworkObserver {
    override val isOnline: StateFlow<Boolean> = MutableStateFlow(online)
    fun goOffline() { online = false; (isOnline as MutableStateFlow).value = false }
}

private class FakeTrustedFinancial : TrustedFinancial {
    val calls = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun execute(type: String, payload: Map<String, Any?>): TrustedOperationResult {
        calls.add(type to payload)
        return TrustedOperationResult(applied = true)
    }
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
        networkObserver: FakeNetworkObserver = FakeNetworkObserver(),
    ): Triple<RegistryViewModel, FakeRegistryRepository, FakeNetworkObserver> {
        val vm = RegistryViewModel(auth, reg, FakeLocalSettings(), networkObserver)
        scheduler.runCurrent() // let Eagerly authUser + init collectors settle (loop stays parked)
        return Triple(vm, reg, networkObserver)
    }

    @Test
    fun increment_withUser_incrementsByOne() {
        val (vm, reg, _) = build()
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1, reg.liveCounterCalls.size)
        val call = reg.liveCounterCalls.first()
        assertEquals("u1", call.uid)
        assertEquals("cig", call.trackerId)
        assertEquals(1.0, call.delta)
        assertEquals(vm.trackingDay.value, call.trackingDate) // caller decides the date at write time (item 1)
    }

    @Test
    fun increment_routesToLedger_whenOptionBEnabledAndAccountMode() {
        val (vm, reg, _) = build()
        val gw = FakeTrustedFinancial()
        vm.optionBGateway = gw
        reg.financialMode = "OPTION_B"
        vm.optionBLedgerEnabled = true
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1, gw.calls.size)
        assertEquals("COUNTER_INCREMENT", gw.calls.first().first)
        assertTrue(reg.liveCounterCalls.isEmpty())
    }

    @Test
    fun increment_staysLegacy_whenFlagOffEvenForOptionBAccount() {
        val (vm, reg, _) = build()
        val gw = FakeTrustedFinancial()
        vm.optionBGateway = gw
        reg.financialMode = "OPTION_B"
        vm.optionBLedgerEnabled = false
        vm.increment("cig")
        scheduler.runCurrent()
        assertTrue(gw.calls.isEmpty())
        assertEquals(1, reg.liveCounterCalls.size)
    }

    @Test
    fun increment_staysLegacy_whenFlagOnButLegacyAccount() {
        val (vm, reg, _) = build()
        val gw = FakeTrustedFinancial()
        vm.optionBGateway = gw
        reg.financialMode = "LEGACY"
        vm.optionBLedgerEnabled = true
        vm.increment("cig")
        scheduler.runCurrent()
        assertTrue(gw.calls.isEmpty())
        assertEquals(1, reg.liveCounterCalls.size)
    }

    @Test
    fun increment_withoutUser_isNoop() {
        val (vm, reg, _) = build(auth = FakeAuthRepository(null))
        vm.increment("cig")
        scheduler.runCurrent()
        assertTrue(reg.liveCounterCalls.isEmpty())
    }

    @Test
    fun decrement_atZero_isNoop() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()
        vm.decrement("cig")
        scheduler.runCurrent()
        assertTrue(reg.liveCounterCalls.isEmpty())
    }

    @Test
    fun decrement_aboveZero_decrementsByOne() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 3.0))
        scheduler.runCurrent()
        vm.decrement("cig")
        scheduler.runCurrent()
        assertEquals(1, reg.liveCounterCalls.size)
        assertEquals(-1.0, reg.liveCounterCalls.first().delta)
    }

    @Test
    fun endDay_togglesEndingDayAndCallsCloseDay() {
        val (vm, reg, _) = build()
        val gate = CompletableDeferred<Unit>()
        reg.closeDayGate = gate

        assertFalse(vm.endingDay.value)
        vm.endDay()
        scheduler.runCurrent()
        assertTrue(vm.endingDay.value) // in flight, blocked on the gate

        gate.complete(Unit)
        scheduler.runCurrent()
        assertFalse(vm.endingDay.value) // reset in finally
        assertEquals(1, reg.closeDayCalls.size)
        assertEquals("u1", reg.closeDayCalls.first().first)
    }

    @Test
    fun endDay_repositoryError_setsErrorAndResetsEndingDay() {
        val (vm, reg, _) = build()
        reg.failWith = RuntimeException("boom")
        vm.endDay()
        scheduler.runCurrent()
        assertNotNull(vm.error.value)
        assertFalse(vm.endingDay.value)
    }

    @Test
    fun increment_repositoryError_setsError() {
        val (vm, reg, _) = build()
        reg.failWith = RuntimeException("boom")
        vm.increment("cig")
        scheduler.runCurrent()
        assertNotNull(vm.error.value)
    }

    @Test
    fun addTracker_blankName_isNoop() {
        val (vm, reg, _) = build()
        vm.addTracker(TrackerConfig(id = "", name = "   ", limit = 5, order = 0))
        scheduler.runCurrent()
        assertTrue(reg.addConfigCalls.isEmpty())
    }

    @Test
    fun addTracker_validName_sanitizesAndAssignsNextOrder() {
        val (vm, reg, _) = build()
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
    fun addTracker_coercesBaselineIntoBounds() {
        val (vm, reg, _) = build()
        vm.addTracker(TrackerConfig(id = "", name = "Cig", limit = 10, order = 0, baseline = 99_999))
        scheduler.runCurrent()
        assertEquals(10_000, reg.addConfigCalls.first().second.baseline)
    }

    @Test
    fun clearError_resetsError() {
        val (vm, reg, _) = build()
        reg.failWith = RuntimeException("boom")
        vm.increment("cig")
        scheduler.runCurrent()
        assertNotNull(vm.error.value)
        vm.clearError()
        assertEquals(null, vm.error.value)
    }

    @Test
    fun increment_bumpsActiveCountsOptimisticallyBeforeWriteSettles() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 2.0))
        scheduler.runCurrent() // overlay follows the server: cig = 2
        reg.liveCounterGate = CompletableDeferred() // keep the write in flight

        vm.increment("cig")
        // the bump is synchronous — visible before the repo call (or runCurrent) settles
        assertEquals(3.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun increment_rollsBackOptimisticBumpOnFailure() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        reg.failWith = RuntimeException("denied")

        vm.increment("cig")
        assertEquals(3.0, vm.activeCounts.value["cig"]) // optimistic
        scheduler.runCurrent()
        assertEquals(2.0, vm.activeCounts.value["cig"]) // rolled back after the write fails
        assertNotNull(vm.error.value)
    }

    @Test
    fun serverSnapshot_whileWriteInFlight_mergesWithPendingDelta() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        reg.liveCounterGate = CompletableDeferred()

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(3.0, vm.activeCounts.value["cig"]) // server 2 + pending 1

        // A higher mid-flight snapshot merges with the still-pending tap.
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 9.0))
        scheduler.runCurrent()
        assertEquals(10.0, vm.activeCounts.value["cig"]) // server 9 + pending 1

        reg.liveCounterGate!!.complete(Unit)
        scheduler.runCurrent()
        // Write folded into baseline; pending cleared → follow server (or local fold).
        assertEquals(10.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun burstTaps_doNotSnapBackOnStaleServerSnapshot() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        reg.liveCounterGate = CompletableDeferred()

        vm.increment("cig")
        vm.increment("cig")
        assertEquals(4.0, vm.activeCounts.value["cig"])

        // Stale echo of the pre-burst value must not rewind the overlay.
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        assertEquals(4.0, vm.activeCounts.value["cig"])

        reg.liveCounterGate!!.complete(Unit)
        scheduler.runCurrent()
        // Both writes folded locally: baseline 4, pending 0.
        assertEquals(4.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun deleteTracker_passesCurrentTrackingDateForLiveCleanup() {
        val (vm, reg, _) = build()
        vm.deleteTracker("cig")
        scheduler.runCurrent()
        assertEquals(1, reg.deleteConfigCalls.size)
        val (uid, id, date) = reg.deleteConfigCalls.first()
        assertEquals("u1", uid)
        assertEquals("cig", id)
        assertEquals(vm.trackingDay.value, date)
    }

    @Test
    fun updateAvatar_delegatesToRepository() {
        val (vm, reg, _) = build()
        vm.updateAvatar("data:new")
        scheduler.runCurrent()
        assertEquals(listOf<Pair<String, String?>>("u1" to "data:new"), reg.updateAvatarCalls)
    }

    @Test
    fun avatar_reflectsProfileExtraFlow_notTheProfileDocument() {
        val (vm, reg, _) = build()
        reg.avatarFlow.value = ProfileExtra(avatar = "data:x")
        bg.launch { vm.avatar.collect {} }
        scheduler.runCurrent()
        assertEquals("data:x", vm.avatar.value)
    }

    @Test
    fun updateDayRecord_delegatesToUpdateHistoricalDay() {
        val (vm, reg, _) = build()
        vm.updateDayRecord("2026-07-10", mapOf("cig" to 5.0))
        scheduler.runCurrent()
        assertEquals(1, reg.updateHistoricalDayCalls.size)
        assertEquals(Triple("u1", "2026-07-10", mapOf("cig" to 5.0)), reg.updateHistoricalDayCalls.first())
    }

    @Test
    fun updateProfile_chainsOffLastSubmitted_soRapidEditsDoNotClobber() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(name = "Alice", accent = "#FF5F5F")
        scheduler.runCurrent()
        reg.profileSettingsGate = CompletableDeferred()

        vm.updateProfile { it.copy(accent = "#111111") }
        scheduler.runCurrent()
        assertEquals(0, reg.profileSettingsCalls.size) // parked on the gate

        // Second edit while the first write is in flight must chain from the
        // pending submitted profile (accent already #111111), not the stale server snap.
        vm.updateProfile { it.copy(name = "Bob") }
        scheduler.runCurrent()
        assertEquals(0, reg.profileSettingsCalls.size)

        reg.profileSettingsGate!!.complete(Unit)
        scheduler.runCurrent()

        assertEquals(2, reg.profileSettingsCalls.size)
        assertEquals("#111111", reg.profileSettingsCalls[0].second.accent)
        assertEquals("Alice", reg.profileSettingsCalls[0].second.name)
        assertEquals("#111111", reg.profileSettingsCalls[1].second.accent)
        assertEquals("Bob", reg.profileSettingsCalls[1].second.name)
    }

    @Test
    fun updateProfile_withNullProfile_isNoop() {
        val (vm, reg, _) = build()
        // profileFlow stays null — must not seed UserProfile() defaults
        vm.updateProfile { it.copy(accent = "#000000") }
        scheduler.runCurrent()
        assertTrue(reg.profileSettingsCalls.isEmpty())
    }

    @Test
    fun scenarioA_snapshotArrivesBeforeMutationCompletes_doesNotDoubleCount() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()
        assertEquals(5.0, vm.activeCounts.value["cig"])

        // In-flight mutation gate
        val gate = CompletableDeferred<Unit>()
        reg.liveCounterGate = gate

        vm.increment("cig")
        scheduler.runCurrent()
        // Optimistic display shows 6.0
        assertEquals(6.0, vm.activeCounts.value["cig"])

        // Snapshot arrives with 6.0 BEFORE mutation completes
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 6.0))
        scheduler.runCurrent()
        // MUST NOT double-count to 7.0!
        assertEquals(6.0, vm.activeCounts.value["cig"])

        // Mutation completes
        gate.complete(Unit)
        scheduler.runCurrent()
        assertEquals(6.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun scenarioB_mutationCompletesBeforeSnapshot_doesNotDownwardFlicker() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()
        assertEquals(5.0, vm.activeCounts.value["cig"])

        val gate = CompletableDeferred<Unit>()
        reg.liveCounterGate = gate

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(6.0, vm.activeCounts.value["cig"])

        // Mutation resolves while server snapshot is still 5.0
        gate.complete(Unit)
        scheduler.runCurrent()
        // MUST NOT flicker down to 5.0!
        assertEquals(6.0, vm.activeCounts.value["cig"])

        // Snapshot arrives with 6.0
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 6.0))
        scheduler.runCurrent()
        assertEquals(6.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun scenarioC_twoFastIncrementsBeforeAcknowledgement() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()

        val gate = CompletableDeferred<Unit>()
        reg.liveCounterGate = gate

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(6.0, vm.activeCounts.value["cig"])

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(7.0, vm.activeCounts.value["cig"])

        // Snapshot 1 arrives
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 6.0))
        scheduler.runCurrent()
        assertEquals(7.0, vm.activeCounts.value["cig"])

        // Snapshot 2 arrives
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 7.0))
        scheduler.runCurrent()
        assertEquals(7.0, vm.activeCounts.value["cig"])

        gate.complete(Unit)
        scheduler.runCurrent()
        assertEquals(7.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun scenarioD_overlappingIncrementAndDecrement() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()

        val gate = CompletableDeferred<Unit>()
        reg.liveCounterGate = gate

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(6.0, vm.activeCounts.value["cig"])

        vm.decrement("cig")
        scheduler.runCurrent()
        assertEquals(5.0, vm.activeCounts.value["cig"])

        gate.complete(Unit)
        scheduler.runCurrent()
        assertEquals(5.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun scenarioH_mutationFailureCleanlyRollsBack() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()

        reg.failWith = Exception("Mutation denied")
        vm.increment("cig")
        scheduler.runCurrent()

        // Rolled back to 5.0
        assertEquals(5.0, vm.activeCounts.value["cig"])
        assertNotNull(vm.error.value)
    }

    // --- item 30: transaction offline guard ---

    @Test
    fun increment_knownOffline_doesNotCreatePendingOpAndShowsOfflineError() {
        val (vm, reg, net) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()

        net.goOffline()
        vm.increment("cig") // should be blocked
        scheduler.runCurrent()

        assertTrue(reg.liveCounterCalls.isEmpty())
        assertNotNull(vm.error.value)
        assertTrue(vm.error.value!!.contains("internet"))
    }

    @Test
    fun decrement_knownOffline_doesNotMoveCountAndShowsOfflineError() {
        val (vm, reg, net) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()

        net.goOffline()
        vm.decrement("cig")
        scheduler.runCurrent()

        assertTrue(reg.liveCounterCalls.isEmpty())
        assertNotNull(vm.error.value)
        assertTrue(vm.error.value!!.contains("internet"))
    }

    @Test
    fun reportedOnline_transactionFailure_rollsBackOptimisticCountAndShowsRollbackError() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 5.0))
        scheduler.runCurrent()

        reg.failWith = RuntimeException("denied") // no matching mapper code → fallback
        vm.increment("cig")
        scheduler.runCurrent()

        // Optimistic bump then rollback
        assertEquals(5.0, vm.activeCounts.value["cig"])
        assertNotNull(vm.error.value)
        assertTrue(vm.error.value!!.contains("was restored"))
    }

    @Test
    fun rapidOps_mixedSuccessFailure_successPreserved() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()

        // op1: success
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1.0, vm.activeCounts.value["cig"])

        // op2: failure
        reg.failWith = RuntimeException("denied")
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1.0, vm.activeCounts.value["cig"]) // rolled back

        // op3: success
        reg.failWith = null
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(2.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun successfulIncrementalTransaction_noFalseErrorFromDelayedListener() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()
        assertEquals(0.0, vm.activeCounts.value["cig"])

        vm.increment("cig")
        scheduler.runCurrent()
        // Write succeeds; listener delay must not surface an error.
        assertEquals(1.0, vm.activeCounts.value["cig"])
        assertNull(vm.error.value)
    }

    // --- item 31: Undo failure handling ---

    @Test
    fun undoneIncrement_undoFails_countRemains() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()

        // Increment succeeds
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1.0, vm.activeCounts.value["cig"])

        // Undo = decrement; make it fail
        reg.failWith = RuntimeException("denied") // no matching mapper code → fallback
        vm.undoIncrement("cig")
        scheduler.runCurrent()

        // Original increment remains, error shown
        assertEquals(1.0, vm.activeCounts.value["cig"])
        assertNotNull(vm.error.value)
        assertTrue(vm.error.value!!.contains("was restored"))
    }

    // --- item 32: end-day success/failure distinction ---

    @Test
    fun endDay_knownOffline_dialogStaysOpen_errorShown() {
        val (vm, reg, net) = build()
        val gate = CompletableDeferred<Unit>()
        reg.closeDayGate = gate

        net.goOffline()
        vm.endDay()
        scheduler.runCurrent()

        // closeDay must NOT be called while offline
        assertTrue(reg.closeDayCalls.isEmpty())
        assertNotNull(vm.error.value)
        assertTrue(vm.error.value!!.contains("internet"))
        assertFalse(vm.endingDay.value) // never started
    }

    @Test
    fun endDay_backendFailure_dialogStaysOpen_spinnerClears() {
        val (vm, reg, net) = build()
        val gate = CompletableDeferred<Unit>()
        reg.closeDayGate = gate
        reg.failWith = RuntimeException("boom")

        vm.endDay()
        scheduler.runCurrent()
        assertTrue(vm.endingDay.value) // spinner showing

        gate.complete(Unit)
        scheduler.runCurrent()

        assertFalse(vm.endingDay.value) // spinner cleared
        assertNotNull(vm.error.value)
        assertTrue(reg.closeDayCalls.isEmpty()) // repo threw, no call recorded
    }

    @Test
    fun endDay_success_emitsSuccessAndCloses() {
        val (vm, reg, _) = build()
        val gate = CompletableDeferred<Unit>()
        reg.closeDayGate = gate

        vm.endDay()
        scheduler.runCurrent()
        assertTrue(vm.endingDay.value)

        val results = mutableListOf<Boolean>()
        bg.launch { vm.endDayResult.collect { results.add(it) } }
        scheduler.runCurrent()

        gate.complete(Unit)
        scheduler.runCurrent()

        assertFalse(vm.endingDay.value)
        assertEquals(1, reg.closeDayCalls.size)
        assertTrue(results.any { it }) // emitted true (success)
    }

    // --- item 33: plain-write behavior (add tracker does NOT require online) ---

    @Test
    fun addTracker_knownOffline_isAllowedAsLocalPendingWrite() {
        val (vm, reg, net) = build()
        net.goOffline()
        vm.addTracker(TrackerConfig(id = "", name = "Cigarettes", limit = 10, order = 0))
        scheduler.runCurrent()
        assertEquals(1, reg.addConfigCalls.size)
        assertNull(vm.error.value)
    }

    // --- Counter write serialization (rapid taps cannot fire concurrent transactions) --

    @Test
    fun rapidIncrements_withGate_serializeWritesInOrder() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()

        // First increment stays in flight (gate not yet completed)
        reg.liveCounterGate = CompletableDeferred()
        vm.increment("cig")
        scheduler.runCurrent()
        // First increment is in flight (blocked on gate) — call not yet recorded
        assertEquals(0, reg.liveCounterCalls.size)
        assertEquals(1.0, vm.activeCounts.value["cig"]) // optimistic

        // Second increment is called while the first write is still pending.
        // Because counterWriteMutex serializes writes, the second write
        // coroutine cannot start until the first completes.
        vm.increment("cig")
        scheduler.runCurrent()
        // Second write is queued behind mutex — still not recorded
        assertEquals(0, reg.liveCounterCalls.size)
        assertEquals(2.0, vm.activeCounts.value["cig"]) // both pending optimistically

        reg.liveCounterGate!!.complete(Unit)
        scheduler.runCurrent()
        // Both increments completed: first released the mutex, second acquired it
        assertEquals(2, reg.liveCounterCalls.size)
        assertEquals(2.0, vm.activeCounts.value["cig"])
    }

    @Test
    fun endDay_waitsForPendingWritesBeforeClosing() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 0.0))
        scheduler.runCurrent()

        // Start an increment that stays in flight
        reg.liveCounterGate = CompletableDeferred()
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1.0, vm.activeCounts.value["cig"]) // optimistic

        // Start endDay while the increment is still in flight
        val closeDayGate = CompletableDeferred<Unit>()
        reg.closeDayGate = closeDayGate
        vm.endDay()
        scheduler.runCurrent()

        // closeDay must NOT have been called yet — it's blocked on the counterWriteMutex
        // held by the in-flight increment
        assertTrue(vm.endingDay.value) // end-day spinner is showing (waiting for lock)
        assertEquals(0, reg.closeDayCalls.size)

        // Complete the increment — this releases the mutex, allowing endDay
        // to acquire it and call closeDay
        reg.liveCounterGate!!.complete(Unit)
        scheduler.runCurrent()

        // closeDay is now in flight (suspended on its gate)
        assertEquals(0, reg.closeDayCalls.size) // not yet recorded — gate not completed
        assertTrue(vm.endingDay.value)

        // Complete closeDay
        closeDayGate.complete(Unit)
        scheduler.runCurrent()
        assertEquals(1, reg.closeDayCalls.size)
        assertFalse(vm.endingDay.value)
    }

    @Test
    fun concurrentIncrementAndEndDay_doitNotDoubleCount() {
        val (vm, reg, _) = build()
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 3.0))
        scheduler.runCurrent()
        assertEquals(3.0, vm.activeCounts.value["cig"])

        reg.liveCounterGate = CompletableDeferred()
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(4.0, vm.activeCounts.value["cig"]) // optimistic

        // Trigger endDay while increment is in flight
        vm.endDay()
        scheduler.runCurrent()

        // Increment write completes
        reg.liveCounterGate!!.complete(Unit)
        scheduler.runCurrent()
        // closeDay should have been called (after mutex released)
        assertEquals(1, reg.closeDayCalls.size)

        // Server confirms the increment
        reg.dayFlow.value = DayDocument(date = vm.trackingDay.value, counts = mapOf("cig" to 4.0))
        scheduler.runCurrent()
        assertEquals(4.0, vm.activeCounts.value["cig"])
        assertNull(vm.error.value)
    }

    @Test
    fun metrics_and_canonical_useTheLedger_whenOptionB() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(lifetimeAggregates = LifetimeAggregates(0.0, 0.0, 0.0, 0.0))
        reg.financialMode = "OPTION_B"
        reg.ledgersFlow.value = listOf(DailyFinancialRecord(
            date = vm.trackingDay.value,
            canonicalCredit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0),
            eligible = true,
        ))
        val metrics = mutableListOf<SmokingCalculator.GlobalMetrics?>()
        val canon = mutableListOf<RegistryViewModel.CanonicalFinancials?>()
        val j1 = bg.launch { vm.metrics.collect { metrics.add(it) } }
        val j2 = bg.launch { vm.canonical.collect { canon.add(it) } }
        scheduler.runCurrent()
        assertEquals(FinancialSource.OPTION_B_CANONICAL, canon.last()!!.today.source)
        assertEquals(6.0, canon.last()!!.today.canonical!!.spent, 0.001)
        assertEquals(4.0, canon.last()!!.totals.saved, 0.001)
        assertEquals(6.0, metrics.last()!!.spentToday, 0.001)
        assertEquals(4.0, metrics.last()!!.saved, 0.001)
        assertEquals(9.0, metrics.last()!!.baselineSavedToday, 0.001)
        j1.cancel(); j2.cancel()
    }

    @Test
    fun canonical_isNull_andMetricsStayLegacy_forLegacyAccount() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(unitPrice = 1.0, lifetimeAggregates = LifetimeAggregates(0.0, 0.0, 0.0, 0.0))
        reg.financialMode = "LEGACY"
        reg.ledgersFlow.value = listOf(DailyFinancialRecord(
            date = vm.trackingDay.value,
            canonicalCredit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0),
        ))
        val canon = mutableListOf<RegistryViewModel.CanonicalFinancials?>()
        val j = bg.launch { vm.canonical.collect { canon.add(it) } }
        scheduler.runCurrent()
        kotlin.test.assertNull(canon.last())
        j.cancel()
    }

    @Test
    fun canonical_marksMissingLedgerUnavailable_whenOptionB() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(lifetimeAggregates = LifetimeAggregates(0.0, 0.0, 0.0, 0.0))
        reg.financialMode = "OPTION_B"
        reg.logsFlow.value = listOf(LogEntry(id = "A", logDate = vm.trackingDay.value, counts = mapOf("cig" to 1.0), origin = "MANUAL_ENTRY"))
        reg.ledgersFlow.value = emptyList()
        val canon = mutableListOf<RegistryViewModel.CanonicalFinancials?>()
        val j = bg.launch { vm.canonical.collect { canon.add(it) } }
        scheduler.runCurrent()
        assertEquals(FinancialSource.MISSING_CANONICAL_LEDGER, canon.last()!!.today.source)
        kotlin.test.assertFalse(canon.last()!!.today.available)
        kotlin.test.assertFalse(canon.last()!!.totals.complete)
        j.cancel()
    }

    @Test
    fun metrics_doNotDoubleCountAFoldedLedger() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(lifetimeAggregates = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0))
        reg.financialMode = "OPTION_B"
        reg.ledgersFlow.value = listOf(DailyFinancialRecord(
            date = vm.trackingDay.value,
            canonicalCredit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0),
            eligible = true,
            foldedIntoLifetime = true,
        ))
        val metrics = mutableListOf<SmokingCalculator.GlobalMetrics?>()
        val j = bg.launch { vm.metrics.collect { metrics.add(it) } }
        scheduler.runCurrent()
        // already folded ⇒ the credit is not added a second time
        assertEquals(4.0, metrics.last()!!.savedLifetime, 0.001)
        j.cancel()
    }

    @Test
    fun metrics_flagUnavailable_forMissingLedger() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(unitPrice = 1.0, lifetimeAggregates = LifetimeAggregates(0.0, 0.0, 0.0, 0.0))
        reg.financialMode = "OPTION_B"
        reg.logsFlow.value = listOf(LogEntry(id = "A", logDate = vm.trackingDay.value, counts = mapOf("cig" to 6.0), origin = "MANUAL_ENTRY"))
        reg.ledgersFlow.value = emptyList()
        val metrics = mutableListOf<SmokingCalculator.GlobalMetrics?>()
        val j = bg.launch { vm.metrics.collect { metrics.add(it) } }
        scheduler.runCurrent()
        // Source activity exists but the ledger is missing ⇒ UNAVAILABLE, never legacy.
        kotlin.test.assertFalse(metrics.last()!!.todayAvailable)
        j.cancel()
    }

    @Test
    fun migrating_appliesCanonicalPerDate_notToEveryDate() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(lifetimeAggregates = LifetimeAggregates(4.0, 6.0, 6.0, 9.0))
        reg.financialMode = "MIGRATING"
        reg.ledgersFlow.value = listOf(DailyFinancialRecord(
            date = vm.trackingDay.value,
            canonicalCredit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0),
            eligible = true,
        ))
        reg.logsFlow.value = listOf(LogEntry(id = "B", logDate = "2020-01-02", counts = mapOf("cig" to 3.0), origin = "MANUAL_ENTRY"))
        val canon = mutableListOf<RegistryViewModel.CanonicalFinancials?>()
        val j = bg.launch { vm.canonical.collect { canon.add(it) } }
        scheduler.runCurrent()
        val c = canon.last()!!
        assertEquals(FinancialSource.OPTION_B_CANONICAL, c.today.source) // migrated date
        assertEquals(4.0, c.totals.saved, 0.001)                        // only the canonical date
        kotlin.test.assertFalse(c.totals.complete)                     // the legacy-owned date is incomplete
        j.cancel()
    }

    @Test
    fun metrics_includeAnUnfoldedLedgerOnce() {
        val (vm, reg, _) = build()
        reg.profileFlow.value = UserProfile(lifetimeAggregates = LifetimeAggregates(0.0, 0.0, 0.0, 0.0))
        reg.financialMode = "OPTION_B"
        reg.ledgersFlow.value = listOf(DailyFinancialRecord(
            date = vm.trackingDay.value,
            canonicalCredit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0),
            eligible = true,
            foldedIntoLifetime = false,
        ))
        val metrics = mutableListOf<SmokingCalculator.GlobalMetrics?>()
        val j = bg.launch { vm.metrics.collect { metrics.add(it) } }
        scheduler.runCurrent()
        assertEquals(4.0, metrics.last()!!.savedLifetime, 0.001)
        j.cancel()
    }

}