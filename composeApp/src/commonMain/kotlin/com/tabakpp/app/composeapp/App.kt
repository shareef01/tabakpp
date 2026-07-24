package com.tabakpp.app.composeapp

import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import com.tabakpp.app.composeapp.theme.*
import com.tabakpp.app.composeapp.ui.components.*
import com.tabakpp.app.composeapp.ui.screens.HistoryScreen
import com.tabakpp.app.composeapp.ui.screens.SettingsScreen
import com.tabakpp.app.composeapp.ui.screens.TrackScreen
import com.tabakpp.app.composeapp.ui.screens.auth.AuthScreen
import com.tabakpp.app.viewmodels.AuthViewModel
import com.tabakpp.app.viewmodels.RegistryViewModel
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

sealed class Screen(val route: String, val icon: ImageVector, val label: String) {
    object Track : Screen("track", Icons.Rounded.Dashboard, "Track")
    object History : Screen("history", Icons.Rounded.History, "History")
    object Settings : Screen("settings", Icons.Rounded.Settings, "Settings")
}

@Composable
fun App(reducedMotion: Boolean = false) {
    val authViewModel = koinInject<AuthViewModel>()
    val registryViewModel = koinInject<RegistryViewModel>()
    
    val user by authViewModel.authState.collectAsStateWithLifecycle()
    val profile by registryViewModel.userProfile.collectAsStateWithLifecycle()
    val localAccent by registryViewModel.localAccent.collectAsStateWithLifecycle()
    
    val accentColor = remember(profile?.accent, localAccent) {
        val hex = com.tabakpp.app.domain.SmokingCalculator.normalizeAccentColor(profile?.accent ?: localAccent)
        try { Color(hex.removePrefix("#").toLong(16) or 0xFF000000) }
        catch (_: Exception) { Color(0xFFFF5F5F) }
    }
    
    val snackbarHostState = remember { SnackbarHostState() }

    TabakTheme(
        accentColor = accentColor,
        reducedMotion = reducedMotion,
        snackbarHostState = snackbarHostState
    ) {
        val authReady by authViewModel.authReady.collectAsStateWithLifecycle()
        when {
            !authReady -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black)
                        .semantics { stateDescription = "Loading account" },
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(
                        color = accentColor,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(28.dp)
                    )
                }
            }
            user == null -> AuthScreen(authViewModel)
            else -> MainApp(registryViewModel, accentColor, snackbarHostState)
        }
    }
}

@Composable
fun MainApp(registryViewModel: RegistryViewModel, accentColor: Color, snackbarHostState: SnackbarHostState) {
    val navController = rememberNavController()
    val authViewModel = koinInject<AuthViewModel>()
    val isOnline by registryViewModel.isOnline.collectAsStateWithLifecycle()
    val profile by registryViewModel.userProfile.collectAsStateWithLifecycle()
    val registryError by registryViewModel.friendlyError.collectAsStateWithLifecycle()

    LaunchedEffect(registryError) {
        val message = registryError ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        registryViewModel.clearError()
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route ?: Screen.Track.route
    val isScrollable = currentRoute == Screen.Track.route || currentRoute == Screen.History.route

    var showHeaderLogoutConfirm by rememberSaveable { mutableStateOf(false) }

    AppScaffold(
        collapseKey = currentRoute,
        collapseEnabled = isScrollable,
        header = { isCollapsed ->
            Column {
                OfflineBanner(!isOnline)
                AppHeader(
                    accentColor = accentColor,
                    widgetSize = profile?.widgetSize ?: com.tabakpp.app.data.WidgetSize.MEDIUM,
                    onToggleGrid = { newSize -> registryViewModel.updateProfile { it.copy(widgetSize = newSize) } },
                    onSignOutClick = { showHeaderLogoutConfirm = true },
                    isCollapsed = isCollapsed
                )
            }
        },
        bottomNav = {
            BottomNavPillDock(navController, accentColor)
        }
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
            NavHost(
                navController = navController,
                startDestination = Screen.Track.route,
                modifier = Modifier.fillMaxSize()
            ) {
                composable(Screen.Track.route) { TrackScreen(registryViewModel, innerPadding) }
                composable(Screen.History.route) { HistoryScreen(registryViewModel, innerPadding, snackbarHostState) }
                composable(Screen.Settings.route) { SettingsScreen(registryViewModel, innerPadding) }
            }

            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = innerPadding.calculateBottomPadding()),
                snackbar = { TabakSnackbar(it) }
            )

            if (showHeaderLogoutConfirm) {
                ConfirmModal(
                    title = "Sign out?",
                    message = "Are you sure you want to sign out? You will need to log in again to access your data.",
                    confirmLabel = "Sign out",
                    tintColor = ErrorColor,
                    onConfirm = {
                        showHeaderLogoutConfirm = false
                        authViewModel.signOut()
                    },
                    onDismiss = { showHeaderLogoutConfirm = false }
                )
            }
        }
    }

}

@Composable
fun BottomNavPillDock(navController: NavHostController, accentColor: Color) {
    val items = listOf(Screen.Track, Screen.History, Screen.Settings)
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val haptics = rememberTabakHaptics()
    val reducedMotion = LocalReducedMotion.current

    Surface(
        color = Color(0xFF141416).copy(alpha = 0.98f),
        shape = RoundedCornerShape(100),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f)),
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(min = 280.dp, max = 420.dp)
            .height(72.dp)
            .tabakCardShadow(RoundedCornerShape(100))
    ) {
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 4.dp)
        ) {
            val itemWidth = maxWidth / items.size
            val selectedIndex = items.indexOfFirst { it.route == currentRoute }.coerceAtLeast(0)
            
            val indicatorOffset by animateDpAsState(
                targetValue = itemWidth * selectedIndex,
                animationSpec = if (reducedMotion) {
                    snap()
                } else {
                    spring(dampingRatio = 0.8f, stiffness = 400f)
                }
            )

            // Sliding Active Indicator
            Box(
                modifier = Modifier
                    .offset(x = indicatorOffset)
                    .width(itemWidth)
                    .fillMaxHeight()
                    .padding(vertical = 8.dp, horizontal = 4.dp)
                    .background(accentColor.copy(alpha = 0.12f), RoundedCornerShape(100))
                    .border(1.dp, accentColor.copy(alpha = 0.3f), RoundedCornerShape(100))
            )

            Row(
                modifier = Modifier.fillMaxSize(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                items.forEach { screen ->
                    val selected = currentRoute == screen.route
                    
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .semantics {
                                role = Role.Tab
                                this.selected = selected
                            }
                            .tabakPressScale()
                            .clickable(
                                interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                                indication = null
                            ) {
                                if (!selected) {
                                    haptics()
                                    navController.navigate(screen.route) {
                                        popUpTo(navController.graph.findStartDestination().route!!) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = screen.icon,
                                contentDescription = null,
                                tint = if (selected) accentColor else TextMuted,
                                modifier = Modifier.size(22.dp)
                            )
                            Text(
                                screen.label,
                                color = if (selected) accentColor else TextMuted,
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                    }
                }
            }
        }
    }
}
