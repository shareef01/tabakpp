package com.tabakpp.app.composeapp.ui.screens

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Audit 2026-11-12 TABAK-001: every tracker stays loggable after "Close day"
 * (an unstamped tracker is stamped on its first late tap), so the copy says
 * logging continues and no longer points to a manual entry. Web parity of the
 * exact string is checked by webApp/src/constants/closeDayCopy.test.js.
 */
class CloseDayCopyTest {
    @Test
    fun copy_saysEveryTrackerStaysLoggable() {
        assertTrue(CLOSE_DAY_CONFIRM_MESSAGE.contains("log any tracker today"))
        assertTrue(CLOSE_DAY_CONFIRM_MESSAGE.contains("totals update"))
        assertFalse(CLOSE_DAY_CONFIRM_MESSAGE.contains("manual entry", ignoreCase = true))
        assertFalse(CLOSE_DAY_CONFIRM_MESSAGE.contains("already logged", ignoreCase = true))
    }
}
