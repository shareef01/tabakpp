package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.DailyFinancialRecord
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.ProfileExtra
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.User
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.domain.CompleteExportSnapshot
import com.tabakpp.app.viewmodels.RegistryViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.datetime.Clock
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.todayIn
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screen-level Compose UI tests for [HistoryScreen] — AUD-004.
 *
 * These render the REAL HistoryScreen composable with a real [RegistryViewModel]
 * backed by an in-memory fake repository (no Firebase). That is the strongest
 * assertion available without a live backend: it drives the screen's actual
 * list, labels, chart content description and empty state from seeded data.
 *
 * Runs on the JVM via Robolectric (`:composeApp:testDebugUnitTest`), so it runs
 * everywhere; the Firebase-backed end-to-end path is covered separately by
 * `:androidApp:connectedDebugAndroidTest`.
 *
 * Dates are seeded relative to the real current day so they fall inside the
 * chart's rolling window (which ends at the tracking day).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// A phone-sized viewport so the LazyColumn composes the section we assert on.
@Config(sdk = [34], qualifiers = "w432dp-h960dp-xxhdpi")
class HistoryScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val today = Clock.System.todayIn(TimeZone.currentSystemDefault())
    private fun dayBefore(n: Int): String = today.minus(n, DateTimeUnit.DAY).toString()

    private fun vm(
        dayDocs: List<DayDocument> = emptyList(),
        logs: List<LogEntry> = emptyList(),
        configs: List<TrackerConfig> = listOf(
            TrackerConfig(id = "cig", name = "Cigarettes", limit = 20, order = 0, type = TrackerType.CIGARETTE)
        ),
        profile: UserProfile? = UserProfile(name = "Tester", lifetimeAggregates = LifetimeAggregates()),
    ): RegistryViewModel = RegistryViewModel(
        authRepository = FakeAuth(),
        registryRepository = FakeRepo(dayDocs, logs, configs, profile),
        localSettings = FakeSettings(),
        networkObserver = FakeNetwork(),
    )

    private fun renderScreen(viewModel: RegistryViewModel) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                HistoryScreen(viewModel = viewModel, snackbarHostState = SnackbarHostState())
            }
        }
        // The screen shows a skeleton until the ViewModel's session bootstrap
        // finishes; wait for that before asserting content.
        rule.waitUntil(timeoutMillis = 10_000) { !viewModel.loading.value }
        rule.waitForIdle()
    }

    /** LazyColumn composes only visible items — scroll to a session-log row first. */
    private fun assertRowVisible(text: String) {
        rule.onNode(hasScrollAction()).performScrollToNode(hasText(text))
        rule.onNodeWithText(text).assertIsDisplayed()
    }

    private fun closedDay(date: String, vararg counts: Pair<String, Double>) =
        DayDocument(date = date, counts = counts.toMap(), status = "closed", foldedIntoLifetime = true)

    // --- OPTION B canonical financial presentation (fail-closed) -----------
    @Test
    fun rendersUnavailableSpent_forOptionBWithoutLedger() {
        // Two source dates so the assertion holds whichever day the tracking
        // rollover puts "today" on — the canonical ledger is missing either way.
        val logs = listOf(
            LogEntry(id = "A", logDate = today.toString(), counts = mapOf("cig" to 1.0), origin = "MANUAL_ENTRY"),
            LogEntry(id = "B", logDate = dayBefore(1), counts = mapOf("cig" to 1.0), origin = "MANUAL_ENTRY"),
        )
        val viewModel = RegistryViewModel(
            authRepository = FakeAuth(),
            registryRepository = FakeRepo(
                days = emptyList(),
                logEntries = logs,
                cfg = listOf(TrackerConfig(id = "cig", name = "Cigarettes", limit = 10, order = 0, type = TrackerType.CIGARETTE)),
                userProfile = UserProfile(name = "Tester", unitPrice = 1.0, lifetimeAggregates = LifetimeAggregates()),
                financialMode = "OPTION_B",
                ledgers = emptyList(),
            ),
            localSettings = FakeSettings(),
            networkObserver = FakeNetwork(),
        )
        renderScreen(viewModel)
        // Fail-closed: a missing authoritative ledger is UNAVAILABLE, not €0.00.
        rule.onNodeWithText("UNAVAILABLE", substring = true).assertIsDisplayed()
    }

    @Test
    fun rendersCanonicalSpent_forOptionBWithLedger() {
        val credit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0)
        val ledgers = listOf(
            DailyFinancialRecord(date = today.toString(), canonicalCredit = credit, eligible = true),
            DailyFinancialRecord(date = dayBefore(1), canonicalCredit = credit, eligible = true),
        )
        val viewModel = RegistryViewModel(
            authRepository = FakeAuth(),
            registryRepository = FakeRepo(
                days = listOf(closedDay(today.toString(), "cig" to 6.0), closedDay(dayBefore(1), "cig" to 6.0)),
                logEntries = emptyList(),
                cfg = listOf(TrackerConfig(id = "cig", name = "Cigarettes", limit = 10, order = 0, type = TrackerType.CIGARETTE)),
                userProfile = UserProfile(name = "Tester", unitPrice = 1.0, lifetimeAggregates = LifetimeAggregates()),
                financialMode = "OPTION_B",
                ledgers = ledgers,
            ),
            localSettings = FakeSettings(),
            networkObserver = FakeNetwork(),
        )
        renderScreen(viewModel)
        // Canonical spend from the ledger is rendered, not a legacy derivation.
        rule.onNodeWithText("6,00 €", substring = true).assertIsDisplayed()
    }

    // --- Scenario 1 — closed daily documents only -------------------------
    @Test
    fun three_closed_day_documents_render_dated_rows_with_counts() {
        val d0 = dayBefore(2); val d1 = dayBefore(1); val d2 = dayBefore(0)
        renderScreen(vm(dayDocs = listOf(
            closedDay(d0, "cig" to 7.0),
            closedDay(d1, "cig" to 3.0),
            closedDay(d2, "cig" to 9.0),
        )))

        // Each seeded day surfaces as a dated row with its count (AUD-004).
        assertRowVisible("7 UNITS LOGGED")
        assertRowVisible("3 UNITS LOGGED")
        assertRowVisible("9 UNITS LOGGED")

        // The velocity chart reflects real (non-zero) historical data.
        rule.onNodeWithContentDescription("$d0: 7 units", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("$d1: 3 units", substring = true).assertIsDisplayed()
    }

    // --- Scenario 2 — mixed sources ---------------------------------------
    @Test
    fun manual_logs_and_day_documents_are_both_shown_and_distinguishable() {
        renderScreen(vm(
            dayDocs = listOf(closedDay(dayBefore(1), "cig" to 7.0)),
            logs = listOf(
                LogEntry(id = "m1", logDate = dayBefore(2), counts = mapOf("cig" to 2.0), isManual = true, origin = "MANUAL_ENTRY"),
            ),
        ))

        assertRowVisible("7 UNITS LOGGED")
        assertRowVisible("2 UNITS LOGGED")
        assertRowVisible("Tracked day")
        assertRowVisible("Manual entry")
    }

    // --- Scenario 5 — empty account ---------------------------------------
    @Test
    fun empty_account_shows_true_empty_state() {
        renderScreen(vm(dayDocs = emptyList(), logs = emptyList()))
        assertRowVisible("Your tracked days will appear here.")
    }

    // --- Removed tracker: historical record stays visible -----------------
    @Test
    fun historical_day_for_removed_tracker_still_renders() {
        renderScreen(vm(
            configs = emptyList(),
            dayDocs = listOf(closedDay(dayBefore(2), "ghost" to 4.0)),
        ))
        assertRowVisible("4 UNITS LOGGED")
        assertRowVisible("Tracked day")
    }

    // --- Scenario B — 3 closed day documents + 2 manual logs --------------
    @Test
    fun three_closed_days_and_two_manual_logs_all_present() {
        renderScreen(vm(
            dayDocs = listOf(
                closedDay(dayBefore(4), "cig" to 5.0),
                closedDay(dayBefore(3), "cig" to 6.0),
                closedDay(dayBefore(2), "cig" to 7.0),
            ),
            logs = listOf(
                LogEntry(id = "m1", logDate = dayBefore(1), counts = mapOf("cig" to 2.0), isManual = true, origin = "MANUAL_ENTRY"),
                LogEntry(id = "m2", logDate = dayBefore(0), counts = mapOf("cig" to 3.0), isManual = true, origin = "MANUAL_ENTRY"),
            ),
        ))
        assertRowVisible("5 UNITS LOGGED")
        assertRowVisible("6 UNITS LOGGED")
        assertRowVisible("7 UNITS LOGGED")
        assertRowVisible("2 UNITS LOGGED")
        assertRowVisible("3 UNITS LOGGED")
    }

    // --- Scenario F — large history: renders and scrolls to the oldest ----
    @Test
    fun large_history_scrolls_to_the_oldest_row() {
        val days = (0 until 40).map { closedDay(dayBefore(it), "cig" to (it + 1).toDouble()) }
        renderScreen(vm(dayDocs = days))
        assertRowVisible("1 UNITS LOGGED") // most recent seeded row
        assertRowVisible("40 UNITS LOGGED") // oldest seeded row, reached by scrolling
    }
}

// --- Fakes (in-memory, no Firebase) ---------------------------------------

private class FakeAuth : AuthRepository {
    override val currentUser: Flow<User?> = flowOf(User(uid = "u1", email = "t@e.st", displayName = "Tester", photoUrl = null))
    override val isGoogleSignInAvailable: Boolean = false
    override suspend fun signInWithGoogle(): Result<Unit> = Result.success(Unit)
    override suspend fun signInWithEmail(email: String, password: String): Result<Unit> = Result.success(Unit)
    override suspend fun signUpWithEmail(email: String, password: String, displayName: String?): Result<Unit> = Result.success(Unit)
    override suspend fun sendPasswordResetEmail(email: String): Result<Unit> = Result.success(Unit)
    override suspend fun updateDisplayName(name: String): Result<Unit> = Result.success(Unit)
    override suspend fun signOut() {}
    override suspend fun deleteAccount(password: String?): Result<Unit> = Result.success(Unit)
}

private class FakeSettings : LocalSettings {
    private val map = mutableMapOf<String, String>()
    override fun getString(key: String, defaultValue: String): String = map[key] ?: defaultValue
    override fun putString(key: String, value: String) { map[key] = value }
}

private class FakeNetwork : NetworkObserver {
    override val isOnline: StateFlow<Boolean> = MutableStateFlow(true)


}

private class FakeRepo(
    private val days: List<DayDocument>,
    private val logEntries: List<LogEntry>,
    private val cfg: List<TrackerConfig>,
    private val userProfile: UserProfile?,
    private val financialMode: String = "LEGACY",
    private val ledgers: List<DailyFinancialRecord> = emptyList(),
) : RegistryRepository {
    override fun subscribeToUserProfile(uid: String): Flow<UserProfile?> = flowOf(userProfile)
    override fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>> = flowOf(cfg)
    override fun subscribeToLogs(uid: String): Flow<List<LogEntry>> = flowOf(logEntries)
    override fun subscribeToDays(uid: String): Flow<List<DayDocument>> = flowOf(days)
    override fun subscribeToLedgers(uid: String): Flow<List<DailyFinancialRecord>> = flowOf(ledgers)
    override suspend fun getFinancialMode(uid: String): String = financialMode
    override fun subscribeToDay(uid: String, date: String): Flow<DayDocument?> =
        flowOf(days.firstOrNull { it.date == date })
    override fun subscribeToProfileExtra(uid: String): Flow<ProfileExtra?> = flowOf(null)

    override suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double, trackingDate: String, defaultUnitPrice: Double) {}
    override suspend fun closeDay(uid: String, date: String) {}
    override suspend fun reconcileStaleDays(uid: String, currentTrackingDate: String) {}
    override suspend fun updateHistoricalDay(uid: String, date: String, counts: Map<String, Double>) {}
    override suspend fun migrateLegacyActiveCounts(uid: String) {}
    override suspend fun migrateAvatarToProfileMeta(uid: String) {}
    override suspend fun updateAvatar(uid: String, avatar: String?) {}
    override suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>) {}
    override suspend fun createManualLogAtomic(uid: String, logId: String, date: String, counts: Map<String, Double>, snapshots: Map<String, com.tabakpp.app.data.TrackerSnapshot>, defaultUnitPrice: Double, operationId: String) {}
    override suspend fun updateManualLogAtomic(uid: String, logId: String, date: String, counts: Map<String, Double>, snapshots: Map<String, com.tabakpp.app.data.TrackerSnapshot>, defaultUnitPrice: Double, operationId: String) {}
    override suspend fun deleteManualLogAtomic(uid: String, logId: String, date: String, defaultUnitPrice: Double, operationId: String) {}
    override suspend fun restoreManualLogAtomic(uid: String, log: com.tabakpp.app.data.LogEntry, defaultUnitPrice: Double, operationId: String) {}
    override suspend fun adjustCounterAtomic(uid: String, date: String, trackerId: String, delta: Double, snapshots: Map<String, com.tabakpp.app.data.TrackerSnapshot>, defaultUnitPrice: Double, operationId: String) {}
    override suspend fun foldLedgerIntoLifetime(uid: String, date: String) {}
    override suspend fun deleteLog(uid: String, logId: String) {}
    override suspend fun restoreLog(uid: String, log: LogEntry) {}
    override suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>) {}
    override suspend fun addConfig(uid: String, config: TrackerConfig) {}
    override suspend fun updateConfig(uid: String, config: TrackerConfig) {}
    override suspend fun deleteConfig(uid: String, configId: String, trackingDate: String?) {}
    override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) {}
    override suspend fun updateProfileSettings(uid: String, profile: UserProfile) {}
    override suspend fun ensureUserDocument(uid: String, displayName: String?) {}
    override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {}
    override suspend fun deleteAllUserData(uid: String) {}
    override suspend fun clearLocalCache() {}
    override suspend fun readCompleteExportSnapshot(uid: String): CompleteExportSnapshot =
        CompleteExportSnapshot(generatedAt = "2026-01-01T00:00:00Z", profile = userProfile, profileMeta = null, configs = cfg, days = days, logs = logEntries)
}