package com.tabakpp.app.composeapp.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertIsDisplayed
import com.tabakpp.app.composeapp.theme.TabakTheme
import com.tabakpp.app.data.LogEntry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every history row used to announce "Edit history entry" / "Delete history
 * entry", so a TalkBack user heard the same label on every row. Each action now
 * names its day, matching the web's "Edit entry for <date>".
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class LogItemA11yTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rowActionsNameTheirDaySoRowsAreDistinguishable() {
        composeRule.setContent {
            TabakTheme(reducedMotion = true) {
                Column {
                    LogItem(log = LogEntry(id = "a", logDate = "2026-11-23", counts = mapOf("cig" to 4.0)), onEdit = {}, onDelete = {})
                    LogItem(log = LogEntry(id = "b", logDate = "2026-11-24", counts = mapOf("cig" to 2.0)), onEdit = {}, onDelete = null)
                }
            }
        }
        composeRule.onNodeWithContentDescription("Edit entry for MON, NOV 23").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Delete entry for MON, NOV 23").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Edit entry for TUE, NOV 24").assertIsDisplayed()
        composeRule.onAllNodesWithContentDescription("Edit history entry").assertCountEquals(0)
    }
}
