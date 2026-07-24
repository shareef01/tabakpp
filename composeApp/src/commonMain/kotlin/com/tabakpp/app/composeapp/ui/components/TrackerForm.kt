package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.data.InputSanitizer
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType

/**
 * Platinum-Quality Tracker Configuration Form.
 * Adheres to industrial dark-mode standards with premium material gradients.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackerForm(
    initialConfig: TrackerConfig? = null,
    accentColor: Color,
    onSave: (TrackerConfig) -> Unit,
    onDismiss: () -> Unit
) {
    var name by rememberSaveable(initialConfig?.id) { mutableStateOf(initialConfig?.name ?: "") }
    var limit by rememberSaveable(initialConfig?.id) { mutableStateOf(initialConfig?.limit?.toString() ?: "20") }
    var typeName by rememberSaveable(initialConfig?.id) {
        val initial = initialConfig?.type ?: TrackerType.CIGARETTE
        // Joint is no longer offered; coerce legacy trackers to Cigarette in the editor.
        mutableStateOf(
            if (initial == TrackerType.JOINT_KING) TrackerType.CIGARETTE.name else initial.name
        )
    }
    var isPrimary by rememberSaveable(initialConfig?.id) {
        mutableStateOf(initialConfig?.isPrimaryTracked ?: true)
    }
    var isFinancial by rememberSaveable(initialConfig?.id) {
        mutableStateOf(initialConfig?.isFinanciallyTracked ?: true)
    }
    var pricePerUnit by rememberSaveable(initialConfig?.id) {
        mutableStateOf(initialConfig?.pricePerUnit?.toString() ?: "0.5")
    }
    val type = TrackerType.valueOf(typeName)

    val scrollState = rememberScrollState()
    val premiumGradient = Brush.verticalGradient(listOf(Color(0xFF16161A), Color(0xFF09090B)))
    val glassBorder = Color.White.copy(alpha = 0.08f)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.95f)
            .background(Color(0xFF050505)) // Deep background
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
                if (initialConfig == null) "NEW COUNTER" else "EDIT CONFIG",
                style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black, letterSpacing = 2.sp),
                color = TextPrimary
            )
            IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Close, contentDescription = "Close tracker form", tint = TextMuted, modifier = Modifier.size(20.dp))
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // SECTION 1: IDENTITY
        FormLabel("Label & Type")
        FormBox(premiumGradient, glassBorder) {
            Column(modifier = Modifier.padding(20.dp)) {
                FormTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = "TRACKER NAME",
                    placeholder = "e.g. Marlboro Red"
                )
                
                Spacer(modifier = Modifier.height(28.dp))
                
                Text("GAUGE ARCHITECTURE", style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Black), color = TextMuted)
                Spacer(modifier = Modifier.height(12.dp))
                TypeSelector(
                    selectedType = type,
                    onTypeSelected = { typeName = it.name },
                    accentColor = accentColor
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // SECTION 2: OBJECTIVES
        FormLabel("Target Protocol")
        FormBox(premiumGradient, glassBorder) {
            Column(modifier = Modifier.padding(20.dp)) {
                FormTextField(
                    value = limit,
                    onValueChange = { limit = it },
                    label = "DAILY UNIT LIMIT",
                    keyboardType = KeyboardType.Number,
                    placeholder = "Units"
                )
                
                Spacer(modifier = Modifier.height(20.dp))
                
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = isPrimary,
                        onCheckedChange = { isPrimary = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = accentColor, 
                            uncheckedColor = Color.White.copy(alpha = 0.1f)
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Primary streak tracker", style = TabakTypography.bodyMedium, color = TextPrimary)
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // SECTION 3: ECONOMICS
        FormLabel("Financial intelligence")
        FormBox(premiumGradient, glassBorder) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(
                        checked = isFinancial,
                        onCheckedChange = { isFinancial = it },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = accentColor,
                            uncheckedTrackColor = Color.White.copy(alpha = 0.05f)
                        )
                    )
                    Spacer(modifier = Modifier.width(16.dp))
                    Text("Cost tracking", style = TabakTypography.bodyMedium, color = TextPrimary)
                }

                if (isFinancial) {
                    Spacer(modifier = Modifier.height(28.dp))
                    FormTextField(
                        value = pricePerUnit,
                        onValueChange = { pricePerUnit = it },
                        label = "UNIT PRICE (€)",
                        keyboardType = KeyboardType.Decimal
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(48.dp))

        // ACTION BUTTONS
        Button(
            onClick = {
                onSave(TrackerConfig(
                    id = initialConfig?.id ?: "",
                    name = InputSanitizer.trackerName(name),
                    limit = (limit.toIntOrNull() ?: 20).coerceIn(0, 10_000),
                    order = initialConfig?.order ?: 0,
                    type = type,
                    isPrimaryTracked = isPrimary,
                    isFinanciallyTracked = isFinancial,
                    pricePerUnit = (pricePerUnit.replace(',', '.').toDoubleOrNull() ?: 0.5)
                        .coerceIn(0.0, 1_000.0)
                ))
            },
            modifier = Modifier.fillMaxWidth().height(60.dp).tabakPressScale().border(1.dp, accentColor.copy(alpha = 0.4f), MaterialTheme.shapes.small),
            shape = MaterialTheme.shapes.small,
            colors = ButtonDefaults.buttonColors(containerColor = accentColor.copy(alpha = 0.12f), contentColor = accentColor),
            enabled = InputSanitizer.trackerName(name).isNotBlank()
        ) {
            Text(
                if (initialConfig == null) "SAVE COUNTER" else "UPDATE COUNTER",
                style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp)
            )
        }
        
        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun FormLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = TabakTypography.labelSmall.copy(letterSpacing = 2.sp, fontWeight = FontWeight.Black),
        color = DefaultAccent,
        modifier = Modifier.padding(start = 4.dp, bottom = 12.dp)
    )
}

@Composable
private fun FormBox(gradient: Brush, border: Color, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(4.dp, RoundedCornerShape(24.dp))
            .clip(RoundedCornerShape(24.dp))
            .background(gradient)
            .border(1.dp, border, RoundedCornerShape(24.dp))
    ) {
        content()
    }
}

@Composable
private fun FormTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String = "",
    keyboardType: KeyboardType = KeyboardType.Text
) {
    Column {
        Text(label, style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Bold), color = TextMuted, modifier = Modifier.padding(bottom = 8.dp, start = 4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
            label = { Text(label) },
            placeholder = { Text(placeholder, color = TextMuted, style = TabakTypography.bodyMedium) },
            shape = RoundedCornerShape(14.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.White.copy(alpha = 0.03f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.03f),
                focusedIndicatorColor = LocalAccentColor.current.copy(alpha = 0.5f),
                unfocusedIndicatorColor = Color.White.copy(alpha = 0.08f),
                cursorColor = LocalAccentColor.current,
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White
            ),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            singleLine = true
        )
    }
}

@Composable
private fun TypeSelector(
    selectedType: TrackerType,
    onTypeSelected: (TrackerType) -> Unit,
    accentColor: Color
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        val selectableTypes = listOf(
            TrackerType.CIGARETTE,
            TrackerType.RYO_ROLL,
            TrackerType.SIMPLE
        )
        selectableTypes.forEach { type ->
            val isSelected = type == selectedType
            Surface(
                onClick = { onTypeSelected(type) },
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .tabakPressScale(),
                color = if (isSelected) accentColor.copy(alpha = 0.15f) else Color.White.copy(alpha = 0.04f),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, if (isSelected) accentColor else Color.White.copy(alpha = 0.05f))
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 4.dp, vertical = 10.dp)) {
                    val label = when (type) {
                        TrackerType.CIGARETTE -> "Cigarette"
                        TrackerType.RYO_ROLL -> "RYO"
                        TrackerType.SIMPLE -> "Custom"
                        else -> type.name
                    }
                    Text(
                        text = label,
                        style = TabakTypography.labelSmall.copy(fontWeight = if (isSelected) FontWeight.Black else FontWeight.Bold),
                        color = if (isSelected) accentColor else TextMuted
                    )
                }
            }
        }
    }
}
