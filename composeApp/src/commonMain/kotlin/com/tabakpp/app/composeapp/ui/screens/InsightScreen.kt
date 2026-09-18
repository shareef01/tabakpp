package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DateRange
import androidx.compose.material.icons.rounded.Timelapse
import androidx.compose.material.icons.rounded.TrendingDown
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.LocalAccentColor
import com.tabakpp.app.composeapp.theme.SurfaceBase
import com.tabakpp.app.composeapp.theme.TabakTypography
import com.tabakpp.app.composeapp.theme.TextMuted
import com.tabakpp.app.composeapp.theme.tabakCardShadow
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.domain.SmokingCalculator

/**
 * Historical Insights subview within the History screen.
 * Displays monthly trend comparisons for consumption, spending, and streaks.
 * Uses the same data streams as HistoryScreen (logs, dayDocs, configs).
 */
@Composable
fun HistoricalInsightsContent(
    logs: List<LogEntry>,
    dayDocs: List<DayDocument>,
    configs: List<TrackerConfig>,
    trackingDay: String,
    modifier: Modifier = Modifier
) {
    val (completedMonths, currentMonthMtd) = SmokingCalculator.aggregateMonthlyData(
        logs = logs,
        dayDocs = dayDocs,
        trackingDay = trackingDay
    )

    val trend = if (completedMonths.isNotEmpty()) {
        SmokingCalculator.calculateTrend(
            currentAvg = completedMonths.first().avgUnitsPerTrackedDay,
            previousAvg = completedMonths.getOrNull(1)?.avgUnitsPerTrackedDay ?: 0.0
        )
    } else {
        SmokingCalculator.calculateTrend(0.0, 0.0)
    }

    val accentColor = LocalAccentColor.current
    val pct = trend.percentChange

    val directionColor = when {
        pct == null -> TextMuted
        pct > 0 -> Color(0xFFFF5F5F)
        pct < 0 -> Color(0xFF4ADE80)
        else -> TextMuted
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
    ) {
        val hasAnyData = completedMonths.isNotEmpty() || currentMonthMtd != null

        if (!hasAnyData) {
            EmptyInsightsCard()
        } else {
            // Trend summary card
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .tabakCardShadow(RoundedCornerShape(16.dp)),
                colors = CardDefaults.cardColors(containerColor = SurfaceBase)
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    InsightSectionLabel("RECENT TREND")
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                trend.text,
                                style = TabakTypography.labelLarge,
                                color = directionColor,
                                fontWeight = FontWeight.Black
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                "${trend.previous} → ${trend.current} units/day",
                                style = TabakTypography.bodySmall,
                                color = TextMuted
                            )
                        }
                        if (pct != null) {
                            Icon(
                                imageVector = if (pct > 0) Icons.Rounded.TrendingUp else Icons.Rounded.TrendingDown,
                                contentDescription = "Trend direction",
                                tint = directionColor,
                                modifier = Modifier.size(28.dp)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Monthly bar chart
            if (completedMonths.isNotEmpty()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .tabakCardShadow(RoundedCornerShape(16.dp)),
                    colors = CardDefaults.cardColors(containerColor = SurfaceBase)
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        InsightSectionLabel("MONTHLY CONSUMPTION")
                        Spacer(modifier = Modifier.height(16.dp))
                        MonthlyBarChart(
                            months = completedMonths,
                            accentColor = accentColor
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Current month MTD
            currentMonthMtd?.let { mtd ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .tabakCardShadow(RoundedCornerShape(16.dp)),
                    colors = CardDefaults.cardColors(containerColor = SurfaceBase)
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        InsightSectionLabel("MTD — ${mtd.label}")
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            InsightMetricBlock(
                                value = "${mtd.trackedDays}",
                                label = "days",
                                subLabel = "TRACKED",
                                icon = Icons.Rounded.Timelapse,
                                modifier = Modifier.weight(1f)
                            )
                            InsightMetricBlock(
                                value = SmokingCalculator.formatCurrency(mtd.units.toDouble()),
                                label = "units",
                                subLabel = "CONSUMED",
                                icon = Icons.Rounded.TrendingUp,
                                modifier = Modifier.weight(1f)
                            )
                            if (mtd.hasBaseline) {
                                InsightMetricBlock(
                                    value = SmokingCalculator.formatCurrency(mtd.baselineSaved),
                                    label = "saved",
                                    subLabel = "BASELINE",
                                    icon = Icons.Rounded.DateRange,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Completed months detail list
            if (completedMonths.isNotEmpty()) {
                CompletedMonthsList(
                    months = completedMonths,
                    accentColor = accentColor
                )
            }
        }
    }
}

@Composable
private fun InsightSectionLabel(text: String) {
    Text(
        text,
        style = TabakTypography.labelSmall.copy(letterSpacing = 2.sp, fontWeight = FontWeight.Black),
        color = TextMuted
    )
}

@Composable
private fun InsightMetricBlock(
    value: String,
    label: String,
    subLabel: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .heightIn(min = 100.dp)
            .tabakCardShadow(RoundedCornerShape(20.dp)),
        colors = CardDefaults.cardColors(containerColor = SurfaceBase)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Icon(icon, contentDescription = null, tint = LocalAccentColor.current, modifier = Modifier.size(18.dp))
                Text(subLabel.uppercase(), style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp), color = TextMuted)
            }
            Column {
                Text(value, style = TabakTypography.headlineMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.Black))
                Text(label.uppercase(), style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp), color = TextMuted)
            }
        }
    }
}

@Composable
private fun EmptyInsightsCard() {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .tabakCardShadow(RoundedCornerShape(16.dp)),
        colors = CardDefaults.cardColors(containerColor = SurfaceBase)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Rounded.DateRange,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(48.dp)
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Insights become more useful as you build history.",
                style = TabakTypography.labelMedium,
                color = TextMuted,
                textAlign = TextAlign.Center
            )
            Text(
                "Keep tracking to build your monthly trends.",
                style = TabakTypography.bodySmall,
                color = TextMuted.copy(alpha = 0.6f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@Composable
private fun CompletedMonthsList(
    months: List<SmokingCalculator.MonthSummary>,
    accentColor: Color
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        months.forEach { month ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .tabakCardShadow(RoundedCornerShape(12.dp)),
                colors = CardDefaults.cardColors(containerColor = SurfaceBase)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            month.label,
                            style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.W600)
                        )
                        Text(
                            "${month.units} units",
                            style = TabakTypography.labelMedium,
                            color = accentColor
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "${month.trackedDays} tracked days · avg ${if (month.trackedDays > 0) (month.avgUnitsPerTrackedDay.toInt()) else 0} units/day",
                        style = TabakTypography.bodySmall,
                        color = TextMuted
                    )
                    if (month.hasBaseline) {
                        Text(
                            "Saved ${SmokingCalculator.formatCurrency(month.baselineSaved)} vs baseline",
                            style = TabakTypography.bodySmall,
                            color = Color(0xFF4ADE80)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthlyBarChart(
    months: List<SmokingCalculator.MonthSummary>,
    accentColor: Color
) {
    val maxCount = months.maxOfOrNull { it.units } ?: 0
    val barMax = if (maxCount > 0) maxCount.toFloat() else 1f
    val density = LocalDensity.current

    val chartDescription = months.joinToString(
        prefix = "Monthly consumption. ",
        separator = "; "
    ) { "${it.label}: ${it.units} units" }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp)
            .semantics { contentDescription = chartDescription }
    ) {
        if (months.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "No data logged",
                    color = TextMuted,
                    style = TabakTypography.labelSmall
                )
            }
        } else {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val canvasWidth = size.width
                val canvasHeight = size.height
                val labelAreaHeight = 40.dp.toPx()
                val barAreaHeight = canvasHeight - labelAreaHeight
                val barAreaLeft = 24.dp.toPx()
                val barAreaWidth = canvasWidth - 48.dp.toPx()
                val availableWidth = barAreaWidth
                val barWidth = if (months.size > 0) availableWidth / months.size * 0.6f else 0f
                val barSpacing = (availableWidth / months.size) - barWidth

                // Draw bars
                months.forEachIndexed { index, month ->
                    val barHeight = if (barMax > 0) (month.units.toFloat() / barMax) * barAreaHeight else 0f
                    val left = barAreaLeft + index * (barWidth + barSpacing)
                    val top = barAreaHeight - barHeight
                    val right = left + barWidth
                    val bottom = barAreaHeight

                    drawPath(
                        path = Path().apply {
                            moveTo(left, top)
                            lineTo(right, top)
                            lineTo(right, bottom)
                            lineTo(left, bottom)
                            close()
                        },
                        brush = Brush.verticalGradient(
                            colors = listOf(accentColor, accentColor.copy(alpha = 0.7f))
                        )
                    )
                }

                // Draw grid lines
                for (i in 1..4) {
                    val y = (barAreaHeight / 4f) * i
                    drawLine(
                        color = Color.White.copy(alpha = 0.03f),
                        start = Offset(barAreaLeft, y),
                        end = Offset(barAreaLeft + barAreaWidth, y),
                        strokeWidth = 0.5f
                    )
                }
            }

            // Month labels below chart
            Row(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 24.dp, bottom = 8.dp)
            ) {
                months.forEach { month ->
                    Text(
                        text = month.label.take(3),
                        style = TabakTypography.labelSmall.copy(fontSize = 10.sp),
                        color = TextMuted,
                        modifier = Modifier.width(with(density) { ((200f) / months.size).dp }),
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
    }
}