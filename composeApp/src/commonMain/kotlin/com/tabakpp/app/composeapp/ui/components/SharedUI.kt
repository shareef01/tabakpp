package com.tabakpp.app.composeapp.ui.components

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import com.tabakpp.app.composeapp.theme.*

/**
 * Platinum Modal Frame with Industrial Depth.
 */
@Composable
fun ModalFrame(
    onDismissRequest: () -> Unit,
    content: @Composable () -> Unit
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = true,
            dismissOnClickOutside = true
        )
    ) {
        var visible by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { visible = true }

        val reducedMotion = LocalReducedMotion.current
        val alpha by animateFloatAsState(
            targetValue = if (visible) 1f else 0f,
            animationSpec = if (reducedMotion) snap() else tween(300)
        )
        val premiumGradient = Brush.verticalGradient(listOf(Color(0xFF16161A), Color(0xFF09090B)))

        Box(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding()
                .graphicsLayer { this.alpha = alpha }
                .background(Color.Black.copy(alpha = 0.85f)),
            contentAlignment = Alignment.BottomCenter
        ) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .widthIn(max = 500.dp)
                    .heightIn(max = 720.dp)
                    .tabakCardShadow(MaterialTheme.shapes.large),
                shape = MaterialTheme.shapes.large,
                color = Color(0xFF0F0F12),
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
            ) {
                Box(
                    modifier = Modifier
                        .background(premiumGradient)
                        .verticalScroll(rememberScrollState())
                ) {
                    content()
                }
            }
        }
    }
}

@Composable
fun ConfirmModal(
    title: String,
    message: String,
    confirmLabel: String = "Confirm",
    dismissLabel: String = "Cancel",
    tintColor: Color = ErrorColor,
    icon: androidx.compose.ui.graphics.vector.ImageVector = Icons.Default.PriorityHigh,
    isLoading: Boolean = false,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalFrame(onDismissRequest = { if (!isLoading) onDismiss() }) {
        Box(modifier = Modifier.padding(32.dp)) {
            if (!isLoading) {
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.align(Alignment.TopEnd).offset(x = 16.dp, y = (-16).dp)
                ) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = TextDisabled, modifier = Modifier.size(20.dp))
                }
            }

            Column(horizontalAlignment = Alignment.Start) {
                Surface(
                    modifier = Modifier.size(48.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = tintColor.copy(alpha = 0.12f),
                    border = BorderStroke(1.dp, tintColor.copy(alpha = 0.2f))
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(icon, contentDescription = "Alert", tint = tintColor, modifier = Modifier.size(24.dp))
                    }
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Text(
                    text = title.uppercase(),
                    style = TabakTypography.headlineMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp),
                    color = TextPrimary
                )
                
                Spacer(modifier = Modifier.height(12.dp))
                
                Text(
                    text = message,
                    style = TabakTypography.bodyMedium,
                    color = TextMuted,
                    lineHeight = 22.sp
                )
                
                Spacer(modifier = Modifier.height(32.dp))
                
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = onConfirm,
                        modifier = Modifier.fillMaxWidth().height(56.dp).tabakPressScale().border(1.dp, tintColor.copy(alpha = 0.4f), RoundedCornerShape(16.dp)),
                        enabled = !isLoading,
                        colors = ButtonDefaults.buttonColors(containerColor = tintColor.copy(alpha = 0.12f), contentColor = tintColor),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = tintColor, strokeWidth = 2.dp)
                        } else {
                            Text(confirmLabel.uppercase(), style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black))
                        }
                    }
                    
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.fillMaxWidth().height(56.dp).tabakPressScale(),
                        enabled = !isLoading
                    ) {
                        Text(dismissLabel.uppercase(), style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black), color = TextDisabled)
                    }
                }
            }
        }
    }
}

@Composable
fun TabakSnackbar(snackbarData: SnackbarData) {
    val premiumGradient = Brush.verticalGradient(listOf(Color(0xFF16161A), Color(0xFF09090B)))
    Surface(
        modifier = Modifier
            .padding(16.dp)
            .fillMaxWidth()
            .widthIn(max = 440.dp)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .tabakCardShadow(RoundedCornerShape(16.dp)),
        shape = RoundedCornerShape(16.dp),
        color = Color(0xFF141416),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
    ) {
        Box(modifier = Modifier.background(premiumGradient)) {
            Row(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = snackbarData.visuals.message.uppercase(),
                    style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, color = TextPrimary, letterSpacing = 1.sp),
                    modifier = Modifier.weight(1f)
                )
                
                snackbarData.visuals.actionLabel?.let { label ->
                    Surface(
                        onClick = { snackbarData.performAction() },
                        color = Color.White.copy(alpha = 0.05f),
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f)),
                        modifier = Modifier.padding(start = 16.dp).heightIn(min = 48.dp)
                    ) {
                        Text(
                            text = label.uppercase(),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp),
                            color = LocalAccentColor.current
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun SkeletonBox(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = RoundedCornerShape(16.dp)
) {
    Box(
        modifier = modifier
            .background(Color.White.copy(alpha = 0.03f), shape = shape)
            .border(0.5.dp, Color.White.copy(alpha = 0.05f), shape)
    )
}

@Composable
fun TrackSkeleton() {
    Column(modifier = Modifier.fillMaxSize().padding(24.dp)) {
        SkeletonBox(modifier = Modifier.fillMaxWidth().height(80.dp).padding(bottom = 24.dp))
        SkeletonBox(modifier = Modifier.fillMaxWidth().height(260.dp).padding(bottom = 16.dp))
        SkeletonBox(modifier = Modifier.fillMaxWidth().height(260.dp).padding(bottom = 16.dp))
        Spacer(modifier = Modifier.weight(1f))
        SkeletonBox(modifier = Modifier.fillMaxWidth().height(120.dp))
    }
}

@Composable
fun OfflineBanner(isOffline: Boolean) {
    if (isOffline) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color(0xFFF59E0B).copy(alpha = 0.15f),
        ) {
            Row(
                modifier = Modifier
                    .padding(vertical = 8.dp, horizontal = 16.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "You're offline — some changes may fail until you're back online",
                    style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp),
                    color = WarningColor
                )
            }
        }
    }
}
