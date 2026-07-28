package com.tabakpp.app.composeapp.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.WidgetSize
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.test.assertEquals

// Compose UI tests run on the JVM via Robolectric (no device). reducedMotion is
// forced on so the animated counter renders statically and stays assertable.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class TrackerCardTest {
    @get:Rule
    val rule = createComposeRule()

    private val cig = TrackerConfig(id = "cig", name = "Cigarettes", limit = 20, order = 0, type = TrackerType.CIGARETTE)

    private fun setCard(count: Int, onInc: () -> Unit = {}, onDec: () -> Unit = {}) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                TrackerCard(
                    config = cig,
                    count = count,
                    accentColor = Color(0xFF10B981),
                    widgetSize = WidgetSize.MEDIUM,
                    onIncrement = onInc,
                    onDecrement = onDec,
                )
            }
        }
    }

    @Test
    fun rendersName_limitBadge_count_and_remaining() {
        setCard(count = 7)
        rule.onNodeWithText("CIGARETTES").assertIsDisplayed()
        rule.onNodeWithText("20/DAY").assertIsDisplayed()
        rule.onNodeWithText("7").assertIsDisplayed()
        rule.onNodeWithText("13 LEFT").assertIsDisplayed()
    }

    @Test
    fun incrementButton_invokesCallback() {
        var inc = 0
        setCard(count = 3, onInc = { inc++ })
        rule.onNodeWithContentDescription("Increase Cigarettes").performClick()
        assertEquals(1, inc)
    }

    @Test
    fun decrementButton_invokesCallback_whenAboveZero() {
        var dec = 0
        setCard(count = 3, onDec = { dec++ })
        rule.onNodeWithContentDescription("Decrease Cigarettes").performClick()
        assertEquals(1, dec)
    }

    @Test
    fun decrementButton_isDisabled_atZero() {
        setCard(count = 0)
        rule.onNodeWithContentDescription("Decrease Cigarettes").assertIsNotEnabled()
    }

    @Test
    fun showsOverLabel_whenOverLimit() {
        setCard(count = 22)
        rule.onNodeWithText("2 OVER").assertIsDisplayed()
    }
}
