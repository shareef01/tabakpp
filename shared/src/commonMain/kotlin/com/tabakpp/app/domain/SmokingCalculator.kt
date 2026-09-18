package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlinx.datetime.*
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

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
     *
     * A day qualifies based on PRESENCE of a record (a day-doc, a log entry,
     * or a non-empty activeCounts map), not on positive sum. This correctly
     * distinguishes "tracked zero" (user interacted or explicitly logged 0)
     * from "untracked/missing" (no record at all) — a day with a zero-count
     * dayDoc or a zero-count manual entry still counts as tracked.
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
        val hasTodayEvidence = logged.containsKey(trackingDay) || activeCounts.isNotEmpty()
        if (loggedDates.isEmpty() && !hasTodayEvidence) return 0
        val yesterday = try {
            LocalDate.parse(trackingDay).minus(1, DateTimeUnit.DAY).toString()
        } catch (_: Exception) {
            ""
        }
        val mostRecent = loggedDates.firstOrNull()
        if (mostRecent != null && yesterday.isNotEmpty() && mostRecent < yesterday && !hasTodayEvidence) return 0

        var streak = 0
        var cursor = try {
            LocalDate.parse(trackingDay)
        } catch (_: Exception) {
            return 0
        }
        for (i in 0 until 366) {
            val cursorStr = cursor.toString()
            val hasEntry = if (cursorStr == trackingDay) {
                logged.containsKey(cursorStr) || activeCounts.isNotEmpty()
            } else {
                logged.containsKey(cursorStr)
            }
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

    /**
     * Aggregate daily goal status across multiple trackers — per-tracker, never
     * pooled (item 7). Each participating tracker is evaluated individually via
     * [getLimitStatus], then the worst state is selected: over dominates
     * at dominates under. This prevents one tracker going over while another
     * is under from collapsing into within targets.
     *
     * Uses [getStreakConfigs] for tracker selection so the daily goal
     * uses the same smoking-first / isPrimaryTracked fallback contract as
     * [calculateStreak].
     *
     * Returns null when there are no participating trackers (no meaningful
     * target to evaluate), so the UI can defer to empty-state behavior (item 20)
     * rather than fabricating "0 below target".
     */
    data class GoalStatus(val status: String, val aboveTarget: Double, val belowTarget: Double, val overTrackers: Int)

    fun getGoalStatus(counts: Map<String, Double>, configs: List<TrackerConfig>): GoalStatus? {
        val goalConfigs = getStreakConfigs(configs)
        if (goalConfigs.isEmpty()) return null
        var worst = "under"
        var totalAbove = 0.0
        var totalBelow = 0.0
        var overCount = 0
        for (c in goalConfigs) {
            val ls = getLimitStatus(max(0.0, counts[c.id] ?: 0.0), max(0, c.limit).toDouble())
            when (ls.status) {
                "over" -> { worst = "over"; totalAbove += ls.aboveTarget; overCount++ }
                "at" -> { if (worst != "over") worst = "at" }
                "under" -> { if (worst != "over" && worst != "at") { worst = "under"; totalBelow += ls.belowTarget } }
            }
        }
        return GoalStatus(worst, totalAbove, totalBelow, overCount)
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
        val goalStatus = getGoalStatus(sessionCounts, configs)

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
            goalStatus = goalStatus,
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
        /** Today's aggregate goal status (under/at/over), computed per-tracker via [getGoalStatus]. Null when no trackers participate. */
        val goalStatus: GoalStatus? = null,
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

    /**
     * Format a YYYY-MM string like "2026-09" into "September 2026".
     */
    fun formatMonthLabel(monthKey: String): String {
        if (monthKey.length < 7) return monthKey
        val parts = monthKey.split("-")
        if (parts.size < 2) return monthKey
        val y = parts[0].toIntOrNull() ?: return monthKey
        val m = parts[1].toIntOrNull() ?: return monthKey
        return try {
            val date = LocalDate(y, m, 1)
            "${date.month.name.lowercase().replaceFirstChar { it.uppercase() }} $y"
        } catch (_: Exception) {
            monthKey
        }
    }

    data class MonthSummary(
        val month: String, // YYYY-MM
        val label: String, // "September 2026"
        val units: Int,
        val trackedDays: Int,
        val avgUnitsPerTrackedDay: Double,
        val spent: Double,
        val saved: Double,
        val baselineSaved: Double,
        val hasBaseline: Boolean,
        val isCurrentMonth: Boolean,
        val isComplete: Boolean
    )

    data class TrendResult(
        val current: Double,
        val previous: Double,
        val delta: Double,
        val percentChange: Double?,
        val direction: String, // "down" | "up" | "unchanged" | "from_zero" | "to_zero"
        val text: String // "12% fewer units", "unchanged", etc.
    )

    /**
     * Compare two period averages. Safe zero-denominator handling — no "∞%" display.
     * - previous > 0 && current > 0 → normal percentage change
     * - previous == 0 && current == 0 → unchanged
     * - previous == 0 && current > 0 → "increased from zero" (no percentage)
     * - previous > 0 && current == 0 → "100% fewer units"
     */
    fun calculateTrend(currentAvg: Double, previousAvg: Double): TrendResult {
        val current = max(0.0, currentAvg)
        val previous = max(0.0, previousAvg)

        if (previous > 0 && current > 0) {
            val pct = ((current - previous) / previous) * 100
            val direction = if (pct < 0) "down" else if (pct > 0) "up" else "unchanged"
            val absPct = kotlin.math.abs(pct)
            val text = if (pct < 0) {
                "${absPct.toInt()}% fewer units"
            } else if (pct > 0) {
                "${absPct.toInt()}% more units"
            } else {
                "unchanged"
            }
            return TrendResult(current, previous, current - previous, pct, direction, text)
        }

        if (previous == 0.0 && current == 0.0) {
            return TrendResult(current, previous, 0.0, 0.0, "unchanged", "unchanged")
        }

        if (previous == 0.0 && current > 0) {
            return TrendResult(current, previous, current, null, "from_zero", "increased from zero")
        }

        // previous > 0, current == 0
        return TrendResult(current, previous, -previous, -100.0, "to_zero", "100% fewer units")
    }

    /**
     * Aggregate daily tracking data into monthly summaries for historical insights.
     *
     * Uses the canonical merge semantics: [aggregateLoggedCounts] merges legacy log
     * archives + manual entries per date, then [mergeDayDocsIntoLogged] additively
     * overlays `days/{date}` documents — identical to existing streak and velocity
     * calculations. In production, each date is written by exactly one source
     * (the day-doc schema ships forward from the migration point), so overlap is
     * a no-op. Where both exist, the merge is additive — the established domain
     * behavior, not an Insights-specific choice.
     *
     * Historical economics use each day's stamped [TrackerSnapshot]s via
     * [computeDayCredit] — NEVER current configs.
     *
     * Missing-day semantics: only dates present in the merged set count as "tracked
     * days." Untracked calendar days are excluded from the denominator (tracked-day
     * average), not treated as zero.
     *
     * @param logs legacy LogEntry list (archives, manual entries)
     * @param dayDocs List<DayDocument> with date, counts, trackerSnapshots, aggregateCredit
     * @param trackingDay today's YYYY-MM-DD
     * @param activeCounts { [trackerId]: count } for the still-open session
     * @param defaultUnitPrice fallback price for legacy data without snapshots
     * @param monthsToInclude how many complete recent months + current MTD to include
     * @returns Pair(months list, currentMonthMtd)
     */
    fun aggregateMonthlyData(
        logs: List<LogEntry>,
        dayDocs: List<DayDocument> = emptyList(),
        trackingDay: String,
        activeCounts: Map<String, Double> = emptyMap(),
        defaultUnitPrice: Double = 0.5,
        monthsToInclude: Int = 6
    ): Pair<List<MonthSummary>, MonthSummary?> {
        val logged = aggregateLoggedCounts(logs)
        val merged = mergeDayDocsIntoLogged(logged, dayDocs)

        val snapshotsByDate = dayDocs.associate { it.date to it.trackerSnapshots }
        val dayCreditByDate: Map<String, LifetimeAggregates> = dayDocs
            .filter { it.aggregateCredit != null }
            .associate { it.date to it.aggregateCredit!! }

        // Build per-day records
        val dayRecords = mutableMapOf<String, DayRecord>()
        merged.forEach { (date, counts) ->
            val isToday = date == trackingDay
            val dayCounts = if (isToday) mergeCounts(counts, activeCounts) else counts

            val units = dayCounts.values.sumOf { max(0.0, it) }.toInt()

            var spent = 0.0
            var saved = 0.0
            var baselineSaved = 0.0
            var hasBaseline = false

            dayCreditByDate[date]?.let { credit ->
                spent = credit.wasted
                saved = credit.saved
                baselineSaved = credit.baselineSaved
                hasBaseline = baselineSaved > 0
            } ?: run {
                snapshotsByDate[date]?.let { snapshots ->
                    val credit = computeDayCredit(dayCounts, snapshots, defaultUnitPrice)
                    spent = credit.wasted
                    saved = credit.saved
                    baselineSaved = credit.baselineSaved
                    hasBaseline = baselineSaved > 0
                }
            }

            dayRecords[date] = DayRecord(units, spent, saved, baselineSaved, hasBaseline)
        }

        // Group by calendar month (YYYY-MM)
        val monthsMap = mutableMapOf<String, MutableList<Pair<String, DayRecord>>>()
        dayRecords.forEach { (date, record) ->
            val monthKey = date.substring(0, 7)
            monthsMap.getOrPut(monthKey) { mutableListOf() }.add(date to record)
        }

        val todayMonthKey = trackingDay.substring(0, 7)

        // Sort months descending (newest first)
        val sortedMonths = monthsMap.keys.sortedDescending()

        val currentMonthMtd = monthsMap[todayMonthKey]?.let { days ->
            buildMonthSummary(todayMonthKey, days, true, monthsMap, snapshotsByDate, dayCreditByDate, trackingDay, activeCounts, defaultUnitPrice)
        }

        val completedMonths = sortedMonths
            .filter { it != todayMonthKey }
            .take(monthsToInclude)
            .mapNotNull { monthKey ->
                val days = monthsMap[monthKey] ?: return@mapNotNull null
                buildMonthSummary(monthKey, days, false, monthsMap, snapshotsByDate, dayCreditByDate, trackingDay, activeCounts, defaultUnitPrice)
            }

        val months = if (currentMonthMtd != null) {
            listOf(currentMonthMtd!!) + completedMonths
        } else {
            completedMonths
        }

        return Pair(months, currentMonthMtd)
    }

    private data class DayRecord(
        val units: Int,
        val spent: Double,
        val saved: Double,
        val baselineSaved: Double,
        val hasBaseline: Boolean
    )

    private fun buildMonthSummary(
        monthKey: String,
        days: List<Pair<String, DayRecord>>,
        isCurrentMonth: Boolean,
        monthsMap: Map<String, List<Pair<String, DayRecord>>>,
        snapshotsByDate: Map<String, Map<String, TrackerSnapshot>>,
        dayCreditByDate: Map<String, LifetimeAggregates>,
        trackingDay: String,
        activeCounts: Map<String, Double>,
        defaultUnitPrice: Double
    ): MonthSummary {
        val trackedDays = days.size
        val totalUnits = days.sumOf { it.second.units }
        val totalSpent = days.sumOf { it.second.spent }
        val totalSaved = days.sumOf { it.second.saved }
        val totalBaselineSaved = days.sumOf { it.second.baselineSaved }
        val hasBaseline = days.any { it.second.hasBaseline }

        return MonthSummary(
            month = monthKey,
            label = formatMonthLabel(monthKey),
            units = totalUnits,
            trackedDays = trackedDays,
            avgUnitsPerTrackedDay = if (trackedDays > 0) totalUnits.toDouble() / trackedDays else 0.0,
            spent = totalSpent,
            saved = totalSaved,
            baselineSaved = totalBaselineSaved,
            hasBaseline = hasBaseline,
            isCurrentMonth = isCurrentMonth,
            isComplete = !isCurrentMonth
        )
    }
}
