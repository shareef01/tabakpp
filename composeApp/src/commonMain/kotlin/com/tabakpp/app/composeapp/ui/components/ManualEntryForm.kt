package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.domain.SmokingCalculator

/**
 * Platinum-Quality Manual Log Entry Form.
 * Aligned with the industrial material system for 100% consistency.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualEntryForm(
    configs: List<TrackerConfig>,
    initialLog: LogEntry? = null,
    initialDate: String = "",
    accentColor: Color,
    onSave: (String, Map<String, Double>) -> Unit,
    onDismiss: () -> Unit
) {
    // Editing can only change counts (updateLog keeps the original date),
    // so the date field is locked in edit mode.
    val isEditing = initialLog != null
    var date by rememberSaveable(initialLog?.id, initialDate) {
        mutableStateOf(initialLog?.logDate ?: initialDate)
    }
    val isDateValid = SmokingCalculator.isValidDate(date)
    val countsSaver = remember {
        mapSaver<SnapshotStateMap<String, String>>(
            save = { it.toMap() },
            restore = { restored ->
                mutableStateMapOf<String, String>().apply {
                    restored.forEach { (key, value) -> this[key] = value as String }
                }
            }
        )
    }
    val counts = rememberSaveable(configs.map { it.id }, initialLog?.id, saver = countsSaver) {
        mutableStateMapOf<String, String>().apply {
            configs.forEach { config ->
                this[config.id] = initialLog?.counts?.get(config.id)?.toInt()?.toString() ?: "0"
            }
        }
    }

    val scrollState = rememberScrollState()
    val premiumGradient = Brush.verticalGradient(listOf(Color(0xFF16161A), Color(0xFF09090B)))
    val glassBorder = Color.White.copy(alpha = 0.08f)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.9f)
            .background(Color(0xFF050505))
            .imePadding()
            .navigationBarsPadding()
            .padding(24.dp)
            .verticalScroll(scrollState),
        horizontalAlignment = Alignment.Start
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "HISTORICAL ENTRY",
                style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black, letterSpacing = 2.sp),
                color = TextPrimary
            )
            IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Close, contentDescription = "Close entry form", tint = TextMuted, modifier = Modifier.size(20.dp))
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // DATE SECTION
        FormTitle("Deployment Timestamp")
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(4.dp, MaterialTheme.shapes.medium)
                .clip(MaterialTheme.shapes.medium)
                .background(premiumGradient)
                .border(1.dp, glassBorder, MaterialTheme.shapes.medium)
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                OutlinedTextField(
                    value = date,
                    onValueChange = { date = it.take(10) },
                    enabled = !isEditing,
                    isError = date.isNotBlank() && !isDateValid,
                    placeholder = { Text("YYYY-MM-DD", color = TextDisabled, style = TabakTypography.bodyMedium) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.small,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.White.copy(alpha = 0.03f),
                        unfocusedContainerColor = Color.White.copy(alpha = 0.03f),
                        disabledContainerColor = Color.White.copy(alpha = 0.02f),
                        focusedIndicatorColor = accentColor.copy(alpha = 0.5f),
                        unfocusedIndicatorColor = Color.White.copy(alpha = 0.08f),
                        disabledIndicatorColor = Color.White.copy(alpha = 0.05f),
                        errorIndicatorColor = ErrorColor.copy(alpha = 0.6f),
                        errorContainerColor = Color.White.copy(alpha = 0.03f),
                        cursorColor = accentColor,
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        disabledTextColor = Color.White.copy(alpha = 0.5f),
                        errorTextColor = Color.White
                    ),
                    singleLine = true
                )
                if (date.isNotBlank() && !isDateValid) {
                    Text(
                        "INVALID DATE — USE YYYY-MM-DD",
                        style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp),
                        color = ErrorColor,
                        modifier = Modifier.padding(top = 8.dp, start = 4.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // COUNTS SECTION
        FormTitle("Tactical Unit Data")
        configs.forEach { config ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .shadow(2.dp, MaterialTheme.shapes.medium)
                    .clip(MaterialTheme.shapes.medium)
                    .background(premiumGradient)
                    .border(1.dp, glassBorder, MaterialTheme.shapes.medium)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(config.name.uppercase(), style = TabakTypography.bodyLarge.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp), color = TextPrimary)
                    
                    OutlinedTextField(
                        value = counts[config.id] ?: "0",
                        onValueChange = { value ->
                            counts[config.id] = value.filter(Char::isDigit).take(5)
                        },
                        modifier = Modifier.width(90.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        shape = MaterialTheme.shapes.small,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.White.copy(alpha = 0.03f),
                            unfocusedContainerColor = Color.White.copy(alpha = 0.03f),
                            focusedIndicatorColor = accentColor.copy(alpha = 0.5f),
                            unfocusedIndicatorColor = Color.White.copy(alpha = 0.08f),
                            cursorColor = accentColor,
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        ),
                        singleLine = true
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(48.dp))

        Button(
            onClick = {
                val finalCounts = counts.mapValues {
                    (it.value.toDoubleOrNull() ?: 0.0).coerceIn(0.0, 10_000.0)
                }
                onSave(date, finalCounts)
            },
            modifier = Modifier.fillMaxWidth().height(60.dp).tabakPressScale().border(1.dp, accentColor.copy(alpha = 0.4f), MaterialTheme.shapes.medium),
            shape = MaterialTheme.shapes.medium,
            colors = ButtonDefaults.buttonColors(containerColor = accentColor.copy(alpha = 0.12f), contentColor = accentColor),
            enabled = isEditing || isDateValid
        ) {
            Text(
                if (isEditing) "UPDATE HISTORY" else "LOG ENTRY",
                style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp)
            )
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun FormTitle(text: String) {
    Text(
        text = text.uppercase(),
        style = TabakTypography.labelSmall.copy(letterSpacing = 2.sp, fontWeight = FontWeight.Black),
        color = DefaultAccent,
        modifier = Modifier.padding(start = 4.dp, bottom = 12.dp)
    )
}
