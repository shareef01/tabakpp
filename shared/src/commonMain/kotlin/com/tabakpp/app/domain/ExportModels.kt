package com.tabakpp.app.domain

import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.UserProfile
import kotlinx.serialization.Serializable

/**
 * Version-tagged export schema.
 *
 * v1 captures the user's stored application data faithfully, preserving
 * provenance (logs vs. days) rather than merging them. Import/restore is
 * out of scope — this is a portable data copy, not a restorable backup.
 *
 * JSON contract (spec item 6):
 * ```json
 * {
 *   "exportVersion": 1,
 *   "generatedAt": "2026-09-16T08:15:00.000Z",
 *   "application": { "name": "Tabakpp" },
 *   "profile": { ... UserProfile fields ... },
 *   "profileMeta": { "avatar": null | "..." },
 *   "configs": [ ... TrackerConfig ... ],
 *   "days": [ ... DayDocument ... ],
 *   "logs": [ ... LogEntry ... ]
 * }
 * ```
 */
const val EXPORT_VERSION = 1

@Serializable
data class ExportApplicationInfo(
    val name: String = "Tabakpp"
)

/**
 * Complete, deterministic, raw-data export snapshot.
 *
 * - `profile` includes lifetimeAggregates (item 12 model).
 * - `profileMeta` is the `users/{uid}/meta/profile` document (avatar only).
 * - `configs`, `days`, `logs` are sorted deterministically (see sort* functions).
 */
@Serializable
data class CompleteExportSnapshot(
    val exportVersion: Int = EXPORT_VERSION,
    val generatedAt: String,
    val application: ExportApplicationInfo = ExportApplicationInfo(),
    val profile: UserProfile? = null,
    val profileMeta: ProfileMetaExport? = null,
    val configs: List<TrackerConfig> = emptyList(),
    val days: List<DayDocument> = emptyList(),
    val logs: List<LogEntry> = emptyList()
)

@Serializable
data class ProfileMetaExport(
    val avatar: String? = null
)

/**
 * CSV row for historical activity analysis (spec item 8).
 *
 * One row per tracker-instance per historical date, with provenance preserved
 * via [source]: "day" | "manual_entry" | "legacy_day_archive".
 */
data class CsvActivityRow(
    val date: String,
    val source: String,
    val trackerId: String,
    val trackerName: String?,
    val count: Double?,
    val target: Int?,
    val baseline: Int?,
    val unitPrice: Double? = null,
    val spent: Double? = null,
    val saved: Double? = null,
    val status: String? = null
)

/**
 * Deterministic ordering (spec item 13):
 * - configs: existing tracker order, then stable ID fallback
 * - days: ascending date
 * - logs: ascending by (logDate, id)
 */
fun sortConfigsForExport(configs: List<TrackerConfig>): List<TrackerConfig> {
    return configs.sortedWith(
        compareBy({ it.order }, { it.id })
    )
}

fun sortDaysForExport(days: List<DayDocument>): List<DayDocument> {
    return days.sortedBy { it.date }
}

fun sortLogsForExport(logs: List<LogEntry>): List<LogEntry> {
    return logs.sortedWith(
        compareBy({ it.logDate }, { it.id })
    )
}

/**
 * Export format selector for the UI layer.
 */
enum class ExportFormat {
    JSON,
    CSV
}

/**
 * UI-visible export state for the ViewModel.
 * - Idle: nothing in progress
 * - Exporting: snapshot read in progress
 * - Ready: export string is available for download
 * - Error: a failure occurred, message is available
 */
sealed class ExportState {
    object Idle : ExportState()
    object Exporting : ExportState()
    data class Ready(val content: String, val format: ExportFormat) : ExportState()
    data class Error(val message: String) : ExportState()
}
