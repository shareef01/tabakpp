package com.tabakpp.app.viewmodels

import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.ProfileExtra
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.User
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.domain.CompleteExportSnapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
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
    var olderDayPage = com.tabakpp.app.domain.HistoryPage<DayDocument>()
    var olderLogPage = com.tabakpp.app.domain.HistoryPage<LogEntry>()
    val olderDayCalls = mutableListOf<com.tabakpp.app.domain.HistoryCursor?>()
    val olderLogCalls = mutableListOf<com.tabakpp.app.domain.HistoryCursor?>()
    override suspend fun fetchOlderDays(uid: String, cursor: com.tabakpp.app.domain.HistoryCursor?, pageSize: Int): com.tabakpp.app.domain.HistoryPage<DayDocument> {
        maybeFail(); olderDayCalls.add(cursor); return olderDayPage
    }
    override suspend fun fetchOlderLogs(uid: String, cursor: com.tabakpp.app.domain.HistoryCursor?, pageSize: Int): com.tabakpp.app.domain.HistoryPage<LogEntry> {
        maybeFail(); olderLogCalls.add(cursor); return olderLogPage
    }
    val avatarFlow = MutableStateFlow<ProfileExtra?>(null)

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
    val subscribeDayCalls = mutableListOf<Pair<String, String>>()
    override fun subscribeToDay(uid: String, date: String): Flow<DayDocument?> {
        subscribeDayCalls.add(uid to date)
        // Date fidelity: a real subscription to days/{date} never replays a
        // DIFFERENT day's document. Dateless docs (legacy test helper shape)
        // stay date-agnostic so existing tests keep their meaning.
        return dayFlow.map { doc -> doc?.takeIf { it.date.isEmpty() || it.date == date } }
    }
    override fun subscribeToDays(uid: String): Flow<List<DayDocument>> = daysFlow
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

/** Deterministic clock for tracking-day tests — advance [now] to cross boundaries. */
private class FakeClock(var now: kotlinx.datetime.Instant) : kotlinx.datetime.Clock {
    override fun now(): kotlinx.datetime.Instant = now
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
        clock: FakeClock = FakeClock(kotlinx.datetime.Instant.parse("2026-06-01T12:00:00Z")),
        timeZoneProvider: () -> kotlinx.datetime.TimeZone = { kotlinx.datetime.TimeZone.UTC },
    ): Triple<RegistryViewModel, FakeRegistryRepository, FakeNetworkObserver> {
        val vm = RegistryViewModel(auth, reg, FakeLocalSettings(), networkObserver, clock, timeZoneProvider)
        scheduler.runCurrent() // let Eagerly authUser + init collectors settle (loop stays parked)
        // Settle the initial profile-sync window deterministically: with no
        // profile in the fake, the 12s sync timeout expires on virtual time and
        // loading clears — matching production, where taps are only gated
        // while the day-start setting is genuinely unknown.
        scheduler.advanceTimeBy(12_500)
        scheduler.runCurrent()
        vm.clearError() // drop the one-shot "Profile sync timed out" state for isolation
        return Triple(vm, reg, networkObserver)
    }

    @Test fun olderHistoryPagesBothLedgersAndStopsWhenBothExhaust() {
        val (vm, reg, _) = build()
        val day = DayDocument(date = "2025-01-01", status = "closed")
        val log = LogEntry(id = "old", logDate = "2025-01-01")
        reg.olderDayPage = com.tabakpp.app.domain.HistoryPage(listOf(day), com.tabakpp.app.domain.HistoryCursor(day.date, day.date), false)
        reg.olderLogPage = com.tabakpp.app.domain.HistoryPage(listOf(log), com.tabakpp.app.domain.HistoryCursor(log.logDate, log.id), false)
        val dayJob = bg.launch { vm.historyDays.collect {} }
        val logJob = bg.launch { vm.historyLogs.collect {} }
        scheduler.runCurrent()
        vm.loadOlderHistory(); scheduler.runCurrent()
        assertEquals(listOf(day), vm.historyDays.value)
        assertEquals(listOf(log), vm.historyLogs.value)
        assertFalse(vm.hasOlderHistory.value)
        assertFalse(vm.loadingOlderHistory.value)
        vm.loadOlderHistory(); scheduler.runCurrent()
        assertEquals(1, reg.olderDayCalls.size)
        assertEquals(1, reg.olderLogCalls.size)
        dayJob.cancel(); logJob.cancel()
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

    // --- tracking-day determinism (injected clock/zone) -----------------------

    @Test
    fun increment_atMidnight_datesCountToTheNewDay_withoutWaitingForPoll() {
        // dayStartHour = 0 -> the day rolls at 00:00 local. The poll (30s) has
        // NOT fired and the profile has NOT changed: only the tap itself knows
        // the boundary was crossed.
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-03-07T23:59:59Z"))
        val (vm, reg, _) = build(clock = clock)
        reg.profileFlow.value = UserProfile(dayStartHour = 0)
        reg.dayFlow.value = DayDocument(date = "2026-03-07", counts = mapOf("cig" to 2.0))
        scheduler.runCurrent()
        assertEquals("2026-03-07", vm.trackingDay.value)
        assertEquals(2.0, vm.activeCounts.value["cig"])

        clock.now = kotlinx.datetime.Instant.parse("2026-03-08T00:00:01Z")
        vm.increment("cig")
        scheduler.runCurrent()

        assertEquals("2026-03-08", vm.trackingDay.value) // UI day advanced
        assertEquals(1, reg.liveCounterCalls.size)
        assertEquals("2026-03-08", reg.liveCounterCalls.first().trackingDate) // written to the NEW day
        assertEquals("2026-03-08", reg.subscribeDayCalls.last().second) // live listener re-keyed

        // Optimistic state transitions to the new day, then reconciles with
        // the server snapshot for that day without double-counting.
        reg.dayFlow.value = DayDocument(date = "2026-03-08", counts = mapOf("cig" to 1.0))
        scheduler.runCurrent()
        assertEquals(1.0, vm.activeCounts.value["cig"])
        assertNull(vm.error.value)
    }

    @Test
    fun increment_atCustomDayStart_datesCountToTheNextDay() {
        // dayStartHour = 23 -> 22:59 belongs to "yesterday" (the running day
        // started at 23:00 the calendar day before).
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-06-01T22:59:59Z"))
        val (vm, reg, _) = build(clock = clock)
        reg.profileFlow.value = UserProfile(dayStartHour = 23)
        scheduler.runCurrent()
        assertEquals("2026-05-31", vm.trackingDay.value)

        clock.now = kotlinx.datetime.Instant.parse("2026-06-01T23:00:01Z")
        vm.increment("cig")
        scheduler.runCurrent()

        assertEquals("2026-06-01", vm.trackingDay.value)
        assertEquals("2026-06-01", reg.liveCounterCalls.first().trackingDate)
    }

    @Test
    fun increment_acrossDstSpringForward_datesCountToLocalDay() {
        // Europe/London 2026-03-29: local times 01:00-01:59 do not exist
        // (clocks jump 01:00 GMT -> 02:00 BST). The date must follow LOCAL
        // wall-clock hours, not fixed offsets.
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-03-29T00:30:00Z")) // local 00:30 GMT
        val (vm, reg, _) = build(clock = clock, timeZoneProvider = { kotlinx.datetime.TimeZone.of("Europe/London") })
        reg.profileFlow.value = UserProfile(dayStartHour = 6)
        scheduler.runCurrent()
        assertEquals("2026-03-28", vm.trackingDay.value) // 00:30 < 06:00 -> running day = 28th

        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals("2026-03-28", reg.liveCounterCalls[0].trackingDate)

        clock.now = kotlinx.datetime.Instant.parse("2026-03-29T05:30:00Z") // local 06:30 BST
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals("2026-03-29", reg.liveCounterCalls[1].trackingDate) // 06:30 >= 06:00 -> new day
    }

    @Test
    fun increment_acrossDstFallBack_datesCountToLocalDay() {
        // Europe/London 2026-10-25: 02:00 BST -> 01:00 GMT (local hour repeats).
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-10-25T00:30:00Z")) // local 01:30 BST
        val (vm, reg, _) = build(clock = clock, timeZoneProvider = { kotlinx.datetime.TimeZone.of("Europe/London") })
        reg.profileFlow.value = UserProfile(dayStartHour = 6)
        scheduler.runCurrent()
        assertEquals("2026-10-24", vm.trackingDay.value)

        clock.now = kotlinx.datetime.Instant.parse("2026-10-25T05:30:00Z") // local 05:30 GMT
        vm.increment("cig")
        scheduler.runCurrent()
        // Still before 06:00 local despite being 05:30Z — no spurious rollover.
        assertEquals("2026-10-24", reg.liveCounterCalls[0].trackingDate)

        clock.now = kotlinx.datetime.Instant.parse("2026-10-25T06:30:00Z") // local 06:30 GMT
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals("2026-10-25", reg.liveCounterCalls[1].trackingDate)
    }

    @Test
    fun increment_afterTimezoneChange_usesTheNewZoneForDateDerivation() {
        // Simulates a device zone change (e.g. user flies UTC -> Auckland):
        // the injected provider is re-evaluated at every mutation, so the date
        // follows the zone in effect at tap time.
        var tz: kotlinx.datetime.TimeZone = kotlinx.datetime.TimeZone.UTC
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-06-01T20:00:00Z"))
        val (vm, reg, _) = build(clock = clock, timeZoneProvider = { tz })
        assertEquals("2026-06-01", vm.trackingDay.value) // 20:00 local UTC

        tz = kotlinx.datetime.TimeZone.of("Pacific/Auckland") // local 08:00 on 2026-06-02
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals("2026-06-02", vm.trackingDay.value)
        assertEquals("2026-06-02", reg.liveCounterCalls.first().trackingDate)
    }

    @Test
    fun increment_whileProfileSyncPending_isBlockedUntilDayStartHourIsKnown() {
        // Before the profile arrives, dayStartHour is unknown: a tap at a
        // custom boundary would be dated with the default hour and land on the
        // wrong days/{date} document. Taps must be blocked, then dated with
        // the real setting once the profile lands.
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-06-01T22:30:00Z"))
        val reg = FakeRegistryRepository()
        val vm = RegistryViewModel(
            FakeAuthRepository(user), reg, FakeLocalSettings(), FakeNetworkObserver(), clock
        ) { kotlinx.datetime.TimeZone.UTC }
        scheduler.runCurrent() // auth session started; profile sync in flight (loading=true)

        vm.increment("cig")
        scheduler.runCurrent()
        assertTrue(reg.liveCounterCalls.isEmpty(), "writes must be blocked while dayStartHour is unknown")
        assertNotNull(vm.error.value)

        reg.profileFlow.value = UserProfile(dayStartHour = 23)
        scheduler.runCurrent() // profile arrives -> loading clears, day known
        assertEquals("2026-05-31", vm.trackingDay.value) // 22 < 23 -> running day = 31st
        vm.increment("cig")
        scheduler.runCurrent()
        assertEquals(1, reg.liveCounterCalls.size)
        assertEquals("2026-05-31", reg.liveCounterCalls.first().trackingDate)
    }

    @Test
    fun endDay_afterRollover_closesTheFreshlyDerivedDay() {
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-03-07T23:59:59Z"))
        val (vm, reg, _) = build(clock = clock)
        reg.profileFlow.value = UserProfile(dayStartHour = 0)
        scheduler.runCurrent()
        assertEquals("2026-03-07", vm.trackingDay.value)

        clock.now = kotlinx.datetime.Instant.parse("2026-03-08T00:00:01Z")
        vm.endDay()
        scheduler.runCurrent()
        assertEquals(1, reg.closeDayCalls.size)
        assertEquals("2026-03-08", reg.closeDayCalls.first().second)
    }

    @Test
    fun profileEmission_recomputesTrackingDayImmediately_withProfileDayStartHour() {
        val clock = FakeClock(kotlinx.datetime.Instant.parse("2026-06-01T22:30:00Z"))
        val (vm, reg, _) = build(clock = clock)
        assertEquals("2026-06-01", vm.trackingDay.value) // default hour 6: 22 >= 6 -> today

        reg.profileFlow.value = UserProfile(dayStartHour = 23)
        scheduler.runCurrent() // collector must recompute WITHOUT the 30s poll advancing
        assertEquals("2026-05-31", vm.trackingDay.value) // 22 < 23 -> running day = 31st
    }
}
