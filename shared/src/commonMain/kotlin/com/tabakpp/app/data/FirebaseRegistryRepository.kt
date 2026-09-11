package com.tabakpp.app.data

import com.tabakpp.app.domain.RegistryMutations
import com.tabakpp.app.domain.SmokingCalculator
import dev.gitlive.firebase.firestore.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.datetime.Clock

/** Schema version marking the dated-daily-document migration. */
private const val CURRENT_SCHEMA_VERSION = 2

private fun nowTimestamp(): Timestamp {
    val ms = Clock.System.now().toEpochMilliseconds()
    return Timestamp(ms / 1000, ((ms % 1000) * 1_000_000).toInt())
}

/**
 * ## Data model
 *
 * `users/{uid}/days/{YYYY-MM-DD}` is the dated daily-document model (item 1):
 * every count always belongs to an explicit tracking date decided AT WRITE
 * TIME by the caller, never to a mutable "current session" bucket that can
 * outlive the day it started on. "Close day" only marks a day complete and
 * folds its stamped credit into `lifetimeAggregates`; it is never what
 * decides which date a count belongs to.
 *
 * `users/{uid}/logs/{logId}` is the pre-existing ledger, kept for backward
 * compatibility: legacy day archives (`{date}_DAY`, no longer created by
 * updated clients) and manual backfill entries (still created here).
 *
 * `users/{uid}` no longer carries `activeCounts` for updated clients (item
 * 12) — see [migrateLegacyActiveCounts]. `avatar` moved to
 * `users/{uid}/meta/profile` — see [migrateAvatarToProfileMeta]/[updateAvatar].
 */
class FirebaseRegistryRepository(
    private val firestore: FirebaseFirestore
) : RegistryRepository {

    private val BATCH_LIMIT = 400

    override fun subscribeToUserProfile(uid: String): Flow<UserProfile?> {
        return firestore.collection("users").document(uid).snapshots().map {
            if (it.exists) it.data<UserProfile>() else null
        }
    }

    override fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>> {
        return firestore.collection("users").document(uid).collection("configs")
            .orderBy("order")
            .snapshots()
            .map { it.documents.map { doc -> doc.data<TrackerConfig>().copy(id = doc.id) } }
    }

    override fun subscribeToLogs(uid: String): Flow<List<LogEntry>> {
        return firestore.collection("users").document(uid).collection("logs")
            .orderBy("logDate", Direction.DESCENDING)
            .limit(LIVE_LOG_QUERY_LIMIT)
            .snapshots()
            .map { snap -> snap.documents.mapNotNull { doc -> decodeLogEntry(doc) } }
    }

    override fun subscribeToDay(uid: String, date: String): Flow<DayDocument?> {
        return firestore.collection("users").document(uid).collection("days").document(date)
            .snapshots()
            .map { if (it.exists) decodeDayDocument(it) else null }
    }

    override fun subscribeToDays(uid: String): Flow<List<DayDocument>> {
        return firestore.collection("users").document(uid).collection("days")
            .orderBy("date", Direction.DESCENDING)
            .limit(LIVE_DAYS_QUERY_LIMIT)
            .snapshots()
            .map { snap -> snap.documents.mapNotNull { doc -> decodeDayDocument(doc) } }
    }

    override fun subscribeToProfileExtra(uid: String): Flow<ProfileExtra?> {
        return firestore.collection("users").document(uid).collection("meta").document("profile")
            .snapshots()
            .map { if (it.exists) it.data<ProfileExtra>() else null }
    }

    private suspend fun listConfigIds(uid: String): List<String> {
        return firestore.collection("users").document(uid).collection("configs")
            .get()
            .documents.map { it.id }
    }

    private suspend fun getConfigsOnce(uid: String): List<TrackerConfig> {
        return firestore.collection("users").document(uid).collection("configs")
            .orderBy("order")
            .get()
            .documents.map { doc -> doc.data<TrackerConfig>().copy(id = doc.id) }
    }

    /** Full history for one-shot migration only — not used by the live listener. */
    private suspend fun getAllLogsOnce(uid: String): List<LogEntry> {
        return firestore.collection("users").document(uid).collection("logs")
            .orderBy("logDate", Direction.DESCENDING)
            .get()
            .documents.mapNotNull { doc -> decodeLogEntry(doc) }
    }

    private fun decodeLogEntry(doc: DocumentSnapshot): LogEntry? {
        return try {
            doc.data<LogEntry>().copy(id = doc.id)
        } catch (_: Exception) {
            // Legacy/partial docs must not crash the signed-in shell.
            null
        }
    }

    private fun decodeDayDocument(doc: DocumentSnapshot): DayDocument? {
        return try {
            doc.data<DayDocument>().copy(date = doc.id)
        } catch (_: Exception) {
            null
        }
    }

    /** Re-read configs by id inside a transaction (client SDK cannot query in a tx). */
    private suspend fun Transaction.loadConfigs(
        configsRef: CollectionReference,
        configIds: List<String>
    ): List<TrackerConfig> {
        return configIds.mapNotNull { id ->
            val snap = get(configsRef.document(id))
            if (snap.exists) snap.data<TrackerConfig>().copy(id = id) else null
        }
    }

    override suspend fun updateLiveCounter(
        uid: String,
        trackerId: String,
        delta: Double,
        trackingDate: String,
        defaultUnitPrice: Double
    ) {
        val configRef = firestore.collection("users").document(uid).collection("configs").document(trackerId)
        val dayRef = firestore.collection("users").document(uid).collection("days").document(trackingDate)

        firestore.runTransaction {
            val configSnap = get(configRef)
            if (!configSnap.exists) throw Exception("CONFIG_NOT_FOUND")
            val config = configSnap.data<TrackerConfig>().copy(id = trackerId)

            val daySnap = get(dayRef)
            val existing = if (daySnap.exists) decodeDayDocument(daySnap) else null
            if (existing?.status == "closed") throw Exception("DAY_CLOSED")

            val counts = (existing?.counts ?: emptyMap()).toMutableMap()
            counts[trackerId] = maxOf(0.0, (counts[trackerId] ?: 0.0) + delta)
            val trackerSnapshots = (existing?.trackerSnapshots ?: emptyMap()) +
                (trackerId to SmokingCalculator.buildTrackerSnapshot(config))
            val credit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots, defaultUnitPrice)
            val now = nowTimestamp()

            set(
                dayRef,
                DayDocument(
                    date = trackingDate,
                    counts = counts,
                    trackerSnapshots = trackerSnapshots,
                    aggregateCredit = credit,
                    status = "open",
                    foldedIntoLifetime = existing?.foldedIntoLifetime ?: false,
                    legacyMigrationApplied = existing?.legacyMigrationApplied ?: false,
                    createdAt = existing?.createdAt ?: now,
                    updatedAt = now,
                    closedAt = existing?.closedAt
                )
            )
        }
    }

    override suspend fun closeDay(uid: String, date: String) {
        val userRef = firestore.collection("users").document(uid)
        val dayRef = userRef.collection("days").document(date)

        firestore.runTransaction {
            val daySnap = get(dayRef)
            if (!daySnap.exists) throw Exception("NOTHING_TO_ARCHIVE")
            val day = decodeDayDocument(daySnap) ?: throw Exception("NOTHING_TO_ARCHIVE")
            if (!SmokingCalculator.hasOpenSession(day.counts)) throw Exception("NOTHING_TO_ARCHIVE")

            if (day.foldedIntoLifetime) {
                if (day.status != "closed") {
                    set(dayRef, day.copy(status = "closed", closedAt = nowTimestamp()))
                }
                return@runTransaction
            }

            val userSnap = get(userRef)
            val profile = if (userSnap.exists) userSnap.data<UserProfile>() else UserProfile()
            val credit = day.aggregateCredit ?: LifetimeAggregates()

            set(dayRef, day.copy(status = "closed", foldedIntoLifetime = true, closedAt = nowTimestamp()))
            updateFields(userRef) {
                "lifetimeAggregates.saved" to (profile.lifetimeAggregates.saved + credit.saved)
                "lifetimeAggregates.wasted" to (profile.lifetimeAggregates.wasted + credit.wasted)
                "lifetimeAggregates.smokingUnits" to (profile.lifetimeAggregates.smokingUnits + credit.smokingUnits)
                "lifetimeAggregates.baselineSaved" to (profile.lifetimeAggregates.baselineSaved + credit.baselineSaved)
            }
        }
    }

    override suspend fun reconcileStaleDays(uid: String, currentTrackingDate: String) {
        val stale = try {
            firestore.collection("users").document(uid).collection("days")
                .orderBy("date", Direction.DESCENDING)
                .limit(LIVE_DAYS_QUERY_LIMIT)
                .get()
                .documents
                .mapNotNull { decodeDayDocument(it) }
                .filter { it.status == "open" && it.date < currentTrackingDate }
        } catch (_: Exception) {
            emptyList()
        }
        for (day in stale) {
            try {
                closeDay(uid, day.date)
            } catch (_: Exception) {
                // Best-effort — one failure must not block the rest.
            }
        }
    }

    override suspend fun updateHistoricalDay(uid: String, date: String, counts: Map<String, Double>) {
        val userRef = firestore.collection("users").document(uid)
        val dayRef = userRef.collection("days").document(date)
        val normalized = InputSanitizer.counts(counts)

        firestore.runTransaction {
            val daySnap = get(dayRef)
            if (!daySnap.exists) throw Exception("DAY_NOT_FOUND")
            val day = decodeDayDocument(daySnap) ?: throw Exception("DAY_NOT_FOUND")

            val mergedCounts = day.counts + normalized
            val newCredit = SmokingCalculator.computeDayCredit(mergedCounts, day.trackerSnapshots)

            if (day.foldedIntoLifetime) {
                val oldCredit = day.aggregateCredit ?: LifetimeAggregates()
                val userSnap = get(userRef)
                if (userSnap.exists) {
                    val profile = userSnap.data<UserProfile>()
                    updateFields(userRef) {
                        "lifetimeAggregates.saved" to (profile.lifetimeAggregates.saved - oldCredit.saved + newCredit.saved)
                        "lifetimeAggregates.wasted" to (profile.lifetimeAggregates.wasted - oldCredit.wasted + newCredit.wasted)
                        "lifetimeAggregates.smokingUnits" to (profile.lifetimeAggregates.smokingUnits - oldCredit.smokingUnits + newCredit.smokingUnits)
                        "lifetimeAggregates.baselineSaved" to (profile.lifetimeAggregates.baselineSaved - oldCredit.baselineSaved + newCredit.baselineSaved)
                    }
                }
            }

            set(dayRef, day.copy(counts = mergedCounts, aggregateCredit = newCredit, updatedAt = nowTimestamp()))
        }
    }

    /**
     * Two single-document transactions rather than one atomic users+days
     * commit — a combined commit measurably hit Firestore's per-commit
     * rules-evaluation ceiling ("maximum of 1000 expressions") once `days`
     * validation was added (see firestore.rules `validDayShape`'s comment
     * and webApp/src/services/registryService.js for the JS twin of this
     * exact design). Each phase is independently idempotent and safe to
     * resume after a crash between them, from any device:
     *   Phase 1 (users/{uid} only) atomically CLAIMS activeCounts — stamps
     *     it onto migratingLegacyCounts/-Date, clears activeCounts, bumps
     *     schemaVersion.
     *   Phase 2 (users/{uid}/days/{date} only) folds the claim into that
     *     day, marks it legacyMigrationApplied, then (separately) clears the
     *     claim fields from the profile.
     */
    override suspend fun migrateLegacyActiveCounts(uid: String) {
        val userRef = firestore.collection("users").document(uid)

        data class Claim(val counts: Map<String, Double>, val date: String)
        var claim: Claim? = null

        firestore.runTransaction {
            val snap = get(userRef)
            if (!snap.exists) return@runTransaction
            val profile = snap.data<UserProfile>()

            val pending = InputSanitizer.counts(profile.migratingLegacyCounts)
            if (profile.migratingLegacyDate != null && SmokingCalculator.hasOpenSession(pending)) {
                claim = Claim(pending, profile.migratingLegacyDate)
                return@runTransaction // resume an interrupted phase 2
            }
            if (profile.schemaVersion >= CURRENT_SCHEMA_VERSION) return@runTransaction // already migrated

            val legacy = InputSanitizer.counts(profile.activeCounts)
            if (!SmokingCalculator.hasOpenSession(legacy)) {
                updateFields(userRef) {
                    "schemaVersion" to CURRENT_SCHEMA_VERSION
                    "activeCounts" to FieldValue.delete
                }
                return@runTransaction
            }

            val date = SmokingCalculator.getTrackingDate(Clock.System.now(), profile.dayStartHour)
            updateFields(userRef) {
                "schemaVersion" to CURRENT_SCHEMA_VERSION
                "activeCounts" to FieldValue.delete
                "migratingLegacyCounts" to legacy
                "migratingLegacyDate" to date
            }
            claim = Claim(legacy, date)
        }

        val resolvedClaim = claim ?: return

        // Read non-transactionally: no concurrent-modification stakes worth a
        // transactional config read here — worst case on a config edited in
        // the gap before the commit below, one migrated tracker's snapshot
        // is a moment stale, self-corrected on its next tap.
        val configById = getConfigsOnce(uid).associateBy { it.id }
        val dayRef = userRef.collection("days").document(resolvedClaim.date)

        var claimResolved = false
        firestore.runTransaction {
            val daySnap = get(dayRef)
            val existing = if (daySnap.exists) decodeDayDocument(daySnap) else null

            if (existing?.legacyMigrationApplied == true) {
                claimResolved = true // already folded by a prior run
                return@runTransaction
            }
            if (existing?.status == "closed") {
                // Exceptionally rare: closed by a newer client in the window
                // between the claim and this commit. The claim stays parked
                // on the profile rather than guessing a different date.
                return@runTransaction
            }

            val mergedCounts = (existing?.counts ?: emptyMap()) + resolvedClaim.counts
            val trackerSnapshots = (existing?.trackerSnapshots ?: emptyMap()).toMutableMap()
            resolvedClaim.counts.keys.forEach { id ->
                configById[id]?.let { trackerSnapshots[id] = SmokingCalculator.buildTrackerSnapshot(it) }
            }
            val credit = SmokingCalculator.computeDayCredit(mergedCounts, trackerSnapshots)
            val now = nowTimestamp()

            set(
                dayRef,
                DayDocument(
                    date = resolvedClaim.date,
                    counts = mergedCounts,
                    trackerSnapshots = trackerSnapshots,
                    aggregateCredit = credit,
                    status = "open",
                    legacyMigrationApplied = true,
                    createdAt = existing?.createdAt ?: now,
                    updatedAt = now
                )
            )
            claimResolved = true
        }

        if (!claimResolved) return // day was closed underneath us — claim stays parked for a future run

        try {
            userRef.updateFields {
                "migratingLegacyCounts" to FieldValue.delete
                "migratingLegacyDate" to FieldValue.delete
            }
        } catch (_: Exception) {
            // Best-effort — next run retries the cleanup.
        }
    }

    override suspend fun migrateAvatarToProfileMeta(uid: String) {
        val userRef = firestore.collection("users").document(uid)
        val snap = userRef.get()
        if (!snap.exists) return
        val avatar = snap.data<UserProfile>().avatar ?: return

        val metaRef = userRef.collection("meta").document("profile")
        try {
            val metaSnap = metaRef.get()
            if (!metaSnap.exists || metaSnap.data<ProfileExtra>().avatar == null) {
                metaRef.set(ProfileExtra(avatar = avatar), merge = true)
            }
            userRef.updateFields { "avatar" to FieldValue.delete }
        } catch (_: Exception) {
            // Decorative metadata migration — safe to catch and ignore
        }
    }

    override suspend fun updateAvatar(uid: String, avatar: String?) {
        val userRef = firestore.collection("users").document(uid)
        userRef.collection("meta").document("profile").set(ProfileExtra(avatar = avatar), merge = true)
        try {
            userRef.updateFields { "avatar" to FieldValue.delete }
        } catch (_: Exception) {
            // Already gone.
        }
    }

    override suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>) {
        if (!SmokingCalculator.isValidDate(date)) {
            throw Exception("INVALID_DATE")
        }
        val userRef = firestore.collection("users").document(uid)
        val configsRef = userRef.collection("configs")
        val logsRef = userRef.collection("logs")
        val configIds = listConfigIds(uid)
        val normalized = InputSanitizer.counts(counts)

        firestore.runTransaction {
            val userSnap = get(userRef)
            val profile = userSnap.data<UserProfile>()
            val configs = loadConfigs(configsRef, configIds)

            val credit = RegistryMutations.contribution(normalized, configs, profile.unitPrice)
            val agg = RegistryMutations.applyCredit(profile.lifetimeAggregates, credit)
            val now = Clock.System.now().toEpochMilliseconds()
            val entropy = (0..999).random().toString().padStart(3, '0')
            val logId = "${date}_M${now}_$entropy"

            val logEntry = LogEntry(
                id = logId,
                logDate = date,
                counts = normalized,
                isManual = true,
                origin = "MANUAL_ENTRY",
                aggregateCredit = credit,
                clientTimestamp = Timestamp(now / 1000, ((now % 1000) * 1_000_000).toInt())
            )

            set(logsRef.document(logId), logEntry)
            updateFields(userRef) {
                "lifetimeAggregates.saved" to agg.saved
                "lifetimeAggregates.wasted" to agg.wasted
                "lifetimeAggregates.smokingUnits" to agg.smokingUnits
            }
        }
    }

    override suspend fun deleteLog(uid: String, logId: String) {
        val userRef = firestore.collection("users").document(uid)
        val configsRef = userRef.collection("configs")
        val logRef = userRef.collection("logs").document(logId)
        val configIds = listConfigIds(uid)

        firestore.runTransaction {
            val logSnap = get(logRef)
            if (!logSnap.exists) return@runTransaction
            val logEntry = decodeLogEntry(logSnap) ?: throw Exception("LOG_NOT_FOUND")

            val userSnap = get(userRef)
            val profile = userSnap.data<UserProfile>()
            val configs = loadConfigs(configsRef, configIds)

            val credit = RegistryMutations.resolveContribution(
                logEntry.aggregateCredit,
                logEntry.counts,
                configs,
                profile.unitPrice
            )
            val agg = RegistryMutations.applyDebit(profile.lifetimeAggregates, credit)

            delete(logRef)
            updateFields(userRef) {
                "lifetimeAggregates.saved" to agg.saved
                "lifetimeAggregates.wasted" to agg.wasted
                "lifetimeAggregates.smokingUnits" to agg.smokingUnits
            }
        }
    }

    override suspend fun restoreLog(uid: String, log: LogEntry) {
        val userRef = firestore.collection("users").document(uid)
        val configsRef = userRef.collection("configs")
        val logRef = userRef.collection("logs").document(log.id)
        val configIds = listConfigIds(uid)
        val normalized = log.copy(counts = InputSanitizer.counts(log.counts))

        firestore.runTransaction {
            val existing = get(logRef)
            if (existing.exists) return@runTransaction

            val userSnap = get(userRef)
            val profile = userSnap.data<UserProfile>()
            val configs = loadConfigs(configsRef, configIds)

            val credit = RegistryMutations.resolveContribution(
                normalized.aggregateCredit,
                normalized.counts,
                configs,
                profile.unitPrice
            )
            val stamped = normalized.copy(aggregateCredit = credit)
            val agg = RegistryMutations.applyCredit(profile.lifetimeAggregates, credit)

            set(logRef, stamped)
            updateFields(userRef) {
                "lifetimeAggregates.saved" to agg.saved
                "lifetimeAggregates.wasted" to agg.wasted
                "lifetimeAggregates.smokingUnits" to agg.smokingUnits
            }
        }
    }

    override suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>) {
        val userRef = firestore.collection("users").document(uid)
        val configsRef = userRef.collection("configs")
        val logRef = userRef.collection("logs").document(logId)
        val configIds = listConfigIds(uid)
        val normalized = InputSanitizer.counts(counts)

        firestore.runTransaction {
            val oldLogSnap = get(logRef)
            if (!oldLogSnap.exists) throw Exception("LOG_NOT_FOUND")
            val oldLogEntry = decodeLogEntry(oldLogSnap) ?: throw Exception("LOG_NOT_FOUND")

            val userSnap = get(userRef)
            val profile = userSnap.data<UserProfile>()
            val configs = loadConfigs(configsRef, configIds)

            val oldCredit = RegistryMutations.resolveContribution(
                oldLogEntry.aggregateCredit,
                oldLogEntry.counts,
                configs,
                profile.unitPrice
            )
            val configIdSet = configIds.toSet()
            val mergedCounts = RegistryMutations.mergeHistoricalEditCounts(
                normalized,
                oldLogEntry.counts,
                configIdSet
            )
            val newCredit = RegistryMutations.contribution(mergedCounts, configs, profile.unitPrice)
            val agg = RegistryMutations.applyReplace(profile.lifetimeAggregates, oldCredit, newCredit)

            updateFields(logRef) {
                "counts" to mergedCounts
                "aggregateCredit.saved" to newCredit.saved
                "aggregateCredit.wasted" to newCredit.wasted
                "aggregateCredit.smokingUnits" to newCredit.smokingUnits
            }
            updateFields(userRef) {
                "lifetimeAggregates.saved" to agg.saved
                "lifetimeAggregates.wasted" to agg.wasted
                "lifetimeAggregates.smokingUnits" to agg.smokingUnits
            }
        }
    }

    override suspend fun addConfig(uid: String, config: TrackerConfig) {
        val collection = firestore.collection("users").document(uid).collection("configs")
        val nowMillis = Clock.System.now().toEpochMilliseconds()
        val finalId = if (config.id.isBlank()) {
            val entropy = (0..999).random().toString().padStart(3, '0')
            "cfg_${nowMillis}$entropy"
        } else {
            config.id
        }
        val finalConfig = config.copy(
            id = finalId,
            createdAt = config.createdAt ?: Timestamp(nowMillis / 1000, ((nowMillis % 1000) * 1_000_000).toInt())
        )
        collection.document(finalId).set(finalConfig)
    }

    override suspend fun updateConfig(uid: String, config: TrackerConfig) {
        firestore.collection("users").document(uid).collection("configs").document(config.id).set(config, merge = true)
    }

    override suspend fun deleteConfig(uid: String, configId: String, trackingDate: String?) {
        val userRef = firestore.collection("users").document(uid)
        val configRef = userRef.collection("configs").document(configId)
        val dayRef = trackingDate?.let { userRef.collection("days").document(it) }
        firestore.runTransaction {
            // Legacy cleanup for an out-of-date client still on the pre-days-model
            // path — harmless no-op once activeCounts is gone.
            val userSnap = get(userRef)
            if (userSnap.exists) {
                val profile = userSnap.data<UserProfile>()
                if (profile.activeCounts.containsKey(configId)) {
                    val next = profile.activeCounts.toMutableMap()
                    next.remove(configId)
                    updateFields(userRef) {
                        "activeCounts" to next
                    }
                }
            }
            if (dayRef != null) {
                val daySnap = get(dayRef)
                if (daySnap.exists) {
                    val day = decodeDayDocument(daySnap)
                    if (day != null && day.status != "closed" && day.counts.containsKey(configId)) {
                        val counts = day.counts - configId
                        val trackerSnapshots = day.trackerSnapshots - configId
                        val credit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots)
                        set(dayRef, day.copy(counts = counts, trackerSnapshots = trackerSnapshots, aggregateCredit = credit, updatedAt = nowTimestamp()))
                    }
                }
            }
            delete(configRef)
        }
    }

    override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) {
        val configsRef = firestore.collection("users").document(uid).collection("configs")
        firestore.runTransaction {
            updateFields(configsRef.document(configId1)) {
                "order" to order1
            }
            updateFields(configsRef.document(configId2)) {
                "order" to order2
            }
        }
    }

    // Settings-only write path: never touches activeCounts, lifetimeAggregates,
    // or avatar (item 12 — avatar lives in users/{uid}/meta/profile), which are
    // owned by their own dedicated write paths. Writing the full profile here
    // would race live increments and silently revert them.
    // Also strip legacy web eco keys so rules stay satisfied on older documents.
    override suspend fun updateProfileSettings(uid: String, profile: UserProfile) {
        firestore.collection("users").document(uid).updateFields {
            "name" to profile.name
            "accent" to profile.accent
            "widgetSize" to profile.widgetSize.name
            "purchaseType" to profile.purchaseType
            "unitPrice" to profile.unitPrice
            "unitsPerPack" to profile.unitsPerPack
            "pouchPrice" to profile.pouchPrice
            "estimatedYield" to profile.estimatedYield
            "dayStartHour" to profile.dayStartHour
            "ecoMode" to FieldValue.delete
            "retailPrice" to FieldValue.delete
            "retailQty" to FieldValue.delete
            "ryoPrice" to FieldValue.delete
            "ryoYield" to FieldValue.delete
        }
    }

    override suspend fun ensureUserDocument(uid: String, displayName: String?) {
        val ref = firestore.collection("users").document(uid)
        val snap = ref.get()
        if (snap.exists) return
        ref.set(
            UserProfile(
                name = displayName.orEmpty(),
                accent = "#FF5F5F",
                widgetSize = WidgetSize.MEDIUM,
                purchaseType = "PACK",
                unitPrice = 0.5,
                pouchPrice = 0.0,
                estimatedYield = 0,
                dayStartHour = 6,
                lifetimeAggregates = LifetimeAggregates(),
                smokingUnitsMigrated = true,
                schemaVersion = CURRENT_SCHEMA_VERSION
            )
        )
    }

    override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {
        val userRef = firestore.collection("users").document(uid)
        val snap = userRef.get()
        if (!snap.exists) return
        val profile = snap.data<UserProfile>()
        if (profile.smokingUnitsMigrated) return

        val configs = getConfigsOnce(uid)
        val logs = getAllLogsOnce(uid)
        val units = SmokingCalculator.sumSmokingUnitsFromLogs(logs, configs)

        firestore.runTransaction {
            val live = get(userRef)
            if (!live.exists) return@runTransaction
            val liveProfile = live.data<UserProfile>()
            if (liveProfile.smokingUnitsMigrated) return@runTransaction
            val currentAggs = liveProfile.lifetimeAggregates
            updateFields(userRef) {
                "lifetimeAggregates" to currentAggs.copy(smokingUnits = units)
                "smokingUnitsMigrated" to true
            }
        }
    }

    override suspend fun deleteAllUserData(uid: String) {
        deleteCollectionPaged(firestore.collection("users").document(uid).collection("configs"))
        deleteCollectionPaged(firestore.collection("users").document(uid).collection("logs"))
        deleteCollectionPaged(firestore.collection("users").document(uid).collection("days"))
        deleteCollectionPaged(firestore.collection("users").document(uid).collection("meta"))
        firestore.collection("users").document(uid).delete()
    }

    private suspend fun deleteCollectionPaged(collection: CollectionReference) {
        while (true) {
            val docs = collection.limit(BATCH_LIMIT.toLong()).get().documents
            if (docs.isEmpty()) break
            var batch = firestore.batch()
            for (doc in docs) {
                batch = batch.delete(doc.reference)
            }
            batch.commit()
            if (docs.size < BATCH_LIMIT) break
        }
    }
}
