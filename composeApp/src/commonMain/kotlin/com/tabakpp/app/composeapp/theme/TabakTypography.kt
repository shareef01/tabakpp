package com.tabakpp.app.composeapp.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// 8-Point Swiss Information Architecture
val TabakTypography = Typography(
    displayLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 72.sp, // Hero scale for counters
        letterSpacing = (-2).sp,
        fontFeatureSettings = "tnum",
        color = TextPrimary
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 28.sp,
        letterSpacing = (-0.5).sp,
        color = TextPrimary
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold, // Sharper for dark mode
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
        color = TextPrimary
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp,
        color = TextPrimary
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 12.sp,
        letterSpacing = 1.2.sp,
        color = TextMuted
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Black,
        fontSize = 11.sp,
        letterSpacing = 1.2.sp,
        color = TextMuted
    )
)

val DisplayCounterStyle = TabakTypography.displayLarge

val CounterStyle = DisplayCounterStyle

val TrackerNameStyle = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.Black,
    fontSize = 12.sp,
    letterSpacing = 1.sp,
    color = TextPrimary
)
