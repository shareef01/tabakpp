package com.tabakpp.app.composeapp.ui.components

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.domain.SmokingCalculator
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class GettingStartedCardTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun setContent(onboarding: SmokingCalculator.OnboardingState) {
        composeRule.setContent {
            TabakTheme(reducedMotion = true) {
                GettingStartedCard(onboarding = onboarding)
            }
        }
    }

    @Test
    fun rendersWhenNoTrackingEvidence() {
        setContent(
            SmokingCalculator.OnboardingState(
                hasTracker = true,
                hasTrackingEvidence = false
            )
        )
        composeRule.onNodeWithText("GETTING STARTED").assertIsDisplayed()
        composeRule.onNodeWithText("Tracker created").assertIsDisplayed()
        composeRule.onNodeWithText("Daily target set").assertIsDisplayed()
        composeRule.onNodeWithText("Record your first activity").assertIsDisplayed()
    }

    @Test
    fun hiddenWhenTrackingEvidenceExists() {
        setContent(
            SmokingCalculator.OnboardingState(
                hasTracker = true,
                hasTrackingEvidence = true
            )
        )
        // Card should not be rendered — no GETTING STARTED node.
        composeRule.onNodeWithText("GETTING STARTED")
            .assertDoesNotExist()
    }

    @Test
    fun showGettingStartedIsFalseWhenEvidenceExists() {
        val state = SmokingCalculator.OnboardingState(
            hasTracker = true,
            hasTrackingEvidence = true
        )
        assert(!state.showGettingStarted)
    }

    @Test
    fun showGettingStartedIsTrueWhenNoEvidence() {
        val state = SmokingCalculator.OnboardingState(
            hasTracker = true,
            hasTrackingEvidence = false
        )
        assert(state.showGettingStarted)
    }

    @Test
    fun showGettingStartedIsFalseWhenNoTracker() {
        val state = SmokingCalculator.OnboardingState(
            hasTracker = false,
            hasTrackingEvidence = false
        )
        assert(!state.showGettingStarted)
    }
}
