package com.tabakpp.app

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * App-level reduced-motion policy.
 *
 * Android reports 0 for the global animator duration scale when animations are
 * disabled. Every other value keeps the normal animation path.
 */
class ReducedMotionTest {

    @Test
    fun zeroAnimatorScaleRequestsReducedMotion() {
        assertTrue(isReducedMotion(0f))
    }

    @Test
    fun enabledAndPartialAnimatorScalesKeepAnimations() {
        assertFalse(isReducedMotion(1f))
        assertFalse(isReducedMotion(0.5f))
    }
}
