package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.composeapp.ui.components.*
import com.tabakpp.app.viewmodels.RegistryViewModel
import kotlinx.coroutines.delay

/**
 * High-performance Track Dashboard.
 * Feature: Silent habit logging with a premium glassy Undo pill.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackScreen(
    viewModel: RegistryViewModel,
    innerPadding: PaddingValues = PaddingValues(0.dp)
) {
    val profile by viewModel.userProfile.collectAsStateWithLifecycle()
    val metrics by viewModel.metrics.collectAsStateWithLifecycle()
    val configs by viewModel.configs.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val endingDay by viewModel.endingDay.collectAsStateWithLifecycle()

    val accentColor = LocalAccentColor.current
    val reducedMotion = LocalReducedMotion.current
    var showAddTrackerSheet by rememberSaveable { mutableStateOf(false) }
    var showEndDayConfirm by rememberSaveable { mutableStateOf(false) }

    var lastLoggedTrackerId by rememberSaveable { mutableStateOf<String?>(null) }
    var undoPillVisible by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(undoPillVisible, lastLoggedTrackerId) {
        if (undoPillVisible) {
            delay(5000)
            undoPillVisible = false
        }
    }



    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = innerPadding.calculateTopPadding())
    ) {
        if (loading) {
            Box(modifier = Modifier.fillMaxSize().semantics { stateDescription = "Loading trackers" }) {
                TrackSkeleton()
            }
        } else {
            TrackerGrid(
                configs = configs,
                activeCounts = profile?.activeCounts,
                accentColor = accentColor,
                widgetSize = profile?.widgetSize ?: com.tabakpp.app.data.WidgetSize.MEDIUM,
                onIncrement = { config ->
                    viewModel.increment(config.id) {
                        lastLoggedTrackerId = config.id
                        undoPillVisible = true
                    }
                },
                onDecrement = { id -> viewModel.decrement(id) },
                metrics = metrics,
                endingDay = endingDay,
                onEndDayClick = { showEndDayConfirm = true },
                bottomPadding = innerPadding.calculateBottomPadding(),
                onAddClick = { showAddTrackerSheet = true }
            )
        }

        // Silent Floating Undo Pill (Premium Polish)
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = innerPadding.calculateBottomPadding() + 12.dp)
        ) {
            AnimatedVisibility(
                visible = undoPillVisible,
                enter = if (reducedMotion) EnterTransition.None else slideInVertically { it } + fadeIn(),
                exit = if (reducedMotion) ExitTransition.None else slideOutVertically { it } + fadeOut()
            ) {
                Surface(
                    onClick = {
                        lastLoggedTrackerId?.let { viewModel.undoIncrement(it) }
                        undoPillVisible = false
                    },
                    modifier = Modifier
                        .height(48.dp)
                        .tabakPressScale(),
                    color = Color(0xFF141416).copy(alpha = 0.95f),
                    shape = RoundedCornerShape(100),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.12f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(Icons.Default.Undo, contentDescription = null, modifier = Modifier.size(18.dp), tint = accentColor)
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            "UNDO LOG",
                            style = TabakTypography.labelSmall.copy(
                                fontWeight = FontWeight.Black,
                                letterSpacing = 1.sp,
                                color = TextPrimary
                            )
                        )
                    }
                }
            }
        }
    }

    if (showAddTrackerSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAddTrackerSheet = false },
            containerColor = Color(0xFF0F0F12)
        ) {
            TrackerForm(
                accentColor = accentColor,
                onSave = { config ->
                    viewModel.addTracker(config)
                    showAddTrackerSheet = false
                },
                onDismiss = { showAddTrackerSheet = false }
            )
        }
    }

    if (showEndDayConfirm) {
        ConfirmModal(
            title = "End tracking day?",
            message = "Today’s counts will be archived and counters reset. Archived entries can be edited in History.",
            confirmLabel = "End Day",
            tintColor = ErrorColor,
            isLoading = endingDay,
            onConfirm = { viewModel.endDay() },
            onDismiss = { if (!endingDay) showEndDayConfirm = false }
        )
    }

    // Close the dialog once the archive operation finishes
    LaunchedEffect(endingDay) {
        if (!endingDay) {
            showEndDayConfirm = false
        }
    }
}

@Composable
fun EmptyDashboard(accentColor: Color, onAddClick: () -> Unit) {
    Column(
        modifier = Modifier.padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .shadow(8.dp, RoundedCornerShape(28.dp))
                .clip(RoundedCornerShape(28.dp))
                .background(Brush.verticalGradient(listOf(Color(0xFF1C1C1E), Color(0xFF0F0F12))))
                .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(28.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.Add, 
                contentDescription = null, 
                modifier = Modifier.size(36.dp), 
                tint = accentColor
            )
        }
        Spacer(modifier = Modifier.height(32.dp))
        Text(
            "INITIALIZE TRACKING",
            style = TabakTypography.headlineMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp),
            color = TextPrimary,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            "Deploy your first habit counter to start gathering behavioral intelligence.",
            color = TextMuted,
            textAlign = TextAlign.Center,
            style = TabakTypography.bodyMedium.copy(lineHeight = 20.sp)
        )
        Spacer(modifier = Modifier.height(48.dp))
        Surface(
            onClick = onAddClick,
            modifier = Modifier
                .fillMaxWidth()
                .height(60.dp)
                .tabakPressScale(),
            color = Color.White.copy(alpha = 0.04f),
            shape = RoundedCornerShape(16.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
        ) {
            Box(contentAlignment = Alignment.Center) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(20.dp), tint = TextPrimary)
                    Spacer(modifier = Modifier.width(12.dp))
                    Text("CREATE TRACKER", style = TabakTypography.labelSmall.copy(color = TextPrimary, fontWeight = FontWeight.Black, letterSpacing = 1.sp))
                }
            }
        }
    }
}

@Composable
private fun ErrorBanner(message: String?, onDismiss: () -> Unit) {
    AnimatedVisibility(
        visible = message != null,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut()
    ) {
        message?.let { msg ->
            Surface(
                color = ErrorColor.copy(alpha = 0.95f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = msg.uppercase(),
                        color = Color.White,
                        style = TabakTypography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Black),
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
                        Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun TrackerGrid(
    configs: List<com.tabakpp.app.data.TrackerConfig>,
    activeCounts: Map<String, Double>?,
    accentColor: Color,
    widgetSize: com.tabakpp.app.data.WidgetSize,
    onIncrement: (com.tabakpp.app.data.TrackerConfig) -> Unit,
    onDecrement: (String) -> Unit,
    metrics: com.tabakpp.app.domain.SmokingCalculator.GlobalMetrics?,
    endingDay: Boolean,
    onEndDayClick: () -> Unit,
    bottomPadding: androidx.compose.ui.unit.Dp,
    onAddClick: () -> Unit
) {
    if (configs.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            EmptyDashboard(accentColor, onAddClick)
        }
    } else {
        LazyVerticalGrid(
            columns = if (widgetSize == com.tabakpp.app.data.WidgetSize.LARGE) GridCells.Fixed(1) else GridCells.Fixed(2),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 16.dp,
                bottom = bottomPadding
            )
        ) {
            itemsIndexed(configs, key = { _, item -> item.id }) { index, config ->
                Box(modifier = Modifier.tabakCardEnter(index)) {
                    TrackerCard(
                        config = config,
                        count = activeCounts?.get(config.id)?.toInt() ?: 0,
                        accentColor = accentColor,
                        widgetSize = widgetSize,
                        onIncrement = { onIncrement(config) },
                        onDecrement = { onDecrement(config.id) }
                    )
                }
            }

            item(span = { GridItemSpan(maxLineSpan) }) {
                metrics?.let {
                    Box(modifier = Modifier.tabakCardEnter(configs.size).padding(top = 12.dp)) {
                        MetricBanner(
                            metrics = it,
                            accentColor = accentColor,
                            onEndDayClick = onEndDayClick,
                            isEndDayEnabled = !endingDay
                        )
                    }
                }
            }
        }
    }
}
