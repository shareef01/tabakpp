package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.composeapp.ui.components.HistoryChart
import com.tabakpp.app.composeapp.ui.components.ManualEntryForm
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

    val scope = rememberCoroutineScope()
    val accentColor = LocalAccentColor.current

    var logToEditId by rememberSaveable { mutableStateOf<String?>(null) }
    val logToEdit = logs.firstOrNull { it.id == logToEditId }
    var showAddEntry by rememberSaveable { mutableStateOf(false) }
    var historyPeriod by rememberSaveable { mutableStateOf(30) }
    val periodLogs = remember(logs, historyPeriod) {
        val cutoff = Clock.System.todayIn(TimeZone.currentSystemDefault())
            .minus(historyPeriod - 1, DateTimeUnit.DAY)
        logs.filter { runCatching { LocalDate.parse(it.logDate) >= cutoff }.getOrDefault(false) }
    }
    val groupedLogs = remember(logs) { SmokingCalculator.groupLogsByDate(logs) }
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
                // TREND ANALYSIS BLOCK
                item {
                    Column {
                        HistoryGroupHeader("vault statistics")
                        Spacer(modifier = Modifier.height(12.dp))
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
                                    "USAGE TRENDS", 
                                    style = TabakTypography.labelSmall.copy(letterSpacing = 2.sp, fontWeight = FontWeight.Black),
                                    color = accentColor
                                )
                                Spacer(modifier = Modifier.height(24.dp))
                                HistoryChart(
                                    logs = periodLogs,
                                    activeCount = metrics?.count ?: 0,
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
                                value = SmokingCalculator.formatCurrency(metrics?.spentToday ?: 0.0),
                                label = "today",
                                subLabel = "SPENT",
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
                                label = "restored",
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
                        HistoryGroupHeader("tactical log")
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

                if (logs.isEmpty()) {
                    item {
                        Text(
                            "No sessions yet. End a tracking day or add a manual entry.",
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
                            LogItem(
                                log = log,
                                onEdit = { logToEditId = log.id },
                                onDelete = {
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
                                }
                            )
                        }
                    }
                }
            }
        }

    }

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
                    viewModel.updateLog(logToEdit.id, counts)
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
                accentColor = accentColor,
                onSave = { date, counts ->
                    viewModel.createManualEntry(date, counts)
                    showAddEntry = false
                },
                onDismiss = { showAddEntry = false }
            )
        }
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
        style = TabakTypography.labelSmall.copy(color = DefaultAccent, letterSpacing = 2.sp, fontWeight = FontWeight.Black),
        modifier = Modifier.padding(start = 4.dp)
    )
}

@Composable
fun LogItem(
    log: LogEntry,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
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
                IconButton(onClick = onDelete, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete history entry", tint = ErrorColor, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}
