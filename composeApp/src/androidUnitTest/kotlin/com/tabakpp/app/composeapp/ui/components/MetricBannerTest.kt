package com.tabakpp.app.composeapp.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.domain.SmokingCalculator
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.test.assertEquals

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class MetricBannerTest {
    @get:Rule
    val rule = createComposeRule()

    private fun metrics(
        count: Int = 7,
        limit: Int = 20,
        streak: Int = 8,
        progress: Double = 0.35,
        spent: Double = 4.51,
        hasOpen: Boolean = true,
    ) = SmokingCalculator.GlobalMetrics(
        count = count, limit = limit, streak = streak,
        spentToday = spent, budgetLeftToday = 0.0, saved = 0.0, savedLifetime = 0.0,
        progress = progress, lifeLost = 0, recovered = 0, hasOpenSession = hasOpen,
    )

    private fun setBanner(m: SmokingCalculator.GlobalMetrics, onEndDay: () -> Unit = {}) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                MetricBanner(metrics = m, accentColor = Color(0xFF10B981), onEndDayClick = onEndDay)
            }
        }
    }

    @Test
    fun rendersLabelsAndValues() {
        setBanner(metrics(count = 7, limit = 20, streak = 8, progress = 0.35))
        rule.onNodeWithText("REMAINING").assertIsDisplayed()
        rule.onNodeWithText("13").assertIsDisplayed()          // limit - count
        rule.onNodeWithText("STREAK").assertIsDisplayed()
        rule.onNodeWithText("8").assertIsDisplayed()
        rule.onNodeWithText("DAILY QUOTA").assertIsDisplayed()
        rule.onNodeWithText("35%").assertIsDisplayed()          // progress * 100
        rule.onNodeWithText("SPENT TODAY").assertIsDisplayed()
    }

    @Test
    fun overLimit_showsOverLimit_andZeroRemaining() {
        setBanner(metrics(count = 22, limit = 20, streak = 3, progress = 1.1, spent = 5.0))
        rule.onNodeWithText("OVER LIMIT").assertIsDisplayed()
        rule.onNodeWithText("0").assertIsDisplayed()            // remaining floored at 0
    }

    @Test
    fun endDay_shownWhenOpenSession_firesCallback() {
        var ended = 0
        setBanner(metrics(hasOpen = true), onEndDay = { ended++ })
        rule.onNodeWithText("END TRACKING DAY").assertIsDisplayed()
        rule.onNodeWithText("END TRACKING DAY").performClick()
        assertEquals(1, ended)
    }

    @Test
    fun endDay_hiddenWhenNoOpenSession() {
        setBanner(metrics(hasOpen = false))
        rule.onNodeWithText("END TRACKING DAY").assertDoesNotExist()
    }
}
