package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.composeapp.ui.components.ConfirmModal
import com.tabakpp.app.composeapp.ui.components.HistoryChart
import com.tabakpp.app.composeapp.ui.components.ManualEntryForm
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.domain.SmokingCalculator
import com.tabakpp.app.viewmodels.RegistryViewModel
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.todayIn

/**
 * Platinum Analytics Vault.
 * Features "Deep Zinc" surfaces and 0.5dp milled highlights.
 */
/** Synthetic history-row id prefix for a closed `days/{date}` record (AUD-004). */
internal const val DAY_RECORD_ID_PREFIX = "day:"

/**
 * A closed `days/{date}` document as a history row, so the dated daily-document
 * model (the primary record going forward) is visible and editable in Android
 * History. Mirrors the web `dayRecordAsLogLike`. Today's still-open day is
 * excluded by the caller.
 */
internal fun dayRecordAsHistoryEntry(day: DayDocument): LogEntry = LogEntry(
    id = "$DAY_RECORD_ID_PREFIX${day.date}",
    logDate = day.date,
    counts = day.counts,
    origin = "DAY_RECORD"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    viewModel: RegistryViewModel,
    innerPadding: PaddingValues = PaddingValues(0.dp),
    snackbarHostState: SnackbarHostState
) {
    val logs by viewModel.logs.collectAsStateWithLifecycle()
    val metrics by viewModel.metrics.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val trackingDay by viewModel.trackingDay.collectAsStateWithLifecycle()
    val historyIsTruncated by viewModel.historyIsTruncated.collectAsStateWithLifecycle()
    val dayDocs by viewModel.dayDocs.collectAsStateWithLifecycle()
    val configs by viewModel.configs.collectAsStateWithLifecycle()
    val activeCounts by viewModel.activeCounts.collectAsStateWithLifecycle()
    var historySubView by rememberSaveable { mutableStateOf("history") }

    val scope = rememberCoroutineScope()
    val accentColor = LocalAccentColor.current

    var logToEditId by rememberSaveable { mutableStateOf<String?>(null) }
    // History rows = legacy `logs` (manual entries + pre-migration archives)
    // PLUS closed `days/{date}` records (AUD-004). Today's still-open day is
    // deliberately excluded — it belongs on the Track screen, not a second
    // editable surface for the same live count (mirrors web HistoryScreen).
    val closedDayRows = remember(dayDocs) {
        dayDocs.filter { it.status == "closed" }.map { dayRecordAsHistoryEntry(it) }
    }
    val historyEntries = remember(logs, closedDayRows) { logs + closedDayRows }
    val logToEdit = historyEntries.firstOrNull { it.id == logToEditId }
    var logPendingDelete by remember { mutableStateOf<LogEntry?>(null) }
    var showAddEntry by rememberSaveable { mutableStateOf(false) }
    var historyPeriod by rememberSaveable { mutableStateOf(30) }
    val groupedLogs = remember(historyEntries) { SmokingCalculator.groupLogsByDate(historyEntries) }
    val sortedDates = remember(groupedLogs) { groupedLogs.keys.sortedDescending() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = innerPadding.calculateTopPadding())
    ) {
        if (loading) {
            Box(
                modifier = Modifier.fillMaxSize().semantics { stateDescription = "Loading history" },
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = accentColor, strokeWidth = 2.dp)
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 16.dp,
                    bottom = innerPadding.calculateBottomPadding()
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // SUB-VIEW SELECTOR
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilterChip(
                            selected = historySubView == "history",
                            onClick = { historySubView = "history" },
                            label = { Text("History") },
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                        )
                        FilterChip(
                            selected = historySubView == "insights",
                            onClick = { historySubView = "insights" },
                            label = { Text("Insights") },
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                        )
                    }
                }

                // INSIGHTS SUBVIEW
                if (historySubView == "insights") {
                    item {
                        HistoricalInsightsContent(
                            logs = logs,
                            dayDocs = dayDocs,
                            configs = configs,
                            trackingDay = trackingDay,
                            activeCounts = activeCounts,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                }

                // HISTORY SUBVIEW (existing content)
                if (historySubView == "history") {
                // TREND ANALYSIS BLOCK
                item {
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            listOf(7, 14, 30, 90).forEach { days ->
                                FilterChip(
                                    selected = historyPeriod == days,
                                    onClick = { historyPeriod = days },
                                    label = { Text("$days days") },
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .tabakCardShadow(MaterialTheme.shapes.large)
                                .insetHighlight(),
                            shape = MaterialTheme.shapes.large,
                            color = SurfaceBase,
                            border = BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f))
                        ) {
                            Column(modifier = Modifier.padding(24.dp)) {
                                Text(
                                    "USAGE VELOCITY",
                                    style = TabakTypography.labelSmall.copy(letterSpacing = 2.sp, fontWeight = FontWeight.Black),
                                    color = accentColor
                                )
                                Spacer(modifier = Modifier.height(24.dp))
                                val velocitySeries = remember(logs, dayDocs, trackingDay, historyPeriod, activeCounts) {
                                    SmokingCalculator.buildVelocitySeries(
                                        logs = logs,
                                        dayDocs = dayDocs,
                                        trackingDay = trackingDay,
                                        days = historyPeriod,
                                        activeCounts = activeCounts
                                    )
                                }
                                HistoryChart(
                                    series = velocitySeries,
                                    accentColor = accentColor,
                                    modifier = Modifier.height(180.dp).padding(horizontal = 8.dp)
                                )
                            }
                        }
                    }
                }

                // METRICS GRID
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        HistoryGroupHeader("at a glance")
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            MetricBlock(
                                value = "${metrics?.streak ?: 0}",
                                label = "days",
                                subLabel = "STREAK",
                                icon = Icons.Default.Whatshot,
                                modifier = Modifier.weight(1f)
                            )
                            MetricBlock(
                                value = if (metrics?.todayAvailable == false || metrics?.todayUnresolved?.spent == true) "—" else SmokingCalculator.formatCurrency(metrics?.spentToday ?: 0.0),
                                label = "today",
                                subLabel = if (metrics?.todayAvailable == false || metrics?.todayUnresolved?.spent == true) "UNAVAILABLE" else "SPENT",
                                icon = Icons.Default.Wallet,
                                modifier = Modifier.weight(1f)
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            MetricBlock(
                                value = SmokingCalculator.formatCurrency(metrics?.savedLifetime ?: 0.0),
                                label = "lifetime",
                                subLabel = "SAVED",
                                icon = Icons.Default.Savings,
                                modifier = Modifier.weight(1f)
                            )
                            MetricBlock(
                                value = SmokingCalculator.formatLifeMinutes(metrics?.recovered ?: 0),
                                label = "recovered",
                                subLabel = "Lost ${SmokingCalculator.formatLifeMinutes(metrics?.lifeLost ?: 0)}",
                                icon = Icons.Default.Favorite,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }

                // LOG HEADER
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        HistoryGroupHeader("session log")
                        IconButton(onClick = { showAddEntry = true }, modifier = Modifier.size(48.dp)) {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = "Add manual entry",
                                tint = accentColor,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }

                if (historyIsTruncated) {
                    item {
                        Text(
                            "Showing the most recent 1,200 entries. Trend and streak views exclude older entries; lifetime totals remain authoritative.",
                            style = TabakTypography.bodySmall,
                            color = WarningColor,
                            modifier = Modifier.padding(horizontal = 4.dp)
                        )
                    }
                }

                if (historyEntries.isEmpty()) {
                    item {
                        Text(
                            "Your tracked days will appear here.",
                            color = TextMuted,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                } else {
                    sortedDates.forEach { date ->
                        item(key = "date-$date") {
                            Text(
                                text = SmokingCalculator.formatDateDisplay(date).uppercase(),
                                style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, color = TextMuted),
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                        items(
                            items = groupedLogs[date].orEmpty(),
                            key = { log -> log.id }
                        ) { log ->
                            val isDayRecord = log.id.startsWith(DAY_RECORD_ID_PREFIX)
                            LogItem(
                                log = log,
                                isDayRecord = isDayRecord,
                                onEdit = { logToEditId = log.id },
                                onDelete = { logPendingDelete = log }
                            )
                        }
                    }
                }
            }
            } // close history subview conditional
        } // close LazyColumn lambda
    } // close else

    if (logToEdit != null) {
        ModalBottomSheet(
            onDismissRequest = { logToEditId = null },
            containerColor = Color(0xFF0F0F12)
        ) {
            val configs by viewModel.configs.collectAsStateWithLifecycle()
            ManualEntryForm(
                configs = configs,
                initialLog = logToEdit,
                accentColor = accentColor,
                onSave = { _, counts ->
                    // Day-doc rows edit the dated record; legacy log rows edit
                    // the log ledger (AUD-004).
                    if (logToEdit.id.startsWith(DAY_RECORD_ID_PREFIX)) {
                        viewModel.updateDayRecord(logToEdit.logDate, counts)
                    } else {
                        viewModel.updateLog(logToEdit.id, counts)
                    }
                    logToEditId = null
                },
                onDismiss = { logToEditId = null }
            )
        }
    }

    if (showAddEntry) {
        ModalBottomSheet(
            onDismissRequest = { showAddEntry = false },
            containerColor = Color(0xFF0F0F12)
        ) {
            val configs by viewModel.configs.collectAsStateWithLifecycle()
            ManualEntryForm(
                configs = configs,
                initialDate = trackingDay,
                maxDate = trackingDay,
                accentColor = accentColor,
                onSave = { date, counts ->
                    viewModel.createManualEntry(date, counts)
                    showAddEntry = false
                },
                onDismiss = { showAddEntry = false }
            )
        }
    }

    logPendingDelete?.let { pending ->
        ConfirmModal(
            title = "Delete entry?",
            message = "This removes the session from history and adjusts lifetime totals. You can undo briefly afterward.",
            confirmLabel = "Delete",
            onConfirm = {
                val log = pending
                logPendingDelete = null
                viewModel.deleteLog(log) {
                    scope.launch {
                        val result = snackbarHostState.showSnackbar(
                            message = "Entry deleted",
                            actionLabel = "Undo",
                            duration = SnackbarDuration.Short
                        )
                        if (result == SnackbarResult.ActionPerformed) {
                            viewModel.restoreLog(log)
                        }
                    }
                }
            },
            onDismiss = { logPendingDelete = null }
        )
    }
}

@Composable
private fun MetricBlock(
    value: String, 
    label: String, 
    subLabel: String, 
    icon: androidx.compose.ui.graphics.vector.ImageVector, 
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .heightIn(min = 120.dp)
            .tabakCardShadow(RoundedCornerShape(24.dp))
            .insetHighlight(),
        shape = RoundedCornerShape(24.dp),
        color = SurfaceBase,
        border = BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f))
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Icon(icon, contentDescription = null, tint = LocalAccentColor.current, modifier = Modifier.size(18.dp))
                Text(subLabel.uppercase(), style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, color = TextMuted))
            }
            Column {
                Text(value, style = TabakTypography.headlineMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.Black))
                Text(label.uppercase(), style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp), color = TextMuted)
            }
        }
    }
}

@Composable
private fun HistoryGroupHeader(title: String) {
    Text(
        text = title.uppercase(),
        style = TabakTypography.labelSmall.copy(color = TextMuted, letterSpacing = 2.sp, fontWeight = FontWeight.Black),
        modifier = Modifier.padding(start = 4.dp)
    )
}

@Composable
fun LogItem(
    log: LogEntry,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    isDayRecord: Boolean = false,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .tabakCardShadow(RoundedCornerShape(20.dp))
            .insetHighlight(),
        shape = RoundedCornerShape(20.dp),
        color = SurfaceBase,
        border = BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                val totalUnits = log.counts.values.sum().toInt()
                Text(
                    text = "$totalUnits UNITS LOGGED",
                    style = TabakTypography.bodyLarge.copy(fontWeight = FontWeight.Black),
                    color = TextPrimary
                )
                Text(
                    text = when (log.origin) {
                        "DAY_RESET" -> "Ended day"
                        "MANUAL_ENTRY" -> "Manual entry"
                        "DAY_RECORD" -> "Tracked day"
                        else -> log.origin.lowercase().replace('_', ' ')
                    },
                    style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp),
                    color = TextMuted
                )
            }
            
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                IconButton(onClick = onEdit, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Edit, contentDescription = "Edit history entry", tint = TextMuted, modifier = Modifier.size(18.dp))
                }
                // Delete/restore for dated day records is not implemented on the
                // app layer (mirrors web HistoryScreen); legacy log rows keep
                // full delete/restore/undo.
                if (!isDayRecord) {
                    IconButton(onClick = onDelete, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete history entry", tint = ErrorColor, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}
