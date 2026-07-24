package com.tabakpp.app.composeapp.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

val TabakShapes = Shapes(
    small = RoundedCornerShape(14.dp),  // Buttons
    medium = RoundedCornerShape(24.dp), // Cards
    large = RoundedCornerShape(32.dp)   // Large cards/modals
)

val NavPillShape = RoundedCornerShape(100)
val AvatarShape = RoundedCornerShape(26.dp)

@Immutable
data class TabakSpacing(
    val cardRounding: Dp = 16.dp, // Reduced from 24
    val buttonRounding: Dp = 100.dp,
    val minTouchTarget: Dp = 44.dp,
    val bottomNavHeight: Dp = 64.dp,
    val bottomNavPadding: Dp = 24.dp,
    /** Extra scroll breathing room below the last item (viewport already clears the nav). */
    val scrollBottomPadding: Dp = 24.dp
)

val LocalSpacing = staticCompositionLocalOf { TabakSpacing() }
