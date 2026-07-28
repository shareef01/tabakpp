package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.WidgetSize
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
class WidgetSizeSelectorTest {
    @get:Rule
    val rule = createComposeRule()

    private fun setSelector(selected: WidgetSize, onSel: (WidgetSize) -> Unit = {}) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                WidgetSizeSelector(
                    selectedSize = selected,
                    accentColor = Color(0xFF10B981),
                    onSizeSelected = onSel,
                )
            }
        }
    }

    @Test
    fun rendersAllDensityOptions() {
        setSelector(WidgetSize.MEDIUM)
        rule.onNodeWithText("Compact").assertIsDisplayed()
        rule.onNodeWithText("Comfortable").assertIsDisplayed()
        rule.onNodeWithText("Spacious").assertIsDisplayed()
    }

    @Test
    fun selecting_firesCallbackWithThatSize() {
        var picked: WidgetSize? = null
        setSelector(WidgetSize.MEDIUM, onSel = { picked = it })
        rule.onNodeWithText("Spacious").performClick()
        assertEquals(WidgetSize.LARGE, picked)
    }

    @Test
    fun currentSelection_isMarkedSelected() {
        setSelector(WidgetSize.SMALL)
        rule.onNodeWithText("Compact").assertIsSelected()
        rule.onNodeWithText("Comfortable").assertIsNotSelected()
    }
}
