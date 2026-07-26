package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.WidgetSize

/**
 * PWA-Fidelity Tracker Card.
 * Replicates the premium industrial look with circular controls and centered elements.
 * Optimized for 120fps performance on high-refresh hardware.
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
    val isLimitReached = (count >= config.limit) && (config.limit > 0)
    val isOver = count > config.limit
    val isLarge = widgetSize == WidgetSize.LARGE
    val isSmall = widgetSize == WidgetSize.SMALL
    val reducedMotion = LocalReducedMotion.current
    
    // Scale parameters matched to PWA feel
    val cardHeight = when (widgetSize) {
        WidgetSize.SMALL -> 180.dp
        WidgetSize.MEDIUM -> 220.dp
        WidgetSize.LARGE -> 310.dp
    }
    val counterSize = when (widgetSize) {
        WidgetSize.SMALL -> 28.sp
        WidgetSize.MEDIUM -> 36.sp
        WidgetSize.LARGE -> 64.sp
    }
    val gaugeHeight = if (isLarge) 56.dp else if (isSmall) 24.dp else 30.dp
    val gaugeMaxWidth = 220.dp
    val btnSize = if (isLarge) 60.dp else if (isSmall) 36.dp else 44.dp
    val iconSize = if (isLarge) 24.dp else if (isSmall) 14.dp else 18.dp

    // Smooth state transitions (Optimized spec)
    val cardBackground by animateColorAsState(
        targetValue = if (isLimitReached) Color(0xFF2D0808) else SurfaceBase,
        animationSpec = if (reducedMotion) snap() else tween(durationMillis = 300)
    )
    val btnAccent = if (isLimitReached) ErrorColor else accentColor

    val haptics = rememberTabakHaptics()
    val heavyHaptics = rememberTabakHaptics(heavier = true)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = cardHeight)
            .tabakCardShadow(MaterialTheme.shapes.large),
        shape = MaterialTheme.shapes.large,
        color = cardBackground,
        border = BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f))
    ) {
        Column(
            modifier = Modifier
                .padding(vertical = 16.dp, horizontal = 16.dp)
                .fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // 1. Header (PWA Style Lowercase)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = config.name.lowercase(),
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.sp,
                        color = Color.White.copy(alpha = 0.72f)
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "${config.limit}${Strings.DAY_LIMIT}",
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Bold,
                        color = Color.White.copy(alpha = 0.55f)
                    )
                )
            }

            // 2. Recessed Physical Gauge (Centered)
            TrackerGauge(
                type = config.type,
                count = count,
                limit = config.limit,
                accentColor = accentColor,
                height = gaugeHeight,
                modifier = if (isLarge) {
                    Modifier.widthIn(max = gaugeMaxWidth).fillMaxWidth()
                } else {
                    Modifier.fillMaxWidth()
                }
            )

            // 3. Action Center (Fluid Circular Controls)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Decrement Circle
                Surface(
                    onClick = {
                        onDecrement()
                        haptics()
                    },
                    enabled = count > 0,
                    modifier = Modifier.size(btnSize).tabakPressScale(),
                    color = Color.White.copy(alpha = 0.04f),
                    shape = CircleShape,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.05f))
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Remove,
                            contentDescription = "${Strings.DECREASE} ${config.name}",
                            tint = if (count > 0) TextMuted else TextDisabled,
                            modifier = Modifier.size(iconSize)
                        )
                    }
                }

                // Counter Zone
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clipToBounds(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        SimpleCounter(count, isLimitReached, counterSize)

                        val remaining = config.limit - count
                        val progress = if (config.limit > 0) count.toFloat() / config.limit.toFloat() else 0f
                        
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            val label = if (isOver) {
                                "${count - config.limit} ${Strings.OVER}"
                            } else {
                                "${maxOf(0, remaining)} ${Strings.LEFT}"
                            }

                            Text(
                                text = label.uppercase(),
                                style = TabakTypography.labelSmall.copy(
                                    fontWeight = FontWeight.Black,
                                    letterSpacing = 0.5.sp,
                                    fontSize = 8.sp,
                                    color = if (isOver) ErrorColor else if (isLimitReached) WarningColor else TextMuted
                                )
                            )

                            // Mini Progress Bar (Web Fidelity)
                            Box(
                                modifier = Modifier
                                    .width(if (isSmall) 20.dp else 28.dp)
                                    .height(2.dp)
                                    .clip(CircleShape)
                                    .background(Color.White.copy(alpha = 0.08f))
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth(progress.coerceIn(0f, 1f))
                                        .fillMaxHeight()
                                        .background(if (isLimitReached) ErrorColor else accentColor)
                                )
                            }
                        }
                    }
                }

                // Increment Circle (Glow)
                Surface(
                    onClick = {
                        onIncrement()
                        heavyHaptics()
                    },
                    modifier = Modifier.size(btnSize).tabakPressScale()
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
                            contentDescription = "${Strings.INCREASE} ${config.name}",
                            tint = Color.White,
                            modifier = Modifier.size(if (isLarge) 28.dp else (iconSize + 2.dp))
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun SimpleCounter(value: Int, isOverLimit: Boolean, fontSize: androidx.compose.ui.unit.TextUnit) {
    val reducedMotion = LocalReducedMotion.current
    val textColor by animateColorAsState(
        targetValue = if (isOverLimit) Color(0xFFFF5252) else Color.White,
        animationSpec = if (reducedMotion) snap() else tween(durationMillis = 300)
    )

    if (reducedMotion) {
        Text(
            text = value.toString(),
            style = TabakTypography.displayLarge.copy(
                fontSize = fontSize,
                fontWeight = FontWeight.Black,
                fontFeatureSettings = "tnum"
            ),
            color = textColor
        )
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
        Text(
            text = targetValue.toString(),
            style = TabakTypography.displayLarge.copy(
                fontSize = fontSize,
                fontWeight = FontWeight.Black,
                fontFeatureSettings = "tnum"
            ),
            color = textColor
        )
    }
}
