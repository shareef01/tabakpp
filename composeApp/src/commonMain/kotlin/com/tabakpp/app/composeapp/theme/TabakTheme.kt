package com.tabakpp.app.composeapp.theme

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color

val LocalAccentColor = staticCompositionLocalOf { DefaultAccent }
val LocalSnackbarHostState = staticCompositionLocalOf<SnackbarHostState> { error("No SnackbarHostState provided") }

@Composable
fun TabakTheme(
    accentColor: Color = DefaultAccent,
    reducedMotion: Boolean = false,
    snackbarHostState: SnackbarHostState? = null,
    content: @Composable () -> Unit
) {
    val animatedAccent by animateColorAsState(
        targetValue = accentColor,
        animationSpec = tween<Color>(300, easing = LinearOutSlowInEasing)
    )

    val colorScheme = darkColorScheme(
        primary = animatedAccent,
        onPrimary = Color.White,
        background = CanvasBackground,
        onBackground = TextPrimary,
        surface = SurfaceBase.copy(alpha = 0.85f), // 75-95% range
        onSurface = TextPrimary,
        surfaceVariant = SurfaceElevated,
        onSurfaceVariant = TextMuted,
        outline = BorderWhite,
        error = DangerColor
    )

    CompositionLocalProvider(
        LocalAccentColor provides animatedAccent,
        LocalSpacing provides TabakSpacing(),
        LocalReducedMotion provides reducedMotion,
        LocalSnackbarHostState provides (snackbarHostState ?: remember { SnackbarHostState() })
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = TabakTypography,
            shapes = TabakShapes,
            content = content
        )
    }
}

// Animation Specs matching PWA
object TabakMotion {
    val TabIndicator = tween<Float>(durationMillis = 300, easing = LinearOutSlowInEasing)
    
    // spring(stiffness 420, damping 30) -> damping ratio approx 0.7 for 30 damping at 420 stiffness
    val CounterBump = spring<Float>(stiffness = 420f, dampingRatio = 0.7f) 
    
    val ButtonPress = spring<Float>(stiffness = Spring.StiffnessMedium, dampingRatio = Spring.DampingRatioLowBouncy)
    
    // For the 4s glow pulse
    val LogoPulse = infiniteRepeatable<Float>(
        animation = tween(2000, easing = FastOutSlowInEasing),
        repeatMode = RepeatMode.Reverse
    )
}
