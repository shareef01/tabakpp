package com.tabakpp.app.domain

import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.TrackerConfig

/**
 * Pure lifetime-aggregate arithmetic for the transactional write paths in
 * [com.tabakpp.app.data.FirebaseRegistryRepository]. Extracted from the
 * Firestore I/O so the drift-prevention math stays unit-testable and in
 * lock-step with the web client (webApp/src/services/registryService.js).
 *
 * Every write that touches money or archives runs inside a Firestore
 * transaction; these helpers compute the resulting aggregates so counters,
 * day archives, and lifetime totals can never diverge.
 */
object RegistryMutations {

    /** Credit a single log's financials and smoking units (manual entry, restore). */
    fun credit(
        current: LifetimeAggregates,
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates {
        val fin = SmokingCalculator.calculateFinancials(counts, configs, unitPrice)
        val units = SmokingCalculator.sumSmokingUnits(counts, configs)
        return LifetimeAggregates(
            saved = current.saved + fin.saved,
            wasted = current.wasted + fin.wasted,
            smokingUnits = current.smokingUnits + units
        )
    }

    /** Debit a single log's financials and smoking units (delete). */
    fun debit(
        current: LifetimeAggregates,
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates {
        val fin = SmokingCalculator.calculateFinancials(counts, configs, unitPrice)
        val units = SmokingCalculator.sumSmokingUnits(counts, configs)
        return LifetimeAggregates(
            saved = current.saved - fin.saved,
            wasted = current.wasted - fin.wasted,
            smokingUnits = current.smokingUnits - units
        )
    }

    /** Swap an old log's contribution for new counts (historical edit). */
    fun replace(
        current: LifetimeAggregates,
        oldCounts: Map<String, Double>,
        newCounts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates {
        val oldFin = SmokingCalculator.calculateFinancials(oldCounts, configs, unitPrice)
        val newFin = SmokingCalculator.calculateFinancials(newCounts, configs, unitPrice)
        val oldUnits = SmokingCalculator.sumSmokingUnits(oldCounts, configs)
        val newUnits = SmokingCalculator.sumSmokingUnits(newCounts, configs)
        return LifetimeAggregates(
            saved = current.saved - oldFin.saved + newFin.saved,
            wasted = current.wasted - oldFin.wasted + newFin.wasted,
            smokingUnits = current.smokingUnits - oldUnits + newUnits
        )
    }

    data class DayEnd(
        val mergedCounts: Map<String, Double>,
        val aggregates: LifetimeAggregates
    )

    /**
     * End-of-day archive. Merges the open session into any existing same-date
     * archive and credits aggregates by the delta over the previous archive
     * only, so a second end-day on the same tracking date can never
     * double-count what was already credited.
     */
    fun endDay(
        current: LifetimeAggregates,
        existingCounts: Map<String, Double>?,
        activeCounts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): DayEnd {
        val mergedCounts = SmokingCalculator.mergeCounts(existingCounts, activeCounts)

        val previousFin = existingCounts
            ?.let { SmokingCalculator.calculateFinancials(it, configs, unitPrice) }
            ?: SmokingCalculator.FinancialResult(0.0, 0.0)
        val mergedFin = SmokingCalculator.calculateFinancials(mergedCounts, configs, unitPrice)
        val previousUnits = existingCounts?.let { SmokingCalculator.sumSmokingUnits(it, configs) } ?: 0.0
        val mergedUnits = SmokingCalculator.sumSmokingUnits(mergedCounts, configs)

        return DayEnd(
            mergedCounts = mergedCounts,
            aggregates = LifetimeAggregates(
                saved = current.saved + mergedFin.saved - previousFin.saved,
                wasted = current.wasted + mergedFin.wasted - previousFin.wasted,
                smokingUnits = current.smokingUnits + mergedUnits - previousUnits
            )
        )
    }
}
