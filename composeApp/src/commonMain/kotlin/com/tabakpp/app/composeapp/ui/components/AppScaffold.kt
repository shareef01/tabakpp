package com.tabakpp.app.composeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tabakpp.app.composeapp.theme.LocalSpacing
import androidx.compose.runtime.saveable.rememberSaveable

@Composable
fun AppScaffold(
    collapseKey: String,
    collapseEnabled: Boolean,
    header: @Composable (isCollapsed: Boolean) -> Unit,
    bottomNav: @Composable () -> Unit,
    content: @Composable (PaddingValues) -> Unit
) {
    val spacing = LocalSpacing.current
    val density = LocalDensity.current
    
    // Scroll tracking for collapsing header
    var scrollOffset by rememberSaveable(collapseKey) { mutableStateOf(0f) }
    val maxOffset = with(density) { 60.dp.toPx() } // Distance to trigger collapse
    
    val nestedScrollConnection = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: androidx.compose.ui.geometry.Offset, source: NestedScrollSource): androidx.compose.ui.geometry.Offset {
                val delta = available.y
                val newOffset = (scrollOffset + delta).coerceIn(-maxOffset, 0f)
                if (collapseEnabled) scrollOffset = newOffset
                return androidx.compose.ui.geometry.Offset.Zero
            }
        }
    }

    val isCollapsed = collapseEnabled && scrollOffset <= -maxOffset * 0.5f
    val navigationBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    // Floating dock height (72) + dock margin — applied as viewport inset so content
    // cannot paint underneath the pill. Extra scroll padding is separate breathing room.
    val navClearance = 72.dp + spacing.bottomNavPadding + navigationBottom

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .nestedScroll(nestedScrollConnection)
    ) {
        // Sticky Header
        header(isCollapsed)

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            // Inset the content viewport above the floating nav (not just scroll padding).
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = navClearance)
            ) {
                content(PaddingValues(bottom = spacing.scrollBottomPadding))
            }

            // Fixed Bottom Nav — wrap content height so fillMaxSize inside the dock
            // cannot expand this overlay across the whole content pane.
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .wrapContentHeight()
                    .padding(horizontal = 16.dp)
                    .padding(bottom = spacing.bottomNavPadding)
                    .navigationBarsPadding()
            ) {
                bottomNav()
            }
        }
    }
}
