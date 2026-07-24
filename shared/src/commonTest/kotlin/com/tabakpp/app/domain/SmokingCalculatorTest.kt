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
}
