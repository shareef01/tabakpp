package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlin.test.*

class AuditStatisticsTest {
    @Test fun monthlyCreditsAreAdditiveButTheLiveDayProjectionIsNot() {
        val date = "2026-09-15"
        val snapshot = TrackerSnapshot(target = 10, baseline = 20, unitPrice = 0.8)
        val log = LogEntry("manual", date, mapOf("cig" to 4.0),
            aggregateCredit = LifetimeAggregates(saved = 4.8, wasted = 3.2, smokingUnits = 4.0, baselineSaved = 12.8))
        val day = DayDocument(date = date, counts = mapOf("cig" to 1.0), trackerSnapshots = mapOf("cig" to snapshot))
        val month = SmokingCalculator.aggregateMonthlyData(listOf(log), listOf(day), date, mapOf("cig" to 2.0)).second!!
        assertEquals(6, month.units)
        assertEquals(4.8, month.spent, 0.00001)
        assertEquals(27.2, month.baselineSaved, 0.00001)
        assertFalse(month.unknownEconomics)
        val unknown = SmokingCalculator.aggregateMonthlyData(listOf(log.copy(aggregateCredit = null)), emptyList(), date).second!!
        assertTrue(unknown.unknownEconomics)
    }

    @Test fun foldedTodayIsNotAddedToLifetimeTwice() {
        val config = TrackerConfig("cig", "Cig", 10, 0, pricePerUnit = 0.8, baseline = 20)
        val metrics = SmokingCalculator.getGlobalMetrics(emptyList(), listOf(config), mapOf("cig" to 2.0), "2026-09-15", 0.8,
            LifetimeAggregates(saved = 6.4, wasted = 1.6, smokingUnits = 2.0, baselineSaved = 14.4),
            listOf(DayDocument(date = "2026-09-15", status = "closed", foldedIntoLifetime = true, counts = mapOf("cig" to 2.0))))
        assertEquals(14.4, metrics.baselineSavedLifetime, 0.00001)
        assertEquals(22, metrics.lifeLost)
    }
}
