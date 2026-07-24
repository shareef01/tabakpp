package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlinx.datetime.*
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

object SmokingCalculator {
    const val DEFAULT_DAY_START_HOUR = 6
    private val SMOKING_TYPES = listOf(TrackerType.CIGARETTE, TrackerType.RYO_ROLL, TrackerType.JOINT_KING)

    fun hasOpenSession(activeCounts: Map<String, Double>?): Boolean {
        return activeCounts?.values?.any { it > 0 } ?: false
    }

    fun getTrackingDate(now: Instant, dayStartHour: Int = DEFAULT_DAY_START_HOUR, timeZone: TimeZone = TimeZone.UTC): String {
        val localDateTime = now.toLocalDateTime(timeZone)
        
        val date = if (localDateTime.hour < dayStartHour) {
            localDateTime.date.minus(1, DateTimeUnit.DAY)
        } else {
            localDateTime.date
        }
        return date.toString() // YYYY-MM-DD
    }

    private fun isDayArchiveLog(log: LogEntry): Boolean {
        return log.origin == "DAY_RESET" || log.id.endsWith("_DAY")
    }

    private fun aggregateLoggedCounts(logs: List<LogEntry>): Map<String, Map<String, Double>> {
        val dayArchives = mutableMapOf<String, Map<String, Double>>()
        val otherByDate = mutableMapOf<String, MutableMap<String, Double>>()

        logs.forEach { log ->
            val date = log.logDate
            if (isDayArchiveLog(log)) {
                dayArchives[date] = log.counts
            } else {
                val dateCounts = otherByDate.getOrPut(date) { mutableMapOf() }
                log.counts.forEach { (id, valCount) ->
                    dateCounts[id] = (dateCounts[id] ?: 0.0) + max(0.0, valCount)
                }
            }
        }

        val allDates = dayArchives.keys + otherByDate.keys
        return allDates.associateWith { date ->
            // Archives and manual entries on the same date both count;
            // an archive must not shadow manual entries added afterwards.
            mergeCounts(dayArchives[date], otherByDate[date] ?: emptyMap())
        }
    }

    fun aggregateDailyChartTotals(logs: List<LogEntry>): List<DateTotal> {
        val logged = aggregateLoggedCounts(logs)
        return logged.mapNotNull { (date, counts) ->
            try {
                LocalDate.parse(date)
                DateTotal(date, counts.values.sumOf { max(0.0, it) }.toInt())
            } catch (_: Exception) {
                null
            }
        }.sortedBy { it.date }
    }

    data class DateTotal(val date: String, val total: Int)

    fun groupLogsByDate(logs: List<LogEntry>): Map<String, List<LogEntry>> {
        return logs.groupBy { it.logDate }
    }

    fun calculateFinancials(
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        defaultPrice: Double = 0.5
    ): FinancialResult {
        var wasted = 0.0
        var saved = 0.0

        configs.forEach { c ->
            if (!c.isFinanciallyTracked) return@forEach
            val count = max(0.0, counts[c.id] ?: 0.0)
            val limit = max(0, c.limit)
            val price = c.pricePerUnit ?: defaultPrice

            wasted += count * price
            saved += max(0.0, limit.toDouble() - count) * price
        }

        return FinancialResult(wasted, saved)
    }

    data class FinancialResult(val wasted: Double, val saved: Double)

    fun calculateStreak(
        logs: List<LogEntry>,
        configs: List<TrackerConfig>,
        activeCounts: Map<String, Double>,
        trackingDay: String
    ): Int {
        val streakConfigs = getStreakConfigs(configs)
        if (streakConfigs.isEmpty()) return 0

        val logged = aggregateLoggedCounts(logs)
        val loggedDates = logged.keys.sortedDescending()
        
        val yesterday = try {
            LocalDate.parse(trackingDay).minus(1, DateTimeUnit.DAY).toString()
        } catch (_: Exception) {
            ""
        }
        val mostRecent = loggedDates.firstOrNull()
        val sessionOpen = hasOpenSession(activeCounts)

        if (loggedDates.isEmpty() && !sessionOpen) return 0
        if (mostRecent != null && yesterday.isNotEmpty() && mostRecent < yesterday && !sessionOpen) return 0

        var streak = 0
        var cursor = try {
            LocalDate.parse(trackingDay)
        } catch (_: Exception) {
            return 0
        }

        for (i in 0 until 366) {
            val cursorStr = cursor.toString()
            val dayCounts = if (cursorStr == trackingDay) {
                mergeCounts(logged[cursorStr], activeCounts)
            } else {
                logged[cursorStr]
            }

            if (cursorStr != trackingDay && dayCounts == null) break

            val withinLimits = streakConfigs.all { c ->
                val count = max(0.0, (dayCounts ?: emptyMap())[c.id] ?: 0.0)
                val limit = max(0, c.limit)
                count <= limit.toDouble()
            }

            if (!withinLimits) break
            streak++
            cursor = try {
                cursor.minus(1, DateTimeUnit.DAY)
            } catch (_: Exception) {
                break
            }
        }
        return streak
    }

    private fun getStreakConfigs(configs: List<TrackerConfig>): List<TrackerConfig> {
        val smoking = configs.filter { SMOKING_TYPES.contains(it.type) }
        return if (smoking.isNotEmpty()) smoking else configs.filter { it.isPrimaryTracked }
    }

    fun mergeCounts(base: Map<String, Double>?, extra: Map<String, Double>): Map<String, Double> {
        val out = base?.toMutableMap() ?: mutableMapOf()
        extra.forEach { (id, valCount) ->
            out[id] = (out[id] ?: 0.0) + max(0.0, valCount)
        }
        return out
    }

    fun sumSmokingUnits(counts: Map<String, Double>, configs: List<TrackerConfig>): Double {
        val smokingIds = configs.filter { SMOKING_TYPES.contains(it.type) }.map { it.id }.toSet()
        if (smokingIds.isEmpty()) return 0.0
        return counts.entries.sumOf { (id, v) ->
            if (smokingIds.contains(id)) max(0.0, v) else 0.0
        }
    }

    fun sumSmokingUnitsFromLogs(logs: List<LogEntry>, configs: List<TrackerConfig>): Double {
        val logged = aggregateLoggedCounts(logs)
        return logged.values.sumOf { sumSmokingUnits(it, configs) }
    }

    fun calculateLifeLostMinutes(
        logs: List<LogEntry>,
        configs: List<TrackerConfig>,
        activeCounts: Map<String, Double>?,
        lifetimeSmokingUnits: Double? = null
    ): Int {
        val smokingIds = configs.filter { SMOKING_TYPES.contains(it.type) }.map { it.id }.toSet()
        if (smokingIds.isEmpty()) return 0

        var totalCount = if (lifetimeSmokingUnits != null) {
            max(0.0, lifetimeSmokingUnits)
        } else {
            var fromLogs = 0.0
            val logged = aggregateLoggedCounts(logs)
            logged.values.forEach { dayCounts ->
                smokingIds.forEach { id ->
                    fromLogs += max(0.0, dayCounts[id] ?: 0.0)
                }
            }
            fromLogs
        }
        activeCounts?.forEach { (id, valCount) ->
            if (smokingIds.contains(id)) {
                totalCount += max(0.0, valCount)
            }
        }

        return (totalCount * 11).toInt()
    }

    fun calculateRecoveryMinutes(
        logs: List<LogEntry>,
        configs: List<TrackerConfig>,
        activeCounts: Map<String, Double>?,
        trackingDay: String
    ): Int {
        val smokingConfigs = configs.filter { SMOKING_TYPES.contains(it.type) }
        if (smokingConfigs.isEmpty()) return 0

        val logged = aggregateLoggedCounts(logs)
        var recovered = 0.0

        logged.forEach { (date, counts) ->
            if (date == trackingDay) return@forEach
            smokingConfigs.forEach { c ->
                val count = max(0.0, counts[c.id] ?: 0.0)
                val limit = max(0, c.limit)
                recovered += max(0.0, limit.toDouble() - count) * 11
            }
        }

        smokingConfigs.forEach { c ->
            val count = max(0.0, (activeCounts ?: emptyMap())[c.id] ?: 0.0)
            val limit = max(0, c.limit)
            recovered += max(0.0, limit.toDouble() - count) * 11
        }

        return recovered.toInt()
    }

    fun getGlobalMetrics(
        logs: List<LogEntry>,
        configs: List<TrackerConfig>,
        activeCounts: Map<String, Double>,
        trackingDay: String,
        userPrice: Double = 0.5,
        lifetimeAggregates: LifetimeAggregates? = null
    ): GlobalMetrics {
        val primaryConfigs = configs.filter { it.isPrimaryTracked }
        val sessionCounts = activeCounts
        val logged = aggregateLoggedCounts(logs)

        val primaryCount = primaryConfigs.sumOf { c -> max(0.0, sessionCounts[c.id] ?: 0.0) }
        val primaryLimit = primaryConfigs.sumOf { c -> max(0, c.limit) }

        val streak = try {
            calculateStreak(logs, configs, activeCounts, trackingDay)
        } catch (_: Exception) {
            0
        }

        var savedLifetime = 0.0
        logged.values.forEach { dayCounts ->
            savedLifetime += calculateFinancials(dayCounts, configs, userPrice).saved
        }

        if (lifetimeAggregates != null) {
            savedLifetime = lifetimeAggregates.saved
        }

        val sessionFin = calculateFinancials(sessionCounts, configs, userPrice)
        val lifeLost = try {
            // Prefer transactional smokingUnits when aggregates are present (same pattern as saved).
            val archivedUnits = if (lifetimeAggregates != null) lifetimeAggregates.smokingUnits else null
            calculateLifeLostMinutes(logs, configs, activeCounts, archivedUnits)
        } catch (_: Exception) {
            0
        }
        val recovered = try {
            calculateRecoveryMinutes(logs, configs, activeCounts, trackingDay)
        } catch (_: Exception) {
            0
        }

        return GlobalMetrics(
            count = primaryCount.toInt(),
            limit = primaryLimit,
            streak = streak,
            spentToday = sessionFin.wasted,
            budgetLeftToday = sessionFin.saved,
            saved = sessionFin.saved,
            savedLifetime = savedLifetime,
            progress = if (primaryLimit > 0) primaryCount / primaryLimit else 0.0,
            lifeLost = lifeLost,
            recovered = recovered,
            hasOpenSession = hasOpenSession(activeCounts)
        )
    }

    data class GlobalMetrics(
        val count: Int,
        val limit: Int,
        val streak: Int,
        val spentToday: Double,
        val budgetLeftToday: Double,
        val saved: Double,
        val savedLifetime: Double,
        val progress: Double,
        val lifeLost: Int,
        val recovered: Int,
        val hasOpenSession: Boolean = false
    )

    fun formatCurrency(amount: Double): String {
        // Round in cent space: naive (amount - intPart) * 100 truncation
        // turns 8.03 into "8,02 €" and breaks entirely for negatives.
        val totalCents = round(amount * 100).toLong()
        val sign = if (totalCents < 0) "-" else ""
        val cents = abs(totalCents)
        return "$sign${cents / 100},${(cents % 100).toString().padStart(2, '0')} €"
    }

    fun formatLifeMinutes(mins: Int): String {
        val n = max(0, mins)
        val h = n / 60
        val m = n % 60
        return if (h <= 0) "${m}m" else "${h}h ${m}m"
    }

    fun isValidDate(dateStr: String): Boolean {
        return try {
            LocalDate.parse(dateStr)
            true
        } catch (_: Exception) {
            false
        }
    }

    fun formatDateDisplay(dateStr: String): String {
        return try {
            val date = LocalDate.parse(dateStr)
            val day = date.dayOfWeek.name.take(3)
            val month = date.month.name.take(3)
            "$day, $month ${date.dayOfMonth}".uppercase()
        } catch (_: Exception) {
            "ERR_DATE"
        }
    }

    fun normalizeAccentColor(hex: String): String {
        val h = hex.trim().uppercase()
        return if (h == "#FFFFFF" || h == "#FFF") "#E4E4E7" else hex
    }

    fun normalizeCounts(counts: Map<String, Double>): Map<String, Double> {
        return counts.mapValues { max(0.0, it.value) }
    }
}
