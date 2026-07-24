package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*

@Composable
fun InsightCard(
    label: String,
    value: String,
    subtitle: String,
    icon: ImageVector,
    infoText: String,
    accentColor: Color,
    modifier: Modifier = Modifier
) {
    var showInfo by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .insetHighlight(),
        shape = MaterialTheme.shapes.medium,
        color = Color(0xFF18181B),
        border = null
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                // Icon in rounded square
                Surface(
                    modifier = Modifier.size(40.dp),
                    shape = RoundedCornerShape(12.dp),
                    color = accentColor.copy(alpha = 0.15f), // More vibrant background
                    border = BorderStroke(1.dp, accentColor.copy(alpha = 0.25f)) // Sharper border
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(icon, contentDescription = null, tint = accentColor, modifier = Modifier.size(20.dp))
                    }
                }

                IconButton(
                    onClick = { showInfo = true },
                    modifier = Modifier.size(44.dp)
                ) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = "Info",
                        tint = TextDisabled,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            Text(
                text = value,
                style = TabakTypography.titleLarge.copy(fontSize = 24.sp),
                color = TextPrimary
            )
            
            Text(
                text = subtitle,
                style = TabakTypography.labelSmall.copy(letterSpacing = 0.5.sp),
                color = TextMuted,
                softWrap = true,
                lineHeight = 12.sp
            )
        }
    }

    if (showInfo) {
        AlertDialog(
            onDismissRequest = { showInfo = false },
            containerColor = SurfaceCard.copy(alpha = 0.95f),
            titleContentColor = TextPrimary,
            textContentColor = TextMuted,
            title = { Text(label, style = TabakTypography.titleLarge.copy(fontSize = 18.sp)) },
            text = { Text(infoText, style = MaterialTheme.typography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { showInfo = false }) {
                    Text("GOT IT", style = TabakTypography.labelSmall, color = accentColor)
                }
            }
        )
    }
}
