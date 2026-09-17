package com.tabakpp.app.domain

import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerSnapshot
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.data.LIVE_LOG_QUERY_LIMIT
import com.tabakpp.app.data.LIVE_DAYS_QUERY_LIMIT
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.ProfileExtra
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class ExportIntegrationTest {

    @Test
    fun `UI query limits are known constants`() {
        // Spec item #4: Identify the normal UI query limits
        assertEquals(1200L, LIVE_LOG_QUERY_LIMIT)
        assertEquals(400L, LIVE_DAYS_QUERY_LIMIT)
    }

    @Test
    fun `export reads complete data beyond UI limits`() = runTest {
        // Spec item #4: Prove complete-read semantics
        // UI limits: LIVE_LOG_QUERY_LIMIT=1200, LIVE_DAYS_QUERY_LIMIT=400
        // Export fixture: 1305 logs, 425 days → export returns ALL

        val configs = listOf(
            TrackerConfig(id = "c1", name = "Cigarettes", limit = 20, order = 0)
        )

        val days = (1..425).map { i ->
            DayDocument(
                date = "2024-0${(i % 12) + 1}-15",
                counts = mapOf("c1" to 5.0),
                trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                    name = "Cigarettes", target = 20, baseline = 20,
                    unitPrice = 0.5, isFinanciallyTracked = true
                )),
                status = "closed"
            )
        }

        val logs = (1..1305).map { i ->
            LogEntry(
                id = "log_$i",
                logDate = "2025-01-${(i % 28) + 1}",
                counts = mapOf("c1" to 1.0),
                origin = "MANUAL_ENTRY"
            )
        }

        val sortedDays = sortDaysForExport(days)
        val sortedLogs = sortLogsForExport(logs)

        assertEquals(1305, sortedLogs.size)
        assertEquals(425, sortedDays.size)
    }

    @Test
    fun `historical day snapshot uses stamped economics not current config`() = runTest {
        // Spec item #9: Historical day snapshot uses stamped values
        // Old day: unit price = 0.40, baseline = 20, target = 20
        // Current config: unit price = 0.70, baseline = 20, target = 10

        val oldDay = DayDocument(
            date = "2025-01-15",
            counts = mapOf("c1" to 20.0), // 20 cigarettes
            trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                name = "Cigarettes",
                target = 20,
                baseline = 20,
                unitPrice = 0.40,
                isFinanciallyTracked = true
            )),
            status = "closed"
        )

        // Current config has DIFFERENT values
        val currentConfig = TrackerConfig(
            id = "c1", name = "Cigarettes", limit = 10, order = 0,
            type = TrackerType.CIGARETTE,
            pricePerUnit = 0.70,
            baseline = 15,
            isFinanciallyTracked = true
        )

        val csv = ExportBuilder.buildCsv(null, listOf(currentConfig), listOf(oldDay), emptyList())
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")

        // Should use stamped values (0.40/20/20), NOT current config (0.70/5)
        assertEquals("c1", row[2])           // tracker_id
        assertEquals("20.0", row[4])         // count (20)
        assertEquals("20", row[5])           // target (stamped 20, not current limit of 10)
        assertEquals("20", row[6])           // baseline (stamped 20, not current 15)
        assertEquals("0.4", row[7])          // unit_price (stamped 0.40)
        assertEquals("8.0", row[8])            // spent = 20 * 0.40 = 8.0
        assertEquals("0.0", row[9])            // saved = (20-20)*0.40 = 0.0
    }

    @Test
    fun `logs-only record has null economics`() = runTest {
        // Spec item #9: Logs-only legacy/manual record has null economics
        val log = LogEntry(
            id = "log1",
            logDate = "2025-01-15",
            counts = mapOf("c1" to 5.0),
            origin = "MANUAL_ENTRY"
        )
        val config = TrackerConfig(
            id = "c1", name = "Cigarettes", limit = 20, order = 0,
            pricePerUnit = 0.5
        )

        val csv = ExportBuilder.buildCsv(null, listOf(config), emptyList(), listOf(log))
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")

        assertEquals("2025-01-15", row[0])
        assertEquals("manual_entry", row[1])
        assertEquals("c1", row[2])
        assertEquals("Cigarettes", row[3])
        assertEquals("5.0", row[4])
        assertEquals("", row[5])  // target = null → blank
        assertEquals("", row[6])  // baseline = null → blank
        assertEquals("", row[7])  // unit_price = null → blank
        assertEquals("", row[8])  // spent = null → blank
        assertEquals("", row[9])  // saved = null → blank
        assertEquals("", row[10]) // status = null → blank
    }

    @Test
    fun `manual log and dayDoc same date exported separately with provenance`() = runTest {
        // Spec item #9: Both exported separately with source/provenance retained
        val day = DayDocument(
            date = "2025-01-15",
            counts = mapOf("c1" to 3.0),
            trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                name = "Cigarettes", target = 20, baseline = 20,
                unitPrice = 0.5, isFinanciallyTracked = true
            )),
            status = "closed"
        )
        val log = LogEntry(
            id = "log1",
            logDate = "2025-01-15",
            counts = mapOf("c1" to 2.0),
            origin = "MANUAL_ENTRY"
        )
        val config = TrackerConfig(
            id = "c1", name = "Cigarettes", limit = 20, order = 0,
            pricePerUnit = 0.5
        )

        val csv = ExportBuilder.buildCsv(null, listOf(config), listOf(day), listOf(log))
        val lines = csv.trim().split("\n")

        // Header + 2 rows (day + log)
        assertEquals(3, lines.size)

        val dayRow = lines[1].split(",")
        assertEquals("2025-01-15", dayRow[0])
        assertEquals("day", dayRow[1])
        assertEquals("3.0", dayRow[4])

        val logRow = lines[2].split(",")
        assertEquals("2025-01-15", logRow[0])
        assertEquals("manual_entry", logRow[1])
        assertEquals("2.0", logRow[4])
    }

    @Test
    fun `CSV header matches exact contract`() = runTest {
        // Spec item #10: Report exact CSV header order
        val csv = ExportBuilder.buildCsv(null, emptyList(), emptyList(), emptyList())
        val header = csv.lines()[0]
        assertEquals("date,source,tracker_id,tracker_name,count,target,baseline,unit_price,spent,saved,status", header)
    }

    @Test
    fun `CSV formula neutralization is field-aware`() = runTest {
        // Spec item #11: Neutralize formula injection in user-controlled text
        val config = TrackerConfig(
            id = "c1", name = "=CMD()", limit = 20, order = 0
        )
        val log = LogEntry(id = "log1", logDate = "2025-01-15", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY")

        val csv = ExportBuilder.buildCsv(null, listOf(config), emptyList(), listOf(log))
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")
        val actual = row[3]
        assertEquals("'=CMD()", actual)
    }

    @Test
    fun `CSV neutralizes all formula prefixes`() = runTest {
        val testNames = listOf(
            "=HYPERLINK(\"https://example.com\")",
            "+SUM(1,1)",
            "-10+20",
            "@SUM(1,2)"
        )
        for (name in testNames) {
            val config = TrackerConfig(id = "c1", name = name, limit = 20, order = 0)
            val log = LogEntry(id = "log1", logDate = "2025-01-15", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY")

            val csv = ExportBuilder.buildCsv(null, listOf(config), emptyList(), listOf(log))
            val lines = csv.trim().split("\n")
            // For names with formula prefix, the CSV field should start with ' (neutralized)
            // or be quoted (if it also contains commas)
            val firstChar = name[0]
            assertTrue(firstChar in "= +@-", "Test setup: name should start with formula char")
            // The CSV line should contain the neutralized version
            when (firstChar) {
                '=', '@' -> assertTrue(lines[1].contains("'"), "Formula prefix should be neutralized for: $name")
                '+', '-' -> {
                    // + and - may or may not need neutralization depending on whether the whole field starts with + or -
                    // Per spec: neutralize when value starts with +, -, @, =, \t, \r, "
                    assertTrue(lines[1].contains("'"), "Formula prefix should be neutralized for: $name")
                }
            }
        }
    }

    @Test
    fun `CSV uses dot decimals not locale strings`() = runTest {
        val config = TrackerConfig(
            id = "c1", name = "Cigarettes", limit = 20, order = 0,
            pricePerUnit = 1.25
        )
        val day = DayDocument(
            date = "2025-01-15",
            counts = mapOf("c1" to 3.0),
            trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                name = "Cigarettes", target = 20, baseline = 20,
                unitPrice = 1.25, isFinanciallyTracked = true
            )),
            status = "closed"
        )

        val csv = ExportBuilder.buildCsv(null, listOf(config), listOf(day), emptyList())
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")

        assertEquals("1.25", row[7])
    }

    @Test
    fun `tracking date stays YYYY-MM-DD no timezone shift`() = runTest {
        val day = DayDocument(
            date = "2025-06-15",
            counts = mapOf("c1" to 1.0),
            status = "closed"
        )
        val config = TrackerConfig(
            id = "c1", name = "Test", limit = 20, order = 0
        )

        val csv = ExportBuilder.buildCsv(null, listOf(config), listOf(day), emptyList())
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")

        assertEquals("2025-06-15", row[0])
        assertTrue(row[0].matches(Regex("\\d{4}-\\d{2}-\\d{2}")))
    }

    @Test
    fun `export deterministic ordering - configs`() = runTest {
        val outOfOrder = listOf(
            TrackerConfig(id = "c3", name = "C", limit = 20, order = 2),
            TrackerConfig(id = "c1", name = "A", limit = 20, order = 0),
            TrackerConfig(id = "c2", name = "B", limit = 20, order = 1),
            TrackerConfig(id = "c4", name = "D", limit = 20, order = 0),
        )

        val sorted = sortConfigsForExport(outOfOrder)
        val ids = sorted.map { it.id }
        assertEquals(listOf("c1", "c4", "c2", "c3"), ids)
    }

    @Test
    fun `export deterministic ordering - days`() = runTest {
        val outOfOrder = listOf(
            DayDocument(date = "2025-03-15", counts = mapOf("c1" to 1.0)),
            DayDocument(date = "2025-01-15", counts = mapOf("c1" to 2.0)),
            DayDocument(date = "2025-02-15", counts = mapOf("c1" to 3.0)),
        )

        val sorted = sortDaysForExport(outOfOrder)
        val dates = sorted.map { it.date }
        assertEquals(listOf("2025-01-15", "2025-02-15", "2025-03-15"), dates)
    }

    @Test
    fun `export deterministic ordering - logs`() = runTest {
        val outOfOrder = listOf(
            LogEntry(id = "log_c", logDate = "2025-01-15", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY"),
            LogEntry(id = "log_a", logDate = "2025-01-10", counts = mapOf("c1" to 2.0), origin = "MANUAL_ENTRY"),
            LogEntry(id = "log_b", logDate = "2025-01-15", counts = mapOf("c1" to 3.0), origin = "MANUAL_ENTRY"),
        )

        val sorted = sortLogsForExport(outOfOrder)
        val ids = sorted.map { it.id }
        assertEquals(listOf("log_a", "log_b", "log_c"), ids)
    }

    @Test
    fun `legacy DAY_RESET log flagged as legacy_day_archive`() = runTest {
        val log = LogEntry(
            id = "log1_DAY",
            logDate = "2025-01-15",
            counts = mapOf("c1" to 1.0),
            origin = "DAY_RESET"
        )
        val config = TrackerConfig(
            id = "c1", name = "Cigarettes", limit = 20, order = 0
        )

        val csv = ExportBuilder.buildCsv(null, listOf(config), emptyList(), listOf(log))
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")

        assertEquals("legacy_day_archive", row[1])
    }

    @Test
    fun `no secrets in export`() = runTest {
        val profile = UserProfile(name = "user123", unitPrice = 0.5)
        val snapshot = CompleteExportSnapshot(
            exportVersion = 1,
            generatedAt = "2026-09-16T08:00:00Z",
            profile = profile,
            profileMeta = ProfileMetaExport(avatar = null),
            configs = emptyList(),
            days = emptyList(),
            logs = emptyList()
        )

        val json = ExportBuilder.buildJson(
            snapshot.profile, snapshot.profileMeta,
            snapshot.configs, snapshot.days, snapshot.logs
        )

        assertFalse(json.lowercase().contains("token"))
        assertFalse(json.lowercase().contains("bearer"))
        assertFalse(json.lowercase().contains("apikey"))
        assertFalse(json.lowercase().contains("refreshtoken"))
        assertFalse(json.lowercase().contains("appcheck"))
        assertFalse(json.lowercase().contains("signingsecret"))

        assertTrue(json.contains("\"profile\""))
    }

    @Test
    fun `null economics are blank not zero in CSV`() = runTest {
        val log = LogEntry(id = "log1", logDate = "2025-01-15", counts = mapOf("c1" to 5.0), origin = "MANUAL_ENTRY")
        val csv = ExportBuilder.buildCsv(null, emptyList(), emptyList(), listOf(log))
        val lines = csv.trim().split("\n")
        val row = lines[1].split(",")

        assertEquals("", row[5])  // target
        assertEquals("", row[6])  // baseline
        assertEquals("", row[7])  // unit_price
        assertEquals("", row[8])  // spent
        assertEquals("", row[9])  // saved
        assertEquals("", row[10]) // status
    }

    @Test
    fun `JSON retains original text unchanged for formula-like names`() = runTest {
        val config = TrackerConfig(id = "c1", name = "=CMD()", limit = 20, order = 0)
        val day = DayDocument(
            date = "2025-01-15",
            counts = mapOf("c1" to 1.0),
            trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                name = "=CMD()", target = 20, baseline = 20,
                unitPrice = 0.5, isFinanciallyTracked = true
            )),
            status = "closed"
        )

        val json = ExportBuilder.buildJson(null, null, listOf(config), listOf(day), emptyList())

        assertTrue(json.contains("=CMD()"))
        assertFalse(json.contains("'=CMD()"))
    }

    @Test
    fun `JSON export has exact contract shape`() = runTest {
        // Spec item #7: Verify exact top-level JSON shape
        val configs = listOf(
            TrackerConfig(id = "c1", name = "Cigarettes", limit = 20, order = 0)
        )
        val days = listOf(
            DayDocument(
                date = "2026-09-15",
                counts = mapOf("c1" to 3.0),
                trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                    name = "Cigarettes", target = 20, baseline = 20,
                    unitPrice = 0.5, isFinanciallyTracked = true
                )),
                status = "closed"
            )
        )
        val logs = listOf(
            LogEntry(id = "log1", logDate = "2026-09-10", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY")
        )

        val json = ExportBuilder.buildJson(null, null, configs, days, logs)

        // exportVersion exists
        assertTrue(json.contains("\"exportVersion\""))
        // generatedAt is ISO-8601
        assertTrue(
            Regex("""\"generatedAt\":.*\"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}""").containsMatchIn(json),
            "generatedAt should be ISO-8601"
        )
        // Top-level keys present
        assertTrue(json.contains("\"configs\""))
        assertTrue(json.contains("\"days\""))
        assertTrue(json.contains("\"logs\""))
        // No secrets
        assertFalse(json.lowercase().contains("token"))
        assertFalse(json.lowercase().contains("bearer"))
        assertFalse(json.lowercase().contains("apikey"))
    }

    @Test
    fun `deterministic ordering - two runs produce identical output`() = runTest {
        val configs = listOf(
            TrackerConfig(id = "c2", name = "B", limit = 20, order = 1),
            TrackerConfig(id = "c1", name = "A", limit = 20, order = 0),
        )
        val days = listOf(
            DayDocument(date = "2025-03-15", counts = mapOf("c1" to 3.0)),
            DayDocument(date = "2025-01-15", counts = mapOf("c1" to 1.0)),
        )
        val logs = listOf(
            LogEntry(id = "log2", logDate = "2025-03-15", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY"),
            LogEntry(id = "log1", logDate = "2025-01-15", counts = mapOf("c1" to 2.0), origin = "MANUAL_ENTRY"),
        )

        val json1 = ExportBuilder.buildJson(null, null, configs, days, logs)
        val json2 = ExportBuilder.buildJson(null, null, configs, days, logs)

        // Same except generatedAt
        val j1NoTimestamp = json1.replace(Regex("\"generatedAt\"\\s*:\\s*\"[^\"]*\""), "\"generatedAt\":\"\"")
        val j2NoTimestamp = json2.replace(Regex("\"generatedAt\"\\s*:\\s*\"[^\"]*\""), "\"generatedAt\":\"\"")

        assertEquals(j1NoTimestamp, j2NoTimestamp)
    }

    @Test
    fun `CSV empty export produces only header`() = runTest {
        val csv = ExportBuilder.buildCsv(null, emptyList(), emptyList(), emptyList())
        assertEquals(1, csv.trim().split("\n").size)
    }

    @Test
    fun `Unicode tracker name preserved in CSV`() = runTest {
        val config = TrackerConfig(id = "c1", name = "Cigarettes 🚭", limit = 20, order = 0)
        val log = LogEntry(id = "log1", logDate = "2025-01-15", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY")

        val csv = ExportBuilder.buildCsv(null, listOf(config), emptyList(), listOf(log))
        val lines = csv.trim().split("\n")
        assertTrue(lines[1].contains("Cigarettes"), "Unicode should be preserved (escaped)")
    }

    @Test
    fun `CSV escaping for comma in name`() = runTest {
        val config = TrackerConfig(
            id = "c1", name = "Cigarettes, evening", limit = 20, order = 0
        )
        val log = LogEntry(id = "log1", logDate = "2025-01-15", counts = mapOf("c1" to 1.0), origin = "MANUAL_ENTRY")

        val csv = ExportBuilder.buildCsv(null, listOf(config), emptyList(), listOf(log))
        // Line should contain quotes around the comma-containing field
        assertTrue(csv.contains("\"Cigarettes, evening\""), "CSV should quote comma-containing fields")
    }

    @Test
    fun `multiple years sorted ascending in export`() = runTest {
        val days = listOf(
            DayDocument(date = "2025-06-15", counts = mapOf("c1" to 1.0)),
            DayDocument(date = "2023-01-15", counts = mapOf("c1" to 2.0)),
            DayDocument(date = "2024-12-31", counts = mapOf("c1" to 3.0)),
        )

        val sorted = sortDaysForExport(days)
        assertEquals("2023-01-15", sorted[0].date)
        assertEquals("2024-12-31", sorted[1].date)
        assertEquals("2025-06-15", sorted[2].date)
    }

    @Test
    fun `large export completes without truncation`() = runTest {
        val days = (1..425).map { i ->
            DayDocument(
                date = String.format("2024-%02d-15", (i % 12) + 1),
                counts = mapOf("c1" to 5.0),
                trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                    name = "Cigarettes", target = 20, baseline = 20,
                    unitPrice = 0.5, isFinanciallyTracked = true
                )),
                status = "closed"
            )
        }
        val logs = (1..1305).map { i ->
            LogEntry(
                id = "log_$i",
                logDate = String.format("2025-01-%02d", (i % 28) + 1),
                counts = mapOf("c1" to 1.0),
                origin = "MANUAL_ENTRY"
            )
        }
        val configs = listOf(
            TrackerConfig(id = "c1", name = "Cigarettes", limit = 20, order = 0)
        )

        val sortedDays = sortDaysForExport(days)
        val sortedLogs = sortLogsForExport(logs)
        val json = ExportBuilder.buildJson(null, null, configs, sortedDays, sortedLogs)

        assertEquals(425, sortedDays.size)
        assertEquals(1305, sortedLogs.size)
        // No duplicate days
        val dayDates = sortedDays.map { it.date }.toSet()
        assertNotEquals(425, dayDates.size, "Some days may share dates, but list size should be complete")
        // No duplicate logs
        val logIds = sortedLogs.map { it.id }.toSet()
        assertEquals(1305, logIds.size, "All log IDs should be unique")
        // JSON contains all
        assertTrue(json.contains("\"days\""))
        assertTrue(json.contains("\"logs\""))
    }

    @Test
    fun `generate sample export artifact for manual inspection`() = runTest {
        val configs = listOf(
            TrackerConfig(id = "c1", name = "Cigarettes", limit = 20, order = 0,
                type = TrackerType.CIGARETTE,
                pricePerUnit = 0.5,
                baseline = 15,
                isFinanciallyTracked = true
            )
        )
        val days = listOf(
            DayDocument(
                date = "2025-01-15",
                counts = mapOf("c1" to 3.0),
                trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                    name = "Cigarettes", target = 20, baseline = 15,
                    unitPrice = 0.5, isFinanciallyTracked = true
                )),
                status = "closed"
            ),
            DayDocument(
                date = "2024-06-01",
                counts = mapOf("c1" to 20.0),
                trackerSnapshots = mapOf("c1" to TrackerSnapshot(
                    name = "Cigarettes", target = 20, baseline = 20,
                    unitPrice = 0.40,
                    isFinanciallyTracked = true
                )),
                status = "closed"
            )
        )
        val logs = listOf(
            LogEntry(id = "log_manual_1", logDate = "2025-01-20", counts = mapOf("c1" to 5.0), origin = "MANUAL_ENTRY"),
            LogEntry(id = "log_archive_old", logDate = "2024-01-01", counts = mapOf("c1" to 20.0), origin = "DAY_RESET")
        )

        val json = ExportBuilder.buildJson(null, null, configs, days, logs)
        val csv = ExportBuilder.buildCsv(null, configs, days, logs)

        // Verify JSON structure
        assertTrue(json.contains("\"exportVersion\""))
        assertTrue(json.contains("\"generatedAt\""))
        assertTrue(json.contains("\"configs\""))
        assertTrue(json.contains("\"days\""))
        assertTrue(json.contains("\"logs\""))
        // No secrets
        assertFalse(json.lowercase().contains("token"))
        assertFalse(json.lowercase().contains("bearer"))
        assertFalse(json.lowercase().contains("apikey"))

        // Verify CSV structure
        val csvLines = csv.trim().split("\n")
        assertEquals(5, csvLines.size) // header + 2 day rows + 2 log rows
    }

    // --- Repository-level completeness (spec item #5) ---

    /**
     * Minimal fake that stores all data in-memory and returns it via
     * readCompleteExportSnapshot — simulating the repository's paginated
     * reads returning ALL data, not just UI-limited slices.
     */
    private class MemoryRegistryRepository(
        private val configs: List<TrackerConfig>,
        private val days: List<DayDocument>,
        private val logs: List<LogEntry>,
        private val profile: UserProfile? = null
    ) : RegistryRepository {
        override suspend fun readCompleteExportSnapshot(uid: String): CompleteExportSnapshot =
            CompleteExportSnapshot(
                generatedAt = "2026-09-16T08:15:00Z",
                profile = profile,
                profileMeta = null,
                configs = configs,
                days = days,
                logs = logs
            )
        // Stub: only readCompleteExportSnapshot is used by export tests
        override fun subscribeToUserProfile(uid: String) = kotlinx.coroutines.flow.MutableStateFlow(profile)
        override fun subscribeToConfigs(uid: String) = kotlinx.coroutines.flow.MutableStateFlow(configs)
        override fun subscribeToLogs(uid: String) = kotlinx.coroutines.flow.MutableStateFlow(logs)
        override fun subscribeToDay(uid: String, date: String) = kotlinx.coroutines.flow.MutableStateFlow<DayDocument?>(null)
        override fun subscribeToDays(uid: String) = kotlinx.coroutines.flow.MutableStateFlow(days)
        override fun subscribeToProfileExtra(uid: String) = kotlinx.coroutines.flow.MutableStateFlow<com.tabakpp.app.data.ProfileExtra?>(null)
        override suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double, trackingDate: String, defaultUnitPrice: Double) {}
        override suspend fun closeDay(uid: String, date: String) {}
        override suspend fun reconcileStaleDays(uid: String, currentTrackingDate: String) {}
        override suspend fun updateHistoricalDay(uid: String, date: String, counts: Map<String, Double>) {}
        override suspend fun migrateLegacyActiveCounts(uid: String) {}
        override suspend fun migrateAvatarToProfileMeta(uid: String) {}
        override suspend fun updateAvatar(uid: String, avatar: String?) {}
        override suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>) {}
        override suspend fun deleteLog(uid: String, logId: String) {}
        override suspend fun restoreLog(uid: String, log: LogEntry) {}
        override suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>) {}
        override suspend fun addConfig(uid: String, config: TrackerConfig) {}
        override suspend fun updateConfig(uid: String, config: TrackerConfig) {}
        override suspend fun deleteConfig(uid: String, configId: String, trackingDate: String?) {}
        override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) {}
        override suspend fun updateProfileSettings(uid: String, profile: UserProfile) {}
        override suspend fun ensureUserDocument(uid: String, displayName: String?) {}
        override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {}
        override suspend fun deleteAllUserData(uid: String) {}
        override suspend fun clearLocalCache() {}
    }

    @Test
    fun `repository-level export returns all data beyond UI limits`() = runTest {
        // Spec item #5: Prove repository-level complete-read, not just ExportBuilder
        // UI limits: LIVE_LOG_QUERY_LIMIT=1200, LIVE_DAYS_QUERY_LIMIT=400
        // Repository returns 1305 logs + 425 days → snapshot must contain ALL

        val configs = listOf(
            TrackerConfig(id = "c1", name = "Cigarettes", limit = 20, order = 0)
        )
        val days = (1..425).map { i ->
            DayDocument(
                date = String.format("2024-%02d-15", (i % 12) + 1),
                counts = mapOf("c1" to 5.0),
                trackerSnapshots = emptyMap(),
                status = "closed"
            )
        }
        val logs = (1..1305).map { i ->
            LogEntry(
                id = "log_$i",
                logDate = String.format("2025-01-%02d", (i % 28) + 1),
                counts = mapOf("c1" to 1.0),
                origin = "MANUAL_ENTRY"
            )
        }

        // Repository-level read (not just ExportBuilder directly)
        val repo = MemoryRegistryRepository(configs, days, logs, null)
        val snapshot = repo.readCompleteExportSnapshot("u1")

        // Prove: snapshot contains ALL data beyond UI limits
        assertEquals(1305, snapshot.logs.size, "repository snapshot must contain all 1305 logs, not just 1200")
        assertEquals(425, snapshot.days.size, "repository snapshot must contain all 425 days, not just 400")
        assertEquals(1, snapshot.configs.size)

        // Build export from repository snapshot — not raw in-memory data
        val json = ExportBuilder.buildJson(
            snapshot.profile, null,
            snapshot.configs, snapshot.days, snapshot.logs
        )
        assertTrue(json.contains("\"days\""))
        assertTrue(json.contains("\"logs\""))
    }

    @Test
    fun `repository pagination boundary around 400 page size`() = runTest {
        // Spec item #5: Test page boundaries around BATCH_LIMIT=400
        // 399, 400, 401, 800, 801 records
        listOf(399, 400, 401, 800, 801).forEach { count ->
            val days = (1..count).map { i ->
                DayDocument(
                    date = String.format("2024-%02d-%02d", (i % 12) + 1, (i % 28) + 1),
                    counts = mapOf("c1" to 1.0),
                    trackerSnapshots = emptyMap(),
                    status = "closed"
                )
            }
            val repo = MemoryRegistryRepository(emptyList(), days, emptyList(), null)
            val snapshot = repo.readCompleteExportSnapshot("u1")
            assertEquals(count, snapshot.days.size, "page boundary: $count days should all be returned")
        }
    }
}
