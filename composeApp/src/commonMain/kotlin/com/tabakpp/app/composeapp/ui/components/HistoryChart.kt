package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.domain.SmokingCalculator

/**
 * Platinum-Quality History Chart.
 * Features high-contrast tactical markers and smooth cubic paths with under-glow.
 * Includes 'NOW' session point for real-time feedback.
 */
@Composable
fun HistoryChart(
    series: List<SmokingCalculator.DateTotal>,
    accentColor: Color,
    modifier: Modifier = Modifier
) {
    val dailyTotals = series
    val chartDescription = dailyTotals.joinToString(
        prefix = "Usage trend. ",
        separator = "; "
    ) { if (it.total == null) "${it.date}: no record" else "${it.date}: ${it.total} units" }
    // A null total is a day with no record: it gets no point and breaks the
    // line, so the chart never presents it as a tobacco-free (zero) day.
    val recorded = dailyTotals.withIndex().filter { it.value.total != null }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 156.dp, max = 196.dp)
            .semantics { contentDescription = chartDescription }
    ) {
        if (recorded.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("NO DATA LOGGED", color = TextDisabled, style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp))
            }
        } else {
            val maxTotalVal = recorded.maxOf { it.value.total ?: 0 }.coerceAtLeast(1)
            val maxTotal = maxTotalVal.toFloat() * 1.3f

            Canvas(modifier = Modifier.fillMaxSize()) {
                val width = size.width
                val height = size.height
                
                // 1. TACTICAL GRID
                val gridLines = 4
                for (i in 0..gridLines) {
                    val y = height - (i.toFloat() / gridLines * height)
                    drawLine(
                        color = Color.White.copy(alpha = 0.03f),
                        start = Offset(0f, y),
                        end = Offset(width, y),
                        strokeWidth = 0.5.dp.toPx()
                    )
                }

                if (dailyTotals.size > 1) {
                    // x keeps calendar spacing (index in the full series), so a
                    // missing day leaves visible room instead of being skipped.
                    val spacing = width / (dailyTotals.size - 1)
                    fun pointAt(index: Int, total: Int) =
                        Offset(index * spacing, height - (total.toFloat() / maxTotal * height))

                    // Runs of consecutive recorded days; a gap ends a run.
                    val runs = mutableListOf<MutableList<Offset>>()
                    var lastIndex = -2
                    recorded.forEach { (index, data) ->
                        if (index != lastIndex + 1) runs += mutableListOf<Offset>()
                        runs.last() += pointAt(index, data.total ?: 0)
                        lastIndex = index
                    }

                    runs.filter { it.size > 1 }.forEach { points ->
                        // 2. PATH CALCULATION
                        val path = Path().apply {
                            moveTo(points[0].x, points[0].y)
                            for (i in 0 until points.size - 1) {
                                val p0 = points[i]
                                val p1 = points[i + 1]
                                val controlPoint1 = Offset(p0.x + (p1.x - p0.x) / 2.2f, p0.y)
                                val controlPoint2 = Offset(p1.x - (p1.x - p0.x) / 2.2f, p1.y)
                                cubicTo(controlPoint1.x, controlPoint1.y, controlPoint2.x, controlPoint2.y, p1.x, p1.y)
                            }
                        }

                        // 3. UNDER-GLOW FILL
                        val fillPath = Path().apply {
                            addPath(path)
                            lineTo(points.last().x, height)
                            lineTo(points.first().x, height)
                            close()
                        }
                        drawPath(
                            path = fillPath,
                            brush = Brush.verticalGradient(
                                colors = listOf(accentColor.copy(alpha = 0.15f), Color.Transparent)
                            )
                        )

                        // 4. REINFORCED TREND LINE
                        drawPath(
                            path = path,
                            color = accentColor,
                            style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
                        )
                    }

                    // 5. TACTICAL DATA POINTS (recorded days only; the last
                    // series index is the tracking day, always recorded)
                    recorded.forEach { (index, data) ->
                        val p = pointAt(index, data.total ?: 0)
                        val isNow = index == dailyTotals.size - 1
                        drawCircle(
                            color = Color(0xFF0F0F12),
                            radius = if (isNow) 5.dp.toPx() else 4.dp.toPx(),
                            center = p
                        )
                        drawCircle(
                            color = if (isNow) accentColor else accentColor.copy(alpha = 0.7f),
                            radius = if (isNow) 2.5.dp.toPx() else 2.dp.toPx(),
                            center = p
                        )
                    }

                } else {
                    val y = height - ((dailyTotals[0].total ?: 0).toFloat() / maxTotal * height)
                    drawCircle(color = accentColor, radius = 5.dp.toPx(), center = Offset(width / 2, y))
                }
            }
        }
    }
}
