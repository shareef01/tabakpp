package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.UserProfile
import com.tabakpp.app.viewmodels.RegistryViewModel
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Undo pill used to float over the bottom of the tracker list, covering
 * whatever sat there for 5 seconds — on a Pixel 7 that was the
 * "Close tracking day" button. It now takes its own row under the list.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi")
class TrackScreenUndoPillTest {

    @get:Rule
    val rule = createComposeRule()

    private fun vm(): RegistryViewModel = RegistryViewModel(
        authRepository = FakeAuth(),
        registryRepository = FakeRepo(
            days = emptyList(),
            logEntries = emptyList(),
            cfg = listOf(TrackerConfig(id = "cig", name = "Rosa", limit = 20, order = 0, type = TrackerType.CIGARETTE)),
            userProfile = UserProfile(name = "Tester", lifetimeAggregates = LifetimeAggregates()),
        ),
        localSettings = FakeSettings(),
        networkObserver = FakeNetwork(),
    )

    @Test
    fun undoPill_sitsBelowTheList_neverOnTopOfIt() {
        val viewModel = vm()
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                // Bottom inset like the real Scaffold's floating nav bar.
                TrackScreen(viewModel = viewModel, innerPadding = PaddingValues(bottom = 96.dp))
            }
        }
        rule.waitUntil(timeoutMillis = 10_000) { !viewModel.loading.value }
        rule.waitForIdle()

        rule.onNodeWithContentDescription("Increase Rosa").performClick()
        rule.waitUntil(timeoutMillis = 5_000) {
            rule.onAllNodes(androidx.compose.ui.test.hasText("UNDO LOG")).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("UNDO LOG").assertIsDisplayed()

        val list = rule.onNode(hasScrollAction()).getUnclippedBoundsInRoot()
        val pill = rule.onNodeWithText("UNDO LOG").getUnclippedBoundsInRoot()
        assertTrue(
            "the list (bottom ${list.bottom}) must end above the Undo pill (top ${pill.top})",
            list.bottom <= pill.top,
        )
    }
}
