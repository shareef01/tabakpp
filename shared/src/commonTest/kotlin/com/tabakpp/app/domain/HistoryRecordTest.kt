package com.tabakpp.app.domain

import com.tabakpp.app.data.*
import kotlin.test.*

class HistoryRecordTest {
    @Test fun closedDaysAppearWithoutLegacyLogsAndKeepTheirMutationKind() {
        val closed = DayDocument(date = "2026-07-01", status = "closed", counts = mapOf("old" to 3.0))
        val records = historyRecords(emptyList(), listOf(closed, closed, DayDocument(date = "2026-07-02")))
        assertEquals(1, records.size)
        assertTrue(records.single() is HistoryRecord.Day)
        assertEquals("day:2026-07-01", records.single().key)
        assertEquals(closed.counts, records.single().displayLog().counts)
    }

    @Test fun sameDateManualLogsAndDaysHaveDistinctIdentities() {
        val records = historyRecords(listOf(LogEntry(id = "m1", logDate = "2026-07-01")),
            listOf(DayDocument(date = "2026-07-01", status = "closed")))
        assertEquals(setOf("log:m1", "day:2026-07-01"), records.map { it.key }.toSet())
    }

    @Test fun editUsesDeletedHistoricalTrackerAndFrozenPrice() {
        val snapshot = TrackerSnapshot(name = "Old", target = 10, baseline = 20, unitPrice = 0.8)
        val record = LogEntry(id = "m1", logDate = "2026-07-01", trackerSnapshots = mapOf("retired" to snapshot))
        val configs = historyEditConfigs(record, listOf(TrackerConfig("new", "New", 1, 0)))
        assertEquals("retired", configs.single().id)
        assertEquals(0.8, configs.single().pricePerUnit)
        assertEquals(20, configs.single().baseline)
    }

    @Test fun inheritedPriceIsCapturedAndOldUnknownPriceRejectsChangedEdits() {
        val snapshot = SmokingCalculator.buildTrackerSnapshot(TrackerConfig("cig", "Cig", 10, 0), 0.8)
        assertEquals(0.8, snapshot.unitPrice)
        assertEquals(2.4, SmokingCalculator.computeDayCredit(mapOf("cig" to 3.0), mapOf("cig" to snapshot)).wasted, 0.00001)
        assertFailsWith<IllegalStateException> {
            SmokingCalculator.requireHistoricalPrices(mapOf("cig" to 3.0), mapOf("cig" to snapshot.copy(unitPrice = null)))
        }
    }
}
