package com.tabakpp.app.composeapp.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

/**
 * Platform avatar control. Android: pick + JPEG-compress to a Firestore-safe data URL.
 * iOS: display-only placeholder until photo picker ships.
 */
@Composable
expect fun AvatarIdentityBadge(
    avatarDataUrl: String?,
    accentColor: Color,
    modifier: Modifier = Modifier,
    onAvatarChanged: (String?) -> Unit,
)
