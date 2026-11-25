package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The tracker row on a 360dp phone: the Settings list pads 16dp each side, so
 * the row gets 328dp. Four 48dp action buttons with 8dp gaps left the name
 * ~72dp, and "CIGARETTES" broke mid-word over two lines.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class TrackerSettingsItemTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun setRow(name: String) {
        composeRule.setContent {
            TabakTheme(reducedMotion = true) {
                Box(Modifier.width(328.dp)) {
                    TrackerSettingsItem(
                        config = TrackerConfig(id = "cig", name = name, limit = 20, order = 0, type = TrackerType.CIGARETTE),
                        onEdit = {}, onDelete = {}, onMoveUp = {}, onMoveDown = {},
                        canMoveUp = false, canMoveDown = true,
                    )
                }
            }
        }
    }

    private fun layoutOf(text: String): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        composeRule.onNodeWithText(text).fetchSemanticsNode()
            .config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.single()
    }

    @Test
    fun ordinaryNameFitsOnOneLineAtPhoneWidth() {
        setRow("Cigarettes")
        val layout = layoutOf("CIGARETTES")
        assertEquals("name must not wrap mid-word", 1, layout.lineCount)
        assertFalse("name must not be cut", layout.isLineEllipsized(0))
    }

    @Test
    fun longNameStaysOnOneLineWithEllipsisInsteadOfBreakingLetters() {
        setRow("Hand-rolled evening cigarettes")
        val layout = layoutOf("HAND-ROLLED EVENING CIGARETTES")
        assertEquals(1, layout.lineCount)
    }

    @Test
    fun showsTheDailyLimitAndKeepsNamedActions() {
        setRow("Cigarettes")
        composeRule.onNodeWithText("20 / day", substring = true).assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Edit Cigarettes").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Delete Cigarettes").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Move Cigarettes down").assertIsDisplayed()
    }
}
