package com.tabakpp.app

/**
 * Android's global animator duration scale is exactly 0 when the user has
 * disabled animations. That setting is the app's reduced-motion signal.
 *
 * Kept as a small pure function so the policy is JVM-testable without launching
 * an Activity or requiring the Firebase/Koin application graph.
 */
internal fun isReducedMotion(animatorDurationScale: Float): Boolean = animatorDurationScale == 0f
