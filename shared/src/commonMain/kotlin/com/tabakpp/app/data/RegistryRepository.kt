package com.tabakpp.app.data

import kotlinx.coroutines.flow.Flow

const val LIVE_LOG_QUERY_LIMIT = 1_200L
const val LIVE_DAYS_QUERY_LIMIT = 400L

interface RegistryRepository {
    fun subscribeToUserProfile(uid: String): Flow<UserProfile?>
    fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>>
    fun subscribeToLogs(uid: String): Flow<List<LogEntry>>

    /** `users/{uid}/days/{date}` (item 1 — dated daily-document model): today's live bucket. */
    fun subscribeToDay(uid: String, date: String): Flow<DayDocument?>
    /** Bounded window (comfortably covers the 366-day streak lookback) for chart/streak use. */
    fun subscribeToDays(uid: String): Flow<List<DayDocument>>
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
}
