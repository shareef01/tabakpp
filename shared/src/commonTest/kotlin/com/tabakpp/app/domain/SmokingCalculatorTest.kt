package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals

class SmokingCalculatorTest {

    @Test
    fun testGetTrackingDate_RolloverBoundaries() {
        val hour = 6
        
        // 05:59:59 -> Previous Day
        val before = Instant.parse("2024-05-20T05:59:59Z")
        assertEquals("2024-05-19", SmokingCalculator.getTrackingDate(before, hour, TimeZone.UTC))
        
        // 06:00:00 -> Same Day
        val at = Instant.parse("2024-05-20T06:00:00Z")
        assertEquals("2024-05-20", SmokingCalculator.getTrackingDate(at, hour, TimeZone.UTC))
        
        // 23:59:59 -> Same Day
        val end = Instant.parse("2024-05-20T23:59:59Z")
        assertEquals("2024-05-20", SmokingCalculator.getTrackingDate(end, hour, TimeZone.UTC))
        
        // 00:00:00 next calendar day -> Previous Day (belongs to night-owl session)
        val midnight = Instant.parse("2024-05-21T00:00:00Z")
        assertEquals("2024-05-20", SmokingCalculator.getTrackingDate(midnight, hour, TimeZone.UTC))
    }

    @Test
    fun testCalculateFinancials_EdgeCases() {
        val configs = listOf(
            TrackerConfig("c1", "Cigarette", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 1.0),
            TrackerConfig("c2", "RYO", 5, 2, TrackerType.RYO_ROLL, pricePerUnit = 0.5, isFinanciallyTracked = false)
        )
        
        // Over limit
        val over = SmokingCalculator.calculateFinancials(mapOf("c1" to 15.0), configs)
        assertEquals(15.0, over.wasted)
        assertEquals(0.0, over.saved)
        
        // Under limit
        val under = SmokingCalculator.calculateFinancials(mapOf("c1" to 8.0), configs)
        assertEquals(8.0, under.wasted)
        assertEquals(2.0, under.saved) // limit 10 - 8 = 2 * 1.0
        
        // Non-financial should be ignored
        val nonFin = SmokingCalculator.calculateFinancials(mapOf("c1" to 0.0, "c2" to 10.0), configs)
        assertEquals(0.0, nonFin.wasted)
        assertEquals(10.0, nonFin.saved) // limit 10 - 0
    }

    @Test
    fun testCalculateStreak_GapsAndFailures() {
        val configs = listOf(TrackerConfig("c1", "Cigarette", 10, 1, TrackerType.CIGARETTE))
        val today = "2024-05-20"
        
        // 1. Perfect streak (3 days)
        val logs1 = listOf(
            LogEntry("d1", "2024-05-19", mapOf("c1" to 5.0), origin = "DAY_RESET"),
            LogEntry("d2", "2024-05-18", mapOf("c1" to 5.0), origin = "DAY_RESET")
        )
        assertEquals(3, SmokingCalculator.calculateStreak(logs1, configs, mapOf("c1" to 5.0), today))
        
        // 2. Broken yesterday
        val logs2 = listOf(
            LogEntry("d1", "2024-05-19", mapOf("c1" to 15.0), origin = "DAY_RESET")
        )
        assertEquals(1, SmokingCalculator.calculateStreak(logs2, configs, mapOf("c1" to 5.0), today))
        
        // 3. Gap (Missing yesterday)
        val logs3 = listOf(
            LogEntry("d1", "2024-05-18", mapOf("c1" to 5.0), origin = "DAY_RESET")
        )
        assertEquals(1, SmokingCalculator.calculateStreak(logs3, configs, mapOf("c1" to 5.0), today))
        
        // 4. No session today, but yesterday was good -> Streak includes today (0 count)
        assertEquals(2, SmokingCalculator.calculateStreak(
            listOf(LogEntry("d1", "2024-05-19", mapOf("c1" to 5.0), origin = "DAY_RESET")),
            configs, emptyMap(), today
        ))
    }

    @Test
    fun testNormalizeCounts() {
        val input = mapOf("a" to 5.0, "b" to -10.0, "c" to 0.0)
        val expected = mapOf("a" to 5.0, "b" to 0.0, "c" to 0.0)
        assertEquals(expected, SmokingCalculator.normalizeCounts(input))
    }

    @Test
    fun testAggregateDailyChartTotals() {
        val logs = listOf(
            LogEntry("m1", "2024-05-19", mapOf("c1" to 2.0), origin = "MANUAL_ENTRY"),
            LogEntry("m2", "2024-05-19", mapOf("c1" to 3.0), origin = "MANUAL_ENTRY"),
            LogEntry("a1", "2024-05-18", mapOf("c1" to 10.0), origin = "DAY_RESET")
        )
        val result = SmokingCalculator.aggregateDailyChartTotals(logs)
        
        assertEquals(2, result.size)
        assertEquals(10, result.find { it.date == "2024-05-18" }?.total)
        assertEquals(5, result.find { it.date == "2024-05-19" }?.total)
    }

    @Test
    fun testFormatCurrency_RoundingAndNegatives() {
        assertEquals("8,03 €", SmokingCalculator.formatCurrency(8.03))
        assertEquals("1,50 €", SmokingCalculator.formatCurrency(1.5))
        assertEquals("0,00 €", SmokingCalculator.formatCurrency(0.0))
        assertEquals("10,00 €", SmokingCalculator.formatCurrency(9.999))
        assertEquals("-1,50 €", SmokingCalculator.formatCurrency(-1.5))
        assertEquals("-0,25 €", SmokingCalculator.formatCurrency(-0.25))

        // Shared half-cent vectors, mirrored in smokingCalculator.test.js.
        // kotlin.math.round is Math.rint (ties-to-even) where JS Math.round ties
        // upward, so 0.125 printed "0,12 €" here and "0,13 €" on the web for the
        // same stored data. formatCurrency now uses floor(x + 0.5).
        assertEquals("0,13 €", SmokingCalculator.formatCurrency(0.125))
        assertEquals("0,14 €", SmokingCalculator.formatCurrency(0.135))
        assertEquals("2,51 €", SmokingCalculator.formatCurrency(2.505))
    }

    @Test
    fun testFormatLifeMinutes() {
        assertEquals("55m", SmokingCalculator.formatLifeMinutes(55))
        assertEquals("1h 5m", SmokingCalculator.formatLifeMinutes(65))
        assertEquals("0m", SmokingCalculator.formatLifeMinutes(0))
        assertEquals("0m", SmokingCalculator.formatLifeMinutes(-10))
    }

    @Test
    fun testAggregateMergesArchiveWithManualEntries() {
        // A manual entry added after the day was archived must still count
        val logs = listOf(
            LogEntry("2024-05-19_DAY", "2024-05-19", mapOf("c1" to 4.0), isArchive = true, origin = "DAY_RESET"),
            LogEntry("m1", "2024-05-19", mapOf("c1" to 2.0), origin = "MANUAL_ENTRY")
        )
        val result = SmokingCalculator.aggregateDailyChartTotals(logs)
        assertEquals(1, result.size)
        assertEquals(6, result[0].total)
    }

    @Test
    fun testIsValidDate() {
        assertEquals(true, SmokingCalculator.isValidDate("2024-05-20"))
        assertEquals(false, SmokingCalculator.isValidDate("2024-13-01"))
        assertEquals(false, SmokingCalculator.isValidDate("abc"))
        assertEquals(false, SmokingCalculator.isValidDate(""))
    }

    @Test
    fun testMergeCounts() {
        assertEquals(
            mapOf("a" to 5.0, "b" to 3.0),
            SmokingCalculator.mergeCounts(mapOf("a" to 2.0), mapOf("a" to 3.0, "b" to 3.0))
        )
        assertEquals(
            mapOf("a" to 3.0),
            SmokingCalculator.mergeCounts(null, mapOf("a" to 3.0))
        )
    }

    @Test
    fun testCalculateLifeMinutes() {
        val configs = listOf(TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE))
        val logs = listOf(LogEntry("l1", "2024-05-19", mapOf("c1" to 10.0)))
        val active = mapOf("c1" to 5.0)
        
        // Total units = 10 + 5 = 15. Minutes = 15 * 11 = 165
        assertEquals(165, SmokingCalculator.calculateLifeLostMinutes(logs, configs, active))
        
        // Recovery: 
        // Log day (limit 10 - count 10) = 0
        // Active day (limit 10 - count 5) = 5. Recovery = 5 * 11 = 55
        assertEquals(55, SmokingCalculator.calculateRecoveryMinutes(logs, configs, active, "2024-05-20"))
    }

    @Test
    fun auditFixtureA_quota20_count5_unit50c() {
        val configs = listOf(TrackerConfig("c1", "Cig", 20, 1, TrackerType.CIGARETTE, pricePerUnit = 0.5))
        val fin = SmokingCalculator.calculateFinancials(mapOf("c1" to 5.0), configs)
        assertEquals(2.5, fin.wasted, 1e-9)
        assertEquals(7.5, fin.saved, 1e-9)
        val m = SmokingCalculator.getGlobalMetrics(emptyList(), configs, mapOf("c1" to 5.0), "2026-01-01", 0.5)
        assertEquals(5, m.count)
        assertEquals(20, m.limit)
        assertEquals(0.25, m.progress, 1e-9)
    }

    @Test
    fun auditFixtureD_zeroQuotaStaysZero() {
        val configs = listOf(TrackerConfig("c1", "Cig", 0, 1, TrackerType.CIGARETTE, pricePerUnit = 0.5))
        val fin = SmokingCalculator.calculateFinancials(mapOf("c1" to 0.0), configs)
        assertEquals(0.0, fin.wasted, 1e-9)
        assertEquals(0.0, fin.saved, 1e-9)
        val m = SmokingCalculator.getGlobalMetrics(emptyList(), configs, mapOf("c1" to 0.0), "2026-01-01", 0.5)
        assertEquals(0, m.limit)
        assertEquals(0.0, m.progress, 1e-9)
    }

    @Test
    fun auditFixtureE_packUnitPrice() {
        val unit = 8.0 / 20.0
        assertEquals(0.4, unit, 1e-9)
        val configs = listOf(TrackerConfig("c1", "Cig", 20, 1, TrackerType.CIGARETTE, pricePerUnit = unit))
        val fin = SmokingCalculator.calculateFinancials(mapOf("c1" to 5.0), configs)
        assertEquals(2.0, fin.wasted, 1e-9)
    }

    @Test
    fun testXPAndRankTiers() {
        assertEquals("Apprentice", SmokingCalculator.getRank(0))
        assertEquals("Apprentice", SmokingCalculator.getRank(100))
        assertEquals("Apprentice", SmokingCalculator.getRank(499))
        assertEquals("Scout", SmokingCalculator.getRank(500))
        assertEquals("Scout", SmokingCalculator.getRank(3000))
        assertEquals("Veteran", SmokingCalculator.getRank(5000))
        assertEquals("Veteran", SmokingCalculator.getRank(8000))
        assertEquals("Master", SmokingCalculator.getRank(10000))
        assertEquals("Master", SmokingCalculator.getRank(19999))
        assertEquals("Legend", SmokingCalculator.getRank(20000))
        assertEquals("Legend", SmokingCalculator.getRank(50000))

        val logs = listOf(
            LogEntry("l1", "2026-01-01", mapOf("c1" to 5.0)),
            LogEntry("l2", "2026-01-01", mapOf("c1" to 2.0)), // same date -> 1 unique day
            LogEntry("l3", "2026-01-02", mapOf("c1" to 4.0))  // 2nd unique day
        )
        // 2 unique days * 10 + 3 streak * 15 = 20 + 45 = 65 XP
        assertEquals(65, SmokingCalculator.calculateXP(logs, 3))
    }

    @Test
    fun backfillDateBoundMatchesWebClient() {
        // Mirrored in smokingCalculator.test.js — both clients must agree on
        // which dates a manual entry may target.
        assertEquals(true, SmokingCalculator.isBackfillDateAllowed("2024-05-20", "2024-05-20"))
        assertEquals(true, SmokingCalculator.isBackfillDateAllowed("2024-05-19", "2024-05-20"))
        assertEquals(true, SmokingCalculator.isBackfillDateAllowed("2023-12-31", "2024-05-20"))

        assertEquals(false, SmokingCalculator.isBackfillDateAllowed("2024-05-21", "2024-05-20"))
        assertEquals(false, SmokingCalculator.isBackfillDateAllowed("2024-06-01", "2024-05-31"))
        assertEquals(false, SmokingCalculator.isBackfillDateAllowed("2025-01-01", "2024-12-31"))

        assertEquals(false, SmokingCalculator.isBackfillDateAllowed("2026-02-31", "2026-12-31"))
        assertEquals(false, SmokingCalculator.isBackfillDateAllowed("abc", "2024-05-20"))

        assertEquals(true, SmokingCalculator.isBackfillDateAllowed("2099-01-01", null))
        assertEquals(true, SmokingCalculator.isBackfillDateAllowed("2099-01-01", ""))
    }

    @Test
    fun testGetLimitStatus_zeroTargetSemantics() {
        // target=0, actual=0 -> on target ("at"), not a meaningless 0%.
        assertEquals(SmokingCalculator.LimitStatus("at", 0.0, 0.0), SmokingCalculator.getLimitStatus(0.0, 0.0))
        // target=0, actual=1 -> 1 above target.
        assertEquals(SmokingCalculator.LimitStatus("over", 1.0, 0.0), SmokingCalculator.getLimitStatus(1.0, 0.0))
        // target=0, actual=5 -> 5 above target.
        assertEquals(SmokingCalculator.LimitStatus("over", 5.0, 0.0), SmokingCalculator.getLimitStatus(5.0, 0.0))
        // Three-state visual semantics (item 5): under / at / over are distinct.
        assertEquals(SmokingCalculator.LimitStatus("under", 0.0, 7.0), SmokingCalculator.getLimitStatus(3.0, 10.0))
        assertEquals(SmokingCalculator.LimitStatus("at", 0.0, 0.0), SmokingCalculator.getLimitStatus(10.0, 10.0))
        assertEquals(SmokingCalculator.LimitStatus("over", 2.0, 0.0), SmokingCalculator.getLimitStatus(12.0, 10.0))
    }

    @Test
    fun testGetReduction_andBaselineSavings_neverFromTarget() {
        // No baseline -> never fabricate a reduction claim.
        assertEquals(null, SmokingCalculator.getReduction(8.0, null))

        // baseline=20, target=10, actual=8: 12 below baseline, reduction 60%.
        val reduction = SmokingCalculator.getReduction(8.0, 20)
        assertEquals(SmokingCalculator.Reduction(20.0, 8.0, 12.0, 0.6), reduction)
        // Independently, goal adherence vs. target is a different, unrelated number.
        assertEquals(SmokingCalculator.LimitStatus("under", 0.0, 2.0), SmokingCalculator.getLimitStatus(8.0, 10.0))

        // Money saved comes from baseline vs. actual, never target vs. actual:
        // 12 units avoided at 1.0 = 12.0 -- NOT (target 10 - actual 8) * 1.0 = 2.0.
        val configs = listOf(TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 1.0, baseline = 20))
        val savings = SmokingCalculator.calculateBaselineSavings(mapOf("c1" to 8.0), configs, 1.0)
        assertEquals(SmokingCalculator.BaselineSavings(12.0, 12.0, true), savings)

        // No baseline on the tracker -> contributes nothing, flagged honestly.
        val noBaselineConfigs = listOf(TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 1.0))
        assertEquals(
            SmokingCalculator.BaselineSavings(0.0, 0.0, false),
            SmokingCalculator.calculateBaselineSavings(mapOf("c1" to 3.0), noBaselineConfigs, 1.0)
        )
    }

    @Test
    fun testBuildTrackerSnapshot_andComputeDayCredit_selfContained() {
        val config = TrackerConfig("c1", "Cigarettes", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 0.5, baseline = 20)
        val snapshot = SmokingCalculator.buildTrackerSnapshot(config)
        assertEquals(TrackerSnapshot("Cigarettes", TrackerType.CIGARETTE, 10, 20, 0.5, true, true), snapshot)

        // Day credit is computed ENTIRELY from the stamped snapshot -- a live
        // config change afterward must not affect it (item 2).
        val credit = SmokingCalculator.computeDayCredit(mapOf("c1" to 8.0), mapOf("c1" to snapshot), 0.5)
        assertEquals(4.0, credit.wasted, 1e-9) // 8 * 0.5
        assertEquals(1.0, credit.saved, 1e-9) // (10 - 8) * 0.5
        assertEquals(8.0, credit.smokingUnits, 1e-9)
        assertEquals(6.0, credit.baselineSaved, 1e-9) // (20 - 8) * 0.5
    }

    @Test
    fun testCalculateStreak_usesSnapshotTarget_notLiveConfig() {
        // Live target is now 5.
        val liveConfigs = listOf(TrackerConfig("c1", "Cig", 5, 1, TrackerType.CIGARETTE))
        val today = "2024-07-14"
        // Yesterday the target was 10 and the user smoked 8 -- a legitimate success at the time.
        val dayDocs = listOf(
            DayDocument(
                date = "2024-07-13",
                counts = mapOf("c1" to 8.0),
                trackerSnapshots = mapOf("c1" to TrackerSnapshot(target = 10))
            )
        )
        // Without the snapshot, 8 > today's live limit of 5 would break the streak.
        assertEquals(2, SmokingCalculator.calculateStreak(emptyList(), liveConfigs, mapOf("c1" to 1.0), today, dayDocs))

        // Changing today's live target does not change the outcome for the snapshotted day.
        val higherLiveConfigs = listOf(TrackerConfig("c1", "Cig", 100, 1, TrackerType.CIGARETTE))
        assertEquals(2, SmokingCalculator.calculateStreak(emptyList(), higherLiveConfigs, mapOf("c1" to 1.0), today, dayDocs))

        // No snapshot for a legacy log -> falls back to the live limit (documented fallback).
        val logs = listOf(LogEntry("d1", "2024-07-13", mapOf("c1" to 8.0), origin = "DAY_RESET"))
        assertEquals(1, SmokingCalculator.calculateStreak(logs, liveConfigs, mapOf("c1" to 1.0), today, emptyList()))
    }

    @Test
    fun testCalculateTrackingStreak_separateFromGoalStreak() {
        val configs = listOf(TrackerConfig("c1", "Cig", 1, 1, TrackerType.CIGARETTE))
        val today = "2024-07-14"
        val logs = listOf(
            LogEntry("d1", "2024-07-13", mapOf("c1" to 20.0), origin = "DAY_RESET"),
            LogEntry("d2", "2024-07-12", mapOf("c1" to 20.0), origin = "DAY_RESET")
        )
        // Goal streak is 0 (way over target every day)...
        assertEquals(0, SmokingCalculator.calculateStreak(logs, configs, mapOf("c1" to 20.0), today))
        // ...but the user tracked faithfully for 3 consecutive days.
        assertEquals(3, SmokingCalculator.calculateTrackingStreak(logs, mapOf("c1" to 20.0), today))
    }

    @Test
    fun testCalculateTrackingStreak_fixtureCoverage() {
        val configs = listOf(TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE))
        val today = "2024-07-14"

        // 1. no history → 0
        assertEquals(0, SmokingCalculator.calculateTrackingStreak(emptyList(), emptyMap(), today))

        // 2. one tracked day
        assertEquals(1, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2024-07-14", mapOf("c1" to 1.0))),
            emptyMap(), today
        ))

        // 3. consecutive tracked days
        assertEquals(3, SmokingCalculator.calculateTrackingStreak(
            listOf(
                LogEntry("l1", "2024-07-13", mapOf("c1" to 3.0)),
                LogEntry("l2", "2024-07-12", mapOf("c1" to 3.0))
            ),
            mapOf("c1" to 1.0), today
        ))

        // 4. missing day breaks streak — log from 2 days ago with no session today = 0
        // (mostRecent 07-12 is older than yesterday 07-13, so streak is 0)
        assertEquals(0, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2024-07-12", mapOf("c1" to 3.0))),
            emptyMap(), today
        ))

        // 5. tracked zero (manual entry with zero counts) preserves streak
        assertEquals(3, SmokingCalculator.calculateTrackingStreak(
            listOf(
                LogEntry("l1", "2024-07-13", mapOf("c1" to 0.0), origin = "MANUAL_ENTRY"),
                LogEntry("l2", "2024-07-12", mapOf("c1" to 5.0))
            ),
            mapOf("c1" to 1.0), today
        ))

        // 6. manual-entry day counts as tracked
        assertEquals(2, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2024-07-13", mapOf("c1" to 5.0), origin = "MANUAL_ENTRY")),
            mapOf("c1" to 1.0), today
        ))

        // 7. dayDoc day counts as tracked — today has active count, yesterday is a dayDoc (possibly zero)
        assertEquals(2, SmokingCalculator.calculateTrackingStreak(
            emptyList(),
            mapOf("c1" to 1.0),
            today,
            listOf(DayDocument("2024-07-13", mapOf("c1" to 3.0), emptyMap()))
        ))

        // 8. manual + dayDoc same date → still 1 streak day
        assertEquals(2, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2024-07-13", mapOf("c1" to 4.0), origin = "MANUAL_ENTRY")),
            mapOf("c1" to 1.0),
            today,
            listOf(DayDocument("2024-07-13", mapOf("c1" to 2.0), emptyMap()))
        ))

        // 9. goal missed but tracking preserved (over target every day)
        val overConfigs = listOf(TrackerConfig("c1", "Cig", 1, 1, TrackerType.CIGARETTE))
        val overLogs = listOf(
            LogEntry("d1", "2024-07-13", mapOf("c1" to 20.0)),
            LogEntry("d2", "2024-07-12", mapOf("c1" to 20.0))
        )
        assertEquals(0, SmokingCalculator.calculateStreak(overLogs, overConfigs, mapOf("c1" to 20.0), today))
        assertEquals(3, SmokingCalculator.calculateTrackingStreak(overLogs, mapOf("c1" to 20.0), today))

        // 11. day-start boundary (trackingDay = cursor, yesterday empty)
        // With trackingDay "2024-07-14", if yesterday (07-13) is missing → streak 0 (no recent activity)
        assertEquals(0, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2024-07-11", mapOf("c1" to 5.0))),
            emptyMap(), today
        ))

        // 12. year/month boundary — streak spans December → January
        val yearBoundaryLogs = listOf(
            LogEntry("l1", "2024-01-01", mapOf("c1" to 3.0)),
            LogEntry("l2", "2023-12-31", mapOf("c1" to 3.0)),
            LogEntry("l3", "2023-12-30", mapOf("c1" to 3.0))
        )
        assertEquals(4, SmokingCalculator.calculateTrackingStreak(yearBoundaryLogs, mapOf("c1" to 1.0), "2024-01-02"))

        // --- Micro-fix: zero-only activeCounts bailout regression tests ---

        // Case A — zero active map, no history: today counts, streak = 1
        assertEquals(1, SmokingCalculator.calculateTrackingStreak(
            emptyList(), mapOf("c1" to 0.0), "2026-09-18"
        ))

        // Case B — zero active + stale history: today counts, yesterday missing, streak = 1
        assertEquals(1, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2026-09-16", mapOf("c1" to 5.0))),
            mapOf("c1" to 0.0), "2026-09-18"
        ))

        // Case C — empty active + stale history: no today evidence, streak = 0
        assertEquals(0, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2026-09-16", mapOf("c1" to 5.0))),
            emptyMap(), "2026-09-18"
        ))

        // Case D — persisted zero current dayDoc: today counts, streak = 1
        assertEquals(1, SmokingCalculator.calculateTrackingStreak(
            emptyList(), emptyMap(), "2026-09-18",
            listOf(DayDocument("2026-09-18", mapOf("c1" to 0.0), emptyMap()))
        ))

        // Case E — zero manual log today: today counts, streak = 1
        assertEquals(1, SmokingCalculator.calculateTrackingStreak(
            listOf(LogEntry("l1", "2026-09-18", mapOf("c1" to 0.0), origin = "MANUAL_ENTRY")),
            emptyMap(), "2026-09-18"
        ))

        // Case F — no evidence at all: streak = 0
        assertEquals(0, SmokingCalculator.calculateTrackingStreak(
            emptyList(), emptyMap(), "2026-09-18"
        ))
    }

    @Test
    fun futureDatedLogWouldReviveADeadStreak() {
        // Why the bound exists: calculateStreak only bails early when the most
        // recent logged date is older than yesterday, and a future date is not,
        // so an inactive user would read as streak 1.
        val configs = listOf(TrackerConfig("c1", "Cig", 5, 1, TrackerType.CIGARETTE))
        val stale = listOf(LogEntry("l1", "2024-01-01", mapOf("c1" to 1.0), origin = "DAY_RESET"))
        assertEquals(0, SmokingCalculator.calculateStreak(stale, configs, emptyMap(), "2024-05-20"))

        val withFuture = stale + LogEntry("l2", "2099-01-01", mapOf("c1" to 1.0), origin = "MANUAL_ENTRY")
        assertEquals(1, SmokingCalculator.calculateStreak(withFuture, configs, emptyMap(), "2024-05-20"))
        assertEquals(false, SmokingCalculator.isBackfillDateAllowed("2099-01-01", "2024-05-20"))
    }
}
