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
 *
 * Logs stamp an absolute [LifetimeAggregates] credit when written. Later
 * debit/restore/replace prefer that stamp so deleted or repriced trackers
 * cannot change what was already applied to lifetime totals.
 */
object RegistryMutations {

    /** Absolute contribution of a counts map under the given configs/price. */
    fun contribution(
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates {
        val fin = SmokingCalculator.calculateFinancials(counts, configs, unitPrice)
        val units = SmokingCalculator.sumSmokingUnits(counts, configs)
        return LifetimeAggregates(
            saved = fin.saved,
            wasted = fin.wasted,
            smokingUnits = units
        )
    }

    /**
     * Prefer a stamped credit from the log; fall back to live configs for
     * legacy docs written before aggregateCredit existed.
     */
    fun resolveContribution(
        stored: LifetimeAggregates?,
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates = stored ?: contribution(counts, configs, unitPrice)

    fun applyCredit(current: LifetimeAggregates, credit: LifetimeAggregates): LifetimeAggregates =
        LifetimeAggregates(
            saved = current.saved + credit.saved,
            wasted = current.wasted + credit.wasted,
            smokingUnits = current.smokingUnits + credit.smokingUnits
        )

    fun applyDebit(current: LifetimeAggregates, credit: LifetimeAggregates): LifetimeAggregates =
        LifetimeAggregates(
            saved = current.saved - credit.saved,
            wasted = current.wasted - credit.wasted,
            smokingUnits = current.smokingUnits - credit.smokingUnits
        )

    fun applyReplace(
        current: LifetimeAggregates,
        oldCredit: LifetimeAggregates,
        newCredit: LifetimeAggregates
    ): LifetimeAggregates =
        LifetimeAggregates(
            saved = current.saved - oldCredit.saved + newCredit.saved,
            wasted = current.wasted - oldCredit.wasted + newCredit.wasted,
            smokingUnits = current.smokingUnits - oldCredit.smokingUnits + newCredit.smokingUnits
        )

    /** Credit a single log's financials and smoking units (manual entry, restore). */
    fun credit(
        current: LifetimeAggregates,
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates = applyCredit(current, contribution(counts, configs, unitPrice))

    /** Debit a single log's financials and smoking units (delete). */
    fun debit(
        current: LifetimeAggregates,
        counts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates = applyDebit(current, contribution(counts, configs, unitPrice))

    /** Swap an old log's contribution for new counts (historical edit). */
    fun replace(
        current: LifetimeAggregates,
        oldCounts: Map<String, Double>,
        newCounts: Map<String, Double>,
        configs: List<TrackerConfig>,
        unitPrice: Double
    ): LifetimeAggregates = applyReplace(
        current,
        contribution(oldCounts, configs, unitPrice),
        contribution(newCounts, configs, unitPrice)
    )

    /**
     * Merge an incoming historical edit with the prior log counts, preserving
     * entries for trackers deleted since the log was written.
     */
    fun mergeHistoricalEditCounts(
        incoming: Map<String, Double>,
        previous: Map<String, Double>,
        liveConfigIds: Collection<String>
    ): Map<String, Double> {
        val live = liveConfigIds.toSet()
        val merged = incoming.toMutableMap()
        previous.forEach { (id, value) ->
            if (id !in live) merged[id] = value
        }
        return merged
    }

    data class DayEnd(
        val mergedCounts: Map<String, Double>,
        /** New lifetime totals after applying the archive delta. */
        val aggregates: LifetimeAggregates,
        /** Absolute contribution stamped on the archive log document. */
        val logCredit: LifetimeAggregates
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
        unitPrice: Double,
        existingCredit: LifetimeAggregates? = null
    ): DayEnd {
        val mergedCounts = SmokingCalculator.mergeCounts(existingCounts, activeCounts)
        val previousCredit = if (existingCounts == null) {
            LifetimeAggregates()
        } else {
            resolveContribution(existingCredit, existingCounts, configs, unitPrice)
        }
        val mergedCredit = contribution(mergedCounts, configs, unitPrice)

        return DayEnd(
            mergedCounts = mergedCounts,
            aggregates = applyReplace(current, previousCredit, mergedCredit),
            logCredit = mergedCredit
        )
    }
}
