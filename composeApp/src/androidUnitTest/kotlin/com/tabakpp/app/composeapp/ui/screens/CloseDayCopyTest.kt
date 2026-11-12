package com.tabakpp.app.composeapp.ui.screens

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Audit 2026-11-12 TABAK-001: the close-day dialog promised "You can keep
 * logging today", but after closing, a tracker not yet logged that day is
 * refused (DAY_CLOSED_NO_SNAPSHOT). Web parity of the exact string is checked
 * by webApp/src/constants/closeDayCopy.test.js.
 */
class CloseDayCopyTest {
    @Test
    fun copy_doesNotPromiseUnrestrictedLoggingAfterClosing() {
        assertFalse(CLOSE_DAY_CONFIRM_MESSAGE.contains("keep logging today", ignoreCase = true))
        assertFalse(CLOSE_DAY_CONFIRM_MESSAGE.contains("continue logging anytime", ignoreCase = true))
        assertTrue(CLOSE_DAY_CONFIRM_MESSAGE.contains("already logged today"))
        assertTrue(CLOSE_DAY_CONFIRM_MESSAGE.contains("manual entry in History"))
    }
}
