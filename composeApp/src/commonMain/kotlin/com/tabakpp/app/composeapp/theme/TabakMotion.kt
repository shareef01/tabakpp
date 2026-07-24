package com.tabakpp.app.composeapp.theme

import androidx.compose.animation.core.*
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.unit.dp

@Composable
fun rememberTabakHaptics(heavier: Boolean = false): () -> Unit {
    val haptic = LocalHapticFeedback.current
    return {
        if (heavier) {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        } else {
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }
}

fun Modifier.tabakPressScale() = composed {
    val reducedMotion = LocalReducedMotion.current
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1.0f,
        animationSpec = if (reducedMotion) snap() else spring(stiffness = Spring.StiffnessMediumLow)
    )

    this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .pointerInput(Unit) {
            while (true) {
                awaitPointerEventScope {
                    awaitFirstDown(false)
                    pressed = true
                    waitForUpOrCancellation()
                    pressed = false
                }
            }
        }
}

fun Modifier.tabakCardEnter(index: Int) = composed {
    val reducedMotion = LocalReducedMotion.current
    var visible by remember(reducedMotion) { mutableStateOf(reducedMotion) }
    LaunchedEffect(reducedMotion) {
        if (!reducedMotion) {
            kotlinx.coroutines.delay(index * 50L)
            visible = true
        }
    }

    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = if (reducedMotion) snap() else tween(400, easing = LinearOutSlowInEasing)
    )
    
    val translateY by animateFloatAsState(
        targetValue = if (visible) 0f else 12f,
        animationSpec = if (reducedMotion) snap() else tween(400, easing = LinearOutSlowInEasing)
    )

    this
        .graphicsLayer {
            this.alpha = alpha
            translationY = translateY.dp.toPx()
        }
}

// CompositionLocal for reduced motion (defaults to false)
val LocalReducedMotion = staticCompositionLocalOf { false }
