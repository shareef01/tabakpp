package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
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
    val isOverLimit = (count >= config.limit) && (config.limit > 0)
    val isOver = count > config.limit
    val remaining = maxOf(0, config.limit - count)
    val progressFraction = (if (config.limit > 0) count.toFloat() / config.limit else 0f).coerceIn(0f, 1f)
    val isLarge = widgetSize == WidgetSize.LARGE
    val isSmall = widgetSize == WidgetSize.SMALL
    val reducedMotion = LocalReducedMotion.current

    // Scale parameters matched to PWA feel (count flanked by controls)
    val counterSize = when (widgetSize) {
        WidgetSize.SMALL -> 40.sp
        WidgetSize.MEDIUM -> 52.sp
        WidgetSize.LARGE -> 72.sp
    }
    val gaugeHeight = if (isLarge) 48.dp else if (isSmall) 34.dp else 42.dp
    val btnSize = if (isLarge) 60.dp else if (isSmall) 44.dp else 52.dp

    // Smooth state transitions (Optimized spec)
    val cardBackground by animateColorAsState(
        targetValue = if (isOverLimit) Color(0xFF2D0808) else SurfaceBase,
        animationSpec = if (reducedMotion) snap() else tween(durationMillis = 300)
    )
    val btnAccent = if (isOverLimit) Color(0xFFFF5252) else accentColor

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
                .padding(vertical = 18.dp, horizontal = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(if (isLarge) 16.dp else 12.dp)
        ) {
            // 1. Header — uppercase name + limit badge (web parity)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = config.name.uppercase(),
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.6.sp,
                        color = Color.White.copy(alpha = 0.85f)
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
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
                            letterSpacing = 1.4.sp,
                            color = Color.White.copy(alpha = 0.55f)
                        )
                    )
                }
            }

            // 2. Cigarette gauge (centered, max width like web)
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                TrackerGauge(
                    type = config.type,
                    count = count,
                    limit = config.limit,
                    accentColor = accentColor,
                    height = gaugeHeight,
                    modifier = Modifier.widthIn(max = 220.dp).fillMaxWidth()
                )
            }

            // 3. Count flanked by circular controls, with "X left" + mini progress
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Decrement
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
                                isOverLimit -> Color(0xFFF87171)
                                count > 0 -> TextMuted
                                else -> TextDisabled
                            },
                            modifier = Modifier.size(if (isLarge) 24.dp else 20.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(if (isLarge) 20.dp else 16.dp))

                // Count + remaining/over + mini progress bar
                Column(
                    modifier = Modifier.widthIn(min = if (isLarge) 96.dp else 78.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    // Counting is the app's main action, so the result has to be
                    // spoken. Without this a TalkBack user taps "Increase" and
                    // hears nothing — the new value is only rendered visually.
                    // Merged (not on the card) so the +/- buttons stay separately
                    // focusable rather than being swallowed into one node.
                    Box(
                        modifier = Modifier
                            .height(if (isLarge) 84.dp else 66.dp)
                            .clipToBounds()
                            .semantics(mergeDescendants = true) {
                                liveRegion = LiveRegionMode.Polite
                                contentDescription = buildString {
                                    append("${config.name}: $count of ${config.limit}, ")
                                    append(
                                        if (isOver) "${count - config.limit} over limit"
                                        else "$remaining left"
                                    )
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        SimpleCounter(count, isOverLimit, counterSize)
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = if (isOver) "${count - config.limit} OVER" else "$remaining LEFT",
                            style = TabakTypography.labelSmall.copy(
                                fontWeight = FontWeight.Black,
                                letterSpacing = 1.2.sp,
                                color = when {
                                    isOver -> Color(0xFFFF4D4D)
                                    isOverLimit -> Color(0xFFFBBF24).copy(alpha = 0.9f)
                                    else -> Color.White.copy(alpha = 0.5f)
                                }
                            )
                        )
                        Box(
                            modifier = Modifier
                                .width(40.dp)
                                .height(2.dp)
                                .clip(CircleShape)
                                .background(Color.White.copy(alpha = 0.08f))
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxHeight()
                                    .fillMaxWidth(progressFraction)
                                    .clip(CircleShape)
                                    .background(if (isOverLimit) Color(0xFFFF4D4D) else accentColor)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.width(if (isLarge) 20.dp else 16.dp))

                // Increment (accent bg, black icon; danger + white when over)
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
                            tint = if (isOverLimit) Color.White else Color.Black,
                            modifier = Modifier.size(if (isLarge) 28.dp else 24.dp)
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
