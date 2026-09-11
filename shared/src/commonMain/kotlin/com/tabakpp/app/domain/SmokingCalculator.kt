package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlinx.datetime.*
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

object SmokingCalculator {
    const val DEFAULT_DAY_START_HOUR = 6
    private val SMOKING_TYPES = listOf(TrackerType.CIGARETTE, TrackerType.RYO_ROLL, TrackerType.JOINT_KING)

    /**
     * Population-level minutes-of-life-expectancy estimate per smoking unit
     * (item 6) — a COHORT AVERAGE (loosely, UK ASH / "11 minutes per
     * cigarette" life-expectancy literature), NOT a personalized medical
     * measurement. Never present a figure derived from this as a fact about
     * the individual user.
     */
    const val LIFE_MINUTES_PER_UNIT = 11

    fun hasOpenSession(activeCounts: Map<String, Double>?): Boolean {
        return activeCounts?.values?.any { it > 0 } ?: false
    }

    /**
     * Tracking day for [now]: before [dayStartHour] the session still belongs to
     * the previous day (night-owl mode).
     *
     * [timeZone] defaults to the device zone because the tracking day is a
     * *local* concept — a UTC default silently shifted the day by one for
     * anyone east of Greenwich after midnight, and by one the other way for the
     * Americas. Pass an explicit zone in tests.
     */
    fun getTrackingDate(
        now: Instant,
        dayStartHour: Int = DEFAULT_DAY_START_HOUR,
        timeZone: TimeZone = TimeZone.currentSystemDefault()
    ): String {
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

    /**
     * Streak: consecutive days where EVERY streak config stayed within its
     * own TARGET for that day (per-config, not pooled). Counts today's live
     * session merged with anything already logged for the tracking day.
     *
     * [dayDocs] (optional, default empty) supplies `days/{date}` documents
     * from the dated-daily-document model. When a day has a stamped
     * [TrackerSnapshot] for a config, its target is read from that snapshot
     * rather than the config's current live limit (item 2) — so raising or
     * lowering today's target can never retroactively flip whether an old
     * day kept the streak alive. Days without a snapshot (legacy `logs`-only
     * data) fall back to the live limit, matching the pre-existing behavior
     * exactly.
     */
    fun calculateStreak(
        logs: List<LogEntry>,
        configs: List<TrackerConfig>,
        activeCounts: Map<String, Double>,
        trackingDay: String,
        dayDocs: List<DayDocument> = emptyList()
    ): Int {
        val streakConfigs = getStreakConfigs(configs)
        if (streakConfigs.isEmpty()) return 0

        val logged = mergeDayDocsIntoLogged(aggregateLoggedCounts(logs), dayDocs)
        val snapshots = snapshotsByDate(dayDocs)
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

            val snapshotsForDay = snapshots[cursorStr]
            val withinLimits = streakConfigs.all { c ->
                val count = max(0.0, (dayCounts ?: emptyMap())[c.id] ?: 0.0)
                count <= effectiveTarget(snapshotsForDay, c).toDouble()
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

    /**
     * Tracking streak (item 7): consecutive days with ANY logged activity,
     * regardless of whether the day stayed within target. Deliberately
     * separate from [calculateStreak] (the goal streak) so "I tracked
     * consistently" and "I stayed on target" never collapse into one number.
     */
    fun calculateTrackingStreak(
        logs: List<LogEntry>,
        activeCounts: Map<String, Double>,
        trackingDay: String,
        dayDocs: List<DayDocument> = emptyList()
    ): Int {
        if (trackingDay.isBlank()) return 0
        val logged = mergeDayDocsIntoLogged(aggregateLoggedCounts(logs), dayDocs)
        val loggedDates = logged.keys.sortedDescending()
        val sessionOpen = hasOpenSession(activeCounts)
        fun sumOf(c: Map<String, Double>?) = (c ?: emptyMap()).values.sumOf { max(0.0, it) }

        if (loggedDates.isEmpty() && !sessionOpen) return 0
        val yesterday = try {
            LocalDate.parse(trackingDay).minus(1, DateTimeUnit.DAY).toString()
        } catch (_: Exception) {
            ""
        }
        val mostRecent = loggedDates.firstOrNull()
        if (mostRecent != null && yesterday.isNotEmpty() && mostRecent < yesterday && !sessionOpen) return 0

        var streak = 0
        var cursor = try {
            LocalDate.parse(trackingDay)
        } catch (_: Exception) {
            return 0
        }
        for (i in 0 until 366) {
            val cursorStr = cursor.toString()
            val dayTotal = if (cursorStr == trackingDay) sumOf(logged[cursorStr]) + sumOf(activeCounts) else sumOf(logged[cursorStr])
            val hasEntry = if (cursorStr == trackingDay) dayTotal > 0 else logged.containsKey(cursorStr)
            if (!hasEntry) break
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

    /**
     * Overlay `days/{date}` documents onto counts already aggregated from
     * the legacy `logs` collection. A given calendar date is produced by
     * exactly one of the two collections in practice, so this is a safe
     * additive merge rather than a precedence question.
     */
    fun mergeDayDocsIntoLogged(
        logged: Map<String, Map<String, Double>>,
        dayDocs: List<DayDocument>
    ): Map<String, Map<String, Double>> {
        val out = logged.toMutableMap()
        dayDocs.forEach { d ->
            if (d.date.isNotBlank()) out[d.date] = mergeCounts(out[d.date], d.counts)
        }
        return out
    }

    /** `{ date -> trackerSnapshots }` for every day-doc that has one. */
    fun snapshotsByDate(dayDocs: List<DayDocument>): Map<String, Map<String, TrackerSnapshot>> {
        val out = mutableMapOf<String, Map<String, TrackerSnapshot>>()
        dayDocs.forEach { d -> if (d.date.isNotBlank()) out[d.date] = d.trackerSnapshots }
        return out
    }

    /**
     * Effective historical target for a tracker on a given day — prefers the
     * stamped [TrackerSnapshot], falls back to the tracker's current live
     * limit only when no snapshot exists (legacy data). See item 2.
     */
    private fun effectiveTarget(snapshotsForDate: Map<String, TrackerSnapshot>?, config: TrackerConfig): Int {
        val snap = snapshotsForDate?.get(config.id)
        return if (snap != null) max(0, snap.target) else max(0, config.limit)
    }

    data class LimitStatus(val status: String, val aboveTarget: Double, val belowTarget: Double)

    /**
     * Zero-target-safe goal status (item 4/5). A target of 0 is a legitimate
     * goal ("none today"), not a meaningless denominator — this never
     * expresses status as a percentage of target. Three states only:
     * "under" (actual < target), "at" (actual == target — "limit reached",
     * not "over"), "over" (actual > target — "N above target").
     */
    fun getLimitStatus(actual: Double, target: Double): LimitStatus {
        val a = max(0.0, actual)
        val t = max(0.0, target)
        val diff = a - t
        return LimitStatus(
            status = if (diff > 0) "over" else if (diff == 0.0) "at" else "under",
            aboveTarget = max(0.0, diff),
            belowTarget = max(0.0, -diff)
        )
    }

    data class Reduction(val baseline: Double, val actual: Double, val avoided: Double, val percent: Double?)

    /**
     * Reduction vs. a user-set baseline (item 3) — deliberately independent
     * of `target`. Returns null when no baseline is set so callers can
     * render the documented fallback ("Set a baseline to calculate
     * reduction.") instead of a fabricated or misleading number.
     */
    fun getReduction(actual: Double, baseline: Int?): Reduction? {
        if (baseline == null) return null
        val a = max(0.0, actual)
        val b = max(0.0, baseline.toDouble())
        val avoided = max(0.0, b - a)
        val percent = if (b > 0) avoided / b else null
        return Reduction(baseline = b, actual = a, avoided = avoided, percent = percent)
    }

    data class BaselineSavings(val moneySaved: Double, val unitsAvoided: Double, val hasBaseline: Boolean)

    /**
     * Money saved strictly from baseline vs. actual (item 3) — NEVER from
     * target vs. actual. A tracker with no baseline contributes nothing and
     * is flagged via [BaselineSavings.hasBaseline] so the UI can show an
     * honest fallback instead of a partial/misleading total.
     */
    fun calculateBaselineSavings(
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        defaultPrice: Double = 0.5
    ): BaselineSavings {
        var moneySaved = 0.0
        var unitsAvoided = 0.0
        var hasBaseline = false
        configs.forEach { c ->
            val baseline = c.baseline ?: return@forEach
            hasBaseline = true
            val count = max(0.0, counts[c.id] ?: 0.0)
            val avoided = max(0.0, baseline.toDouble() - count)
            unitsAvoided += avoided
            if (!c.isFinanciallyTracked) return@forEach
            val price = c.pricePerUnit ?: defaultPrice
            moneySaved += avoided * price
        }
        return BaselineSavings(moneySaved, unitsAvoided, hasBaseline)
    }

    /**
     * Immutable-config-safe snapshot of a tracker, stamped onto a
     * `days/{date}` document whenever that day's counts change (item 2). A
     * historical day interprets its own counts using this stamp, never the
     * tracker's CURRENT settings.
     */
    fun buildTrackerSnapshot(config: TrackerConfig): TrackerSnapshot = TrackerSnapshot(
        name = config.name,
        type = config.type,
        target = max(0, config.limit),
        baseline = config.baseline?.let { max(0, it) },
        unitPrice = config.pricePerUnit,
        isFinanciallyTracked = config.isFinanciallyTracked,
        isPrimaryTracked = config.isPrimaryTracked
    )

    /**
     * Financial/unit contribution of a `days/{date}` document computed
     * ENTIRELY from its own stamped [TrackerSnapshot]s — never from live
     * tracker configs. This is what makes a day doc historically
     * self-contained (item 2): once written, its meaning cannot be changed
     * by editing, repricing, renaming, or deleting the live tracker
     * afterward.
     */
    fun computeDayCredit(
        counts: Map<String, Double>,
        trackerSnapshots: Map<String, TrackerSnapshot>,
        defaultUnitPrice: Double = 0.5
    ): LifetimeAggregates {
        var wasted = 0.0
        var saved = 0.0
        var smokingUnits = 0.0
        var baselineSaved = 0.0
        trackerSnapshots.forEach { (id, snap) ->
            val count = max(0.0, counts[id] ?: 0.0)
            val target = max(0, snap.target).toDouble()
            val price = snap.unitPrice ?: defaultUnitPrice
            if (snap.isFinanciallyTracked) {
                wasted += count * price
                saved += max(0.0, target - count) * price
                snap.baseline?.let { b -> baselineSaved += max(0.0, b - count) * price }
            }
            if (SMOKING_TYPES.contains(snap.type)) smokingUnits += count
        }
        return LifetimeAggregates(saved = saved, wasted = wasted, smokingUnits = smokingUnits, baselineSaved = baselineSaved)
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

        return (totalCount * LIFE_MINUTES_PER_UNIT).toInt()
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
                recovered += max(0.0, limit.toDouble() - count) * LIFE_MINUTES_PER_UNIT
            }
        }

        smokingConfigs.forEach { c ->
            val count = max(0.0, (activeCounts ?: emptyMap())[c.id] ?: 0.0)
            val limit = max(0, c.limit)
            recovered += max(0.0, limit.toDouble() - count) * LIFE_MINUTES_PER_UNIT
        }

        return recovered.toInt()
    }

    /**
     * [dayDocs] (optional, default empty) is threaded through to
     * [calculateStreak]/[calculateTrackingStreak] for snapshot-aware
     * historical target checks (item 2). It does not affect any other
     * field's math, so omitting it reproduces the exact prior output.
     */
    fun getGlobalMetrics(
        logs: List<LogEntry>,
        configs: List<TrackerConfig>,
        activeCounts: Map<String, Double>,
        trackingDay: String,
        userPrice: Double = 0.5,
        lifetimeAggregates: LifetimeAggregates? = null,
        dayDocs: List<DayDocument> = emptyList()
    ): GlobalMetrics {
        val primaryConfigs = configs.filter { it.isPrimaryTracked }
        val sessionCounts = activeCounts
        val logged = aggregateLoggedCounts(logs)

        val primaryCount = primaryConfigs.sumOf { c -> max(0.0, sessionCounts[c.id] ?: 0.0) }
        val primaryLimit = primaryConfigs.sumOf { c -> max(0, c.limit) }

        val streak = try {
            calculateStreak(logs, configs, activeCounts, trackingDay, dayDocs)
        } catch (_: Exception) {
            0
        }
        val trackingStreak = try {
            calculateTrackingStreak(logs, activeCounts, trackingDay, dayDocs)
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

        // Baseline-derived savings/reduction (item 3) — always from baseline
        // vs. actual, never target vs. actual. Lifetime prefers the
        // maintained rollup (folded in when a day closes); today's
        // still-open contribution is added live from current configs,
        // mirroring how spentToday/budgetLeftToday already layer session on
        // top of lifetime.
        val sessionBaseline = calculateBaselineSavings(sessionCounts, configs, userPrice)
        val baselineSavedLifetime = (lifetimeAggregates?.baselineSaved ?: 0.0) + sessionBaseline.moneySaved
        val hasAnyBaseline = sessionBaseline.hasBaseline || configs.any { it.baseline != null }

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

        val xp = calculateXP(logs, streak)
        val rank = getRank(xp)

        return GlobalMetrics(
            count = primaryCount.toInt(),
            limit = primaryLimit,
            streak = streak,
            trackingStreak = trackingStreak,
            spentToday = sessionFin.wasted,
            budgetLeftToday = sessionFin.saved,
            saved = sessionFin.saved,
            savedLifetime = savedLifetime,
            hasBaseline = hasAnyBaseline,
            baselineSavedToday = sessionBaseline.moneySaved,
            baselineUnitsAvoidedToday = sessionBaseline.unitsAvoided,
            baselineSavedLifetime = baselineSavedLifetime,
            progress = if (primaryLimit > 0) primaryCount / primaryLimit else 0.0,
            lifeLost = lifeLost,
            recovered = recovered,
            hasOpenSession = hasOpenSession(activeCounts),
            xp = xp,
            rank = rank
        )
    }

    fun calculateXP(logs: List<LogEntry>, streak: Int): Int {
        val uniqueDays = logs.mapNotNull { it.logDate.takeIf { d -> d.isNotBlank() } }.toSet().size
        val totalDays = if (uniqueDays > 0) uniqueDays else logs.size
        return totalDays * 10 + streak * 15
    }

    fun getRank(xp: Int): String {
        return when {
            xp < 500 -> "Apprentice"
            xp < 5000 -> "Scout"
            xp < 10000 -> "Veteran"
            xp < 20000 -> "Master"
            else -> "Legend"
        }
    }

    data class GlobalMetrics(
        val count: Int,
        val limit: Int,
        /** Goal streak: consecutive days within target. See [trackingStreak] for the separate consistency-only measure (item 7). */
        val streak: Int,
        val trackingStreak: Int = 0,
        val spentToday: Double,
        val budgetLeftToday: Double,
        val saved: Double,
        val savedLifetime: Double,
        /** True if ANY tracker has a baseline set — gates whether reduction/savings claims should be shown at all (item 3). */
        val hasBaseline: Boolean = false,
        val baselineSavedToday: Double = 0.0,
        val baselineUnitsAvoidedToday: Double = 0.0,
        val baselineSavedLifetime: Double = 0.0,
        val progress: Double,
        val lifeLost: Int,
        val recovered: Int,
        val hasOpenSession: Boolean = false,
        val xp: Int = 0,
        val rank: String = "Apprentice"
    )

    fun formatCurrency(amount: Double): String {
        // Round in cent space: naive (amount - intPart) * 100 truncation
        // turns 8.03 into "8,02 €" and breaks entirely for negatives.
        //
        // floor(x + 0.5), not round(x): kotlin.math.round is Math.rint, which
        // breaks ties to even, while the web's Math.round breaks them upward. On
        // an exact half-cent — reachable from a unit price like 0.125 — the two
        // clients printed amounts a cent apart for the same stored data. This is
        // both JS-identical and the conventional currency rounding.
        val totalCents = floor(amount * 100 + 0.5).toLong()
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

    /**
     * Backfill is for days that have happened. A future-dated log is not just
     * meaningless — it also silently revives a dead streak: [calculateStreak] bails
     * early only when the most recent logged date is older than yesterday, and a
     * date in the future is not, so an otherwise-inactive user reads as streak 1.
     *
     * Both arguments are YYYY-MM-DD, so the comparison is plain lexicographic
     * ordering. Kept here rather than in the form so the view model and both
     * clients apply the identical rule.
     */
    fun isBackfillDateAllowed(dateStr: String, trackingDay: String?): Boolean {
        if (!isValidDate(dateStr)) return false
        if (trackingDay.isNullOrBlank()) return true
        return dateStr <= trackingDay
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
