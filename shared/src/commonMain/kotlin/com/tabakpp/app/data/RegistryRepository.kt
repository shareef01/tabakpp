package com.tabakpp.app.data

import kotlinx.coroutines.flow.Flow

const val LIVE_LOG_QUERY_LIMIT = 1_200L

interface RegistryRepository {
    fun subscribeToUserProfile(uid: String): Flow<UserProfile?>
    fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>>
    fun subscribeToLogs(uid: String): Flow<List<LogEntry>>

    suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double)
    suspend fun endDay(uid: String, trackingDate: String)
    suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>)
    suspend fun deleteLog(uid: String, logId: String)
    suspend fun restoreLog(uid: String, log: LogEntry)
    suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>)
    suspend fun addConfig(uid: String, config: TrackerConfig)
    suspend fun updateConfig(uid: String, config: TrackerConfig)
    suspend fun deleteConfig(uid: String, configId: String)
    suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int)
    /** Settings-only — never writes activeCounts / lifetimeAggregates. */
    suspend fun updateProfileSettings(uid: String, profile: UserProfile)

    /** Creates a default user doc only when missing — never overwrites live counters/aggregates. */
    suspend fun ensureUserDocument(uid: String, displayName: String? = null)

    /** One-shot: compute smokingUnits from full log history if not yet migrated. */
    suspend fun migrateSmokingUnitsIfNeeded(uid: String)

    /** Spark-safe wipe of users/{uid} + configs + logs (Auth deleteUser is separate). */
    suspend fun deleteAllUserData(uid: String)
}
