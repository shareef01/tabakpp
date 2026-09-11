package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.WidgetSize
import com.tabakpp.app.domain.SmokingCalculator

/**
 * PWA-Fidelity Tracker Card.
 * Density scales the whole composition; controls never overflow the card.
 *
 * Limit status uses the same zero-target-safe three-state logic as the web
 * client (items 4/5): a target of 0 never renders as a meaningless 0%, and
 * "at target" (amber — this app's existing "approaching/warning" color) is
 * visually distinct from "over target" (red) rather than both collapsing
 * into one "over limit" flag.
 */
@Composable
fun TrackerCard(
    config: TrackerConfig,
    count: Int,
    accentColor: Color,
    widgetSize: WidgetSize,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    modifier: Modifier = Modifier
) {
    val limitStatus = SmokingCalculator.getLimitStatus(count.toDouble(), config.limit.toDouble())
    val isAtLimit = limitStatus.status == "at"
    val isOver = limitStatus.status == "over"
    val isLimitReached = isAtLimit || isOver
    val remaining = limitStatus.belowTarget.toInt()
    val aboveTarget = limitStatus.aboveTarget.toInt()
    val progressFraction = (if (config.limit > 0) count.toFloat() / config.limit else if (limitStatus.status == "under") 0f else 1f).coerceIn(0f, 1f)
    val reduction = SmokingCalculator.getReduction(count.toDouble(), config.baseline)
    val isLarge = widgetSize == WidgetSize.LARGE
    val isSmall = widgetSize == WidgetSize.SMALL
    val reducedMotion = LocalReducedMotion.current

    val counterSize = when (widgetSize) {
        WidgetSize.SMALL -> 32.sp
        WidgetSize.MEDIUM -> 40.sp
        WidgetSize.LARGE -> 52.sp
    }
    val gaugeHeight = when (widgetSize) {
        WidgetSize.SMALL -> 32.dp
        WidgetSize.MEDIUM -> 36.dp
        WidgetSize.LARGE -> 44.dp
    }
    val btnSize = when (widgetSize) {
        WidgetSize.SMALL -> 44.dp
        WidgetSize.MEDIUM -> 48.dp
        WidgetSize.LARGE -> 56.dp
    }
    val iconSize = when (widgetSize) {
        WidgetSize.SMALL -> 18.dp
        WidgetSize.MEDIUM -> 20.dp
        WidgetSize.LARGE -> 24.dp
    }
    val cardPad = when (widgetSize) {
        WidgetSize.SMALL -> 12.dp
        WidgetSize.MEDIUM -> 16.dp
        WidgetSize.LARGE -> 20.dp
    }
    val stackGap = when (widgetSize) {
        WidgetSize.SMALL -> 8.dp
        WidgetSize.MEDIUM -> 10.dp
        WidgetSize.LARGE -> 12.dp
    }

    val cardBackground by animateColorAsState(
        targetValue = when {
            isOver -> Color(0xFF2D0808)
            isAtLimit -> Color(0xFF2A1D06)
            else -> SurfaceBase
        },
        animationSpec = if (reducedMotion) snap() else tween(durationMillis = 300)
    )
    val stateColor = when {
        isOver -> Color(0xFFFF5252)
        isAtLimit -> Color(0xFFFBBF24)
        else -> accentColor
    }
    val btnAccent = stateColor
    // The counter digit stays white while under target (accentColor is
    // reserved for buttons/progress there), but still shifts for at/over.
    val counterTextColor = when {
        isOver -> Color(0xFFFF5252)
        isAtLimit -> Color(0xFFFBBF24)
        else -> Color.White
    }

    val haptics = rememberTabakHaptics()
    val heavyHaptics = rememberTabakHaptics(heavier = true)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .tabakCardShadow(MaterialTheme.shapes.large),
        shape = MaterialTheme.shapes.large,
        color = cardBackground,
        border = BorderStroke(0.5.dp, Color.White.copy(alpha = 0.06f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(cardPad),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(stackGap)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = config.name.uppercase(),
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.2.sp,
                        color = Color.White.copy(alpha = 0.85f)
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.White.copy(alpha = 0.04f))
                        .border(0.5.dp, Color.White.copy(alpha = 0.06f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Text(
                        text = "${config.limit}/DAY",
                        style = TabakTypography.labelSmall.copy(
                            fontWeight = FontWeight.Black,
                            letterSpacing = 1.sp,
                            color = Color.White.copy(alpha = 0.55f)
                        ),
                        maxLines = 1
                    )
                }
            }

            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                TrackerGauge(
                    type = config.type,
                    count = count,
                    limit = config.limit,
                    accentColor = accentColor,
                    height = gaugeHeight,
                    modifier = Modifier.widthIn(
                        max = when (widgetSize) {
                            WidgetSize.SMALL -> 156.dp
                            WidgetSize.MEDIUM -> 180.dp
                            WidgetSize.LARGE -> 208.dp
                        }
                    ).fillMaxWidth()
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    onClick = { onDecrement(); haptics() },
                    enabled = count > 0,
                    modifier = Modifier.size(btnSize).tabakPressScale(),
                    color = Color.White.copy(alpha = 0.04f),
                    shape = CircleShape,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Remove,
                            contentDescription = "Decrease ${config.name}",
                            tint = when {
                                isOver -> Color(0xFFF87171)
                                isAtLimit -> Color(0xFFFBBF24)
                                count > 0 -> TextMuted
                                else -> TextDisabled
                            },
                            modifier = Modifier.size(iconSize)
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                        .clipToBounds()
                        .semantics(mergeDescendants = true) {
                            liveRegion = LiveRegionMode.Polite
                            contentDescription = buildString {
                                append("${config.name}: $count of ${config.limit}, ")
                                append(
                                    when {
                                        isOver -> "$aboveTarget above target"
                                        isAtLimit -> "limit reached"
                                        else -> "$remaining left"
                                    }
                                )
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    SimpleCounter(count, counterTextColor, counterSize)
                }

                Surface(
                    onClick = { onIncrement(); heavyHaptics() },
                    modifier = Modifier
                        .size(btnSize)
                        .tabakPressScale()
                        .shadow(
                            elevation = 12.dp,
                            shape = CircleShape,
                            ambientColor = btnAccent.copy(alpha = 0.4f),
                            spotColor = btnAccent.copy(alpha = 0.4f)
                        ),
                    color = btnAccent,
                    shape = CircleShape
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "Increase ${config.name}",
                            tint = if (isOver) Color.White else Color.Black,
                            modifier = Modifier.size(iconSize)
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Text(
                    text = when {
                        isOver -> "$aboveTarget ABOVE TARGET"
                        isAtLimit -> "LIMIT REACHED"
                        else -> "$remaining LEFT"
                    },
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.sp,
                        color = when {
                            isOver -> Color(0xFFFF4D4D)
                            isAtLimit -> Color(0xFFFBBF24).copy(alpha = 0.9f)
                            else -> Color.White.copy(alpha = 0.5f)
                        }
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.width(8.dp))
                Box(
                    modifier = Modifier
                        .width(if (isSmall) 28.dp else 40.dp)
                        .height(2.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.08f))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(progressFraction)
                            .clip(CircleShape)
                            .background(stateColor)
                    )
                }
            }

            // Baseline reduction hint (item 3) — independent of target/limit status.
            if (reduction != null) {
                Text(
                    text = "${reduction.avoided.toInt()} UNDER BASELINE",
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                        fontSize = 9.sp,
                        color = accentColor.copy(alpha = 0.8f)
                    ),
                    maxLines = 1
                )
            }
        }
    }
}

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun SimpleCounter(value: Int, tint: Color, fontSize: androidx.compose.ui.unit.TextUnit) {
    val reducedMotion = LocalReducedMotion.current
    val textColor by animateColorAsState(
        targetValue = tint,
        animationSpec = if (reducedMotion) snap() else tween(durationMillis = 300)
    )
    val style = TabakTypography.displayLarge.copy(
        fontSize = fontSize,
        lineHeight = fontSize,
        fontWeight = FontWeight.Black,
        fontFeatureSettings = "tnum"
    )

    if (reducedMotion) {
        Text(text = value.toString(), style = style, color = textColor, maxLines = 1)
        return
    }

    AnimatedContent(
        targetState = value,
        transitionSpec = {
            val spec = spring<androidx.compose.ui.unit.IntOffset>(
                stiffness = Spring.StiffnessMedium,
                dampingRatio = Spring.DampingRatioNoBouncy
            )

            if (targetState > initialState) {
                (slideInVertically(animationSpec = spec) { height -> height } + fadeIn()) togetherWith
                    slideOutVertically(animationSpec = spec) { height -> -height } + fadeOut()
            } else {
                (slideInVertically(animationSpec = spec) { height -> -height } + fadeIn()) togetherWith
                    slideOutVertically(animationSpec = spec) { height -> height } + fadeOut()
            }.using(
                SizeTransform(clip = true)
            )
        }
    ) { targetValue ->
        Text(text = targetValue.toString(), style = style, color = textColor, maxLines = 1)
    }
}
