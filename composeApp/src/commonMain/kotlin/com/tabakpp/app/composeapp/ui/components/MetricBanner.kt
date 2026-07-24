package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.domain.SmokingCalculator

@Composable
fun MetricBanner(
    metrics: SmokingCalculator.GlobalMetrics,
    accentColor: Color,
    onEndDayClick: () -> Unit = {},
    isEndDayEnabled: Boolean = true,
    modifier: Modifier = Modifier
) {
    val progress = metrics.progress.toFloat().coerceIn(0f, 1f)
    val reducedMotion = LocalReducedMotion.current
    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = if (reducedMotion) snap() else spring()
    )
    val isOverLimit = metrics.count > metrics.limit && metrics.limit > 0
    val isWarning = progress >= 0.8f && !isOverLimit

    val stateColor = when {
        isOverLimit -> ErrorColor
        isWarning -> WarningColor
        else -> accentColor
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .widthIn(max = 1024.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .tabakCardShadow(MaterialTheme.shapes.large)
                .insetHighlight(),
            shape = MaterialTheme.shapes.large,
            color = SurfaceBase,
            border = androidx.compose.foundation.BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f))
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(24.dp)
                ) {
                    MetricItem(
                        label = "REMAINING",
                        value = maxOf(0, metrics.limit - metrics.count).toString(),
                        valueColor = if (isOverLimit) ErrorColor else Color.White,
                        modifier = Modifier.weight(1f)
                    )
                    SpentMetricItem(
                        label = "SPENT TODAY",
                        spent = metrics.spentToday,
                        modifier = Modifier.weight(1f)
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(24.dp)
                ) {
                    MetricItem(
                        label = "STREAK",
                        value = "${metrics.streak}",
                        suffix = if (metrics.streak == 1) "DAY" else "DAYS",
                        valueColor = SuccessColor,
                        modifier = Modifier.weight(1f)
                    )
                    Column(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "DAILY QUOTA",
                                style = TabakTypography.labelSmall.copy(color = TextMuted, letterSpacing = 1.sp, fontWeight = FontWeight.Black)
                            )
                            Text(
                                text = if (isOverLimit) "OVER LIMIT" else "${(progress * 100).toInt()}%",
                                style = TabakTypography.labelSmall.copy(
                                    color = stateColor,
                                    fontWeight = FontWeight.Black,
                                    letterSpacing = 1.sp
                                )
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(8.dp)
                                .clip(RoundedCornerShape(100))
                                .background(Color.White.copy(alpha = 0.05f))
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(animatedProgress)
                                    .fillMaxHeight()
                                    .clip(RoundedCornerShape(100))
                                    .background(stateColor)
                            )
                        }
                    }
                }
            }
        }

        if (metrics.hasOpenSession) {
            Spacer(modifier = Modifier.height(24.dp))
            Surface(
                onClick = onEndDayClick,
                enabled = isEndDayEnabled,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 60.dp)
                    .tabakPressScale(),
                color = Color.White.copy(alpha = 0.04f),
                shape = RoundedCornerShape(14.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Icon(
                        Icons.Default.WbSunny,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = WarningColor
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        "END DAY",
                        style = TabakTypography.labelSmall.copy(
                            color = TextPrimary,
                            fontWeight = FontWeight.Black,
                            letterSpacing = 2.sp
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun MetricItem(
    label: String,
    value: String,
    suffix: String = "",
    valueColor: Color,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.Start) {
        Text(
            text = label,
            style = TabakTypography.labelSmall.copy(color = TextMuted, letterSpacing = 1.sp, fontWeight = FontWeight.Black)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = value,
                style = TabakTypography.headlineMedium.copy(fontWeight = FontWeight.Black, fontSize = 24.sp),
                color = valueColor
            )
            if (suffix.isNotEmpty()) {
                Text(
                    text = " $suffix",
                    style = TabakTypography.labelSmall.copy(
                        fontSize = 10.sp,
                        color = TextMuted,
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.sp
                    ),
                    modifier = Modifier.padding(bottom = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun SpentMetricItem(
    label: String,
    spent: Double,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.Start) {
        Text(
            text = label,
            style = TabakTypography.labelSmall.copy(color = TextMuted, letterSpacing = 1.sp, fontWeight = FontWeight.Black)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = SmokingCalculator.formatCurrency(spent),
            style = TabakTypography.headlineMedium.copy(fontWeight = FontWeight.Black, fontSize = 24.sp),
            color = if (spent > 0) WarningColor else Color.White
        )
    }
}
