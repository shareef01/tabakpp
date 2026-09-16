package com.tabakpp.app.domain

import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerSnapshot
import com.tabakpp.app.data.TrackerType
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertNotNull
import kotlin.test.fail

/**
 * Cross-platform domain contract fixtures (item 11) — see
 * shared-tests/README.md. The JS twin of this file is
 * webApp/src/utils/domainFixtures.contract.test.js; both run the exact same
 * shared-tests/domain-fixtures.json, so semantic drift between the two
 * platforms' hand-mirrored SmokingCalculator ports fails CI on both sides.
 *
 * JVM-only (androidUnitTest, not commonTest): reading the shared fixture
 * file from a relative path uses java.io.File, which is not available in a
 * portable commonTest source set. iOS is not a release target in this repo
 * (see README "Platforms"), so this does not lose coverage for a supported
 * platform.
 */
class DomainContractFixturesTest {

    private fun locateFixtureFile(): File {
        // Gradle's working directory for this module's tests is normally the
        // module root (shared/), but this walks upward defensively so the
        // test isn't fragile to which directory it's actually invoked from.
        var dir = File(".").absoluteFile
        repeat(6) {
            val candidate = File(dir, "shared-tests/domain-fixtures.json")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        fail("Could not locate shared-tests/domain-fixtures.json from ${File(".").absolutePath}")
    }

    private val fixtures: List<JsonObject> by lazy {
        val text = locateFixtureFile().readText()
        val root = Json.parseToJsonElement(text).jsonObject
        root["fixtures"]!!.jsonArray.map { it.jsonObject }
    }

    @Test
    fun runsAllFixtures() {
        var count = 0
        fixtures.forEach { fixture ->
            val case = fixture["case"]!!.jsonPrimitive.content
            val op = fixture["op"]!!.jsonPrimitive.content
            val input = fixture["input"]!!.jsonObject
            val expected = fixture["expected"]!!
            try {
                assertFixture(op, input, expected)
                count++
            } catch (e: AssertionError) {
                throw AssertionError("Fixture failed: [$op] $case -- ${e.message}", e)
            }
        }
        assertEquals(fixtures.size, count, "not every fixture ran")
    }

    private fun assertFixture(op: String, input: JsonObject, expected: JsonElement) {
        when (op) {
            "trackingDate" -> {
                val fields = input["localDateTime"]!!.jsonArray.map { it.jsonPrimitive.int }
                val (y, mo, d, h, mi, s) = fields
                // Local wall-clock fields, no timezone conversion — treated as
                // UTC here, matching the existing SmokingCalculatorTest.kt
                // convention (explicit TimeZone.UTC) — see shared-tests/README.md.
                val instant = LocalDateTime(y, mo, d, h, mi, s).toInstant(TimeZone.UTC)
                val dayStartHour = input["dayStartHour"]!!.jsonPrimitive.int
                val actual = SmokingCalculator.getTrackingDate(instant, dayStartHour, TimeZone.UTC)
                assertEquals(expected.jsonPrimitive.content, actual)
            }
            "limitStatus" -> {
                val actual = SmokingCalculator.getLimitStatus(
                    input["actual"]!!.jsonPrimitive.double,
                    input["target"]!!.jsonPrimitive.double
                )
                val exp = expected.jsonObject
                assertEquals(exp["status"]!!.jsonPrimitive.content, actual.status)
                assertEquals(exp["aboveTarget"]!!.jsonPrimitive.double, actual.aboveTarget)
                assertEquals(exp["belowTarget"]!!.jsonPrimitive.double, actual.belowTarget)
            }
            "reduction" -> {
                val baseline = input["baseline"].let { if (it == null || it is JsonNull) null else it.jsonPrimitive.int }
                val actual = SmokingCalculator.getReduction(input["actual"]!!.jsonPrimitive.double, baseline)
                if (expected is JsonNull) {
                    assertNull(actual)
                } else {
                    val exp = expected.jsonObject
                    assertEquals(exp["baseline"]!!.jsonPrimitive.double, actual!!.baseline)
                    assertEquals(exp["actual"]!!.jsonPrimitive.double, actual.actual)
                    assertEquals(exp["avoided"]!!.jsonPrimitive.double, actual.avoided)
                    val expPercent = exp["percent"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }
                    assertEquals(expPercent, actual.percent)
                }
            }
            "baselineSavings" -> {
                val counts = jsonObjectToDoubleMap(input["counts"]!!.jsonObject)
                val configs = input["configs"]!!.jsonArray.map { parseConfig(it.jsonObject) }
                val defaultPrice = input["defaultPrice"]!!.jsonPrimitive.double
                val actual = SmokingCalculator.calculateBaselineSavings(counts, configs, defaultPrice)
                val exp = expected.jsonObject
                assertEquals(exp["moneySaved"]!!.jsonPrimitive.double, actual.moneySaved)
                assertEquals(exp["unitsAvoided"]!!.jsonPrimitive.double, actual.unitsAvoided)
                assertEquals(exp["hasBaseline"]!!.jsonPrimitive.boolean, actual.hasBaseline)
            }
            "dayCredit" -> {
                val counts = jsonObjectToDoubleMap(input["counts"]!!.jsonObject)
                val snapshots = input["trackerSnapshots"]!!.jsonObject.mapValues { (_, v) -> parseSnapshot(v.jsonObject) }
                val defaultUnitPrice = input["defaultUnitPrice"]!!.jsonPrimitive.double
                val actual = SmokingCalculator.computeDayCredit(counts, snapshots, defaultUnitPrice)
                val exp = expected.jsonObject
                assertEquals(exp["wasted"]!!.jsonPrimitive.double, actual.wasted, 1e-9)
                assertEquals(exp["saved"]!!.jsonPrimitive.double, actual.saved, 1e-9)
                assertEquals(exp["smokingUnits"]!!.jsonPrimitive.double, actual.smokingUnits, 1e-9)
                assertEquals(exp["baselineSaved"]!!.jsonPrimitive.double, actual.baselineSaved, 1e-9)
            }
            "formatCurrency" -> {
                val actual = SmokingCalculator.formatCurrency(input["amount"]!!.jsonPrimitive.double)
                assertEquals(expected.jsonPrimitive.content, actual)
            }
            "backfillAllowed" -> {
                val actual = SmokingCalculator.isBackfillDateAllowed(
                    input["date"]!!.jsonPrimitive.content,
                    input["trackingDay"]!!.jsonPrimitive.contentOrNull
                )
                assertEquals(expected.jsonPrimitive.boolean, actual)
            }
            "monthlyInsights" -> {
                val logs = (input["logs"]?.jsonArray ?: emptyList()).map { parseLog(it.jsonObject) }
                val dayDocs = (input["dayDocs"]?.jsonArray ?: emptyList()).map { parseDayDoc(it.jsonObject) }
                val trackingDay = input["trackingDay"]!!.jsonPrimitive.content
                val activeCounts = input["activeCounts"]?.let { jsonObjectToDoubleMap(it.jsonObject) } ?: emptyMap()
                val defaultUnitPrice = input["defaultUnitPrice"]?.jsonPrimitive?.double ?: 0.5
                val monthsToInclude = input["monthsToInclude"]?.jsonPrimitive?.int ?: 6

                val (allMonths, currentMonthMtd) = SmokingCalculator.aggregateMonthlyData(
                    logs, dayDocs, trackingDay, activeCounts, defaultUnitPrice, monthsToInclude
                )
                val exp = expected.jsonObject
                // allMonths = [currentMtd] + completedMonths (current first), or just completedMonths
                val completedMonths = if (currentMonthMtd != null) allMonths.drop(1) else allMonths
                val firstCompleted = completedMonths.firstOrNull()
                val target = firstCompleted ?: currentMonthMtd

                exp["units"]?.jsonPrimitive?.let { assertEquals(it.int, target?.units ?: 0, "units") }
                exp["trackedDays"]?.jsonPrimitive?.let { assertEquals(it.int, target?.trackedDays ?: 0, "trackedDays") }
                exp["avgUnitsPerTrackedDay"]?.jsonPrimitive?.let { assertEquals(it.double, target?.avgUnitsPerTrackedDay ?: 0.0, 1e-9, "avgUnitsPerTrackedDay") }
                exp["spent"]?.jsonPrimitive?.let { assertEquals(it.double, target?.spent ?: 0.0, 1e-9, "spent") }
                exp["saved"]?.jsonPrimitive?.let { assertEquals(it.double, target?.saved ?: 0.0, 1e-9, "saved") }
                exp["baselineSaved"]?.jsonPrimitive?.let { assertEquals(it.double, target?.baselineSaved ?: 0.0, 1e-9, "baselineSaved") }
                exp["hasBaseline"]?.jsonPrimitive?.let { assertEquals(it.boolean, target?.hasBaseline ?: false, "hasBaseline") }
                exp["completedCount"]?.jsonPrimitive?.let { assertEquals(it.int, completedMonths.size, "completedCount") }
                exp["currentMonthMtd"]?.jsonPrimitive?.let { assertEquals(it.boolean, currentMonthMtd != null, "currentMonthMtd") }
                exp["currentMonthUnits"]?.let { if (it is JsonNull) assertNull(currentMonthMtd) else assertEquals(it.jsonPrimitive.int, currentMonthMtd?.units ?: 0, "currentMonthUnits") }
                // completedMonth = first completed month (not current MTD)
                exp["completedMonth"]?.let { if (it is JsonNull) assertNull(firstCompleted) else assertEquals(it.jsonPrimitive.content, firstCompleted?.month, "completedMonth") }
                exp["currentMonth"]?.let { if (it is JsonNull) assertNull(currentMonthMtd) else assertEquals(it.jsonPrimitive.content, currentMonthMtd?.month, "currentMonth") }
            }
            "trendComparison" -> {
                val actual = SmokingCalculator.calculateTrend(
                    input["currentAvg"]!!.jsonPrimitive.double,
                    input["previousAvg"]!!.jsonPrimitive.double
                )
                val exp = expected.jsonObject
                assertEquals(exp["direction"]!!.jsonPrimitive.content, actual.direction)
                assertEquals(exp["text"]!!.jsonPrimitive.content, actual.text)
                val expPct = exp["percentChange"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }
                val actualPct = actual.percentChange
                if (expPct == null) {
                    assertNull(actualPct)
                } else {
                    assertNotNull(actualPct, "percentChange should not be null for non-null expected")
                    assertEquals(expPct, actualPct, 1e-9)
                }
            }
            else -> fail("Unknown fixture op: $op")
        }
    }

    private fun jsonObjectToDoubleMap(obj: JsonObject): Map<String, Double> =
        obj.mapValues { (_, v) -> v.jsonPrimitive.double }

    private fun parseConfig(obj: JsonObject): TrackerConfig = TrackerConfig(
        id = obj["id"]!!.jsonPrimitive.content,
        name = obj["id"]!!.jsonPrimitive.content,
        limit = obj["limit"]!!.jsonPrimitive.int,
        order = 0,
        baseline = obj["baseline"]?.let { if (it is JsonNull) null else it.jsonPrimitive.int },
        pricePerUnit = obj["pricePerUnit"]?.jsonPrimitive?.double,
        isFinanciallyTracked = obj["isFinanciallyTracked"]?.jsonPrimitive?.boolean ?: true
    )

    private fun parseSnapshot(obj: JsonObject): TrackerSnapshot = TrackerSnapshot(
        target = obj["target"]!!.jsonPrimitive.int,
        baseline = obj["baseline"]?.let { if (it is JsonNull) null else it.jsonPrimitive.int },
        unitPrice = obj["unitPrice"]?.let { if (it is JsonNull) null else it.jsonPrimitive.double },
        type = obj["type"]?.jsonPrimitive?.content?.let { TrackerType.valueOf(it) } ?: TrackerType.CIGARETTE,
        isFinanciallyTracked = obj["isFinanciallyTracked"]?.jsonPrimitive?.boolean ?: true
    )

    private fun parseLog(obj: JsonObject): LogEntry {
        val origin = obj["origin"]?.jsonPrimitive?.content ?: "MANUAL_ENTRY"
        val isArchive = origin == "DAY_RESET" || (obj["id"]?.jsonPrimitive?.content?.endsWith("_DAY") ?: false)
        return LogEntry(
            id = obj["id"]?.jsonPrimitive?.content ?: "",
            logDate = obj["logDate"]!!.jsonPrimitive.content,
            counts = jsonObjectToDoubleMap(obj["counts"]!!.jsonObject),
            isArchive = isArchive,
            isManual = origin == "MANUAL_ENTRY",
            origin = origin,
            aggregateCredit = obj["aggregateCredit"]?.let { if (it is JsonNull) null else parseLifetimeAggregates(it.jsonObject) }
        )
    }

    private fun parseDayDoc(obj: JsonObject): DayDocument = DayDocument(
        date = obj["date"]!!.jsonPrimitive.content,
        counts = jsonObjectToDoubleMap(obj["counts"]!!.jsonObject),
        trackerSnapshots = obj["trackerSnapshots"]?.jsonObject?.mapValues { (_, v) -> parseSnapshot(v.jsonObject) } ?: emptyMap(),
        aggregateCredit = (obj["aggregateCredit"]?.let { if (it is JsonNull) null else parseLifetimeAggregates(it.jsonObject) }),
        status = obj["status"]?.jsonPrimitive?.content ?: "closed"
    )

    private fun parseLifetimeAggregates(obj: JsonObject): LifetimeAggregates = LifetimeAggregates(
        saved = obj["saved"]?.jsonPrimitive?.double ?: 0.0,
        wasted = obj["wasted"]?.jsonPrimitive?.double ?: 0.0,
        smokingUnits = obj["smokingUnits"]?.jsonPrimitive?.double ?: 0.0,
        baselineSaved = obj["baselineSaved"]?.jsonPrimitive?.double ?: 0.0
    )
}

private operator fun <T> List<T>.component6(): T = this[5]
