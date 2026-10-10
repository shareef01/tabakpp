package com.tabakpp.app.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

const val LIVE_LOG_QUERY_LIMIT = 1_200L
const val LIVE_DAYS_QUERY_LIMIT = 400L

/**
 * Hard cap on simultaneously-configured trackers (AUD-005).
 *
 * `firestore.rules` bounds a day document's `trackerSnapshots` map to 8 entries
 * (validSnapshotMap) to stay within Firestore's per-commit rules-evaluation
 * budget. A snapshot entry is stamped for every tracker touched on a day, so a
 * 9th tracker would make the day write fail with permission-denied mid-use.
 * Enforced in the client so the user is told up-front.
 */
const val MAX_TRACKERS = 8

interface RegistryRepository {
    fun subscribeToUserProfile(uid: String): Flow<UserProfile?>
    fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>>
    fun subscribeToLogs(uid: String): Flow<List<LogEntry>>

    /** `users/{uid}/days/{date}` (item 1 — dated daily-document model): today's live bucket. */
    fun subscribeToDay(uid: String, date: String): Flow<DayDocument?>
    /** Bounded window (comfortably covers the 366-day streak lookback) for chart/streak use. */
    fun subscribeToDays(uid: String): Flow<List<DayDocument>>

    /**
     * Canonical OPTION B daily ledgers (bounded recent window). A bounded
     * subscription is NOT complete account history — see [getFinancialMode].
     */
    fun subscribeToLedgers(uid: String): Flow<List<DailyFinancialRecord>> = flowOf(emptyList())
    /** `users/{uid}/meta/profile` (item 12 — hot/profile split): avatar only. */
    fun subscribeToProfileExtra(uid: String): Flow<ProfileExtra?>

    /**
     * ATOMIC COUNTER ADJUSTMENT — the P0 fix (item 1). `trackingDate` is
     * computed by the caller at call time from wall-clock now + dayStartHour
     * and is where this write always lands; there is no separate "current
     * session" bucket that can carry counts across a rollover boundary.
     * `defaultUnitPrice` is supplied by the caller (already known from the
     * hydrated profile) so this never has to read `users/{uid}` — the hottest
     * write path stays fully decoupled from the profile document (item 12).
     */
    suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double, trackingDate: String, defaultUnitPrice: Double)

    /**
     * Close a tracking day: marks it complete and folds its stamped credit
     * into lifetimeAggregates. Purely a UX/rollup affordance — never what
     * assigns counts to a date (that already happened at write time above).
     */
    suspend fun closeDay(uid: String, date: String)

    /**
     * Fold any day still marked open but no longer the current tracking date
     * (item 1 — correctness must not depend on the app being open at
     * rollover or on "close day" ever being pressed). Safe to call on every
     * app start / tracking-date change.
     */
    suspend fun reconcileStaleDays(uid: String, currentTrackingDate: String)

    /**
     * Edit a closed historical day's counts. Never adds or changes a
     * trackerSnapshot entry — a historical day's stamped config is immutable
     * (item 2).
     */
    suspend fun updateHistoricalDay(uid: String, date: String, counts: Map<String, Double>)

    /**
     * One-shot, idempotent migration of legacy `activeCounts` into the dated
     * daily-document model. See FirebaseRegistryRepository for the exact
     * two-phase, single-document-transaction design and why (Firestore's
     * per-commit rules-evaluation ceiling).
     */
    suspend fun migrateLegacyActiveCounts(uid: String)

    /** One-shot, best-effort migration of the legacy `avatar` field into `users/{uid}/meta/profile`. */
    suspend fun migrateAvatarToProfileMeta(uid: String)

    /** Avatar lives in its own low-frequency doc (item 12), never the profile settings write path. */
    suspend fun updateAvatar(uid: String, avatar: String?)

    suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>)
    suspend fun deleteLog(uid: String, logId: String)
    suspend fun restoreLog(uid: String, log: LogEntry)
    suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>)

    /**
     * OPTION B atomic ledger write (local, parity with web `DailyLedger`). Creates
     * the manual-log SOURCE document AND folds its consumption into the date's
     * canonical `dailyFinancials/{date}` ledger AND (when the date is already
     * folded) the `lifetimeAggregates` projection AND the idempotency receipt —
     * all in ONE transaction. `operationId` dedupes retries of the same logical
     * action. Not wired into production flows; activation is gated.
     */
    suspend fun createManualLogAtomic(
        uid: String,
        logId: String,
        date: String,
        counts: Map<String, Double>,
        snapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double,
        operationId: String
    )

    /** OPTION B — edit a manual log; the ledger receives the exact source delta. */
    suspend fun updateManualLogAtomic(
        uid: String,
        logId: String,
        date: String,
        counts: Map<String, Double>,
        snapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double,
        operationId: String
    )

    /** OPTION B — delete a manual log; reverses its consumption in the ledger. */
    suspend fun deleteManualLogAtomic(uid: String, logId: String, date: String, defaultUnitPrice: Double, operationId: String)

    /** OPTION B — restore a deleted manual log (idempotent when already present). */
    suspend fun restoreManualLogAtomic(uid: String, log: LogEntry, defaultUnitPrice: Double, operationId: String)

    /** OPTION B — counter tap; writes the day document AND the date's ledger atomically. */
    suspend fun adjustCounterAtomic(
        uid: String,
        date: String,
        trackerId: String,
        delta: Double,
        snapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double,
        operationId: String
    )

    /** OPTION B — fold a date's canonical credit into lifetimeAggregates (idempotent). */
    suspend fun foldLedgerIntoLifetime(uid: String, date: String)

    /**
     * The account's server-side financial write mode ('LEGACY' default).
     *
     * Default implementation returns LEGACY so non-Firebase fakes stay valid;
     * FirebaseRegistryRepository overrides it to read `users/{uid}.financialMode`.
     */
    suspend fun getFinancialMode(uid: String): String = "LEGACY"
    suspend fun addConfig(uid: String, config: TrackerConfig)
    suspend fun updateConfig(uid: String, config: TrackerConfig)
    /** `trackingDate` (optional) additionally strips this tracker out of today's still-open day, never a closed one. */
    suspend fun deleteConfig(uid: String, configId: String, trackingDate: String? = null)
    suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int)
    /** Settings-only — never writes counters/aggregates/avatar. */
    suspend fun updateProfileSettings(uid: String, profile: UserProfile)

    /** Creates a default user doc only when missing — never overwrites live counters/aggregates. */
    suspend fun ensureUserDocument(uid: String, displayName: String? = null)

    /** One-shot: compute smokingUnits from full log history if not yet migrated. */
    suspend fun migrateSmokingUnitsIfNeeded(uid: String)

    /** Spark-safe wipe of users/{uid} + configs + logs + days + meta (Auth deleteUser is separate). */
    suspend fun deleteAllUserData(uid: String)

    /** Clears local cache/persistence post account deletion (M-04). */
    suspend fun clearLocalCache()

    /**
     * Complete, unbounded read of all user data for export (spec item 1).
     * Returns raw, unsorted snapshot data — the caller (ExportBuilder)
     * applies deterministic ordering. Strictly read-only: does NOT close
     * days, reconcile stale days, migrate active counts, or update any
     * document (spec items 16, 26).
     */
    suspend fun readCompleteExportSnapshot(uid: String): com.tabakpp.app.domain.CompleteExportSnapshot
}
