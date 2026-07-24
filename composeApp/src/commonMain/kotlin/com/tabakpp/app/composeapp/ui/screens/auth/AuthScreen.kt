package com.tabakpp.app.composeapp.ui.screens.auth

import androidx.compose.animation.*
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.viewmodels.AuthViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Platinum Entry Protocol.
 * Overhauled for high-fidelity branding and high-contrast interaction.
 */
@Composable
fun AuthScreen(viewModel: AuthViewModel) {
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val success by viewModel.success.collectAsStateWithLifecycle()
    val isOnline by viewModel.isOnline.collectAsStateWithLifecycle()

    var isSignUp by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var passwordVisible by rememberSaveable { mutableStateOf(false) }

    val accentColor = DefaultAccent
    val premiumGradient = Brush.verticalGradient(listOf(Color(0xFF16161A), Color(0xFF09090B)))
    val glassBorder = Color.White.copy(alpha = 0.08f)
    val canSubmit = email.isNotBlank() && password.isNotBlank() && isOnline && !loading

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(48.dp))

            // 1. BRAND HERO
            BrandedHero(accentColor)

            Spacer(modifier = Modifier.height(48.dp))

            // 2. AUTH CARD
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(16.dp, MaterialTheme.shapes.large)
                    .clip(MaterialTheme.shapes.large)
                    .background(premiumGradient)
                    .border(1.dp, glassBorder, MaterialTheme.shapes.large)
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    AuthTabs(
                        isSignUp = isSignUp,
                        onTabSelected = {
                            isSignUp = it
                            viewModel.clearError()
                            viewModel.clearSuccess()
                        },
                        accentColor = accentColor
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    if (isSignUp) {
                        AuthField(
                            label = "DISPLAY NAME (OPTIONAL)",
                            value = displayName,
                            onValueChange = { displayName = it.take(100) }
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                    }

                    AuthField(
                        label = "EMAIL",
                        value = email,
                        onValueChange = { email = it },
                        keyboardType = KeyboardType.Email
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    AuthField(
                        label = "PASSWORD",
                        value = password,
                        onValueChange = { password = it },
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailing = {
                            TextButton(onClick = { passwordVisible = !passwordVisible }) {
                                Text(
                                    if (passwordVisible) "HIDE" else "SHOW",
                                    style = TabakTypography.labelSmall.copy(
                                        fontWeight = FontWeight.Black,
                                        letterSpacing = 1.sp,
                                        color = Color.White.copy(alpha = 0.45f)
                                    )
                                )
                            }
                        }
                    )
                    if (isSignUp) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Use at least 12 characters.",
                            style = TabakTypography.labelSmall.copy(color = TextMuted),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    if (!isOnline) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            "OFFLINE — RECONNECT TO SIGN IN",
                            style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp),
                            color = Color(0xFFFBBF24)
                        )
                    }

                    Spacer(modifier = Modifier.height(32.dp))

                    // 3. PRIMARY ACTION (Rectangular Industrial Target)
                    Surface(
                        onClick = {
                            val trimmed = email.trim()
                            if (isSignUp) viewModel.signUp(trimmed, password, displayName)
                            else viewModel.signIn(trimmed, password)
                        },
                        enabled = canSubmit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp)
                            .semantics {
                                if (loading) stateDescription = "Loading"
                            }
                            .tabakPressScale()
                            .shadow(12.dp, MaterialTheme.shapes.small, ambientColor = accentColor.copy(alpha = 0.4f), spotColor = accentColor.copy(alpha = 0.4f)),
                        color = accentColor,
                        shape = MaterialTheme.shapes.small
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            if (loading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
                            } else {
                                Text(
                                    text = if (isSignUp) "CREATE ACCOUNT" else "SIGN IN",
                                    style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp, color = Color.White)
                                )
                            }
                        }
                    }

                    if (viewModel.googleSignInAvailable) {
                        Spacer(modifier = Modifier.height(16.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(modifier = Modifier.weight(1f).height(1.dp).background(Color.White.copy(alpha = 0.08f)))
                            Text(
                                "OR",
                                modifier = Modifier.padding(horizontal = 12.dp),
                                style = TabakTypography.labelSmall.copy(letterSpacing = 2.sp, color = Color.White.copy(alpha = 0.55f), fontWeight = FontWeight.Black)
                            )
                            Box(modifier = Modifier.weight(1f).height(1.dp).background(Color.White.copy(alpha = 0.08f)))
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        Surface(
                            onClick = { viewModel.signInWithGoogle() },
                            enabled = !loading && isOnline,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(56.dp)
                                .tabakPressScale(),
                            color = Color.White.copy(alpha = 0.04f),
                            shape = MaterialTheme.shapes.small,
                            border = BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Default.AccountCircle,
                                        contentDescription = "Google",
                                        tint = Color.White,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Text(
                                        "CONTINUE WITH GOOGLE",
                                        style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 1.sp, color = Color.White)
                                    )
                                }
                            }
                        }
                    }

                    // 4. PASSWORD RESET (login mode only)
                    if (!isSignUp) {
                        Spacer(modifier = Modifier.height(16.dp))
                        TextButton(
                            onClick = { viewModel.resetPassword(email.trim()) },
                            enabled = !loading && isOnline && email.isNotBlank(),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                "FORGOT PASSWORD?",
                                style = TabakTypography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 1.sp,
                                    color = Color.White.copy(alpha = if (email.isNotBlank()) 0.5f else 0.25f)
                                )
                            )
                        }
                    }
                }
            }

            error?.let {
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    text = it.uppercase(),
                    color = ErrorColor,
                    style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }
                )
            }

            success?.let {
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    text = it.uppercase(),
                    color = SuccessColor,
                    style = TabakTypography.labelSmall.copy(fontWeight = FontWeight.Black),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
                )
            }
        }
    }
}

@Composable
private fun BrandedHero(accentColor: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "tabak",
                color = Color.White,
                fontSize = 42.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = (-2).sp
            )
            Text(
                text = "++",
                color = accentColor,
                fontSize = 42.sp,
                fontWeight = FontWeight.Black
            )
        }
        Text(
            text = "EXECUTIVE HABIT TRACKING",
            style = TabakTypography.labelSmall.copy(
                letterSpacing = 4.sp, 
                color = Color.White.copy(alpha = 0.3f),
                fontWeight = FontWeight.Bold
            )
        )
    }
}

@Composable
private fun AuthTabs(isSignUp: Boolean, onTabSelected: (Boolean) -> Unit, accentColor: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(MaterialTheme.shapes.small)
            .background(Color.White.copy(alpha = 0.04f))
            .padding(4.dp)
    ) {
        TabItem("Sign in", !isSignUp, Modifier.weight(1f), accentColor) { onTabSelected(false) }
        TabItem("Create account", isSignUp, Modifier.weight(1f), accentColor) { onTabSelected(true) }
    }
}

@Composable
private fun TabItem(label: String, selected: Boolean, modifier: Modifier, accentColor: Color, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) accentColor.copy(alpha = 0.1f) else Color.Transparent)
            .semantics {
                role = Role.Tab
                this.selected = selected
            }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = TabakTypography.labelSmall.copy(
                fontWeight = if (selected) FontWeight.Black else FontWeight.Bold,
                color = if (selected) accentColor else Color.White.copy(alpha = 0.4f)
            )
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AuthField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: @Composable (() -> Unit)? = null
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = TabakTypography.labelSmall.copy(letterSpacing = 1.sp, color = Color.White.copy(alpha = 0.55f)),
            modifier = Modifier.padding(start = 4.dp, bottom = 8.dp)
        )
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.small,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.White.copy(alpha = 0.03f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.03f),
                focusedIndicatorColor = DefaultAccent.copy(alpha = 0.5f),
                unfocusedIndicatorColor = Color.White.copy(alpha = 0.08f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White,
                cursorColor = DefaultAccent
            ),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            visualTransformation = visualTransformation,
            trailingIcon = trailing,
            singleLine = true
        )
    }
}
