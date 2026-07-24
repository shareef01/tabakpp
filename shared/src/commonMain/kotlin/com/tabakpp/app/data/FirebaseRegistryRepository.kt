package com.tabakpp.app.data

import com.tabakpp.app.domain.RegistryMutations
import com.tabakpp.app.domain.SmokingCalculator
import dev.gitlive.firebase.firestore.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.datetime.Clock

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

    override suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double) {
        val userRef = firestore.collection("users").document(uid)
        firestore.runTransaction {
            val snapshot = get(userRef)
            if (!snapshot.exists) throw Exception("USER_NOT_FOUND")
            val profile = snapshot.data<UserProfile>()
            val counts = profile.activeCounts.toMutableMap()
            counts[trackerId] = maxOf(0.0, (counts[trackerId] ?: 0.0) + delta)
            updateFields(userRef) {
                "activeCounts" to counts
            }
        }
    }

    override suspend fun endDay(uid: String, trackingDate: String) {
        val userRef = firestore.collection("users").document(uid)
        val configsRef = userRef.collection("configs")
        val configIds = listConfigIds(uid)
        val logRef = userRef.collection("logs").document("${trackingDate}_DAY")

        firestore.runTransaction {
            val userSnap = get(userRef)
            val existingSnap = get(logRef)
            val profile = userSnap.data<UserProfile>()
            val activeCounts = profile.activeCounts
            val configs = loadConfigs(configsRef, configIds)

            if (!SmokingCalculator.hasOpenSession(activeCounts)) {
                throw Exception("NOTHING_TO_ARCHIVE")
            }

            // A second end-day on the same tracking date must merge into the
            // existing archive, not replace it. Aggregates were already credited
            // with fin(existing), so only the delta to fin(merged) is applied.
            val existingCounts = if (existingSnap.exists) decodeLogEntry(existingSnap)?.counts else null
            val dayEnd = RegistryMutations.endDay(
                current = profile.lifetimeAggregates,
                existingCounts = existingCounts,
                activeCounts = activeCounts,
                configs = configs,
                unitPrice = profile.unitPrice
            )

            val nowMs = Clock.System.now().toEpochMilliseconds()
            val logEntry = LogEntry(
                id = "${trackingDate}_DAY",
                logDate = trackingDate,
                counts = dayEnd.mergedCounts,
                isArchive = true,
                origin = "DAY_RESET",
                finalizedAt = Timestamp(nowMs / 1000, ((nowMs % 1000) * 1_000_000).toInt())
            )

            set(logRef, logEntry)
            updateFields(userRef) {
                "activeCounts" to emptyMap<String, Double>()
                "lifetimeAggregates.saved" to dayEnd.aggregates.saved
                "lifetimeAggregates.wasted" to dayEnd.aggregates.wasted
                "lifetimeAggregates.smokingUnits" to dayEnd.aggregates.smokingUnits
            }
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

            val agg = RegistryMutations.credit(profile.lifetimeAggregates, normalized, configs, profile.unitPrice)
            val now = Clock.System.now().toEpochMilliseconds()
            val entropy = (0..999).random().toString().padStart(3, '0')
            val logId = "${date}_M${now}_$entropy"

            val logEntry = LogEntry(
                id = logId,
                logDate = date,
                counts = normalized,
                isManual = true,
                origin = "MANUAL_ENTRY",
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

            val agg = RegistryMutations.debit(profile.lifetimeAggregates, logEntry.counts, configs, profile.unitPrice)

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

        firestore.runTransaction {
            val existing = get(logRef)
            if (existing.exists) return@runTransaction

            val userSnap = get(userRef)
            val profile = userSnap.data<UserProfile>()
            val configs = loadConfigs(configsRef, configIds)

            val agg = RegistryMutations.credit(profile.lifetimeAggregates, log.counts, configs, profile.unitPrice)

            set(logRef, log)
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

            val agg = RegistryMutations.replace(
                current = profile.lifetimeAggregates,
                oldCounts = oldLogEntry.counts,
                newCounts = normalized,
                configs = configs,
                unitPrice = profile.unitPrice
            )

            updateFields(logRef) {
                "counts" to normalized
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

    override suspend fun deleteConfig(uid: String, configId: String) {
        val userRef = firestore.collection("users").document(uid)
        val configRef = userRef.collection("configs").document(configId)
        firestore.runTransaction {
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

    // Settings-only write path: never touches activeCounts or lifetimeAggregates,
    // which are owned by the transactional counter/archive paths. Writing the full
    // profile here would race live increments and silently revert them.
    // Also strip legacy web eco keys so rules stay satisfied on older documents.
    override suspend fun updateProfileSettings(uid: String, profile: UserProfile) {
        firestore.collection("users").document(uid).updateFields {
            "name" to profile.name
            "accent" to profile.accent
            "widgetSize" to profile.widgetSize.name
            "purchaseType" to profile.purchaseType
            "unitPrice" to profile.unitPrice
            "pouchPrice" to profile.pouchPrice
            "estimatedYield" to profile.estimatedYield
            "dayStartHour" to profile.dayStartHour
            "avatar" to profile.avatar
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
                activeCounts = emptyMap()
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
            updateFields(userRef) {
                "lifetimeAggregates.smokingUnits" to units
                "smokingUnitsMigrated" to true
            }
        }
    }

    override suspend fun deleteAllUserData(uid: String) {
        deleteCollectionPaged(firestore.collection("users").document(uid).collection("configs"))
        deleteCollectionPaged(firestore.collection("users").document(uid).collection("logs"))
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
