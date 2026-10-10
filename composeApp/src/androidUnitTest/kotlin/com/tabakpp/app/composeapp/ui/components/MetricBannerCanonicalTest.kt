package com.tabakpp.app.composeapp.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.tabakpp.app.data.UnresolvedComponents
import com.tabakpp.app.domain.SmokingCalculator
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Rendered Compose test (Robolectric) for the canonical financial values that
 * reach the Dashboard banner via `RegistryViewModel.metrics`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w432dp-h960dp-xxhdpi")
class MetricBannerCanonicalTest {

    @get:Rule
    val rule = createComposeRule()

    private fun metrics(spent: Double) = SmokingCalculator.GlobalMetrics(
        count = 6,
        limit = 10,
        streak = 0,
        trackingStreak = 0,
        spentToday = spent,
        budgetLeftToday = 4.0,
        saved = 4.0,
        savedLifetime = 4.0,
        hasBaseline = true,
        baselineSavedToday = 9.0,
        baselineSavedLifetime = 9.0,
        progress = 0.6,
        lifeLost = 0,
        recovered = 0,
    )

    @Test
    fun rendersTheCanonicalSpentToday() {
        rule.setContent { MetricBanner(metrics = metrics(6.0), accentColor = Color(0xFF5F5FFF)) }
        rule.onNodeWithText("SPENT TODAY", substring = true).assertIsDisplayed()
        rule.onNodeWithText("6,00 €", substring = true).assertIsDisplayed()
    }

    @Test
    fun rendersAVerifiedZero() {
        rule.setContent { MetricBanner(metrics = metrics(0.0), accentColor = Color(0xFF5F5FFF)) }
        rule.onNodeWithText("0,00 €", substring = true).assertIsDisplayed()
    }

    @Test
    fun rendersUnavailable_notAFabricatedZero() {
        rule.setContent {
            MetricBanner(metrics = metrics(0.0).copy(todayAvailable = false), accentColor = Color(0xFF5F5FFF))
        }
        rule.onNodeWithText("Unavailable", substring = true).assertIsDisplayed()
        rule.onNodeWithText("—", substring = true).assertIsDisplayed()
    }

    @Test
    fun rendersUnavailableSpent_whenOnlyTheSpentComponentIsUnresolved() {
        rule.setContent {
            MetricBanner(
                metrics = metrics(0.0).copy(todayAvailable = true, todayUnresolved = UnresolvedComponents(spent = true)),
                accentColor = Color(0xFF5F5FFF),
            )
        }
        rule.onNodeWithText("Unavailable", substring = true).assertIsDisplayed()
    }
}
