package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals

class SmokingCalculatorTest {

    @Test
    fun testGetTrackingDate_UsesLocalCalendarDate() {
        val tz = TimeZone.UTC
        assertEquals("2024-05-20", SmokingCalculator.getTrackingDate(Instant.parse("2024-05-20T05:59:59Z"), tz))
        assertEquals("2024-05-20", SmokingCalculator.getTrackingDate(Instant.parse("2024-05-20T06:00:00Z"), tz))
        assertEquals("2024-05-20", SmokingCalculator.getTrackingDate(Instant.parse("2024-05-20T23:59:59Z"), tz))
        assertEquals("2024-05-21", SmokingCalculator.getTrackingDate(Instant.parse("2024-05-21T00:00:00Z"), tz))
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

    // --- getGlobalMetrics (previously untested; T3) --------------------------

    @Test
    fun testGetGlobalMetrics_derivesCountLimitFinancialsAndMinutes() {
        val configs = listOf(
            TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 1.0, isPrimaryTracked = true)
        )
        val metrics = SmokingCalculator.getGlobalMetrics(
            logs = emptyList(),
            configs = configs,
            activeCounts = mapOf("c1" to 4.0),
            trackingDay = "2024-05-20",
            userPrice = 0.5
        )
        assertEquals(4, metrics.count)
        assertEquals(10, metrics.limit)
        assertEquals(0.4, metrics.progress, 1e-9)
        assertEquals(4.0, metrics.spentToday, 1e-9)   // 4 * 1.0
        assertEquals(6.0, metrics.saved, 1e-9)        // (10 - 4) * 1.0
        assertEquals(true, metrics.hasOpenSession)
        assertEquals(44, metrics.lifeLost)            // 4 units * 11
        assertEquals(66, metrics.recovered)           // (10 - 4) active * 11
        assertEquals(0.0, metrics.savedLifetime, 1e-9)
    }

    @Test
    fun testGetGlobalMetrics_usesLifetimeAggregatesWhenPresent() {
        val configs = listOf(
            TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 1.0, isPrimaryTracked = true)
        )
        val agg = LifetimeAggregates(saved = 123.45, wasted = 0.0, smokingUnits = 100.0)
        val metrics = SmokingCalculator.getGlobalMetrics(
            logs = emptyList(),
            configs = configs,
            activeCounts = mapOf("c1" to 2.0),
            trackingDay = "2024-05-20",
            userPrice = 0.5,
            lifetimeAggregates = agg
        )
        // savedLifetime comes from the authoritative aggregate, not a log sum.
        assertEquals(123.45, metrics.savedLifetime, 1e-9)
        // lifeLost = (archived 100 + active 2) * 11
        assertEquals(1122, metrics.lifeLost)
    }

    @Test
    fun testGetGlobalMetrics_emptySessionHasNoOpenSession() {
        val configs = listOf(TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE, isPrimaryTracked = true))
        val metrics = SmokingCalculator.getGlobalMetrics(
            logs = emptyList(), configs = configs, activeCounts = emptyMap(),
            trackingDay = "2024-05-20"
        )
        assertEquals(0, metrics.count)
        assertEquals(false, metrics.hasOpenSession)
        assertEquals(0.0, metrics.progress, 1e-9)
    }

    @Test
    fun testRecovery_todayManualEntryExcludedUntilArchived() {
        // C7: the same manual entry contributes recovery when dated in the past,
        // but is skipped for the current tracking day (only the live session counts).
        val configs = listOf(TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE))
        val today = "2024-05-20"

        val datedYesterday = listOf(LogEntry("m1", "2024-05-19", mapOf("c1" to 3.0), origin = "MANUAL_ENTRY"))
        // yesterday (10-3)=7*11=77 + today's empty active (10-0)=10*11=110
        assertEquals(187, SmokingCalculator.calculateRecoveryMinutes(datedYesterday, configs, emptyMap(), today))

        val datedToday = listOf(LogEntry("m1", today, mapOf("c1" to 3.0), origin = "MANUAL_ENTRY"))
        // today's manual entry is skipped; only the empty active session counts → 110
        assertEquals(110, SmokingCalculator.calculateRecoveryMinutes(datedToday, configs, emptyMap(), today))
    }

    // --- normalizeAccentColor (C3 regression) -------------------------------

    @Test
    fun testNormalizeAccentColor_expandsShortHexAndGuardsWhite() {
        assertEquals("#E4E4E7", SmokingCalculator.normalizeAccentColor("#FFFFFF"))
        assertEquals("#E4E4E7", SmokingCalculator.normalizeAccentColor("#fff"))
        // 3-digit hex must expand so Compose parses the intended color, not near-black.
        assertEquals("#00FF00", SmokingCalculator.normalizeAccentColor("#0F0"))
        assertEquals("#00FF00", SmokingCalculator.normalizeAccentColor("#0f0"))
        // 6-digit hex passes through unchanged.
        assertEquals("#FF5F5F", SmokingCalculator.normalizeAccentColor("#FF5F5F"))
    }
}
