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

/**
 * PWA-Fidelity Tracker Card.
 * Density scales the whole composition; controls never overflow the card.
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
                                isOverLimit -> Color(0xFFF87171)
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
                                    if (isOver) "${count - config.limit} over limit"
                                    else "$remaining left"
                                )
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    SimpleCounter(count, isOverLimit, counterSize)
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
                            tint = if (isOverLimit) Color.White else Color.Black,
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
                    text = if (isOver) "${count - config.limit} OVER" else "$remaining LEFT",
                    style = TabakTypography.labelSmall.copy(
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.sp,
                        color = when {
                            isOver -> Color(0xFFFF4D4D)
                            isOverLimit -> Color(0xFFFBBF24).copy(alpha = 0.9f)
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
                            .background(if (isOverLimit) Color(0xFFFF4D4D) else accentColor)
                    )
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
