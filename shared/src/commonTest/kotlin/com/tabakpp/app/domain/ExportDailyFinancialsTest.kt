package com.tabakpp.app.domain

import com.tabakpp.app.data.DailyFinancialRecord
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.UnresolvedComponents
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * F-06 follow-up: the Android export carries the date-level canonical money
 * (`dailyFinancials`) for MIGRATING/OPTION_B accounts, matching the web export
 * (webApp/src/utils/ExportBuilder.test.js "canonical" cases).
 */
class ExportDailyFinancialsTest {
    private val date = "2026-10-01"
    private val configs = listOf(TrackerConfig(id = "cig", name = "Cigarettes", limit = 10, order = 0))
    private val days = listOf(DayDocument(date = date, counts = mapOf("cig" to 2.0), status = "closed"))
    private val logs = listOf(
        LogEntry(id = "m1", logDate = date, counts = mapOf("cig" to 2.0), origin = "MANUAL_ENTRY"),
        LogEntry(id = "m2", logDate = date, counts = mapOf("cig" to 2.0), origin = "MANUAL_ENTRY"),
    )
    private fun ledger(unresolved: UnresolvedComponents = UnresolvedComponents()) = DailyFinancialRecord(
        date = date,
        canonicalCredit = LifetimeAggregates(saved = 4.0, wasted = 6.0, smokingUnits = 6.0, baselineSaved = 9.0),
        unresolvedComponents = unresolved,
    )

    private fun json(mode: String, ledgers: List<DailyFinancialRecord>): JsonObject =
        Json.parseToJsonElement(
            ExportBuilder.buildJson(null, null, configs, days, logs, financialMode = mode, ledgers = ledgers)
        ).jsonObject

    @Test
    fun json_carriesTheDateLevelCreditOnce_preservingSourceRecords() {
        val doc = json("OPTION_B", listOf(ledger()))
        assertEquals(1, doc["days"]!!.jsonArray.size)
        assertEquals(2, doc["logs"]!!.jsonArray.size)
        assertEquals("OPTION_B", doc["financialMode"]!!.jsonPrimitive.content)
        val rows = doc["dailyFinancials"]!!.jsonArray
        assertEquals(1, rows.size)
        val r = rows[0].jsonObject
        assertEquals(date, r["date"]!!.jsonPrimitive.content)
        assertEquals("OPTION_B_CANONICAL_SOURCE", r["source"]!!.jsonPrimitive.content)
        assertEquals(6.0, r["spent"]!!.jsonPrimitive.double)
        assertEquals(4.0, r["saved"]!!.jsonPrimitive.double)
        assertEquals(9.0, r["baselineSaved"]!!.jsonPrimitive.double)
        assertEquals(6.0, r["smokingUnits"]!!.jsonPrimitive.double)
        val s = doc["financialSummary"]!!.jsonObject
        assertEquals(4.0, s["saved"]!!.jsonPrimitive.double)
        assertTrue(s["complete"]!!.jsonPrimitive.boolean)
        assertEquals("OPTION_B", s["mode"]!!.jsonPrimitive.content)
    }

    @Test
    fun legacy_addsNoCanonicalSection() {
        val doc = json("LEGACY", emptyList())
        assertNull(doc["financialMode"])
        assertNull(doc["dailyFinancials"])
        assertNull(doc["financialSummary"])
        val csv = ExportBuilder.buildCsv(null, configs, days, logs, 1.0, financialMode = "LEGACY")
        assertFalse(csv.contains("daily_financial_summary"))
    }

    @Test
    fun missingLedger_isUnavailable_notZero() {
        val doc = json("OPTION_B", emptyList())
        val r = doc["dailyFinancials"]!!.jsonArray[0].jsonObject
        assertEquals("MISSING_CANONICAL_LEDGER", r["source"]!!.jsonPrimitive.content)
        assertFalse(r["available"]!!.jsonPrimitive.boolean)
        // explicitNulls = false: an unavailable amount is absent, never 0.
        assertTrue(r["saved"] == null || r["saved"] is JsonNull)
        assertFalse(doc["financialSummary"]!!.jsonObject["complete"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun unresolvedComponent_isMarkedUnknownInTheSummary() {
        val doc = json("OPTION_B", listOf(ledger(UnresolvedComponents(saved = true))))
        val r = doc["dailyFinancials"]!!.jsonArray[0].jsonObject
        assertTrue(r["unresolvedComponents"]!!.jsonObject["saved"]!!.jsonPrimitive.boolean)
        val s = doc["financialSummary"]!!.jsonObject
        assertFalse(s["complete"]!!.jsonPrimitive.boolean)
        assertFalse(s["known"]!!.jsonObject["saved"]!!.jsonPrimitive.boolean)
        assertTrue(s["known"]!!.jsonObject["spent"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun csv_addsACompanionSection_withTheCreditOncePerDate() {
        val csv = ExportBuilder.buildCsv(null, configs, days, logs, 1.0, financialMode = "OPTION_B", ledgers = listOf(ledger()))
        val lines = csv.split("\n")
        val i = lines.indexOf("# daily_financial_summary")
        assertTrue(i > 0)
        assertEquals(
            "date,source,spent,saved,baseline_saved,smoking_units,ambiguous,unresolved_components,conflicting,eligible",
            lines[i + 1],
        )
        val row = lines[i + 2]
        assertTrue(row.startsWith("$date,OPTION_B_CANONICAL_SOURCE,6.0,4.0,9.0,6.0"), row)
        assertEquals(1, lines.count { it == row })
        assertTrue(lines.none { it.startsWith(date) && it.contains("OPTION_B_CANONICAL_SOURCE") && it != row })
    }

    @Test
    fun migratingDateWithoutLedger_staysLegacyOwned() {
        val rows = json("MIGRATING", emptyList())["dailyFinancials"] as JsonArray
        assertEquals("LEGACY_FINANCIAL_SOURCE", rows[0].jsonObject["source"]!!.jsonPrimitive.content)
    }
}
