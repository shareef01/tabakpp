package com.tabakpp.app.domain

import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Parity coverage for the transactional aggregate math in
 * [com.tabakpp.app.data.FirebaseRegistryRepository]. Fixtures and expected
 * values mirror webApp/src/services/registryService.test.js exactly so the two
 * clients are provably in lock-step:
 *   cig — CIGARETTE, €1.00, limit 10 · ryo — RYO_ROLL, €0.50, limit 5
 */
class RegistryMutationsTest {

    private val cig = TrackerConfig("cig", "Cigarette", 10, 1, TrackerType.CIGARETTE, pricePerUnit = 1.0)
    private val ryo = TrackerConfig("ryo", "RYO", 5, 2, TrackerType.RYO_ROLL, pricePerUnit = 0.5)
    private val configs = listOf(cig, ryo)
    private val cigOnly = listOf(cig)
    private val price = 0.5

    private fun assertAgg(expected: Triple<Double, Double, Double>, actual: LifetimeAggregates) {
        assertEquals(expected.first, actual.saved, 1e-9, "saved")
        assertEquals(expected.second, actual.wasted, 1e-9, "wasted")
        assertEquals(expected.third, actual.smokingUnits, 1e-9, "smokingUnits")
    }

    @Test
    fun endDay_firstArchive_creditsFullFinancials() {
        val result = RegistryMutations.endDay(
            current = LifetimeAggregates(saved = 100.0, wasted = 50.0, smokingUnits = 200.0),
            existingCounts = null,
            activeCounts = mapOf("cig" to 8.0, "ryo" to 2.0),
            configs = configs,
            unitPrice = price
        )
        // fin{cig:8,ryo:2} = saved (2*1)+(3*0.5)=3.5 · wasted (8*1)+(2*0.5)=9 · units 10
        assertEquals(mapOf("cig" to 8.0, "ryo" to 2.0), result.mergedCounts)
        assertAgg(Triple(103.5, 59.0, 210.0), result.aggregates)
    }

    @Test
    fun endDay_secondArchive_mergesByDeltaWithoutDoubleCounting() {
        // Continuation of the first archive: aggregates already hold fin(8,2).
        val result = RegistryMutations.endDay(
            current = LifetimeAggregates(saved = 103.5, wasted = 59.0, smokingUnits = 210.0),
            existingCounts = mapOf("cig" to 8.0, "ryo" to 2.0),
            activeCounts = mapOf("cig" to 2.0),
            configs = configs,
            unitPrice = price
        )
        // merged {cig:10,ryo:2}; only the delta over the previous archive is applied
        assertEquals(mapOf("cig" to 10.0, "ryo" to 2.0), result.mergedCounts)
        assertAgg(Triple(101.5, 61.0, 212.0), result.aggregates)
    }

    @Test
    fun credit_addsLogFinancials() {
        // fin{cig:2}: saved 8 wasted 2 units 2
        val agg = RegistryMutations.credit(
            LifetimeAggregates(50.0, 50.0, 50.0), mapOf("cig" to 2.0), cigOnly, price
        )
        assertAgg(Triple(58.0, 52.0, 52.0), agg)
    }

    @Test
    fun debit_subtractsLogFinancials() {
        // fin{cig:6}: saved 4 wasted 6 units 6
        val agg = RegistryMutations.debit(
            LifetimeAggregates(50.0, 50.0, 50.0), mapOf("cig" to 6.0), cigOnly, price
        )
        assertAgg(Triple(46.0, 44.0, 44.0), agg)
    }

    @Test
    fun replace_swapsOldContributionForNew() {
        // old{cig:4}: saved 6 wasted 4 units 4 · new{cig:9}: saved 1 wasted 9 units 9
        val agg = RegistryMutations.replace(
            LifetimeAggregates(50.0, 50.0, 50.0), mapOf("cig" to 4.0), mapOf("cig" to 9.0), cigOnly, price
        )
        assertAgg(Triple(45.0, 55.0, 55.0), agg)
    }

    @Test
    fun creditThenDebit_isIdentity() {
        // Restoring then deleting the same log must leave aggregates untouched.
        val start = LifetimeAggregates(12.34, 56.78, 90.0)
        val counts = mapOf("cig" to 3.0, "ryo" to 4.0)
        val credited = RegistryMutations.credit(start, counts, configs, price)
        val restored = RegistryMutations.debit(credited, counts, configs, price)
        assertAgg(Triple(start.saved, start.wasted, start.smokingUnits), restored)
    }

    @Test
    fun endDay_ignoresNonSmokingTypesInUnits() {
        val withSimple = configs + TrackerConfig("simple", "Water", 3, 3, TrackerType.SIMPLE)
        val result = RegistryMutations.endDay(
            current = LifetimeAggregates(0.0, 0.0, 0.0),
            existingCounts = null,
            activeCounts = mapOf("cig" to 5.0, "simple" to 9.0),
            configs = withSimple,
            unitPrice = price
        )
        // Only cig counts toward smoking units; simple is excluded.
        assertEquals(5.0, result.aggregates.smokingUnits, 1e-9)
    }
}
