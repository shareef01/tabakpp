package com.tabakpp.app.data

import dev.gitlive.firebase.firestore.BaseTimestamp
import dev.gitlive.firebase.firestore.Timestamp
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

object TimestampOrLongSerializer : KSerializer<Timestamp?> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("TimestampOrLong", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Timestamp? {
        return try {
            decoder.decodeSerializableValue(Timestamp.serializer().nullable)
        } catch (_: Exception) {
            millisToTimestamp(decodeEpochMillis(decoder))
        }
    }

    override fun serialize(encoder: Encoder, value: Timestamp?) {
        encoder.encodeSerializableValue(Timestamp.serializer().nullable, value)
    }
}

/**
 * Same Long/Timestamp tolerance as [TimestampOrLongSerializer], but keeps
 * [BaseTimestamp] so writes can still use [Timestamp.ServerTimestamp].
 */
object BaseTimestampOrLongSerializer : KSerializer<BaseTimestamp?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("BaseTimestampOrLong", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): BaseTimestamp? {
        return try {
            decoder.decodeSerializableValue(Timestamp.serializer().nullable)
        } catch (_: Exception) {
            millisToTimestamp(decodeEpochMillis(decoder))
        }
    }

    override fun serialize(encoder: Encoder, value: BaseTimestamp?) {
        when (value) {
            null -> encoder.encodeSerializableValue(Timestamp.serializer().nullable, null)
            is Timestamp -> encoder.encodeSerializableValue(Timestamp.serializer(), value)
            else -> {
                // ServerTimestamp sentinel — encode via Timestamp null and let callers
                // that need server time write FieldValue separately. Prefer concrete
                // Timestamp values on write paths when using this serializer.
                encoder.encodeSerializableValue(Timestamp.serializer().nullable, null)
            }
        }
    }
}

private fun decodeEpochMillis(decoder: Decoder): Long? {
    return try {
        decoder.decodeLong()
    } catch (_: Exception) {
        try {
            decoder.decodeDouble().toLong()
        } catch (_: Exception) {
            null
        }
    }
}

private fun millisToTimestamp(raw: Long?): Timestamp? {
    if (raw == null) return null
    // Firestore legacy docs may store epoch millis or seconds.
    val millis = if (raw > 100_000_000_000L) raw else raw * 1000L
    val seconds = millis / 1000
    val nanoseconds = ((millis % 1000) * 1_000_000).toInt()
    return Timestamp(seconds, nanoseconds)
}

@Serializable
enum class TrackerType {
    @SerialName("CIGARETTE") CIGARETTE,
    @SerialName("RYO_ROLL") RYO_ROLL,
    @SerialName("JOINT_KING") JOINT_KING,
    @SerialName("SIMPLE") SIMPLE
}

@Serializable
enum class WidgetSize {
    @SerialName("SMALL") SMALL,
    @SerialName("MEDIUM") MEDIUM,
    @SerialName("LARGE") LARGE
}

@Serializable
data class LifetimeAggregates(
    val saved: Double = 0.0,
    val wasted: Double = 0.0,
    /** Archived/manual smoking units (CIGARETTE/RYO; legacy JOINT still counts) — authoritative for life-lost beyond the log window. */
    val smokingUnits: Double = 0.0,
    /**
     * Money saved strictly from baseline vs. actual (item 3) — NEVER derived
     * from target vs. actual. See SmokingCalculator.calculateBaselineSavings.
     * Absent/zero on legacy accounts and historical days predating baseline
     * support; that is a documented "unknown, not fabricated" state, not a
     * claim that nothing was ever saved.
     */
    val baselineSaved: Double = 0.0
)

@Serializable
data class UserProfile(
    val name: String = "",
    val accent: String = "#FF5F5F",
    val widgetSize: WidgetSize = WidgetSize.MEDIUM,
    val purchaseType: String = "PACK",
    val unitPrice: Double = 0.5,
    /**
     * Units in a pack, for the PACK economics editor. Persisted because both
     * clients used to hardcode 20 and re-derive the pack price as
     * unitPrice * 20 — so a user who bought 25s saw their pack price change
     * under them on the next load even though unitPrice was correct.
     * Legacy documents without the field fall back to 20.
     */
    val unitsPerPack: Int = 20,
    val pouchPrice: Double = 0.0,
    val estimatedYield: Int = 0,
    val dayStartHour: Int = 6,
    /**
     * LEGACY (item 1/12): still readable/writable so an out-of-date client —
     * this app has no forced-update mechanism — keeps working during the
     * rollout. Updated clients never write this; see [DayDocument] and
     * `RegistryRepository.migrateLegacyActiveCounts`.
     */
    val activeCounts: Map<String, Double> = emptyMap(),
    val lifetimeAggregates: LifetimeAggregates = LifetimeAggregates(),
    /** One-shot backfill of smokingUnits from full log history completed. */
    val smokingUnitsMigrated: Boolean = false,
    /** LEGACY (item 12): moved to `users/{uid}/meta/profile`; see [ProfileExtra]. */
    val avatar: String? = null,
    /** 2 once activeCounts has been migrated into the dated day-doc model. Absent/0 = not yet migrated. */
    val schemaVersion: Int = 0,
    /** In-flight claim from `migrateLegacyActiveCounts` phase 1, resumed by phase 2. Always paired with [migratingLegacyDate]. */
    val migratingLegacyCounts: Map<String, Double> = emptyMap(),
    val migratingLegacyDate: String? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val createdAt: Timestamp? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val updatedAt: Timestamp? = null
)

/** `users/{uid}/meta/profile` (item 12) — split from [UserProfile] so a large, rarely-changing avatar never rides along on a high-frequency write. */
@Serializable
data class ProfileExtra(
    val avatar: String? = null
)

@Serializable
data class TrackerConfig(
    val id: String,
    val name: String,
    val limit: Int,
    val order: Int,
    val type: TrackerType = TrackerType.CIGARETTE,
    val pricePerUnit: Double? = null,
    val isFinanciallyTracked: Boolean = true,
    val isPrimaryTracked: Boolean = true,
    /**
     * Baseline consumption (item 3) — the user's previous/reference average,
     * kept strictly separate from [limit] (the current target). Null = "not
     * set"; onboarding never requires it. Reduction and money-saved are
     * always computed from baseline vs. actual, never from target vs.
     * actual — see SmokingCalculator.calculateBaselineSavings.
     */
    val baseline: Int? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val createdAt: Timestamp? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val updatedAt: Timestamp? = null
)

/**
 * Stamped historical config for one tracker on one [DayDocument] (item 2).
 * Once a day is closed, this is immutable at the rules level — see
 * firestore.rules `validDayUpdate`. A day with no snapshot for a tracker
 * (legacy data, or a tracker never touched that day) falls back to that
 * tracker's CURRENT live config — a documented, non-fabricating fallback,
 * not a silent difference in meaning for any day that DOES have a snapshot.
 */
@Serializable
data class TrackerSnapshot(
    val name: String = "",
    val type: TrackerType = TrackerType.CIGARETTE,
    val target: Int = 0,
    val baseline: Int? = null,
    val unitPrice: Double? = null,
    val isFinanciallyTracked: Boolean = true,
    val isPrimaryTracked: Boolean = true
)

/**
 * `users/{uid}/days/{YYYY-MM-DD}` — the dated daily-document model (item 1,
 * the P0 rollover fix). Every count always belongs to an explicit tracking
 * date decided by the caller at write time; there is no separate "current
 * session" bucket that can carry counts across a rollover boundary.
 */
@Serializable
data class DayDocument(
    val date: String = "",
    val counts: Map<String, Double> = emptyMap(),
    val trackerSnapshots: Map<String, TrackerSnapshot> = emptyMap(),
    val aggregateCredit: LifetimeAggregates? = null,
    val status: String = "open", // "open" | "closed"
    val foldedIntoLifetime: Boolean = false,
    val legacyMigrationApplied: Boolean = false,
    @Serializable(with = BaseTimestampOrLongSerializer::class) val createdAt: BaseTimestamp? = null,
    @Serializable(with = BaseTimestampOrLongSerializer::class) val updatedAt: BaseTimestamp? = null,
    @Serializable(with = BaseTimestampOrLongSerializer::class) val closedAt: BaseTimestamp? = null
)

@Serializable
data class LogEntry(
    val id: String,
    val logDate: String, // YYYY-MM-DD
    val counts: Map<String, Double> = emptyMap(),
    val isArchive: Boolean = false,
    val isManual: Boolean = false,
    val origin: String = "MANUAL_ENTRY", // "DAY_RESET" or "MANUAL_ENTRY"
    /**
     * Absolute lifetime contribution stamped when the log was last credited.
     * Debit/restore/replace prefer this over recomputing from live configs so
     * deleted or repriced trackers cannot drift aggregates.
     */
    val aggregateCredit: LifetimeAggregates? = null,
    @Serializable(with = BaseTimestampOrLongSerializer::class)
    val finalizedAt: BaseTimestamp? = null,
    @Serializable(with = BaseTimestampOrLongSerializer::class)
    val clientTimestamp: BaseTimestamp? = null
)


