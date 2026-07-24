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
    val smokingUnits: Double = 0.0
)

@Serializable
data class UserProfile(
    val name: String = "",
    val accent: String = "#FF5F5F",
    val widgetSize: WidgetSize = WidgetSize.MEDIUM,
    val purchaseType: String = "PACK",
    val unitPrice: Double = 0.5,
    val pouchPrice: Double = 0.0,
    val estimatedYield: Int = 0,
    val dayStartHour: Int = 6,
    val activeCounts: Map<String, Double> = emptyMap(),
    val lifetimeAggregates: LifetimeAggregates = LifetimeAggregates(),
    /** One-shot backfill of smokingUnits from full log history completed. */
    val smokingUnitsMigrated: Boolean = false,
    val avatar: String? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val createdAt: Timestamp? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val updatedAt: Timestamp? = null
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
    @Serializable(with = TimestampOrLongSerializer::class) val createdAt: Timestamp? = null,
    @Serializable(with = TimestampOrLongSerializer::class) val updatedAt: Timestamp? = null
)

@Serializable
data class LogEntry(
    val id: String,
    val logDate: String, // YYYY-MM-DD
    val counts: Map<String, Double> = emptyMap(),
    val isArchive: Boolean = false,
    val isManual: Boolean = false,
    val origin: String = "MANUAL_ENTRY", // "DAY_RESET" or "MANUAL_ENTRY"
    @Serializable(with = BaseTimestampOrLongSerializer::class)
    val finalizedAt: BaseTimestamp? = null,
    @Serializable(with = BaseTimestampOrLongSerializer::class)
    val clientTimestamp: BaseTimestamp? = null
)


