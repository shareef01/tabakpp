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
    fun contribution_includesBaselineSaved() {
        // AUD-007: baseline savings must advance together with `saved` on the
        // manual-entry / legacy-log write paths.
        val withBaseline = TrackerConfig(
            "cig", "Cigarette", 10, 1, TrackerType.CIGARETTE,
            pricePerUnit = 1.0, baseline = 20
        )
        val cfg = listOf(withBaseline)
        val credit = RegistryMutations.contribution(mapOf("cig" to 2.0), cfg, price)
        assertEquals(8.0, credit.saved, 1e-9)          // (10 - 2) * 1
        assertEquals(2.0, credit.wasted, 1e-9)         // 2 * 1
        assertEquals(18.0, credit.baselineSaved, 1e-9) // (20 - 2) * 1

        val start = LifetimeAggregates(50.0, 50.0, 50.0, 50.0)
        val credited = RegistryMutations.credit(start, mapOf("cig" to 2.0), cfg, price)
        assertEquals(68.0, credited.baselineSaved, 1e-9)
        val debited = RegistryMutations.debit(credited, mapOf("cig" to 2.0), cfg, price)
        assertEquals(50.0, debited.baselineSaved, 1e-9)
        val replaced = RegistryMutations.replace(
            credited, mapOf("cig" to 2.0), mapOf("cig" to 5.0), cfg, price
        )
        assertEquals(65.0, replaced.baselineSaved, 1e-9) // 68 - 18 + 15
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
    fun mergeHistoricalEditCounts_preservesDeletedTrackerCounts() {
        val merged = RegistryMutations.mergeHistoricalEditCounts(
            incoming = mapOf("cig" to 9.0),
            previous = mapOf("cig" to 4.0, "retired" to 7.0),
            liveConfigIds = listOf("cig")
        )
        assertEquals(mapOf("cig" to 9.0, "retired" to 7.0), merged)
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
        assertEquals(5.0, result.logCredit.smokingUnits, 1e-9)
    }

    @Test
    fun resolveContribution_prefersStampedCredit_whenConfigsWouldDiffer() {
        // Stamped when cig cost €1 and limit produced saved=8 wasted=2 units=2.
        val stamped = LifetimeAggregates(saved = 8.0, wasted = 2.0, smokingUnits = 2.0)
        // Live configs are gone / empty — recomputing would yield zeros.
        val resolved = RegistryMutations.resolveContribution(
            stamped,
            mapOf("cig" to 2.0),
            emptyList(),
            price
        )
        assertAgg(Triple(8.0, 2.0, 2.0), resolved)

        val afterDebit = RegistryMutations.applyDebit(
            LifetimeAggregates(50.0, 50.0, 50.0),
            resolved
        )
        assertAgg(Triple(42.0, 48.0, 48.0), afterDebit)
    }

    @Test
    fun endDay_secondArchive_usesStampedExistingCredit() {
        // Existing archive was credited under old economics; live configs changed.
        val stampedExisting = LifetimeAggregates(saved = 3.5, wasted = 9.0, smokingUnits = 10.0)
        val expensiveCig = cig.copy(pricePerUnit = 9.0)
        val result = RegistryMutations.endDay(
            current = LifetimeAggregates(saved = 103.5, wasted = 59.0, smokingUnits = 210.0),
            existingCounts = mapOf("cig" to 8.0, "ryo" to 2.0),
            activeCounts = mapOf("cig" to 2.0),
            configs = listOf(expensiveCig, ryo),
            unitPrice = price,
            existingCredit = stampedExisting
        )
        // Delta must use stamped previous credit, not recomputed expensive prices.
        assertEquals(mapOf("cig" to 10.0, "ryo" to 2.0), result.mergedCounts)
        val expectedNew = RegistryMutations.contribution(
            mapOf("cig" to 10.0, "ryo" to 2.0),
            listOf(expensiveCig, ryo),
            price
        )
        assertAgg(
            Triple(
                103.5 - stampedExisting.saved + expectedNew.saved,
                59.0 - stampedExisting.wasted + expectedNew.wasted,
                210.0 - stampedExisting.smokingUnits + expectedNew.smokingUnits
            ),
            result.aggregates
        )
        assertAgg(Triple(expectedNew.saved, expectedNew.wasted, expectedNew.smokingUnits), result.logCredit)
    }

    @Test
    fun mergeHistoricalEditCounts_ignoresZeroCountForUninvolvedTrackers_preservesExistingZero() {
        val merged = RegistryMutations.mergeHistoricalEditCounts(
            incoming = mapOf("cig" to 0.0, "newVape" to 0.0),
            previous = mapOf("cig" to 4.0, "retired" to 7.0),
            liveConfigIds = listOf("cig", "newVape"),
            historicalIds = listOf("cig", "retired")
        )
        // `cig` is an existing historical tracker so `cig: 0.0` is preserved;
        // `newVape` is absent from both previous counts and historical snapshots so `newVape: 0.0` is ignored.
        assertEquals(mapOf("cig" to 0.0, "retired" to 7.0), merged)
    }

    @Test
    fun financialRounding_roundsSavedWastedAndBaselineSaved_withoutRoundingSmokingUnits() {
        val decCig = TrackerConfig(
            "cig", "Cigarette", 10, 1, TrackerType.CIGARETTE,
            pricePerUnit = 0.125, baseline = 11
        )
        // count = 9 -> wasted = 9 * 0.125 = 1.125 -> 1.13; saved = 1 * 0.125 = 0.125 -> 0.13; baselineSaved = 2 * 0.125 = 0.25
        val contrib = RegistryMutations.contribution(mapOf("cig" to 9.0), listOf(decCig), 0.125)
        assertEquals(0.13, contrib.saved)
        assertEquals(1.13, contrib.wasted)
        assertEquals(0.25, contrib.baselineSaved)
        assertEquals(9.0, contrib.smokingUnits)

        // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004 without roundMoney
        val start = LifetimeAggregates(saved = 0.1, wasted = 0.1, smokingUnits = 1.5, baselineSaved = 0.1)
        val delta = LifetimeAggregates(saved = 0.2, wasted = 0.2, smokingUnits = 2.0, baselineSaved = 0.2)
        val credited = RegistryMutations.applyCredit(start, delta)
        assertEquals(0.3, credited.saved)
        assertEquals(0.3, credited.wasted)
        assertEquals(0.3, credited.baselineSaved)
        assertEquals(3.5, credited.smokingUnits)

        val debited = RegistryMutations.applyDebit(credited, delta)
        assertEquals(0.1, debited.saved)
        assertEquals(0.1, debited.wasted)
        assertEquals(0.1, debited.baselineSaved)
        assertEquals(1.5, debited.smokingUnits)

        val replaced = RegistryMutations.applyReplace(
            LifetimeAggregates(saved = 0.3, wasted = 0.3, smokingUnits = 3.0, baselineSaved = 0.3),
            LifetimeAggregates(saved = 0.2, wasted = 0.2, smokingUnits = 2.0, baselineSaved = 0.2),
            LifetimeAggregates(saved = 0.2, wasted = 0.2, smokingUnits = 4.0, baselineSaved = 0.2)
        )
        assertEquals(0.3, replaced.saved)
        assertEquals(0.3, replaced.wasted)
        assertEquals(0.3, replaced.baselineSaved)
        assertEquals(5.0, replaced.smokingUnits)

        // Symmetric half-away-from-zero across positive/negative half-cents and IEEE-754 computed half-cents
        assertEquals(0.13, SmokingCalculator.roundMoney(0.125))
        assertEquals(-0.13, SmokingCalculator.roundMoney(-0.125))
        assertEquals(1.01, SmokingCalculator.roundMoney(1.005))
        assertEquals(-1.01, SmokingCalculator.roundMoney(-1.005))
        assertEquals(10.08, SmokingCalculator.roundMoney(10.075))
        assertEquals(-10.08, SmokingCalculator.roundMoney(-10.075))
        assertEquals(0.23, SmokingCalculator.roundMoney(3.0 * 0.075))
        assertEquals(-0.23, SmokingCalculator.roundMoney(-3.0 * 0.075))
        assertEquals(1.41, SmokingCalculator.roundMoney(1.4 + 0.005))
        assertEquals(-1.41, SmokingCalculator.roundMoney(-1.4 - 0.005))
        assertEquals("0,23 €", SmokingCalculator.formatCurrency(3.0 * 0.075))
        assertEquals("-0,23 €", SmokingCalculator.formatCurrency(-3.0 * 0.075))

        // Repeated credits, debits, and full reversal produce zero net drift
        var agg = LifetimeAggregates()
        val steps = listOf(
            LifetimeAggregates(saved = SmokingCalculator.roundMoney(1.005), wasted = SmokingCalculator.roundMoney(3.0 * 0.075), smokingUnits = 1.5, baselineSaved = SmokingCalculator.roundMoney(10.075)),
            LifetimeAggregates(saved = 0.1, wasted = 0.2, smokingUnits = 2.25, baselineSaved = SmokingCalculator.roundMoney(0.125))
        )
        repeat(200) {
            steps.forEach { s -> agg = RegistryMutations.applyCredit(agg, s) }
            steps.reversed().forEach { s -> agg = RegistryMutations.applyDebit(agg, s) }
        }
        assertEquals(0.0, agg.saved)
        assertEquals(0.0, agg.wasted)
        assertEquals(0.0, agg.baselineSaved)
        assertEquals(0.0, agg.smokingUnits)
    }
}
