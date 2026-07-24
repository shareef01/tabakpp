package com.tabakpp.app.composeapp.theme

import androidx.compose.ui.graphics.Color

// Pure OLED Canvas
val CanvasBackground = Color(0xFF000000)
val BackgroundCanvas = CanvasBackground 

// Industrial Surface System
val SurfaceBase = Color(0xFF0A0A0B) // Deep matte grey
val SurfaceCard = SurfaceBase
val SurfaceElevated = Color(0xFF141416)
val SurfaceControl = Color(0xFF1C1C1E) // For interactive elements
val SurfaceRaised = SurfaceElevated

// High-Contrast Typography
val TextPrimary = Color(0xFFFFFFFF)
val TextMuted = Color(0xFFA1A1AA)     // Zinc-400
val TextDisabled = Color(0xFF71717A)  // Zinc-500 — readable metadata on OLED black

// Machined Borders & Highlights
val BorderWhite = Color.White.copy(alpha = 0.08f)
val BorderGlass = Color.White.copy(alpha = 0.05f)
val InsetHighlightColor = Color.White.copy(alpha = 0.04f)

// Brand Tokens
val DefaultAccent = Color(0xFF10B981) // Emerald Green
val DangerColor = Color(0xFFEF4444)   // Red
val ErrorColor = DangerColor
val WarningColor = Color(0xFFFACC15) // Amber-400
val SuccessColor = Color(0xFF10B981) // Emerald-500
