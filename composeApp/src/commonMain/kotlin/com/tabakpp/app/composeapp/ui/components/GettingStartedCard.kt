package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.domain.SmokingCalculator

/**
 * State-driven Getting Started card.
 *
 * Derives its checklist from [SmokingCalculator.OnboardingState] (item 27) — no
 * separate onboarding-persisted flag. Disappears automatically once tracking
 * evidence exists (stage >= 2). Optionally dismissible via onDismiss.
 *
 * Shows:
 *   ✓ Tracker created
 *   ✓ Daily target set
 *   ○ Record your first activity
 *
 * Plus a hint line explaining what the target means (item 12).
 */
@Composable
fun GettingStartedCard(
    onboarding: SmokingCalculator.OnboardingState,
    modifier: Modifier = Modifier,
    onDismiss: (() -> Unit)? = null,
) {
    if (onboarding.hasTrackingEvidence) return

    val accent = LocalAccentColor.current

    Column(modifier = modifier.fillMaxWidth()) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .tabakCardEnter(0)
                .tabakCardShadow(RoundedCornerShape(20.dp)),
            shape = RoundedCornerShape(20.dp),
            color = SurfaceElevated,
            border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "GETTING STARTED",
                        style = TabakTypography.labelSmall.copy(
                            fontWeight = FontWeight.Black,
                            letterSpacing = 2.sp,
                            color = TextPrimary
                        )
                    )
                    onDismiss?.let {
                        IconButton(onClick = it, modifier = Modifier.size(40.dp)) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Dismiss",
                                tint = TextMuted,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                CheckStep("Tracker created", onboarding.hasTracker, accent)
                Spacer(modifier = Modifier.height(10.dp))
                CheckStep("Daily target set", onboarding.hasTracker, accent)
                Spacer(modifier = Modifier.height(10.dp))
                PendingStep("Record your first activity")

                Text(
                    "Your target is the daily level you want to stay at or below.",
                    style = TabakTypography.bodySmall,
                    color = TextMuted,
                    textAlign = TextAlign.Start,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}

@Composable
private fun CheckStep(label: String, isComplete: Boolean, accent: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = if (isComplete) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
            contentDescription = if (isComplete) "Done" else "Pending",
            tint = if (isComplete) accent else TextMuted,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(10.dp))
        Text(
            label,
            style = TabakTypography.bodyMedium.copy(
                fontWeight = if (isComplete) FontWeight.SemiBold else FontWeight.Normal,
                color = if (isComplete) TextPrimary else TextMuted
            )
        )
    }
}

@Composable
private fun PendingStep(label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = Icons.Rounded.RadioButtonUnchecked,
            contentDescription = "Pending",
            tint = TextMuted,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(10.dp))
        Text(label, style = TabakTypography.bodyMedium, color = TextPrimary)
    }
}
