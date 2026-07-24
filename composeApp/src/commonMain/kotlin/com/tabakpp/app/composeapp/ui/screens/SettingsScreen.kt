package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.composeapp.ui.components.AvatarIdentityBadge
import com.tabakpp.app.composeapp.ui.components.ConfirmModal
import com.tabakpp.app.composeapp.ui.components.TrackerForm
import com.tabakpp.app.data.InputSanitizer
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.data.WidgetSize
import com.tabakpp.app.viewmodels.RegistryViewModel
import com.tabakpp.app.viewmodels.AuthViewModel
import kotlinx.coroutines.delay
import org.koin.compose.koinInject

/**
 * Platinum-Quality Control Panel.
 * Synchronized with the premium industrial aesthetic.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: RegistryViewModel,
    innerPadding: PaddingValues = PaddingValues(0.dp)
) {
    val profile by viewModel.userProfile.collectAsStateWithLifecycle()
    val configs by viewModel.configs.collectAsStateWithLifecycle()
    val authViewModel = koinInject<AuthViewModel>()
    
    val accentColor = LocalAccentColor.current

    var configToEditId by rememberSaveable { mutableStateOf<String?>(null) }
    var configToDeleteId by rememberSaveable { mutableStateOf<String?>(null) }
    val configToEdit = configs.firstOrNull { it.id == configToEditId }
    val configToDelete = configs.firstOrNull { it.id == configToDeleteId }
    var showAddTrackerSheet by rememberSaveable { mutableStateOf(false) }
    var showLogoutConfirm by rememberSaveable { mutableStateOf(false) }
    var showDeleteAccount by rememberSaveable { mutableStateOf(false) }
    var showPrivacyNotice by rememberSaveable { mutableStateOf(false) }
    var deletePassword by rememberSaveable { mutableStateOf("") }
    var isDeletingAccount by remember { mutableStateOf(false) }
    val authLoading by authViewModel.loading.collectAsStateWithLifecycle()
    val authError by authViewModel.error.collectAsStateWithLifecycle()
    val authUser by authViewModel.authState.collectAsStateWithLifecycle()
    val canPasswordDelete = authUser?.hasPasswordProvider == true
    val canGoogleDelete = authUser?.hasGoogleProvider == true

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = innerPadding.calculateTopPadding())
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 24.dp,
                bottom = innerPadding.calculateBottomPadding()
            ),
            verticalArrangement = Arrangement.spacedBy(32.dp)
        ) {
            // 1. Identity
            item {
                Column {
                    SettingsHeader("command identity")
                    IdentitySection(
                        profile = profile,
                        onUpdateName = { raw ->
                            val name = InputSanitizer.displayName(raw)
                            viewModel.updateDisplayName(name)
                            viewModel.updateProfile { p -> p.copy(name = name) }
                        },
                        onUpdateAvatar = { dataUrl ->
                            viewModel.updateProfile { p -> p.copy(avatar = dataUrl) }
                        },
                        accentColor = accentColor
                    )
                }
            }

            // 2. Visual Interface
            item {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    SettingsHeader("visual interface")
                    
                    SettingsGroupCard {
                        Column(modifier = Modifier.padding(20.dp)) {
                            Text("ACCENT SPECTRUM", style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Black), color = TextPrimary)
                            Spacer(modifier = Modifier.height(16.dp))
                            AccentPalette(
                                selectedColor = profile?.accent ?: "#10B981",
                                onColorSelected = { viewModel.updateProfile { p -> p.copy(accent = it) } }
                            )
                        }
                    }

                    SettingsGroupCard {
                        Column(modifier = Modifier.padding(20.dp)) {
                            Text("DASHBOARD DENSITY", style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Black), color = TextPrimary)
                            Spacer(modifier = Modifier.height(16.dp))
                            WidgetSizeSelector(
                                selectedSize = profile?.widgetSize ?: WidgetSize.MEDIUM,
                                accentColor = accentColor,
                                onSizeSelected = { viewModel.updateProfile { p -> p.copy(widgetSize = it) } }
                            )
                        }
                    }
                }
            }

            // 3. Habit Configuration
            item {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    SettingsHeader("habit configuration")
                    SettingsGroupCard {
                        Column {
                            configs.forEachIndexed { index, config ->
                                TrackerSettingsItem(
                                    config = config,
                                    onEdit = { configToEditId = config.id },
                                    onDelete = { configToDeleteId = config.id },
                                    onMoveUp = { viewModel.reorderTracker(index, true) },
                                    onMoveDown = { viewModel.reorderTracker(index, false) },
                                    canMoveUp = index > 0,
                                    canMoveDown = index < configs.lastIndex
                                )
                                if (index < configs.size - 1) {
                                    HorizontalDivider(modifier = Modifier.padding(horizontal = 20.dp), color = Color.White.copy(alpha = 0.03f), thickness = 0.5.dp)
                                }
                            }
                        }
                    }
                    
                    Surface(
                        onClick = { showAddTrackerSheet = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .tabakPressScale()
                            .shadow(8.dp, MaterialTheme.shapes.small, ambientColor = accentColor.copy(alpha = 0.2f), spotColor = accentColor.copy(alpha = 0.2f)),
                        color = accentColor,
                        shape = MaterialTheme.shapes.small
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(20.dp), tint = Color.White)
                                Spacer(modifier = Modifier.width(12.dp))
                                Text("ADD NEW TRACKER", style = TabakTypography.labelSmall.copy(color = Color.White, fontWeight = FontWeight.Black, letterSpacing = 1.sp))
                            }
                        }
                    }
                }
            }

            // 4. Night Owl Mode
            item {
                Column {
                    SettingsHeader("night owl mode")
                    DayStartSettings(
                        hour = profile?.dayStartHour ?: 6,
                        onHourChange = { viewModel.updateProfile { p -> p.copy(dayStartHour = it) } },
                        accentColor = accentColor
                    )
                }
            }

            // 5. Economics (web Settings parity)
            item {
                Column {
                    SettingsHeader("economic constants")
                    EconomicsSettings(
                        profile = profile,
                        accentColor = accentColor,
                        onSave = { purchaseType, unitPrice, pouchPrice, estimatedYield ->
                            viewModel.updateProfile { p ->
                                p.copy(
                                    purchaseType = purchaseType,
                                    unitPrice = unitPrice,
                                    pouchPrice = pouchPrice,
                                    estimatedYield = estimatedYield
                                )
                            }
                        }
                    )
                }
            }

            // 6. Privacy
            item {
                Surface(
                    onClick = { showPrivacyNotice = true },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    color = Color.White.copy(alpha = 0.04f),
                    shape = MaterialTheme.shapes.small,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.05f))
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            "PRIVACY AND DATA HANDLING",
                            style = TabakTypography.labelSmall.copy(
                                color = TextMuted,
                                fontWeight = FontWeight.Black,
                                letterSpacing = 1.sp
                            )
                        )
                    }
                }
            }

            // 7. Sign Out / Delete
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Surface(
                        onClick = { showLogoutConfirm = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .tabakPressScale(),
                        color = Color.White.copy(alpha = 0.04f),
                        shape = MaterialTheme.shapes.small,
                        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.05f))
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(20.dp), tint = ErrorColor)
                                Spacer(modifier = Modifier.width(12.dp))
                                Text("SIGN OUT", style = TabakTypography.labelSmall.copy(color = ErrorColor, fontWeight = FontWeight.Black, letterSpacing = 1.sp))
                            }
                        }
                    }
                    Surface(
                        onClick = {
                            deletePassword = ""
                            authViewModel.clearError()
                            showDeleteAccount = true
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .tabakPressScale(),
                        color = ErrorColor.copy(alpha = 0.08f),
                        shape = MaterialTheme.shapes.small,
                        border = BorderStroke(1.dp, ErrorColor.copy(alpha = 0.25f))
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(20.dp), tint = ErrorColor)
                                Spacer(modifier = Modifier.width(12.dp))
                                Text("DELETE ACCOUNT", style = TabakTypography.labelSmall.copy(color = ErrorColor, fontWeight = FontWeight.Black, letterSpacing = 1.sp))
                            }
                        }
                    }
                }
            }
        }
    }

    if (showPrivacyNotice) {
        AlertDialog(
            onDismissRequest = { showPrivacyNotice = false },
            title = { Text("Privacy and data handling") },
            text = {
                Text(
                    "Your account, tracker history, financial estimates, profile settings, and optional avatar are stored in Firebase for synchronization. The app does not sell tracker data. Delete Account removes Firestore data and then the sign-in account; a partial failure is reported so deletion can be retried."
                )
            },
            confirmButton = {
                TextButton(onClick = { showPrivacyNotice = false }) {
                    Text("Close")
                }
            }
        )
    }

    configToDelete?.let { config ->
        ConfirmModal(
            title = "Delete tracker?",
            message = "\"${config.name}\" will be removed from your dashboard. Logged history stays in the vault.",
            confirmLabel = "Delete",
            tintColor = ErrorColor,
            onConfirm = {
                viewModel.deleteTracker(config.id)
                configToDeleteId = null
            },
            onDismiss = { configToDeleteId = null }
        )
    }

    if (showLogoutConfirm) {
        ConfirmModal(
            title = "Sign out?",
            message = "Are you sure you want to sign out? You will need to log in again to access your data.",
            confirmLabel = "Sign out",
            tintColor = ErrorColor,
            onConfirm = {
                showLogoutConfirm = false
                authViewModel.signOut()
            },
            onDismiss = { showLogoutConfirm = false }
        )
    }

    if (showDeleteAccount) {
        com.tabakpp.app.composeapp.ui.components.ModalFrame(
            onDismissRequest = {
                if (!isDeletingAccount) {
                    showDeleteAccount = false
                    deletePassword = ""
                    authViewModel.clearError()
                }
            }
        ) {
            Column(modifier = Modifier.padding(32.dp)) {
                Text(
                    "DELETE ACCOUNT?",
                    style = TabakTypography.headlineMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp),
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    when {
                        !canPasswordDelete && !canGoogleDelete ->
                            "This account has no password or Google sign-in linked. Sign in with a supported method, then retry deletion."
                        canPasswordDelete && canGoogleDelete ->
                            "This permanently deletes your trackers, history, and login. Confirm with password or Google."
                        canGoogleDelete ->
                            "This permanently deletes your trackers, history, and login. Confirm with Google to continue."
                        else ->
                            "This permanently deletes your trackers, history, and login. Enter your password to confirm."
                    },
                    style = TabakTypography.bodyMedium,
                    color = TextMuted,
                    lineHeight = 22.sp
                )
                if (!canPasswordDelete && !canGoogleDelete) {
                    Spacer(modifier = Modifier.height(24.dp))
                    TextButton(
                        onClick = {
                            showDeleteAccount = false
                            authViewModel.clearError()
                        },
                        modifier = Modifier.fillMaxWidth().height(56.dp)
                    ) {
                        Text("CLOSE", style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black), color = TextDisabled)
                    }
                } else {
                if (canPasswordDelete) {
                    Spacer(modifier = Modifier.height(20.dp))
                    Text(
                        "PASSWORD",
                        style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp),
                        color = TextMuted
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    BasicTextField(
                        value = deletePassword,
                        onValueChange = { deletePassword = it },
                        singleLine = true,
                        enabled = !isDeletingAccount,
                        textStyle = TabakTypography.bodyMedium.copy(color = TextPrimary),
                        cursorBrush = SolidColor(accentColor),
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics { contentDescription = "Password" }
                            .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(12.dp))
                            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                            .padding(14.dp)
                    )
                }
                authError?.let {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(it, style = TabakTypography.labelSmall, color = ErrorColor)
                }
                Spacer(modifier = Modifier.height(24.dp))
                if (canPasswordDelete) {
                    Button(
                        onClick = {
                            if (deletePassword.isBlank() || isDeletingAccount) return@Button
                            isDeletingAccount = true
                            authViewModel.deleteAccount(deletePassword) { result ->
                                isDeletingAccount = false
                                if (result.isSuccess) {
                                    showDeleteAccount = false
                                    deletePassword = ""
                                }
                            }
                        },
                        enabled = !isDeletingAccount && deletePassword.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ErrorColor.copy(alpha = 0.12f),
                            contentColor = ErrorColor
                        ),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        if (isDeletingAccount || authLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = ErrorColor, strokeWidth = 2.dp)
                        } else {
                            Text("DELETE FOREVER", style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black))
                        }
                    }
                }
                if (canGoogleDelete) {
                    if (canPasswordDelete) Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = {
                            if (isDeletingAccount) return@Button
                            isDeletingAccount = true
                            authViewModel.deleteAccount(null) { result ->
                                isDeletingAccount = false
                                if (result.isSuccess) {
                                    showDeleteAccount = false
                                    deletePassword = ""
                                }
                            }
                        },
                        enabled = !isDeletingAccount,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ErrorColor.copy(alpha = 0.12f),
                            contentColor = ErrorColor
                        ),
                        shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.dp, ErrorColor.copy(alpha = 0.35f))
                    ) {
                        if (isDeletingAccount || authLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = ErrorColor, strokeWidth = 2.dp)
                        } else {
                            Text(
                                if (canPasswordDelete) "CONFIRM WITH GOOGLE" else "DELETE WITH GOOGLE",
                                style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black)
                            )
                        }
                    }
                }
                TextButton(
                    onClick = {
                        if (!isDeletingAccount) {
                            showDeleteAccount = false
                            deletePassword = ""
                            authViewModel.clearError()
                        }
                    },
                    enabled = !isDeletingAccount,
                    modifier = Modifier.fillMaxWidth().height(56.dp)
                ) {
                    Text("CANCEL", style = TabakTypography.labelMedium.copy(fontWeight = FontWeight.Black), color = TextDisabled)
                }
                } // supported providers
            }
        }
    }

    if (configToEdit != null) {
        ModalBottomSheet(
            onDismissRequest = { configToEditId = null },
            containerColor = Color(0xFF0F0F12)
        ) {
            TrackerForm(
                initialConfig = configToEdit,
                accentColor = accentColor,
                onSave = { 
                    viewModel.updateTracker(it)
                    configToEditId = null
                },
                onDismiss = { configToEditId = null }
            )
        }
    }

    if (showAddTrackerSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAddTrackerSheet = false },
            containerColor = Color(0xFF0F0F12)
        ) {
            TrackerForm(
                accentColor = accentColor,
                onSave = { config ->
                    viewModel.addTracker(config)
                    showAddTrackerSheet = false
                },
                onDismiss = { showAddTrackerSheet = false }
            )
        }
    }
}

@Composable
fun SettingsHeader(title: String) {
    Text(
        text = title.uppercase(),
        style = TabakTypography.labelSmall.copy(color = DefaultAccent, letterSpacing = 2.sp, fontWeight = FontWeight.Black),
        modifier = Modifier.padding(start = 4.dp, bottom = 12.dp)
    )
}

@Composable
fun SettingsGroupCard(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .tabakCardShadow(RoundedCornerShape(20.dp))
            .insetHighlight(),
        shape = RoundedCornerShape(20.dp),
        color = SurfaceBase,
        border = BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f)),
        content = content
    )
}

@Composable
fun IdentitySection(
    profile: UserProfile?,
    onUpdateName: (String) -> Unit,
    onUpdateAvatar: (String?) -> Unit,
    accentColor: Color
) {
    SettingsGroupCard {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AvatarIdentityBadge(
                avatarDataUrl = profile?.avatar,
                accentColor = accentColor,
                onAvatarChanged = onUpdateAvatar
            )
            
            Spacer(modifier = Modifier.width(24.dp))
            
            var name by remember(profile?.name) { mutableStateOf(profile?.name ?: "") }
            
            Column(modifier = Modifier.weight(1f)) {
                BasicTextField(
                    value = name,
                    onValueChange = { name = it.take(100) },
                    textStyle = TabakTypography.headlineMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.Black),
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = "Display name" },
                    cursorBrush = SolidColor(TextPrimary),
                    singleLine = true
                )
                Text(
                    text = "IDENTIFIED COMMANDER",
                    style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp),
                    color = TextMuted
                )
                
                // Debounced: one Firestore write after typing pauses, not per keystroke
                LaunchedEffect(name) {
                    if (name.isNotBlank() && name != profile?.name) {
                        delay(600)
                        onUpdateName(name)
                    }
                }
            }
        }
    }
}

@Composable
fun TrackerSettingsItem(
    config: TrackerConfig,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    canMoveUp: Boolean,
    canMoveDown: Boolean
) {
    val typeLabel = when(config.type) {
        TrackerType.CIGARETTE -> "Cigarette"
        TrackerType.RYO_ROLL -> "RYO"
        TrackerType.JOINT_KING -> "Cigarette" // legacy; no longer offered
        TrackerType.SIMPLE -> "Custom"
    }

    Row(
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp).fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(config.name.uppercase(), style = TabakTypography.bodyLarge.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp), color = TextPrimary)
            Text(typeLabel, style = TabakTypography.labelSmall, color = TextMuted)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = onMoveUp, enabled = canMoveUp, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Move ${config.name} up", modifier = Modifier.size(18.dp), tint = if (canMoveUp) TextMuted else TextDisabled) }
            IconButton(onClick = onMoveDown, enabled = canMoveDown, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Move ${config.name} down", modifier = Modifier.size(18.dp), tint = if (canMoveDown) TextMuted else TextDisabled) }
            IconButton(onClick = onEdit, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Edit, contentDescription = "Edit ${config.name}", modifier = Modifier.size(18.dp), tint = TextMuted) }
            IconButton(onClick = onDelete, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Delete, contentDescription = "Delete ${config.name}", modifier = Modifier.size(18.dp), tint = ErrorColor) }
        }
    }
}

@Composable
fun WidgetSizeSelector(
    selectedSize: WidgetSize,
    accentColor: Color,
    onSizeSelected: (WidgetSize) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        WidgetSize.entries.forEach { size ->
            val isSelected = size == selectedSize
            Surface(
                onClick = { onSizeSelected(size) },
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .semantics {
                        role = Role.RadioButton
                        selected = isSelected
                    }
                    .tabakPressScale(),
                color = if (isSelected) accentColor.copy(alpha = 0.15f) else Color.White.copy(alpha = 0.04f),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, if (isSelected) accentColor else Color.White.copy(alpha = 0.05f))
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = when (size) {
                            WidgetSize.SMALL -> "Compact"
                            WidgetSize.MEDIUM -> "Comfortable"
                            WidgetSize.LARGE -> "Spacious"
                        },
                        style = TabakTypography.labelMedium.copy(fontWeight = if(isSelected) FontWeight.Black else FontWeight.Bold),
                        color = if (isSelected) accentColor else TextMuted
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AccentPalette(
    selectedColor: String,
    onColorSelected: (String) -> Unit
) {
    val colors = listOf(
        "Signal red" to "#FF5F5F", "Industrial amber" to "#F59E0B",
        "Warning yellow" to "#FACC15", "Emerald" to "#10B981",
        "Teal" to "#14B8A6", "Electric cyan" to "#00D1FF",
        "Cobalt" to "#3B82F6", "Violet" to "#8B5CF6",
        "Magenta" to "#EC4899", "Zinc" to "#E4E4E7"
    )
    
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        colors.forEach { (name, hex) ->
            val color = Color(hex.removePrefix("#").toLong(16) or 0xFF000000)
            val isSelected = selectedColor.uppercase() == hex.uppercase()
            
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .padding(5.dp)
                    .clip(CircleShape)
                    .background(color)
                    .border(width = if (isSelected) 2.dp else 0.dp, color = Color.White, shape = CircleShape)
                    .shadow(if (isSelected) 12.dp else 0.dp, CircleShape, spotColor = color)
                    .tabakPressScale()
                    .semantics {
                        role = Role.RadioButton
                        selected = isSelected
                        contentDescription = "$name accent"
                    }
                    .clickable { onColorSelected(hex) }
            )
        }
    }
}

@Composable
fun EconomicsSettings(
    profile: UserProfile?,
    accentColor: Color,
    onSave: (purchaseType: String, unitPrice: Double, pouchPrice: Double, estimatedYield: Int) -> Unit
) {
    val initialMode = if (profile?.purchaseType == "POUCH") "POUCH" else "PACK"
    var ecoMode by rememberSaveable(profile?.purchaseType) { mutableStateOf(initialMode) }
    var packPrice by rememberSaveable(profile?.unitPrice, profile?.purchaseType) {
        mutableStateOf(
            if (profile?.purchaseType == "PACK" && (profile.unitPrice) > 0) {
                twoDecimals(profile.unitPrice * 20.0)
            } else "8.00"
        )
    }
    var packQty by rememberSaveable { mutableStateOf("20") }
    var pouchPrice by rememberSaveable(profile?.pouchPrice) {
        mutableStateOf(
            profile?.pouchPrice?.takeIf { it > 0 }?.let { twoDecimals(it) } ?: "6.50"
        )
    }
    var estimatedYield by rememberSaveable(profile?.estimatedYield) {
        mutableStateOf(
            profile?.estimatedYield?.takeIf { it > 0 }?.toString() ?: "60"
        )
    }

    val unitCost = remember(ecoMode, packPrice, packQty, pouchPrice, estimatedYield) {
        if (ecoMode == "PACK") {
            val rp = packPrice.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0
            val rq = packQty.toIntOrNull()?.coerceAtLeast(1) ?: 1
            rp / rq
        } else {
            val bp = pouchPrice.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0
            val by = estimatedYield.toIntOrNull()?.coerceAtLeast(1) ?: 1
            bp / by
        }
    }

    SettingsGroupCard {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                    .border(1.dp, Color.White.copy(alpha = 0.05f), RoundedCornerShape(999.dp))
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                listOf("PACK" to "RETAIL", "POUCH" to "LOOSE").forEach { (mode, label) ->
                    val selected = ecoMode == mode
                    Surface(
                        onClick = { ecoMode = mode },
                        modifier = Modifier.weight(1f).height(40.dp),
                        color = if (selected) Color.White else Color.Transparent,
                        shape = RoundedCornerShape(999.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                label,
                                style = TabakTypography.labelSmall.copy(
                                    fontWeight = FontWeight.Black,
                                    letterSpacing = 1.sp,
                                    color = if (selected) Color.Black else TextMuted
                                )
                            )
                        }
                    }
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (ecoMode == "PACK") "PACK PRICE (€)" else "BEUTEL PRICE (€)",
                        style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Black),
                        color = TextMuted
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    BasicTextField(
                        value = if (ecoMode == "PACK") packPrice else pouchPrice,
                        onValueChange = { v ->
                            if (ecoMode == "PACK") packPrice = v.filter { it.isDigit() || it == '.' }
                            else pouchPrice = v.filter { it.isDigit() || it == '.' }
                        },
                        singleLine = true,
                        textStyle = TabakTypography.bodyMedium.copy(color = TextPrimary),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics {
                                contentDescription = if (ecoMode == "PACK") "Pack price" else "Pouch price"
                            }
                            .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(12.dp))
                            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                            .padding(14.dp)
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (ecoMode == "PACK") "UNITS / PACK" else "EST. YIELD",
                        style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Black),
                        color = TextMuted
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    BasicTextField(
                        value = if (ecoMode == "PACK") packQty else estimatedYield,
                        onValueChange = { v ->
                            if (ecoMode == "PACK") packQty = v.filter { it.isDigit() }
                            else estimatedYield = v.filter { it.isDigit() }
                        },
                        singleLine = true,
                        textStyle = TabakTypography.bodyMedium.copy(color = TextPrimary),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics {
                                contentDescription = if (ecoMode == "PACK") "Units per pack" else "Estimated yield"
                            }
                            .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(12.dp))
                            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                            .padding(14.dp)
                    )
                }
            }

            HorizontalDivider(color = Color.White.copy(alpha = 0.05f), thickness = 0.5.dp)

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("UNIT COST", style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, fontWeight = FontWeight.Black), color = TextMuted)
                Text(
                    "€${twoDecimals(unitCost)}",
                    style = TabakTypography.headlineMedium.copy(fontSize = 22.sp, fontWeight = FontWeight.Black),
                    color = TextPrimary
                )
            }

            Surface(
                onClick = {
                    if (ecoMode == "PACK") {
                        val rp = packPrice.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0
                        val rq = packQty.toIntOrNull()?.coerceAtLeast(1) ?: 1
                        onSave("PACK", rp / rq, 0.0, 0)
                    } else {
                        val bp = pouchPrice.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0
                        val by = estimatedYield.toIntOrNull()?.coerceAtLeast(1) ?: 1
                        onSave("POUCH", bp / by, bp, by)
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .tabakPressScale(),
                color = accentColor.copy(alpha = 0.15f),
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, accentColor.copy(alpha = 0.35f))
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        "SYNCHRONIZE ECONOMICS",
                        style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp, color = accentColor)
                    )
                }
            }
        }
    }
}

private fun twoDecimals(value: Double): String {
    val cents = kotlin.math.round(value * 100.0).toLong()
    val neg = cents < 0
    val abs = kotlin.math.abs(cents)
    val whole = abs / 100
    val frac = (abs % 100).toString().padStart(2, '0')
    return "${if (neg) "-" else ""}$whole.$frac"
}

@Composable
fun DayStartSettings(
    hour: Int,
    onHourChange: (Int) -> Unit,
    accentColor: Color
) {
    // Local state while dragging; a single Firestore write on release
    var pendingHour by remember(hour) { mutableStateOf(hour) }
    val amPm = if (pendingHour == 0) "12:00 AM" else if (pendingHour < 12) "$pendingHour:00 AM" else if (pendingHour == 12) "12:00 PM" else "${pendingHour-12}:00 PM"

    SettingsGroupCard {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("DAY RESET PROTOCOL", style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp), color = TextPrimary)
                Text(amPm, style = TabakTypography.headlineMedium.copy(fontSize = 18.sp, fontWeight = FontWeight.Black, color = accentColor))
            }
            Spacer(modifier = Modifier.height(8.dp))
            Slider(
                value = pendingHour.toFloat(),
                onValueChange = { pendingHour = it.toInt() },
                onValueChangeFinished = { if (pendingHour != hour) onHourChange(pendingHour) },
                valueRange = 0f..23f,
                steps = 22,
                colors = SliderDefaults.colors(thumbColor = accentColor, activeTrackColor = accentColor, inactiveTrackColor = Color.White.copy(alpha = 0.05f))
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(0 to "Midnight", 4 to "4 AM", 6 to "6 AM", 12 to "Noon").forEach { (preset, label) ->
                    FilterChip(
                        selected = pendingHour == preset,
                        onClick = {
                            pendingHour = preset
                            if (preset != hour) onHourChange(preset)
                        },
                        label = { Text(label) },
                        modifier = Modifier.heightIn(min = 48.dp)
                    )
                }
            }
        }
    }
}
