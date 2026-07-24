package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.tabakpp.app.composeapp.theme.TextDisabled

@Composable
actual fun AvatarIdentityBadge(
    avatarDataUrl: String?,
    accentColor: Color,
    modifier: Modifier,
    onAvatarChanged: (String?) -> Unit,
) {
    // iOS photo picker / compression not wired yet — display placeholder only.
    Box(modifier = modifier.size(72.dp), contentAlignment = Alignment.Center) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            shape = CircleShape,
            color = Color.White.copy(alpha = 0.05f),
            border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(36.dp),
                    tint = TextDisabled
                )
            }
        }
    }
}
