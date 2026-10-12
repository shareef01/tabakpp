package com.tabakpp.app.data

import com.tabakpp.app.domain.CompleteExportSnapshot
import com.tabakpp.app.domain.ProfileMetaExport
import com.tabakpp.app.domain.RegistryMutations
import com.tabakpp.app.domain.SmokingCalculator
import com.tabakpp.app.domain.HistoryCursor
import com.tabakpp.app.domain.HistoryPage
import dev.gitlive.firebase.firestore.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlin.time.Clock
import kotlinx.serialization.Serializable

/** Minimal projection used to read `users/{uid}.financialMode` without touching UserProfile. */
@Serializable
private data class FinancialModeDoc(val financialMode: String = "LEGACY")

/** Schema version marking the dated-daily-document migration. */
private const val CURRENT_SCHEMA_VERSION = 2

/** Every subcollection under `users/{uid}` (firestore.rules match blocks). */
internal val USER_SUBCOLLECTIONS = listOf(
    "configs", "logs", "days", "meta", "dailyFinancials", "financialOperations",
)

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
    private val firestore: FirebaseFirestore,
    /** Trusted server-side wipe for locked accounts; injectable for tests. */
    private val deleteAccountDataRemotely: suspend () -> Unit = ::callDeleteAccountData,
) : RegistryRepository {

    private val BATCH_LIMIT = 400

    override suspend fun getHistoricalDay(uid: String, date: String): DayDocument? =
        decodeDayDocument(firestore.collection("users").document(uid).collection("days").document(date).get())

    override suspend fun getHistoricalLog(uid: String, id: String): LogEntry? =
        decodeLogEntry(firestore.collection("users").document(uid).collection("logs").document(id).get())

    override suspend fun fetchOlderDays(uid: String, cursor: HistoryCursor?, pageSize: Int): HistoryPage<DayDocument> {
        require(pageSize in 1..400)
        val ref = firestore.collection("users").document(uid).collection("days")
        var query = ref.orderBy("date", Direction.DESCENDING).limit(pageSize.toLong())
        if (cursor != null) query = query.startAfter(cursor.date)
        val docs = query.get().documents
        val items = docs.mapNotNull { decodeDayDocument(it) }
        return HistoryPage(items, docs.lastOrNull()?.let { HistoryCursor(it.id, it.id) }, docs.size == pageSize)
    }

    override suspend fun fetchOlderLogs(uid: String, cursor: HistoryCursor?, pageSize: Int): HistoryPage<LogEntry> {
        require(pageSize in 1..400)
        val ref = firestore.collection("users").document(uid).collection("logs")
        var query = ref.orderBy("logDate", Direction.DESCENDING).orderBy("__name__", Direction.DESCENDING).limit(pageSize.toLong())
        if (cursor != null) query = query.startAfter(cursor.date, cursor.id)
        val docs = query.get().documents
        val items = docs.mapNotNull { decodeLogEntry(it) }
        val last = docs.lastOrNull()
        return HistoryPage(items, last?.let { HistoryCursor(it.get<String>("logDate"), it.id) }, docs.size == pageSize)
    }

    override fun subscribeToUserProfile(uid: String): Flow<UserProfile?> {
        return firestore.collection("users").document(uid).snapshots().map {
            if (it.exists) it.data<UserProfile>() else null
        }
    }

    /** Same document as [subscribeToUserProfile] — the SDK shares one watch target. */
    override fun subscribeToFinancialMode(uid: String): Flow<String> {
        return firestore.collection("users").document(uid).snapshots().map {
            if (it.exists) it.data<FinancialModeDoc>().financialMode else "LEGACY"
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

    /**
     * Canonical OPTION B daily ledgers (bounded recent window — the Web
     * equivalent uses 400 docs). The trusted callable is the only writer.
     */
    override fun subscribeToLedgers(uid: String): Flow<List<DailyFinancialRecord>> {
        return firestore.collection("users").document(uid).collection("dailyFinancials")
            .orderBy("date", Direction.DESCENDING)
            .limit(LIVE_DAYS_QUERY_LIMIT)
            .snapshots()
            .map { snap -> snap.documents.mapNotNull { doc -> decodeLedger(doc) } }
    }

    private fun decodeLedger(doc: DocumentSnapshot): DailyFinancialRecord? {
        return try {
            if (doc.exists) doc.data<DailyFinancialRecord>().copy(date = doc.id) else null
        } catch (e: Exception) {
            null
        }
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

    /**
     * Paginated full-history read for logs — NOT the bounded live
     * listener (which uses limit(LIVE_LOG_QUERY_LIMIT)). Paginates to stay
     * under Firestore's 1MB response cap on heavy accounts.
     */
    private suspend fun getAllLogsOnce(uid: String): List<LogEntry> {
        val out = mutableListOf<LogEntry>()
        var lastDoc: DocumentSnapshot? = null
        while (true) {
            val query = firestore.collection("users").document(uid).collection("logs")
                .orderBy("logDate", Direction.DESCENDING)
                .limit(BATCH_LIMIT.toLong())
            val snap = if (lastDoc != null) query.startAfter(lastDoc).get() else query.get()
            val docs = snap.documents
            if (docs.isEmpty()) break
            docs.mapNotNull { doc -> decodeLogEntry(doc) }.let { out.addAll(it) }
            if (docs.size < BATCH_LIMIT) break
            lastDoc = docs.last()
        }
        return out
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

    /**
     * Paginated full-history read for day documents — NOT the bounded live
     * listener (which uses limit(LIVE_DAYS_QUERY_LIMIT)). Paginates to stay
     * under Firestore's 1MB response cap.
     */
    private suspend fun getAllDaysOnce(uid: String): List<DayDocument> {
        val out = mutableListOf<DayDocument>()
        var lastDoc: DocumentSnapshot? = null
        while (true) {
            val query = firestore.collection("users").document(uid).collection("days")
                .orderBy("date", Direction.DESCENDING)
                .limit(BATCH_LIMIT.toLong())
            val snap = if (lastDoc != null) query.startAfter(lastDoc).get() else query.get()
            val docs = snap.documents
            if (docs.isEmpty()) break
            docs.mapNotNull { doc -> decodeDayDocument(doc) }.let { out.addAll(it) }
            if (docs.size < BATCH_LIMIT) break
            lastDoc = docs.last()
        }
        return out
    }

    private suspend fun getUserProfileOnce(uid: String): UserProfile? {
        val snap = firestore.collection("users").document(uid).get()
        return if (snap.exists) {
            try {
                snap.data<UserProfile>()
            } catch (_: Exception) {
                null
            }
        } else null
    }

    private suspend fun getProfileExtraOnce(uid: String): ProfileExtra? {
        val snap = firestore.collection("users").document(uid).collection("meta").document("profile").get()
        return if (snap.exists) {
            try {
                snap.data<ProfileExtra>()
            } catch (_: Exception) {
                null
            }
        } else null
    }

    /**
     * Read-only complete snapshot of all user data for export.
     *
     * Uses unbounded, paginated reads — NOT the bounded live-query collections
     * (limit(1200) for logs, limit(400) for days). Safe to call from ViewModel
     * without triggering migrations, day-close, or any writes.
     */
    override suspend fun readCompleteExportSnapshot(uid: String): CompleteExportSnapshot {
        val profile = getUserProfileOnce(uid)
        val profileExtra = getProfileExtraOnce(uid)
        val configs = getConfigsOnce(uid)
        val days = getAllDaysOnce(uid)
        val logs = getAllLogsOnce(uid)
        return CompleteExportSnapshot(
            generatedAt = kotlin.time.Clock.System.now().toString(),
            profile = profile,
            profileMeta = profileExtra?.let { ProfileMetaExport(it.avatar) },
            configs = configs,
            days = days,
            logs = logs
        )
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
            if (trackerId !in (existing?.trackerSnapshots ?: emptyMap()) && (existing?.trackerSnapshots?.size ?: 0) >= 8) throw Exception("TRACKER_LIMIT")

            val counts = (existing?.counts ?: emptyMap()).toMutableMap()
            counts[trackerId] = maxOf(0.0, (counts[trackerId] ?: 0.0) + delta)
            val trackerSnapshots = (existing?.trackerSnapshots ?: emptyMap()) +
                (trackerId to SmokingCalculator.buildTrackerSnapshot(config, defaultUnitPrice))
            val credit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots, defaultUnitPrice)

            // Match the web RegistryService.adjustCounter: use update() for
            // existing docs (field-level patch only) and set() for new docs.
            //
            // CRITICAL (item 4): Timestamp.ServerTimestamp cannot survive
            // @Serializable data class round-tripping through
            // BaseTimestampOrLongSerializer — it is serialized as null (see
            // GitLive issue #666). So new-day creation uses set() with concrete
            // now() timestamps, then updateFields to overwrite createdAt/updatedAt
            // with server sentinels in the same transaction. This matches the
            // web code's `transaction.set(dayRef, { ...payload, createdAt:
            // serverTimestamp() })` pattern where serverTimestamp() is a native
            // Firestore sentinel that stays intact through the JS SDK's
            // serialization path.
            val serverTs = Timestamp.ServerTimestamp as BaseTimestamp
            val now = nowTimestamp()
            if (existing == null) {
                // New day: use set() to create the document.
                //
                // CRITICAL (item 4): Timestamp.ServerTimestamp cannot survive
                // @Serializable data class round-tripping through
                // BaseTimestampOrLongSerializer — it is serialized as null (see
                // GitLive issue #666). So we create the doc with a concrete
                // client-side now() for createdAt, then immediately overwrite
                // BOTH createdAt and updatedAt with server sentinels via
                // updateFields in the same transaction. This matches the web
                // code's `transaction.set(dayRef, { ...payload, createdAt:
                // serverTimestamp() })` pattern, where serverTimestamp() is a
                // native Firestore sentinel that survives the JS SDK's
                // serialization path intact.
                set(dayRef, DayDocument(
                    date = trackingDate,
                    updatedTrackerId = trackerId,
                    counts = counts,
                    trackerSnapshots = trackerSnapshots,
                    aggregateCredit = credit,
                    status = "open",
                    foldedIntoLifetime = false,
                    legacyMigrationApplied = false,
                    createdAt = now,
                    updatedAt = now,
                    closedAt = null
                ))
                // Overwrite createdAt + updatedAt with real server sentinels.
                // updateFields passes them through the native FieldValue path,
                // not through @Serializable, so the sentinel is preserved.
                updateFields(dayRef) {
                    "createdAt" to serverTs
                    "updatedAt" to serverTs
                }
            } else {
                updateFields(dayRef) {
                    "counts" to counts
                    "updatedTrackerId" to trackerId
                    "trackerSnapshots" to trackerSnapshots
                    "aggregateCredit" to credit
                    "updatedAt" to serverTs
                }
            }
        }
    }

    override suspend fun closeDay(uid: String, date: String) {
        val userRef = firestore.collection("users").document(uid)
        val dayRef = userRef.collection("days").document(date)

        firestore.runTransaction {
            val daySnap = get(dayRef)
            if (!daySnap.exists) throw Exception("NOTHING_TO_ARCHIVE")
            val day = decodeDayDocument(daySnap) ?: throw Exception("NOTHING_TO_ARCHIVE")
            // A day doc that exists IS a recorded day, even with all-zero counts
            // (increment-then-decrement, or the last tracker removed after
            // activity). Closing it must fold its stamped credit, which a
            // zero-count day still carries as target-based `saved` (AUD-006).
            // Previously a zero-count day threw here and stayed open forever.
            if (day.foldedIntoLifetime) {
                if (day.status != "closed") {
                    updateFields(dayRef) {
                        "status" to "closed"
                        "closedAt" to (Timestamp.ServerTimestamp as BaseTimestamp)
                    }
                }
                return@runTransaction
            }

            val userSnap = get(userRef)
            val profile = if (userSnap.exists) userSnap.data<UserProfile>() else UserProfile()
            val credit = day.aggregateCredit ?: LifetimeAggregates()

            updateFields(dayRef) {
                "status" to "closed"
                "foldedIntoLifetime" to true
                "closedAt" to (Timestamp.ServerTimestamp as BaseTimestamp)
            }
            updateFields(userRef) {
                "lifetimeAggregates.saved" to (profile.lifetimeAggregates.saved + credit.saved)
                "lifetimeAggregates.wasted" to (profile.lifetimeAggregates.wasted + credit.wasted)
                "lifetimeAggregates.smokingUnits" to (profile.lifetimeAggregates.smokingUnits + credit.smokingUnits)
                "lifetimeAggregates.baselineSaved" to (profile.lifetimeAggregates.baselineSaved + credit.baselineSaved)
            }
        }
    }

    /**
     * Batched stale-day reconciliation (AUD-010). Pages the `days` collection in
     * ASCENDING date order (single-field, auto-indexed) so the oldest — and
     * therefore stale — days are reached first, and stops early once a page
     * reaches the current tracking date. Bounded by both a page size and a hard
     * page cap so a runaway backlog can never block the caller; best-effort per
     * day so one failure does not abort the rest.
     */
    override suspend fun reconcileStaleDays(uid: String, currentTrackingDate: String) {
        for (date in listStaleOpenDays(uid, currentTrackingDate)) {
            try {
                closeDay(uid, date)
            } catch (_: Exception) {
                // Best-effort — one failure must not block the rest.
            }
        }
    }

    override suspend fun listStaleOpenDays(uid: String, currentTrackingDate: String): List<String> {
        val daysCollection = firestore.collection("users").document(uid).collection("days")
        val pageSize = 200L
        val maxPages = 10 // ≤2000 days per call — bounded, resumable on the next call
        val stale = mutableListOf<String>()
        var lastDoc: DocumentSnapshot? = null
        var page = 0
        while (page < maxPages) {
            page++
            var query: Query = daysCollection
                .orderBy("date", Direction.ASCENDING)
                .limit(pageSize)
            if (lastDoc != null) query = query.startAfter(lastDoc!!)
            val snap = try {
                query.get()
            } catch (_: Exception) {
                return stale
            }
            val docs = snap.documents
            if (docs.isEmpty()) return stale
            for (doc in docs) {
                val day = decodeDayDocument(doc) ?: continue
                if (day.status != "open") continue
                // Ascending order: no later document can be stale.
                if (day.date >= currentTrackingDate) return stale
                stale.add(day.date)
            }
            lastDoc = docs.lastOrNull() ?: return stale
            if (docs.size < pageSize) return stale
        }
        return stale
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
            if (SmokingCalculator.countsEqual(mergedCounts, day.counts)) return@runTransaction
            SmokingCalculator.requireHistoricalPrices(mergedCounts, day.trackerSnapshots)
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

            updateFields(dayRef) {
                "counts" to mergedCounts
                "aggregateCredit" to newCredit
                "updatedAt" to (Timestamp.ServerTimestamp as BaseTimestamp)
            }
        }
    }

    /** Apply a fenced claim in resumable per-tracker transactions.
     * Closed or full targets become recovery logs whose historical money is unknown. */
    private suspend fun applyLegacyClaim(
        uid: String, date: String, claimed: Map<String, Double>, price: Double, claimId: String,
        configs: Map<String, TrackerConfig>
    ) {
        val userRef = firestore.collection("users").document(uid)
        val dayRef = userRef.collection("days").document(date)
        claimed.keys.sorted().forEachIndexed { index, id ->
            val marker = userRef.collection("meta").document("legacy_${date}_${claimId}_$index")
            val logRef = userRef.collection("logs").document("${date}_LEGACY_${claimId}_$index")
            firestore.runTransaction {
                if (get(marker).exists) return@runTransaction
                val daySnap = get(dayRef)
                val day = if (daySnap.exists) decodeDayDocument(daySnap) else null
                val previous = day?.trackerSnapshots ?: emptyMap()
                val config = configs[id] ?: TrackerConfig(id, "Removed tracker", 0, 0,
                    type = TrackerType.SIMPLE, isFinanciallyTracked = false)
                if (day?.status != "closed" && (day?.counts?.get(id) ?: 0.0) + claimed.getValue(id) <= 10000
                    && (id in previous || previous.size < 8)) {
                    val counts = (day?.counts ?: emptyMap()) + (id to ((day?.counts?.get(id) ?: 0.0) + claimed.getValue(id)))
                    val snapshots = previous + (id to (previous[id] ?: SmokingCalculator.buildTrackerSnapshot(config, price)))
                    val credit = SmokingCalculator.computeDayCredit(counts, snapshots)
                    if (day == null) {
                        set(dayRef, DayDocument(date = date, counts = counts, trackerSnapshots = snapshots,
                            aggregateCredit = credit, updatedTrackerId = id, createdAt = nowTimestamp(), updatedAt = nowTimestamp()))
                    } else {
                        updateFields(dayRef) {
                            "counts" to counts
                            "trackerSnapshots" to snapshots
                            "aggregateCredit" to credit
                            "updatedTrackerId" to id
                            "updatedAt" to (Timestamp.ServerTimestamp as BaseTimestamp)
                        }
                    }
                    set(marker, LegacyMigrationMarker(date))
                } else {
                    val existing = get(logRef)
                    val user = get(userRef)
                    if (existing.exists) throw IllegalStateException("LEGACY_RECOVERY_CONFLICT")
                    val counts = mapOf(id to claimed.getValue(id))
                    val snapshots = mapOf(id to SmokingCalculator.buildTrackerSnapshot(
                        config.copy(limit = 0, baseline = null, pricePerUnit = 0.0, isFinanciallyTracked = false), 0.0))
                    val credit = SmokingCalculator.computeDayCredit(counts, snapshots)
                    set(logRef, LogEntry(id = logRef.id, logDate = date, counts = counts, trackerSnapshots = snapshots,
                        aggregateCredit = credit, origin = "LEGACY_RECOVERY", economicStatus = "UNKNOWN", clientTimestamp = nowTimestamp()))
                    set(marker, LegacyMigrationMarker(date))
                    updateFields(userRef) {
                        "lifetimeAggregates.smokingUnits" to (user.data<UserProfile>().lifetimeAggregates.smokingUnits + credit.smokingUnits)
                    }
                }
            }
        }
    }
    override suspend fun migrateLegacyActiveCounts(uid: String) {
        val userRef = firestore.collection("users").document(uid)
        data class Claim(val counts: Map<String, Double>, val date: String, val id: String, val price: Double)
        fun newId() = kotlin.random.Random.nextBytes(16).joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }
        var claim: Claim? = null
        firestore.runTransaction {
            claim = null // A retry may observe a claim already completed by another client.
            val snap = get(userRef)
            if (!snap.exists) return@runTransaction
            val profile = snap.data<UserProfile>()
            val pending = InputSanitizer.counts(profile.migratingLegacyCounts)
            if (profile.migratingLegacyDate != null && SmokingCalculator.hasOpenSession(pending)) {
                if (profile.migratingLegacyId == null) {
                    val day = get(userRef.collection("days").document(profile.migratingLegacyDate))
                    if (day.exists && decodeDayDocument(day)?.legacyMigrationApplied == true) {
                        updateFields(userRef) {
                            "migratingLegacyCounts" to FieldValue.delete
                            "migratingLegacyDate" to FieldValue.delete
                            "migratingLegacyId" to FieldValue.delete
                            "migratingLegacyVersion" to FieldValue.delete
                            "migratingLegacyUnitPrice" to FieldValue.delete
                        }
                        return@runTransaction
                    }
                }
                val id = profile.migratingLegacyId ?: newId()
                val price = profile.migratingLegacyUnitPrice ?: profile.unitPrice
                updateFields(userRef) {
                    "migratingLegacyId" to id
                    "migratingLegacyVersion" to 3
                    "migratingLegacyUnitPrice" to price
                }
                claim = Claim(pending, profile.migratingLegacyDate, id, price)
                return@runTransaction
            }
            val legacy = InputSanitizer.counts(profile.activeCounts)
            if (!SmokingCalculator.hasOpenSession(legacy)) {
                if (profile.schemaVersion < CURRENT_SCHEMA_VERSION || profile.migratingLegacyVersion != null) {
                    updateFields(userRef) {
                        "schemaVersion" to CURRENT_SCHEMA_VERSION
                        "activeCounts" to FieldValue.delete
                        "migratingLegacyCounts" to FieldValue.delete
                        "migratingLegacyDate" to FieldValue.delete
                        "migratingLegacyId" to FieldValue.delete
                        "migratingLegacyVersion" to FieldValue.delete
                        "migratingLegacyUnitPrice" to FieldValue.delete
                    }
                }
                return@runTransaction
            }
            val date = SmokingCalculator.getTrackingDate(Clock.System.now(), profile.dayStartHour)
            val id = newId()
            updateFields(userRef) {
                "schemaVersion" to CURRENT_SCHEMA_VERSION
                "activeCounts" to FieldValue.delete
                "migratingLegacyCounts" to legacy
                "migratingLegacyDate" to date
                "migratingLegacyId" to id
                "migratingLegacyVersion" to 3
                "migratingLegacyUnitPrice" to profile.unitPrice
            }
            claim = Claim(legacy, date, id, profile.unitPrice)
        }
        val resolved = claim ?: return
        val configs = getConfigsOnce(uid).associateBy { it.id }
        applyLegacyClaim(uid, resolved.date, resolved.counts, resolved.price, resolved.id, configs)
        firestore.runTransaction {
            val user = get(userRef)
            val dayRef = userRef.collection("days").document(resolved.date)
            val day = get(dayRef)
            if (!user.exists || user.data<UserProfile>().migratingLegacyId != resolved.id) return@runTransaction
            updateFields(userRef) {
                "migratingLegacyCounts" to FieldValue.delete
                "migratingLegacyDate" to FieldValue.delete
                "migratingLegacyId" to FieldValue.delete
                "migratingLegacyVersion" to FieldValue.delete
                "migratingLegacyUnitPrice" to FieldValue.delete
            }
            if (day.exists && decodeDayDocument(day)?.status != "closed") {
                updateFields(dayRef) { "legacyMigrationApplied" to true }
            }
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
        if (configIds.size > 8) throw IllegalStateException("TRACKER_LIMIT")
        if (normalized.any { (id, value) -> value > 0 && id !in configIds }) throw IllegalStateException("INVALID_TRACKER")

        firestore.runTransaction {
            val userSnap = get(userRef)
            val profile = userSnap.data<UserProfile>()
            val configs = loadConfigs(configsRef, configIds)

            val trackerSnapshots = configs.associate { it.id to SmokingCalculator.buildTrackerSnapshot(it, profile.unitPrice) }
            val credit = SmokingCalculator.computeDayCredit(normalized, trackerSnapshots)
            val agg = RegistryMutations.applyCredit(profile.lifetimeAggregates, credit)
            val now = Clock.System.now().toEpochMilliseconds()
            val entropy = kotlin.random.Random.nextBytes(4).joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }
            val logId = "${date}_M${now}_$entropy"

            val logEntry = LogEntry(
                id = logId,
                logDate = date,
                counts = normalized,
                isManual = true,
                origin = "MANUAL_ENTRY",
                aggregateCredit = credit,
                trackerSnapshots = trackerSnapshots,
                clientTimestamp = Timestamp(now / 1000, ((now % 1000) * 1_000_000).toInt())
            )

            set(logsRef.document(logId), logEntry)
            updateFields(userRef) {
                "lifetimeAggregates.saved" to agg.saved
                "lifetimeAggregates.wasted" to agg.wasted
                "lifetimeAggregates.smokingUnits" to agg.smokingUnits
                "lifetimeAggregates.baselineSaved" to agg.baselineSaved
            }
        }
    }

    /**
     * OPTION B atomic ledger write (parity with web `DailyLedger.createManualLog`).
     * Source log + canonical ledger + (when folded) lifetime + idempotency receipt
     * commit together or not at all. `operationId` makes the logical action
     * request-idempotent. Local only — not called by production flows.
     */
    override suspend fun createManualLogAtomic(
        uid: String,
        logId: String,
        date: String,
        counts: Map<String, Double>,
        snapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double,
        operationId: String
    ) {
        if (!SmokingCalculator.isValidDate(date)) throw Exception("INVALID_DATE")
        val userRef = firestore.collection("users").document(uid)
        val ledgerRef = userRef.collection("dailyFinancials").document(date)
        val logRef = userRef.collection("logs").document(logId)
        val receiptRef = userRef.collection("financialOperations").document(operationId)
        val normalized = InputSanitizer.counts(counts)
        val fingerprint = "createManualLog|$date|$logId|" +
            normalized.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" }

        firestore.runTransaction {
            val receiptSnap = get(receiptRef)
            val ledgerSnap = get(ledgerRef)
            val userSnap = get(userRef)
            val logSnap = get(logRef)

            if (receiptSnap.exists) {
                val stored = receiptSnap.data<FinancialOperationReceipt>().payloadFingerprint
                if (stored != fingerprint) throw Exception("OPERATION_CONFLICT")
                return@runTransaction
            }
            if (logSnap.exists) throw Exception("LOG_EXISTS")

            val existing = if (ledgerSnap.exists) ledgerSnap.data<DailyFinancialRecord>() else null
            val oldCounts = existing?.countsByTracker ?: emptyMap()
            val newCounts = addCounts(oldCounts, normalized)
            val mergedSnapshots = (existing?.snapshots ?: emptyMap()) + snapshots
            val oldCredit = existing?.canonicalCredit ?: LifetimeAggregates()
            val newCredit = SmokingCalculator.computeDayCredit(newCounts, mergedSnapshots, defaultUnitPrice)
            val logOwnCredit = SmokingCalculator.computeDayCredit(normalized, snapshots, defaultUnitPrice)
            val folded = existing?.foldedIntoLifetime == true

            set(logRef, LogEntry(
                id = logId,
                logDate = date,
                counts = normalized,
                isManual = true,
                origin = "MANUAL_ENTRY",
                // Per-log stamp is consumption-only; the day-level `saved` lives on the ledger.
                aggregateCredit = LifetimeAggregates(
                    saved = 0.0,
                    wasted = logOwnCredit.wasted,
                    smokingUnits = logOwnCredit.smokingUnits,
                    baselineSaved = 0.0
                )
            ))
            set(ledgerRef, DailyFinancialRecord(
                date = date,
                countsByTracker = newCounts,
                snapshots = mergedSnapshots,
                canonicalCredit = newCredit,
                ledgerSchemaVersion = 2,
                ambiguous = existing?.ambiguous ?: false,
                missingConfig = existing?.missingConfig ?: emptyList(),
                foldedIntoLifetime = folded,
                migratedFromLegacy = existing?.migratedFromLegacy ?: false
            ))
            if (folded && userSnap.exists) {
                val profile = userSnap.data<UserProfile>()
                val cur = profile.lifetimeAggregates
                updateFields(userRef) {
                    "lifetimeAggregates.saved" to (cur.saved - oldCredit.saved + newCredit.saved)
                    "lifetimeAggregates.wasted" to (cur.wasted - oldCredit.wasted + newCredit.wasted)
                    "lifetimeAggregates.smokingUnits" to (cur.smokingUnits - oldCredit.smokingUnits + newCredit.smokingUnits)
                    "lifetimeAggregates.baselineSaved" to (cur.baselineSaved - oldCredit.baselineSaved + newCredit.baselineSaved)
                }
            }
            set(receiptRef, FinancialOperationReceipt(
                operationId = operationId,
                operationType = "createManualLog",
                sourceDocumentPath = logRef.path,
                trackingDate = date,
                payloadFingerprint = fingerprint,
                resultStatus = "OK"
            ))
        }
    }

    /** Element-wise count addition (Kotlin's `Map + Map` replaces duplicate keys). */
    private fun addCounts(a: Map<String, Double>, b: Map<String, Double>): Map<String, Double> =
        (a.keys + b.keys)
            .associateWith { maxOf(0.0, (a[it] ?: 0.0) + (b[it] ?: 0.0)) }
            .filterValues { it > 0.0 }

    /** Recompute a date's canonical ledger from an (optional) prior record + a delta. */
    private fun deriveLedgerRecord(
        date: String,
        existing: DailyFinancialRecord?,
        deltaCounts: Map<String, Double>,
        extraSnapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double
    ): Pair<DailyFinancialRecord, LifetimeAggregates> {
        val oldCounts = existing?.countsByTracker ?: emptyMap()
        val newCounts = addCounts(oldCounts, deltaCounts)
        val snapshots = (existing?.snapshots ?: emptyMap()) + extraSnapshots
        val oldCredit = existing?.canonicalCredit ?: LifetimeAggregates()
        val newCredit = SmokingCalculator.computeDayCredit(newCounts, snapshots, defaultUnitPrice)
        val rec = DailyFinancialRecord(
            date = date,
            countsByTracker = newCounts,
            snapshots = snapshots,
            canonicalCredit = newCredit,
            ledgerSchemaVersion = 2,
            ambiguous = existing?.ambiguous ?: false,
            missingConfig = existing?.missingConfig ?: emptyList(),
            foldedIntoLifetime = existing?.foldedIntoLifetime == true,
            migratedFromLegacy = existing?.migratedFromLegacy ?: false
        )
        return rec to oldCredit
    }

    private fun ledgerFingerprint(type: String, vararg parts: String): String =
        type + "|" + parts.joinToString("|")

    override suspend fun updateManualLogAtomic(
        uid: String,
        logId: String,
        date: String,
        counts: Map<String, Double>,
        snapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double,
        operationId: String
    ) {
        val userRef = firestore.collection("users").document(uid)
        val ledgerRef = userRef.collection("dailyFinancials").document(date)
        val logRef = userRef.collection("logs").document(logId)
        val receiptRef = userRef.collection("financialOperations").document(operationId)
        val normalized = InputSanitizer.counts(counts)
        val fingerprint = ledgerFingerprint("updateManualLog", date, logId,
            normalized.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" })

        firestore.runTransaction {
            val receiptSnap = get(receiptRef)
            val ledgerSnap = get(ledgerRef)
            val userSnap = get(userRef)
            val logSnap = get(logRef)
            if (receiptSnap.exists) {
                if (receiptSnap.data<FinancialOperationReceipt>().payloadFingerprint != fingerprint) throw Exception("OPERATION_CONFLICT")
                return@runTransaction
            }
            if (!logSnap.exists) throw Exception("LOG_NOT_FOUND")
            val oldLogCounts = logSnap.data<LogEntry>().counts
            val delta = (oldLogCounts.keys + normalized.keys).associateWith {
                (normalized[it] ?: 0.0) - (oldLogCounts[it] ?: 0.0)
            }
            val existing = if (ledgerSnap.exists) ledgerSnap.data<DailyFinancialRecord>() else null
            val (rec, oldCredit) = deriveLedgerRecord(date, existing, delta, snapshots, defaultUnitPrice)
            val logOwn = SmokingCalculator.computeDayCredit(normalized, snapshots, defaultUnitPrice)

            updateFields(logRef) {
                "counts" to normalized
                "aggregateCredit.saved" to 0.0
                "aggregateCredit.wasted" to logOwn.wasted
                "aggregateCredit.smokingUnits" to logOwn.smokingUnits
                "aggregateCredit.baselineSaved" to 0.0
            }
            set(ledgerRef, rec)
            if (rec.foldedIntoLifetime && userSnap.exists) {
                val cur = userSnap.data<UserProfile>().lifetimeAggregates
                val n = rec.canonicalCredit
                updateFields(userRef) {
                    "lifetimeAggregates.saved" to (cur.saved - oldCredit.saved + n.saved)
                    "lifetimeAggregates.wasted" to (cur.wasted - oldCredit.wasted + n.wasted)
                    "lifetimeAggregates.smokingUnits" to (cur.smokingUnits - oldCredit.smokingUnits + n.smokingUnits)
                    "lifetimeAggregates.baselineSaved" to (cur.baselineSaved - oldCredit.baselineSaved + n.baselineSaved)
                }
            }
            set(receiptRef, FinancialOperationReceipt(
                operationId = operationId, operationType = "updateManualLog",
                sourceDocumentPath = logRef.path, trackingDate = date,
                payloadFingerprint = fingerprint, resultStatus = "OK"
            ))
        }
    }

    override suspend fun deleteManualLogAtomic(uid: String, logId: String, date: String, defaultUnitPrice: Double, operationId: String) {
        val userRef = firestore.collection("users").document(uid)
        val ledgerRef = userRef.collection("dailyFinancials").document(date)
        val logRef = userRef.collection("logs").document(logId)
        val receiptRef = userRef.collection("financialOperations").document(operationId)
        val fingerprint = ledgerFingerprint("deleteManualLog", date, logId)

        firestore.runTransaction {
            val receiptSnap = get(receiptRef)
            val ledgerSnap = get(ledgerRef)
            val userSnap = get(userRef)
            val logSnap = get(logRef)
            if (receiptSnap.exists) {
                if (receiptSnap.data<FinancialOperationReceipt>().payloadFingerprint != fingerprint) throw Exception("OPERATION_CONFLICT")
                return@runTransaction
            }
            if (!logSnap.exists) return@runTransaction
            val oldLogCounts = logSnap.data<LogEntry>().counts
            val delta = oldLogCounts.mapValues { -it.value }
            val existing = if (ledgerSnap.exists) ledgerSnap.data<DailyFinancialRecord>() else null
            val (rec, oldCredit) = deriveLedgerRecord(date, existing, delta, emptyMap(), defaultUnitPrice)

            delete(logRef)
            set(ledgerRef, rec)
            if (rec.foldedIntoLifetime && userSnap.exists) {
                val cur = userSnap.data<UserProfile>().lifetimeAggregates
                val n = rec.canonicalCredit
                updateFields(userRef) {
                    "lifetimeAggregates.saved" to (cur.saved - oldCredit.saved + n.saved)
                    "lifetimeAggregates.wasted" to (cur.wasted - oldCredit.wasted + n.wasted)
                    "lifetimeAggregates.smokingUnits" to (cur.smokingUnits - oldCredit.smokingUnits + n.smokingUnits)
                    "lifetimeAggregates.baselineSaved" to (cur.baselineSaved - oldCredit.baselineSaved + n.baselineSaved)
                }
            }
            set(receiptRef, FinancialOperationReceipt(
                operationId = operationId, operationType = "deleteManualLog",
                sourceDocumentPath = logRef.path, trackingDate = date,
                payloadFingerprint = fingerprint, resultStatus = "OK"
            ))
        }
    }

    override suspend fun restoreManualLogAtomic(uid: String, log: LogEntry, defaultUnitPrice: Double, operationId: String) {
        val date = log.logDate
        val userRef = firestore.collection("users").document(uid)
        val ledgerRef = userRef.collection("dailyFinancials").document(date)
        val logRef = userRef.collection("logs").document(log.id)
        val receiptRef = userRef.collection("financialOperations").document(operationId)
        val counts = InputSanitizer.counts(log.counts)
        val fingerprint = ledgerFingerprint("restoreManualLog", date, log.id,
            counts.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" })

        firestore.runTransaction {
            val receiptSnap = get(receiptRef)
            val ledgerSnap = get(ledgerRef)
            val userSnap = get(userRef)
            val logSnap = get(logRef)
            if (receiptSnap.exists) {
                if (receiptSnap.data<FinancialOperationReceipt>().payloadFingerprint != fingerprint) throw Exception("OPERATION_CONFLICT")
                return@runTransaction
            }
            if (logSnap.exists) return@runTransaction
            val existing = if (ledgerSnap.exists) ledgerSnap.data<DailyFinancialRecord>() else null
            val (rec, oldCredit) = deriveLedgerRecord(date, existing, counts, emptyMap(), defaultUnitPrice)
            val logOwn = SmokingCalculator.computeDayCredit(counts, existing?.snapshots ?: emptyMap(), defaultUnitPrice)

            set(logRef, LogEntry(
                id = log.id, logDate = date, counts = counts, isManual = true, origin = "MANUAL_ENTRY",
                aggregateCredit = LifetimeAggregates(saved = 0.0, wasted = logOwn.wasted, smokingUnits = logOwn.smokingUnits, baselineSaved = 0.0)
            ))
            set(ledgerRef, rec)
            if (rec.foldedIntoLifetime && userSnap.exists) {
                val cur = userSnap.data<UserProfile>().lifetimeAggregates
                val n = rec.canonicalCredit
                updateFields(userRef) {
                    "lifetimeAggregates.saved" to (cur.saved - oldCredit.saved + n.saved)
                    "lifetimeAggregates.wasted" to (cur.wasted - oldCredit.wasted + n.wasted)
                    "lifetimeAggregates.smokingUnits" to (cur.smokingUnits - oldCredit.smokingUnits + n.smokingUnits)
                    "lifetimeAggregates.baselineSaved" to (cur.baselineSaved - oldCredit.baselineSaved + n.baselineSaved)
                }
            }
            set(receiptRef, FinancialOperationReceipt(
                operationId = operationId, operationType = "restoreManualLog",
                sourceDocumentPath = logRef.path, trackingDate = date,
                payloadFingerprint = fingerprint, resultStatus = "OK"
            ))
        }
    }

    override suspend fun adjustCounterAtomic(
        uid: String,
        date: String,
        trackerId: String,
        delta: Double,
        snapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double,
        operationId: String
    ) {
        if (!SmokingCalculator.isValidDate(date)) throw Exception("INVALID_TRACKING_DATE")
        val userRef = firestore.collection("users").document(uid)
        val ledgerRef = userRef.collection("dailyFinancials").document(date)
        val dayRef = userRef.collection("days").document(date)
        val receiptRef = userRef.collection("financialOperations").document(operationId)
        val fingerprint = ledgerFingerprint("adjustCounter", date, trackerId, delta.toString())

        firestore.runTransaction {
            val receiptSnap = get(receiptRef)
            val ledgerSnap = get(ledgerRef)
            val userSnap = get(userRef)
            val daySnap = get(dayRef)
            if (receiptSnap.exists) {
                if (receiptSnap.data<FinancialOperationReceipt>().payloadFingerprint != fingerprint) throw Exception("OPERATION_CONFLICT")
                return@runTransaction
            }
            val day = if (daySnap.exists) daySnap.data<DayDocument>() else null
            if (day?.status == "closed") throw Exception("DAY_CLOSED")

            val dayCounts = (day?.counts ?: emptyMap()).toMutableMap()
            val next = maxOf(0.0, (dayCounts[trackerId] ?: 0.0) + delta)
            if (next > 0.0) dayCounts[trackerId] = next else dayCounts.remove(trackerId)
            val daySnapshots = (day?.trackerSnapshots ?: emptyMap()) + snapshots

            val existing = if (ledgerSnap.exists) ledgerSnap.data<DailyFinancialRecord>() else null
            val (rec, oldCredit) = deriveLedgerRecord(date, existing, mapOf(trackerId to delta), snapshots, defaultUnitPrice)

            val now = nowTimestamp()
            val serverTs = Timestamp.ServerTimestamp as BaseTimestamp
            if (daySnap.exists) {
                updateFields(dayRef) {
                    "counts" to dayCounts
                    "trackerSnapshots" to daySnapshots
                    "status" to "open"
                    "updatedAt" to serverTs
                }
            } else {
                set(dayRef, DayDocument(
                    date = date,
                    counts = dayCounts,
                    trackerSnapshots = daySnapshots,
                    aggregateCredit = rec.canonicalCredit,
                    status = "open",
                    legacyMigrationApplied = false,
                    foldedIntoLifetime = false,
                    createdAt = now,
                    updatedAt = now,
                    closedAt = null
                ))
                updateFields(dayRef) {
                    "createdAt" to serverTs
                    "updatedAt" to serverTs
                }
            }
            set(ledgerRef, rec)
            if (rec.foldedIntoLifetime && userSnap.exists) {
                val cur = userSnap.data<UserProfile>().lifetimeAggregates
                val n = rec.canonicalCredit
                updateFields(userRef) {
                    "lifetimeAggregates.saved" to (cur.saved - oldCredit.saved + n.saved)
                    "lifetimeAggregates.wasted" to (cur.wasted - oldCredit.wasted + n.wasted)
                    "lifetimeAggregates.smokingUnits" to (cur.smokingUnits - oldCredit.smokingUnits + n.smokingUnits)
                    "lifetimeAggregates.baselineSaved" to (cur.baselineSaved - oldCredit.baselineSaved + n.baselineSaved)
                }
            }
            set(receiptRef, FinancialOperationReceipt(
                operationId = operationId, operationType = "adjustCounter",
                sourceDocumentPath = dayRef.path, trackingDate = date,
                payloadFingerprint = fingerprint, resultStatus = "OK"
            ))
        }
    }

    override suspend fun foldLedgerIntoLifetime(uid: String, date: String) {
        val userRef = firestore.collection("users").document(uid)
        val ledgerRef = userRef.collection("dailyFinancials").document(date)
        firestore.runTransaction {
            val ledgerSnap = get(ledgerRef)
            if (!ledgerSnap.exists) throw Exception("NOTHING_TO_ARCHIVE")
            val ledger = ledgerSnap.data<DailyFinancialRecord>()
            if (ledger.foldedIntoLifetime) return@runTransaction
            val userSnap = get(userRef)
            if (!userSnap.exists) return@runTransaction
            val cur = userSnap.data<UserProfile>().lifetimeAggregates
            val c = ledger.canonicalCredit
            updateFields(ledgerRef) { "foldedIntoLifetime" to true }
            updateFields(userRef) {
                "lifetimeAggregates.saved" to (cur.saved + c.saved)
                "lifetimeAggregates.wasted" to (cur.wasted + c.wasted)
                "lifetimeAggregates.smokingUnits" to (cur.smokingUnits + c.smokingUnits)
                "lifetimeAggregates.baselineSaved" to (cur.baselineSaved + c.baselineSaved)
            }
        }
    }

    override suspend fun getLogDate(uid: String, logId: String): String? {
        val snap = firestore.collection("users").document(uid).collection("logs").document(logId).get()
        return if (snap.exists) snap.get<String?>("logDate") else null
    }

    override suspend fun getFinancialMode(uid: String): String {
        val snap = firestore.collection("users").document(uid).get()
        if (!snap.exists) return "LEGACY"
        return snap.data<FinancialModeDoc>().financialMode
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
                "lifetimeAggregates.baselineSaved" to agg.baselineSaved
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
                "lifetimeAggregates.baselineSaved" to agg.baselineSaved
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

            val configIdSet = configIds.toSet()
            val mergedCounts = RegistryMutations.mergeHistoricalEditCounts(
                normalized,
                oldLogEntry.counts,
                configIdSet,
                oldLogEntry.trackerSnapshots.keys
            )
            if (SmokingCalculator.countsEqual(mergedCounts, oldLogEntry.counts)) return@runTransaction
            SmokingCalculator.requireHistoricalPrices(mergedCounts, oldLogEntry.trackerSnapshots)
            val oldCredit = oldLogEntry.aggregateCredit ?: SmokingCalculator.computeDayCredit(oldLogEntry.counts, oldLogEntry.trackerSnapshots)
            val newCredit = SmokingCalculator.computeDayCredit(mergedCounts, oldLogEntry.trackerSnapshots)
            val agg = RegistryMutations.applyReplace(profile.lifetimeAggregates, oldCredit, newCredit)

            updateFields(logRef) {
                "counts" to mergedCounts
                "aggregateCredit.saved" to newCredit.saved
                "aggregateCredit.wasted" to newCredit.wasted
                "aggregateCredit.smokingUnits" to newCredit.smokingUnits
                "aggregateCredit.baselineSaved" to newCredit.baselineSaved
            }
            updateFields(userRef) {
                "lifetimeAggregates.saved" to agg.saved
                "lifetimeAggregates.wasted" to agg.wasted
                "lifetimeAggregates.smokingUnits" to agg.smokingUnits
                "lifetimeAggregates.baselineSaved" to agg.baselineSaved
            }
        }
    }

    override suspend fun addConfig(uid: String, config: TrackerConfig) {
        if (getConfigsOnce(uid).size >= 8) throw Exception("TRACKER_LIMIT")
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
                        updateFields(dayRef) {
                            "counts" to counts
                            "trackerSnapshots" to trackerSnapshots
                            "aggregateCredit" to credit
                            "updatedAt" to (Timestamp.ServerTimestamp as BaseTimestamp)
                        }
                    }
                }
            }
            delete(configRef)
        }
    }

    override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) {
        val configsRef = firestore.collection("users").document(uid).collection("configs")
        firestore.runTransaction {
            val doc1 = configsRef.document(configId1)
            val doc2 = configsRef.document(configId2)
            val snap1 = get(doc1)
            val snap2 = get(doc2)
            if (!snap1.exists || !snap2.exists) return@runTransaction
            val o1 = snap1.data<TrackerConfig>().order
            val o2 = snap2.data<TrackerConfig>().order
            updateFields(doc1) {
                "order" to o2
            }
            updateFields(doc2) {
                "order" to o1
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
        firestore.runTransaction {
            val snap = get(ref)
            if (snap.exists) return@runTransaction
            set(
                ref,
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
    }

    override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {
        val userRef = firestore.collection("users").document(uid)
        var maxRetries = 2
        while (maxRetries-- >= 0) {
            val snap = userRef.get()
            if (!snap.exists) return
            val profile = snap.data<UserProfile>()
            if (profile.smokingUnitsMigrated) return
            val initialAggs = profile.lifetimeAggregates

            val configs = getConfigsOnce(uid)
            val logs = getAllLogsOnce(uid)
            val units = SmokingCalculator.sumSmokingUnitsFromLogs(logs, configs)

            var retryNeeded = false
            firestore.runTransaction {
                val live = get(userRef)
                if (!live.exists) return@runTransaction
                val liveProfile = live.data<UserProfile>()
                if (liveProfile.smokingUnitsMigrated) return@runTransaction
                val currentAggs = liveProfile.lifetimeAggregates

                if (currentAggs.saved != initialAggs.saved ||
                    currentAggs.wasted != initialAggs.wasted ||
                    currentAggs.baselineSaved != initialAggs.baselineSaved) {
                    retryNeeded = true
                    return@runTransaction
                }

                updateFields(userRef) {
                    "lifetimeAggregates" to currentAggs.copy(smokingUnits = units)
                    "smokingUnitsMigrated" to true
                }
            }
            if (!retryNeeded) break
        }
    }

    /**
     * Firestore does not cascade deletes, so every subcollection under
     * `users/{uid}` must be listed here (parity with the web
     * `USER_SUBCOLLECTIONS`). The profile goes LAST: the rules'
     * `financialLocked()` reads it to authorize the subcollection deletes.
     */
    override suspend fun deleteAllUserData(uid: String) {
        // MIGRATING/OPTION_B: the rules deny the client its financial deletes
        // and the profile delete, so the trusted function wipes the whole tree
        // (parity with the web deleteAllUserData).
        val mode = getFinancialMode(uid)
        if (mode == "MIGRATING" || mode == "OPTION_B") {
            deleteAccountDataRemotely()
            return
        }
        val userDoc = firestore.collection("users").document(uid)
        for (sub in USER_SUBCOLLECTIONS) {
            deleteCollectionPaged(userDoc.collection(sub))
        }
        userDoc.delete()
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

    override suspend fun clearLocalCache() {
        runCatching {
            firestore.clearPersistence()
        }
    }
}
