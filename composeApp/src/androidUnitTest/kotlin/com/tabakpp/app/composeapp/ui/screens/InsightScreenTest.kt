package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.LogEntry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Compose UI tests for [HistoricalInsightsContent] (audit N-06/N-07): the trend
 * compares complete months only, the current month is not listed twice, and
 * averages are formatted.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w432dp-h960dp-xxhdpi")
class InsightScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val trackingDay = "2026-09-15"

    private fun log(date: String, units: Double) = LogEntry(
        id = "${date}_M", logDate = date, counts = mapOf("cig" to units), origin = "MANUAL_ENTRY"
    )

    private fun render(logs: List<LogEntry>) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                HistoricalInsightsContent(
                    logs = logs,
                    dayDocs = emptyList(),
                    configs = emptyList(),
                    trackingDay = trackingDay
                )
            }
        }
    }

    @Test
    fun oneCompleteMonth_showsMoreDataNeeded_notIncreasedFromZero() {
        render(listOf(log("2026-09-10", 30.0), log("2026-08-10", 10.0)))

        rule.onNodeWithText("More tracking data is needed for a comparison.").assertIsDisplayed()
        rule.onAllNodesWithText("increased from zero").assertCountEquals(0)
    }

    @Test
    fun currentMonth_isNotListedAsACompleteMonth() {
        render(listOf(log("2026-09-10", 30.0), log("2026-08-10", 10.0)))

        // August is the only complete month; September appears only in its MTD card.
        rule.onAllNodesWithText("August 2026").assertCountEquals(1)
        rule.onAllNodesWithText("September 2026").assertCountEquals(0)
        rule.onNodeWithText("MTD — September 2026").assertExists()
    }

    @Test
    fun trend_comparesCompleteMonths_withFormattedAverages() {
        render(listOf(log("2026-09-10", 30.0), log("2026-08-10", 10.0), log("2026-07-10", 5.0)))

        rule.onNodeWithText("100% more units").assertIsDisplayed()
        rule.onNodeWithText("5.0 → 10.0 units/day").assertIsDisplayed()
    }

    @Test
    fun monthToDateUnits_areNotFormattedAsCurrency() {
        render(listOf(log("2026-09-10", 30.0)))

        rule.onNodeWithText("30").assertExists()
        rule.onAllNodesWithText("30,00 €").assertCountEquals(0)
    }
}
