package com.tabakpp.app.domain

import com.tabakpp.app.data.*

data class HistoryCursor(val date: String, val id: String)
data class HistoryPage<T>(val items: List<T> = emptyList(), val cursor: HistoryCursor? = null, val hasMore: Boolean = false)

/** Record kind remains explicit through rendering and mutation routing. */
sealed class HistoryRecord {
    abstract val key: String
    abstract val date: String
    abstract fun displayLog(): LogEntry

    data class Day(val value: DayDocument) : HistoryRecord() {
        override val key = "day:${value.date}"
        override val date = value.date
        override fun displayLog() = LogEntry(id = key, logDate = date, counts = value.counts,
            origin = "DAY_RECORD", aggregateCredit = value.aggregateCredit, trackerSnapshots = value.trackerSnapshots)
    }
    data class Log(val value: LogEntry) : HistoryRecord() {
        override val key = "log:${value.id}"
        override val date = value.logDate
        override fun displayLog() = value
    }
}

fun historyRecords(logs: List<LogEntry>, days: List<DayDocument>): List<HistoryRecord> =
    (logs.distinctBy { it.id }.map { HistoryRecord.Log(it) } +
        days.filter { it.status == "closed" }.distinctBy { it.date }.map { HistoryRecord.Day(it) })
        .sortedWith(compareByDescending<HistoryRecord> { it.date }.thenBy { it.key })

/** Editing a stamped record presents its original trackers, including deleted ones. */
fun historyEditConfigs(record: LogEntry, live: List<TrackerConfig>): List<TrackerConfig> =
    if (record.trackerSnapshots.isEmpty()) live else record.trackerSnapshots.map { (id, snapshot) ->
        TrackerConfig(id, snapshot.name, snapshot.target, 0, snapshot.type, snapshot.unitPrice,
            snapshot.isFinanciallyTracked, snapshot.isPrimaryTracked, snapshot.baseline)
    }
