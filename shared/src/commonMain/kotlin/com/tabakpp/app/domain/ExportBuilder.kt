package com.tabakpp.app.domain

import com.tabakpp.app.data.DailyFinancialRecord
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.UnresolvedComponents
import com.tabakpp.app.data.UserProfile
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Pure export builder — no Firestore dependency. Transforms raw snapshot data
 * into versioned JSON and CSV strings.
 *
 * Spec items covered:
 * - #6: versioned JSON contract
 * - #8: CSV as analysis format, not canonical
 * - #9: historical economics (stamped only, null when unavailable)
 * - #10: stable numeric representation (dot decimal, JSON numbers)
 * - #11: proper CSV escaping
 * - #12: formula-neutralization for user-controlled text
 * - #13: deterministic sorting
 * - #14: timestamp semantics (ISO-8601; dates stay YYYY-MM-DD, no TZ shift)
 */
object ExportBuilder {

    /**
     * Build the canonical JSON export string from raw snapshot data.
     * Preserves raw model structure — logs and days are NOT merged.
     */
    fun buildJson(
        profile: UserProfile?,
        profileMeta: ProfileMetaExport?,
        configs: List<TrackerConfig>,
        days: List<DayDocument>,
        logs: List<LogEntry>,
        generatedAt: Instant = Clock.System.now(),
        financialMode: String = "LEGACY",
        ledgers: List<DailyFinancialRecord> = emptyList(),
    ): String {
        val fin = buildDailyFinancials(financialMode, ledgers, days, logs)
        val snapshot = CompleteExportSnapshot(
            exportVersion = EXPORT_VERSION,
            generatedAt = toIso8601(generatedAt),
            profile = profile,
            profileMeta = profileMeta,
            configs = sortConfigsForExport(configs),
            days = sortDaysForExport(days),
            logs = sortLogsForExport(logs),
            financialMode = fin?.mode,
            dailyFinancials = fin?.rows,
            financialSummary = fin?.summary,
        )
        val json = Json {
            prettyPrint = true
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = false
        }
        return json.encodeToString(CompleteExportSnapshot.serializer(), snapshot)
    }

    /**
     * Build a CSV export of historical activity.
     *
     * One row per tracker per date. Provenance is preserved via the `source`
     * column. Historical economics use stamped snapshots when available;
     * otherwise unit_price/spent/saved are blank (null).
     */
    fun buildCsv(
        profile: UserProfile?,
        configs: List<TrackerConfig>,
        days: List<DayDocument>,
        logs: List<LogEntry>,
        defaultUnitPrice: Double = 0.5,
        financialMode: String = "LEGACY",
        ledgers: List<DailyFinancialRecord> = emptyList(),
    ): String {
        val rows = buildCsvRows(profile, configs, days, logs, defaultUnitPrice)
        val sb = StringBuilder()
        sb.append(CSV_HEADER)
        for (row in rows) {
            sb.append(csvLine(row))
        }
        // Backward-compatible companion section (web parity): the DATE-LEVEL
        // canonical money, once per date, never repeated per manual log.
        val fin = buildDailyFinancials(financialMode, ledgers, days, logs)
        if (fin != null) {
            sb.append("\n# daily_financial_summary\n")
            sb.append("date,source,spent,saved,baseline_saved,smoking_units,ambiguous,unresolved_components,conflicting,eligible\n")
            for (d in fin.rows) {
                sb.append(
                    listOf(
                        csvField(d.date), csvField(d.source), csvField(d.spent), csvField(d.saved),
                        csvField(d.baselineSaved), csvField(d.smokingUnits), csvField(d.ambiguous),
                        csvField(d.unresolvedComponents?.let { compactJson.encodeToString(UnresolvedComponents.serializer(), it) }),
                        csvField(d.conflicting.joinToString("|")), csvField(d.eligible),
                    ).joinToString(",") + "\n"
                )
            }
        }
        return sb.toString()
    }

    class DailyFinancials(val mode: String, val rows: List<DailyFinancialExportRow>, val summary: FinancialSummaryExport)

    /**
     * Date-level canonical projection for MIGRATING/OPTION_B (web
     * `buildDailyFinancials` parity); null for LEGACY. Each date's money comes
     * from its ledger via [FinancialReadModel], never recomputed per log.
     */
    fun buildDailyFinancials(
        financialMode: String,
        ledgers: List<DailyFinancialRecord>,
        days: List<DayDocument>,
        logs: List<LogEntry>,
    ): DailyFinancials? {
        val mode = financialMode.ifBlank { "LEGACY" }
        if (mode == "LEGACY") return null
        val byDate = ledgers.associateBy { it.date }
        val dayDates = days.map { it.date }.toSet()
        val logDates = logs.map { it.logDate }.toSet()
        val dates = (byDate.keys + dayDates + logDates).toSortedSet()
        val resolved = dates.map { date ->
            date to FinancialReadModel.resolveDateFinancial(mode, byDate[date], date in dayDates || date in logDates)
        }
        val rows = resolved.map { (date, r) ->
            val c = if (r.available) r.canonical else null
            DailyFinancialExportRow(
                date = date,
                source = webSourceName(r.source),
                spent = c?.spent, saved = c?.saved, baselineSaved = c?.baselineSaved, smokingUnits = c?.smokingUnits,
                unresolvedComponents = r.unresolved,
                ambiguous = r.ambiguous,
                conflicting = byDate[date]?.conflicting ?: emptyList(),
                eligible = r.eligible,
                available = r.available,
            )
        }
        val totals = FinancialReadModel.aggregateFinancials(resolved.map { it.second })
        val available = resolved.map { it.second }.filter { it.available && it.canonical != null }
        val known = KnownComponents(
            spent = available.none { it.unresolved?.spent == true },
            saved = available.none { it.unresolved?.saved == true },
            baselineSaved = available.none { it.unresolved?.baselineSaved == true },
            smokingUnits = available.none { it.unresolved?.smokingUnits == true },
        )
        val summary = FinancialSummaryExport(
            totals.spent, totals.saved, totals.baselineSaved, totals.smokingUnits,
            totals.complete, totals.unavailableDates, totals.unresolvedDates, known, mode,
        )
        return DailyFinancials(mode, rows, summary)
    }

    /** The web export's `FinancialSource` strings, so both platforms' exports read alike. */
    private fun webSourceName(source: FinancialSource): String = when (source) {
        FinancialSource.LEGACY -> "LEGACY_FINANCIAL_SOURCE"
        FinancialSource.OPTION_B_CANONICAL -> "OPTION_B_CANONICAL_SOURCE"
        FinancialSource.MISSING_CANONICAL_LEDGER -> "MISSING_CANONICAL_LEDGER"
        FinancialSource.NO_ACTIVITY -> "NO_FINANCIAL_ACTIVITY"
    }

    private val compactJson = Json { encodeDefaults = true }

    private fun buildCsvRows(
        profile: UserProfile?,
        configs: List<TrackerConfig>,
        days: List<DayDocument>,
        logs: List<LogEntry>,
        defaultUnitPrice: Double
    ): List<CsvActivityRow> {
        val configByName = configs.associateBy { it.id }
        val rows = mutableListOf<CsvActivityRow>()

        // Day documents: use stamped trackerSnapshots for historical economics (spec item 9)
        for (day in sortDaysForExport(days)) {
            for ((trackerId, count) in day.counts) {
                val snap = day.trackerSnapshots[trackerId]
                val config = configByName[trackerId]
                val countVal = count
                val (spent, saved) = computeDayEconomics(countVal, snap, config, defaultUnitPrice)
                rows.add(CsvActivityRow(
                    date = day.date,
                    source = "day",
                    trackerId = trackerId,
                    trackerName = snap?.name ?: config?.name,
                    count = countVal,
                    target = snap?.target,
                    baseline = snap?.baseline,
                    unitPrice = snap?.unitPrice,
                    spent = spent,
                    saved = saved,
                    status = day.status
                ))
            }
        }

        // Logs: manual entries and legacy archives
        for (log in sortLogsForExport(logs)) {
            val isArchive = log.origin == "DAY_RESET" || log.id.endsWith("_DAY")
            val source = if (log.origin == "LEGACY_RECOVERY") "legacy_recovery_unknown_money" else if (isArchive) "legacy_day_archive" else "manual_entry"
            for ((trackerId, count) in log.counts) {
                val config = configByName[trackerId]
                val countVal = count
                val snap = log.trackerSnapshots[trackerId]
                val (spent, saved) = if (log.economicStatus == "UNKNOWN") Pair(null, null) else computeDayEconomics(countVal, snap, config, defaultUnitPrice)
                rows.add(CsvActivityRow(
                    date = log.logDate,
                    source = source,
                    trackerId = trackerId,
                    trackerName = snap?.name ?: config?.name,
                    count = countVal,
                    target = snap?.target,
                    baseline = snap?.baseline,
                    unitPrice = if (log.economicStatus == "UNKNOWN") null else snap?.unitPrice,
                    spent = spent,
                    saved = saved,
                    status = null
                ))
            }
        }

        return rows
    }

    /**
     * Compute spent/saved from stamped snapshot values, or null when
     * historical economics are unavailable (spec item 9: do not use current
     * config to fill historical values).
     */
    private fun computeDayEconomics(
        count: Double,
        snap: com.tabakpp.app.data.TrackerSnapshot?,
        config: TrackerConfig?,
        defaultUnitPrice: Double
    ): Pair<Double?, Double?> {
        if (snap == null) {
            // No stamped snapshot — cannot compute historical economics without risk
            return Pair(null, null)
        }
        val price = snap.unitPrice ?: return Pair(null, null)
        val target = snap.target
        val actual = maxOf(0.0, count)
        val spent = if (snap.isFinanciallyTracked) SmokingCalculator.roundMoney(actual * price) else null
        val saved = if (snap.isFinanciallyTracked) SmokingCalculator.roundMoney(maxOf(0.0, target.toDouble() - actual) * price) else null
        return Pair(spent, saved)
    }

    private fun toIso8601(instant: Instant): String {
        val local = instant.toLocalDateTime(TimeZone.UTC)
        return local.toString()
    }

    private const val CSV_HEADER =
        "date,source,tracker_id,tracker_name,count,target,baseline,unit_price,spent,saved,status\n"

    /**
     * Proper CSV serializer (spec item 11):
     * - Fields containing comma, quote, CR, or LF are wrapped in double quotes
     * - Internal double-quotes are doubled
     * - Null fields become empty strings
     * - Formula-prefix neutralization for user-controlled text cells (spec item 12)
     */
    private fun csvLine(row: CsvActivityRow): String {
        return csvField(row.date) + "," +
            csvField(row.source) + "," +
            csvField(row.trackerId) + "," +
            csvField(row.trackerName) + "," +
            csvField(row.count) + "," +
            csvField(row.target) + "," +
            csvField(row.baseline) + "," +
            csvField(row.unitPrice) + "," +
            csvField(row.spent) + "," +
            csvField(row.saved) + "," +
            csvField(row.status) + "\n"
    }

    private fun csvField(value: Any?): String {
        if (value == null) return ""
        val s = value.toString()
        if (s.isEmpty()) return ""
        // Formula-injection neutralization (spec item 12): prefix with single quote
        // so spreadsheet software treats it as text, not a formula.
        // Only applies to text fields that originate from user input.
        // Numeric fields pass through unchanged.
        val neutralized = when {
            value is String -> neutralizeFormula(value)
            else -> s  // numeric/bool — no neutralization
        }
        // Standard CSV escaping (spec item 11)
        if (neutralized.contains(',') || neutralized.contains('"') ||
            neutralized.contains('\n') || neutralized.contains('\r')
        ) {
            val escaped = neutralized.replace("\"", "\"\"")
            return "\"$escaped\""
        }
        return neutralized
    }

    /**
     * Neutralize formula-injection vectors by prefixing with a single quote (spec item 12).
     * Does NOT modify the stored value — only the CSV representation.
     */
    private fun neutralizeFormula(s: String): String {
        if (s.isNotEmpty() && (s[0] in "= +@-\t\r\n\"")) {
            return "'" + s
        }
        return s
    }
}
