package com.tabakpp.app.domain

import com.tabakpp.app.data.DailyFinancialRecord
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.UnresolvedComponents
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun ledger(
    date: String = "2026-10-01",
    saved: Double = 4.0,
    wasted: Double = 6.0,
    units: Double = 6.0,
    baselineSaved: Double = 9.0,
    ambiguous: Boolean = false,
    eligible: Boolean = true,
    folded: Boolean = false,
    unresolved: UnresolvedComponents = UnresolvedComponents()
) = DailyFinancialRecord(
    date = date,
    canonicalCredit = LifetimeAggregates(saved = saved, wasted = wasted, smokingUnits = units, baselineSaved = baselineSaved),
    ambiguous = ambiguous,
    eligible = eligible,
    foldedIntoLifetime = folded,
    unresolvedComponents = unresolved
)

class FinancialReadModelTest {

    @Test
    fun canonicalScenario_optionB_readsTheLedgerValues() {
        val r = FinancialReadModel.resolveDateFinancial("OPTION_B", ledger(), hasSourceActivity = true)
        assertEquals(FinancialSource.OPTION_B_CANONICAL, r.source)
        assertTrue(r.available)
        assertEquals(6.0, r.canonical!!.spent)
        assertEquals(4.0, r.canonical!!.saved)
        assertEquals(9.0, r.canonical!!.baselineSaved)
        assertEquals(6.0, r.canonical!!.smokingUnits)
        assertFalse(r.ambiguous)
    }

    @Test
    fun legacy_ownsTheDate_noCanonicalOverride() {
        val r = FinancialReadModel.resolveDateFinancial("LEGACY", null, hasSourceActivity = true)
        assertEquals(FinancialSource.LEGACY, r.source)
        assertFalse(r.available)
        assertNull(r.canonical)
    }

    @Test
    fun scenarioD_optionB_missingLedger_withActivity_isUnavailable_neverLegacy() {
        val r = FinancialReadModel.resolveDateFinancial("OPTION_B", null, hasSourceActivity = true)
        assertEquals(FinancialSource.MISSING_CANONICAL_LEDGER, r.source)
        assertFalse(r.available)
        assertNull(r.canonical)
    }

    @Test
    fun optionB_noLedger_noActivity_isGenuineZero() {
        val r = FinancialReadModel.resolveDateFinancial("OPTION_B", null, hasSourceActivity = false)
        assertEquals(FinancialSource.NO_ACTIVITY, r.source)
        assertTrue(r.available)
        assertEquals(0.0, r.canonical!!.saved)
    }

    @Test
    fun scenarioC_migrating_perDate_ledgerCanonical_elseLegacy() {
        assertEquals(FinancialSource.OPTION_B_CANONICAL, FinancialReadModel.resolveDateFinancial("MIGRATING", ledger(), true).source)
        assertEquals(FinancialSource.LEGACY, FinancialReadModel.resolveDateFinancial("MIGRATING", null, true).source)
    }

    @Test
    fun scenarioF_unresolvedSavings_knownSpentKept_aggregateIncomplete() {
        val r = FinancialReadModel.resolveDateFinancial(
            "OPTION_B",
            ledger(saved = 0.0, baselineSaved = 0.0, ambiguous = true, unresolved = UnresolvedComponents(saved = true, baselineSaved = true)),
            hasSourceActivity = true
        )
        assertTrue(r.available)
        assertEquals(6.0, r.canonical!!.spent)     // known spend preserved
        assertTrue(r.unresolved!!.saved)           // savings flagged unknown
        val totals = FinancialReadModel.aggregateFinancials(listOf(r))
        assertFalse(totals.complete)
        assertEquals(6.0, totals.spent)
        assertEquals(0.0, totals.saved)            // not counted as a confident saving
    }

    @Test
    fun aggregate_sumsAKnownCanonicalDateOnce() {
        val t = FinancialReadModel.aggregateFinancials(listOf(FinancialReadModel.resolveDateFinancial("OPTION_B", ledger(), true)))
        assertEquals(6.0, t.spent)
        assertEquals(4.0, t.saved)
        assertEquals(9.0, t.baselineSaved)
        assertEquals(6.0, t.smokingUnits)
        assertTrue(t.complete)
    }

    @Test
    fun aggregate_unavailableDate_blocksCompleteness_neverZero() {
        val t = FinancialReadModel.aggregateFinancials(listOf(FinancialReadModel.resolveDateFinancial("OPTION_B", null, true)))
        assertFalse(t.complete)
        assertEquals(1, t.unavailableDates)
        assertEquals(0.0, t.spent)
    }

    @Test
    fun presentFinancial_unknownIsNotAConfidentZero() {
        assertEquals("Unknown", FinancialReadModel.presentFinancial(0.0, unresolved = true) { it.toString() })
        assertEquals("0.0", FinancialReadModel.presentFinancial(0.0, unresolved = false) { it.toString() })
    }

    @Test
    fun foldedLedger_stillResolvesCanonical_andCarriesTheFoldFlag() {
        val r = FinancialReadModel.resolveDateFinancial("OPTION_B", ledger(folded = true), true)
        assertEquals(FinancialSource.OPTION_B_CANONICAL, r.source)
        assertEquals(4.0, r.canonical!!.saved)
    }
}
