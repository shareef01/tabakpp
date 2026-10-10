package com.tabakpp.app.domain

import com.tabakpp.app.data.DailyFinancialRecord
import com.tabakpp.app.data.UnresolvedComponents
import kotlin.math.abs

/** Which source OWNS a date's financial result (mirrors the Web read contract). */
enum class FinancialSource { LEGACY, OPTION_B_CANONICAL, MISSING_CANONICAL_LEDGER, NO_ACTIVITY }

data class CanonicalCredit(
    val spent: Double,
    val saved: Double,
    val baselineSaved: Double,
    val smokingUnits: Double
)

/**
 * Resolution of ONE date's authoritative financial state.
 * `available=false` means UNAVAILABLE (never a fabricated zero, never a legacy
 * fallback). `unresolved` marks components whose 0 is not a verified zero.
 */
data class DateFinancial(
    val source: FinancialSource,
    val available: Boolean,
    val canonical: CanonicalCredit?,
    val unresolved: UnresolvedComponents?,
    val ambiguous: Boolean,
    val eligible: Boolean
)

data class FinancialTotals(
    val spent: Double,
    val saved: Double,
    val baselineSaved: Double,
    val smokingUnits: Double,
    val complete: Boolean,
    val unavailableDates: Int,
    val unresolvedDates: Int
)

/**
 * Mode-aware financial read model (Kotlin parity with
 * `webApp/src/services/financialReadModel.js`). It CONSUMES persisted
 * server-calculated canonical values — it never recomputes Option-B credit.
 */
object FinancialReadModel {

    fun resolveDateFinancial(
        financialMode: String,
        ledger: DailyFinancialRecord?,
        hasSourceActivity: Boolean
    ): DateFinancial {
        val mode = financialMode.ifBlank { "LEGACY" }
        if (mode == "LEGACY") {
            return DateFinancial(FinancialSource.LEGACY, available = false, canonical = null, unresolved = null, ambiguous = false, eligible = true)
        }
        if (ledger != null) {
            val u = ledger.unresolvedComponents
            return DateFinancial(
                source = FinancialSource.OPTION_B_CANONICAL,
                available = true,
                canonical = CanonicalCredit(
                    spent = ledger.canonicalCredit.wasted,
                    saved = ledger.canonicalCredit.saved,
                    baselineSaved = ledger.canonicalCredit.baselineSaved,
                    smokingUnits = ledger.canonicalCredit.smokingUnits
                ),
                unresolved = u,
                ambiguous = ledger.ambiguous || u.anyUnresolved,
                eligible = ledger.eligible
            )
        }
        // No ledger: a MIGRATING date without one is still legacy-owned.
        if (mode == "MIGRATING") {
            return DateFinancial(FinancialSource.LEGACY, available = false, canonical = null, unresolved = null, ambiguous = false, eligible = true)
        }
        return if (hasSourceActivity) {
            DateFinancial(FinancialSource.MISSING_CANONICAL_LEDGER, available = false, canonical = null, unresolved = null, ambiguous = true, eligible = true)
        } else {
            DateFinancial(FinancialSource.NO_ACTIVITY, available = true, canonical = CanonicalCredit(0.0, 0.0, 0.0, 0.0), unresolved = null, ambiguous = false, eligible = false)
        }
    }

    /** Completeness-aware aggregation — unknown components are excluded, not summed as zero. */
    fun aggregateFinancials(resolutions: List<DateFinancial>): FinancialTotals {
        var spent = 0.0; var saved = 0.0; var baselineSaved = 0.0; var smokingUnits = 0.0
        var complete = true; var unavailable = 0; var unresolvedDates = 0
        for (r in resolutions) {
            if (!r.available || r.canonical == null) { complete = false; unavailable += 1; continue }
            val u = r.unresolved ?: UnresolvedComponents()
            if (u.spent) { complete = false } else spent += r.canonical.spent
            if (u.saved) { complete = false } else saved += r.canonical.saved
            if (u.baselineSaved) { complete = false } else baselineSaved += r.canonical.baselineSaved
            if (u.smokingUnits) { complete = false } else smokingUnits += r.canonical.smokingUnits
            if (u.anyUnresolved) unresolvedDates += 1
        }
        return FinancialTotals(spent, saved, baselineSaved, smokingUnits, complete, unavailable, unresolvedDates)
    }

    /** A known value formats normally; an unresolved one is Unknown (never a confident 0). */
    fun presentFinancial(value: Double, unresolved: Boolean, format: (Double) -> String): String =
        if (unresolved) "Unknown" else format(value)

    fun nearlyEqual(a: Double, b: Double, eps: Double = 1e-9): Boolean = abs(a - b) < eps
}
