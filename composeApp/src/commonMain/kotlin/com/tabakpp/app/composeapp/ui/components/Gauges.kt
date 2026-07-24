package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.data.TrackerType

/**
 * PWA-Fidelity habit gauges.
 * Features a recessed industrial slot, textured 'verge' paper, and vertical glow ember.
 * Performance Hardened for 120fps refresh rates.
 */
@Composable
fun TrackerGauge(
    type: TrackerType,
    count: Int,
    limit: Int,
    accentColor: Color,
    height: Dp = 48.dp,
    modifier: Modifier = Modifier
) {
    val progress = if (limit > 0) count.toFloat() / limit else 0f
    val animatedProgress = remember { Animatable(progress.coerceIn(0f, 1f)) }
    val reducedMotion = LocalReducedMotion.current
    
    LaunchedEffect(progress, reducedMotion) {
        if (reducedMotion) {
            animatedProgress.snapTo(progress.coerceIn(0f, 1f))
        } else {
            animatedProgress.animateTo(
                targetValue = progress.coerceIn(0f, 1f),
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioNoBouncy,
                    stiffness = Spring.StiffnessMediumLow // Faster response
                )
            )
        }
    }

    val isOverLimit = (count >= limit) && (limit > 0)
    val shape = CircleShape

    // The Recessed Industrial Slot
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .semantics {
                contentDescription = "$count of $limit daily units"
                progressBarRangeInfo = ProgressBarRangeInfo(
                    current = progress.coerceIn(0f, 1f),
                    range = 0f..1f
                )
            }
            .clip(shape)
            .background(Color.Black.copy(alpha = 0.4f))
            .border(0.5.dp, Color.White.copy(alpha = 0.08f), shape)
            .padding(vertical = 4.dp, horizontal = 4.dp) // The "recess" offset
    ) {
        if (type == TrackerType.SIMPLE) {
            BarProgress(animatedProgress.value, if (isOverLimit) ErrorColor else accentColor)
        } else {
            // Material definition pass — legacy JOINT uses the same cigarette look.
            val paperColor = Color(0xFFFAFAFA)
            
            val filterBrush = remember(type) {
                when (type) {
                    TrackerType.SIMPLE -> Brush.verticalGradient(listOf(Color.Gray, Color.DarkGray))
                    else -> Brush.verticalGradient(
                        0.0f to Color(0xFF8B5E3C),
                        1.0f to Color(0xFF5D4037)
                    )
                }
            }
            
            val filterRatio = 0.22f

            PWAHighFidelityCanvas(
                progress = animatedProgress.value,
                filterBrush = filterBrush,
                paperColor = paperColor,
                isOverLimit = isOverLimit,
                filterRatio = filterRatio
            )
        }
    }
}

@Composable
private fun PWAHighFidelityCanvas(
    progress: Float,
    filterBrush: Brush,
    paperColor: Color,
    isOverLimit: Boolean,
    filterRatio: Float
) {
    // Optimization: Cache constant DP values
    val vergeStepDp = 4.dp
    val emberWidthDp = 6.dp
    val strokeWidthDp = 1.dp

    Canvas(modifier = Modifier.fillMaxSize().clip(CircleShape)) {
        // RED ALERT OVERRIDE (Minimalist Draw)
        if (isOverLimit) {
            drawRect(color = Color(0xFFFF2A2A), size = size)
            return@Canvas
        }

        val width = size.width
        val height = size.height
        val filterWidth = width * filterRatio
        val burnableWidth = width - filterWidth
        
        val ashWidth = burnableWidth * progress
        val emberWidth = emberWidthDp.toPx()
        
        // 1. Ash Section (Dark Charcoal)
        drawRect(
            color = Color(0xFF1A1A1A),
            size = Size(ashWidth, height)
        )
        
        // 2. Paper Section (Textured Bone White)
        val paperStart = ashWidth
        val paperWidth = burnableWidth - ashWidth
        if (paperWidth > 0) {
            drawRect(
                color = paperColor,
                topLeft = Offset(paperStart, 0f),
                size = Size(paperWidth, height)
            )
            
            // Optimized "Verge" Texture Lines (Batched Draw if possible, but line by line is usually fine for these counts)
            val step = vergeStepDp.toPx()
            val strokePx = strokeWidthDp.toPx()
            var x = paperStart + (step / 2)
            while (x < burnableWidth) {
                drawLine(
                    color = Color.Black.copy(alpha = 0.05f),
                    start = Offset(x, 0f),
                    end = Offset(x, height),
                    strokeWidth = strokePx
                )
                x += step
            }
        }

        // 3. Filter Section
        drawRect(
            brush = filterBrush,
            topLeft = Offset(burnableWidth, 0f),
            size = Size(filterWidth, height)
        )
        
        // 4. Vertical Glow Ember (PWA Style)
        if (progress < 1f && progress > 0f) {
            val emberColor = Color(0xFFFF4500)
            drawRect(
                brush = Brush.horizontalGradient(
                    colors = listOf(emberColor, emberColor.copy(alpha = 0.1f)),
                    startX = ashWidth,
                    endX = ashWidth + emberWidth
                ),
                topLeft = Offset(ashWidth, 0f),
                size = Size(emberWidth, height)
            )
        }
        
        // 5. Cylindrical Surface Shading (Top to Bottom)
        // High-Performance single pass gradient
        drawRect(
            brush = Brush.verticalGradient(
                0.0f to Color.Black.copy(alpha = 0.12f),
                0.5f to Color.Transparent,
                1.0f to Color.Black.copy(alpha = 0.22f)
            ),
            size = size
        )
    }
}

@Composable
fun BarProgress(
    progress: Float,
    accentColor: Color
) {
    Canvas(modifier = Modifier.fillMaxSize().clip(CircleShape)) {
        drawRect(
            color = Color.White.copy(alpha = 0.05f),
            size = size
        )
        drawRect(
            color = accentColor,
            size = Size(size.width * progress, size.height)
        )
    }
}
