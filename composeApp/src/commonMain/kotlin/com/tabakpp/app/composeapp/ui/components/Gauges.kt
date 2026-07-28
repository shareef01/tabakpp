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
            // Matches the web gauge BURN_TRANSITION: 0.8s, cubic-bezier(0.16, 1, 0.3, 1).
            animatedProgress.animateTo(
                targetValue = progress.coerceIn(0f, 1f),
                animationSpec = tween(
                    durationMillis = 800,
                    easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
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
            
            // Orange filter tip to match the web CigaretteGauge (#F4A261 -> #E76F3C).
            val filterBrush = remember {
                Brush.verticalGradient(
                    0.0f to Color(0xFFF4A261),
                    1.0f to Color(0xFFE76F3C)
                )
            }

            // Stubbier silhouette to match web (filterRatio 0.3).
            val filterRatio = 0.30f

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
    // Cache constant DP values
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
        val paperStart = ashWidth
        val paperWidth = burnableWidth - ashWidth

        // 1. Ash Section (Dark Charcoal)
        if (ashWidth > 0f) {
            drawRect(color = Color(0xFF1A1A1A), size = Size(ashWidth, height))
        }

        // 2. Paper Section (bone white) with 15 faint vertical "verge" lines,
        //    evenly spread across the current paper span (web parity).
        if (paperWidth > 0f) {
            drawRect(color = paperColor, topLeft = Offset(paperStart, 0f), size = Size(paperWidth, height))
            val lines = 15
            val strokePx = strokeWidthDp.toPx()
            var i = 1
            while (i <= lines) {
                val x = paperStart + paperWidth * (i / (lines + 1f))
                drawLine(
                    color = Color.Black.copy(alpha = 0.04f),
                    start = Offset(x, 0f),
                    end = Offset(x, height),
                    strokeWidth = strokePx
                )
                i++
            }
        }

        // 3. Filter Section (orange), with a thin dark seam at the paper join.
        drawRect(brush = filterBrush, topLeft = Offset(burnableWidth, 0f), size = Size(filterWidth, height))
        drawLine(
            color = Color.Black.copy(alpha = 0.4f),
            start = Offset(burnableWidth, 0f),
            end = Offset(burnableWidth, height),
            strokeWidth = strokeWidthDp.toPx()
        )

        // 4. Cylindrical surface shading — matte over ash/paper, glossy on the filter.
        drawRect(
            brush = Brush.verticalGradient(
                0.0f to Color.Black.copy(alpha = 0.10f),
                0.5f to Color.Transparent,
                1.0f to Color.Black.copy(alpha = 0.20f)
            ),
            size = Size(burnableWidth, height)
        )
        drawRect(
            brush = Brush.verticalGradient(
                0.0f to Color.White.copy(alpha = 0.10f),
                0.5f to Color.Transparent,
                1.0f to Color.Black.copy(alpha = 0.30f)
            ),
            topLeft = Offset(burnableWidth, 0f),
            size = Size(filterWidth, height)
        )

        // 5. Laser ember at the burn line — bright core + radiant glow, drawn on top.
        if (progress > 0.0001f && progress < 0.9999f) {
            val glowR = 13.dp.toPx()
            drawRect(
                brush = Brush.horizontalGradient(
                    0.0f to Color(0xFFFF4500).copy(alpha = 0f),
                    0.5f to Color(0xFFFF4500).copy(alpha = 0.55f),
                    1.0f to Color(0xFFFF4500).copy(alpha = 0f),
                    startX = ashWidth - glowR,
                    endX = ashWidth + glowR
                ),
                topLeft = Offset(ashWidth - glowR, 0f),
                size = Size(glowR * 2, height)
            )
            val coreW = emberWidthDp.toPx()
            drawRect(
                color = Color(0xFFFF5A1F),
                topLeft = Offset(ashWidth - coreW, 0f),
                size = Size(coreW, height)
            )
        }
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
