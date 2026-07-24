package com.tabakpp.app.composeapp.theme

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

fun Modifier.tabakCardShadow(shape: Shape) = this.shadow(
    elevation = 40.dp,
    shape = shape,
    ambientColor = Color.Black.copy(alpha = 0.45f),
    spotColor = Color.Black.copy(alpha = 0.45f)
)

fun Modifier.tabakNavShadow(shape: Shape) = this.shadow(
    elevation = 32.dp,
    shape = shape,
    ambientColor = Color.Black.copy(alpha = 0.55f),
    spotColor = Color.Black.copy(alpha = 0.55f)
)

fun Modifier.insetHighlight() = this.drawWithContent {
    drawContent()
    // Top inner highlight
    drawLine(
        color = InsetHighlightColor,
        start = Offset(0f, 0.5f),
        end = Offset(size.width, 0.5f),
        strokeWidth = 1.dp.toPx()
    )
}
