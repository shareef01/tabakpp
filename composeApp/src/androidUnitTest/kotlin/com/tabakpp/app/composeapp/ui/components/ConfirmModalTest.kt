package com.tabakpp.app.composeapp.ui.components

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.tabakpp.app.composeapp.theme.TabakTheme
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
class ConfirmModalTest {
    @get:Rule
    val rule = createComposeRule()

    private fun setModal(onConfirm: () -> Unit = {}, onDismiss: () -> Unit = {}) {
        rule.setContent {
            TabakTheme(reducedMotion = true) {
                ConfirmModal(
                    title = "Delete tracker",
                    message = "This removes the counter and its history.",
                    confirmLabel = "Delete",
                    dismissLabel = "Cancel",
                    onConfirm = onConfirm,
                    onDismiss = onDismiss,
                )
            }
        }
    }

    @Test
    fun rendersTitle_message_andButtons() {
        setModal()
        rule.onNodeWithText("DELETE TRACKER").assertIsDisplayed()      // title, uppercased
        rule.onNodeWithText("This removes the counter and its history.").assertIsDisplayed()
        rule.onNodeWithText("DELETE").assertIsDisplayed()              // confirm label, uppercased
        rule.onNodeWithText("CANCEL").assertIsDisplayed()             // dismiss label, uppercased
    }

    @Test
    fun confirmButton_firesOnConfirm() {
        var confirmed = 0
        setModal(onConfirm = { confirmed++ })
        rule.onNodeWithText("DELETE").performClick()
        assertEquals(1, confirmed)
    }

    @Test
    fun cancelButton_firesOnDismiss() {
        var dismissed = 0
        setModal(onDismiss = { dismissed++ })
        rule.onNodeWithText("CANCEL").performClick()
        assertEquals(1, dismissed)
    }
}
