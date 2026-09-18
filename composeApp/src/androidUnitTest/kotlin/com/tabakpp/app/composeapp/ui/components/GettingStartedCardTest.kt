package com.tabakpp.app.composeapp.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.domain.SmokingCalculator
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
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
    val rule = createComposeRule()

    private val cig = TrackerConfig("c1", "Cig", 10, 1, TrackerType.CIGARETTE, isPrimaryTracked = true)
    private val today = "2024-05-20"

    private fun setCard(onboarding: SmokingCalculator.OnboardingState) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                GettingStartedCard(onboarding = onboarding)
            }
        }
    }

    @Test
    fun trackerCreated_showUnchecked() {
        val state = SmokingCalculator.getFirstWeekGuidance(listOf(cig), emptyList(), emptyList(), emptyMap(), today)
        setCard(state)
        rule.onNodeWithText("GETTING STARTED").assertIsDisplayed()
        rule.onNodeWithText("Tracker created").assertIsDisplayed()
        rule.onNodeWithText("Daily target set").assertIsDisplayed()
        rule.onNodeWithText("Record your first activity").assertIsDisplayed()
    }

    @Test
    fun hiddenWhenTrackingEvidenceExists() {
        val state = SmokingCalculator.OnboardingState(
            stage = 2, hasTracker = true, hasTrackingEvidence = true,
            hasHistory = false, hasCompletedDay = false
        )
        setCard(state)
        rule.onNodeWithText("GETTING STARTED").assertDoesNotExist()
    }

    @Test
    fun hidesTargetExplanation() {
        val state = SmokingCalculator.getFirstWeekGuidance(listOf(cig), emptyList(), emptyList(), emptyMap(), today)
        setCard(state)
        rule.onNodeWithText("Your target is the daily level you want to stay at or below.").assertIsDisplayed()
    }
}
