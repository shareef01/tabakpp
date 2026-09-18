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
        trackingStreak: Int = 12,
        progress: Double = 0.35,
        spent: Double = 4.51,
        hasOpen: Boolean = true,
        goalStatus: SmokingCalculator.GoalStatus? = null,
    ) = SmokingCalculator.GlobalMetrics(
        count = count, limit = limit, streak = streak, trackingStreak = trackingStreak,
        spentToday = spent, budgetLeftToday = 0.0, saved = 0.0, savedLifetime = 0.0,
        progress = progress, lifeLost = 0, recovered = 0, hasOpenSession = hasOpen,
        goalStatus = goalStatus,
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
        rule.onNodeWithText("GOAL STREAK").assertIsDisplayed()
        rule.onNodeWithText("8").assertIsDisplayed()
        rule.onNodeWithText("TRACKING").assertIsDisplayed()
        rule.onNodeWithText("12").assertIsDisplayed()
        rule.onNodeWithText("ENGAGEMENT").assertIsDisplayed()
        rule.onNodeWithText("DAILY USE").assertIsDisplayed()
        rule.onNodeWithText("35%").assertIsDisplayed()          // progress * 100
        rule.onNodeWithText("SPENT TODAY").assertIsDisplayed()
    }

    @Test
    fun overTarget_showsOverTarget_andZeroRemaining() {
        setBanner(metrics(count = 22, limit = 20, streak = 3, progress = 1.1, spent = 5.0))
        rule.onNodeWithText("2 OVER TARGET").assertIsDisplayed()
        rule.onNodeWithText("0").assertIsDisplayed()            // remaining floored at 0
    }

    @Test
    fun atTarget_isDistinctFromOverTarget() {
        setBanner(metrics(count = 20, limit = 20, streak = 3, progress = 1.0, spent = 5.0))
        rule.onNodeWithText("AT TARGET").assertIsDisplayed()
    }

    @Test
    fun endDay_shownWhenOpenSession_firesCallback() {
        var ended = 0
        setBanner(metrics(hasOpen = true), onEndDay = { ended++ })
        rule.onNodeWithText("CLOSE TRACKING DAY").assertIsDisplayed()
        rule.onNodeWithText("CLOSE TRACKING DAY").performClick()
        assertEquals(1, ended)
    }

    @Test
    fun endDay_hiddenWhenNoOpenSession() {
        setBanner(metrics(hasOpen = false))
        rule.onNodeWithText("CLOSE TRACKING DAY").assertDoesNotExist()
    }

    @Test
    fun trackingStreak_displaysGoalZeroButTrackingPositive() {
        // Goal streak 0, tracking streak 9 — consistent tracking despite over goal.
        setBanner(metrics(count = 50, limit = 10, streak = 0, trackingStreak = 9, progress = 1.0))
        rule.onNodeWithText("GOAL STREAK").assertIsDisplayed()
        rule.onNodeWithText("TRACKING").assertIsDisplayed()
        rule.onNodeWithText("9").assertIsDisplayed()
    }

    @Test
    fun trackingStreak_usesSingularDaySuffixWhenOne() {
        setBanner(metrics(count = 7, limit = 20, streak = 8, trackingStreak = 1, progress = 0.35))
        // Tracking streak = 1 renders "1 DAY"; goal streak = 8 renders "8 DAYS"
        rule.onNodeWithText("1").assertIsDisplayed()
    }

    @Test
    fun trackingStreak_longValueDoesNotOverflow() {
        setBanner(metrics(streak = 365, trackingStreak = 730, progress = 0.1))
        rule.onNodeWithText("365").assertIsDisplayed()
        rule.onNodeWithText("730").assertIsDisplayed()
    }

    @Test
    fun goalStatus_underTarget_showsBelowTarget() {
        val gs = SmokingCalculator.GoalStatus("under", belowTarget = 3.0, aboveTarget = 0.0, overTrackers = 0)
        setBanner(metrics(count = 7, limit = 10, goalStatus = gs))
        rule.onNodeWithText("TODAY'S GOAL").assertIsDisplayed()
        rule.onNodeWithText("3 below target").assertIsDisplayed()
    }

    @Test
    fun goalStatus_atTarget_showsAtTarget() {
        val gs = SmokingCalculator.GoalStatus("at", belowTarget = 0.0, aboveTarget = 0.0, overTrackers = 0)
        setBanner(metrics(count = 10, limit = 10, goalStatus = gs))
        rule.onNodeWithText("At target").assertIsDisplayed()
    }

    @Test
    fun goalStatus_overTarget_showsAboveTarget() {
        val gs = SmokingCalculator.GoalStatus("over", belowTarget = 0.0, aboveTarget = 2.0, overTrackers = 1)
        setBanner(metrics(count = 12, limit = 10, goalStatus = gs))
        rule.onNodeWithText("1 above target").assertIsDisplayed()
    }

    @Test
    fun goalStatus_null_showsNoTarget() {
        setBanner(metrics(count = 7, limit = 20, goalStatus = null))
        rule.onNodeWithText("No target set").assertIsDisplayed()
    }
}
