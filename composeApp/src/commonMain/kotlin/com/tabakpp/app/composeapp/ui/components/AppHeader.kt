package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.ViewAgenda
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.data.WidgetSize
import androidx.compose.animation.core.snap

/**
 * Command Header for tabak++.
 * Features the grid toggle for absolute dashboard density control and a custom logotype.
 */
@Composable
fun AppHeader(
    accentColor: Color,
    widgetSize: WidgetSize,
    onToggleGrid: (WidgetSize) -> Unit,
    onSignOutClick: () -> Unit,
    isCollapsed: Boolean = false
) {
    var showMenu by remember { mutableStateOf(false) }
    val haptics = rememberTabakHaptics()
    val reducedMotion = LocalReducedMotion.current
    val headerHeight by animateDpAsState(
        if (isCollapsed) 64.dp else 80.dp,
        animationSpec = if (reducedMotion) snap() else androidx.compose.animation.core.spring()
    )

    Surface(
        modifier = Modifier
            .fillMaxWidth(),
        color = Color(0xFF09090B),
        tonalElevation = 12.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(headerHeight)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "tabak",
                    color = Color.White,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Black,
                    letterSpacing = (-1).sp // Tight premium kerning
                )
                Text(
                    text = "++",
                    color = accentColor,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Black,
                )
            }

            // THE ACTION ICONS (Grid Toggle & Profile)
            Row(verticalAlignment = Alignment.CenterVertically) {
                // THE GRID TOGGLE BUTTON
                IconButton(onClick = {
                    haptics()
                    val newSize = when (widgetSize) {
                        WidgetSize.SMALL -> WidgetSize.MEDIUM
                        WidgetSize.MEDIUM -> WidgetSize.LARGE
                        WidgetSize.LARGE -> WidgetSize.SMALL
                    }
                    onToggleGrid(newSize)
                }, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = if (widgetSize == WidgetSize.LARGE) Icons.Rounded.ViewAgenda else Icons.Rounded.GridView,
                        contentDescription = "Change dashboard density. Current ${widgetSize.accessibleLabel()}",
                        tint = TextMuted,
                        modifier = Modifier.size(26.dp)
                    )
                }
                
                Spacer(modifier = Modifier.width(8.dp))

                // Profile Button / Command Menu
                Box {
                    FilledIconButton(
                        onClick = { 
                            haptics()
                            showMenu = true 
                        },
                        modifier = Modifier.size(48.dp),
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = Color.White.copy(alpha = 0.1f),
                            contentColor = Color.White
                        ),
                        shape = CircleShape
                    ) {
                        Icon(Icons.Rounded.Person, contentDescription = "Profile", modifier = Modifier.size(20.dp))
                    }

                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false },
                        modifier = Modifier
                            .background(Color(0xFF121214))
                            .border(1.dp, Color.White.copy(alpha = 0.08f), MaterialTheme.shapes.small)
                    ) {
                        DropdownMenuItem(
                            text = { Text("Sign out", color = ErrorColor) },
                            onClick = { 
                                showMenu = false
                                onSignOutClick() 
                            },
                            leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = ErrorColor, modifier = Modifier.size(18.dp)) }
                        )
                    }
                }
            }
        }
    }
}

private fun WidgetSize.accessibleLabel(): String = when (this) {
    WidgetSize.SMALL -> "Compact"
    WidgetSize.MEDIUM -> "Comfortable"
    WidgetSize.LARGE -> "Spacious"
}
