package com.tabakpp.app.composeapp

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.tabakpp.app.composeapp.ui.screens.FakeAuth
import com.tabakpp.app.composeapp.ui.screens.FakeNetwork
import com.tabakpp.app.composeapp.ui.screens.FakeRepo
import com.tabakpp.app.composeapp.ui.screens.FakeSettings
import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.DayDocument
import com.tabakpp.app.data.LifetimeAggregates
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerSnapshot
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.User
import com.tabakpp.app.data.UserProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import com.tabakpp.app.domain.SmokingCalculator
import com.tabakpp.app.viewmodels.AuthViewModel
import com.tabakpp.app.viewmodels.RegistryViewModel
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlin.time.Clock
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * README showcase captures of the real Android UI, with synthetic data only.
 *
 * Renders the real [App] (header, screens, bottom navigation) against the
 * in-memory fakes from HistoryScreenTest. No device, no Firebase and no
 * account are involved, so no personal tracking data can reach the README.
 * The data mirrors the web demo (src/demo/useRegistry.js): Cigarettes 20/day
 * at 7, Roll-ups 8/day at 3, and a week of closed days, in Signal red.
 *
 * Always renders and checks the three screens (a smoke test in CI). Writes
 * PNGs only when TABAKPP_SHOWCASE_DIR is set:
 *
 *   TABAKPP_SHOWCASE_DIR=<dir> ./gradlew :composeApp:testDebugUnitTest \
 *     --tests "*ShowcaseScreenshotTest" --rerun
 *
 * 411x831dp at 420dpi is ~1080x2182px, the size of the previous device
 * captures, so the README's 240px-wide row keeps its proportions.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h831dp-420dpi")
class ShowcaseScreenshotTest {

    @get:Rule
    val rule = createComposeRule()

    private val today: String =
        SmokingCalculator.getTrackingDate(Clock.System.now(), 6)
    private fun daysAgo(n: Int): String =
        LocalDate.parse(today).minus(n, DateTimeUnit.DAY).toString()

    private val configs = listOf(
        TrackerConfig(id = "cig", name = "Cigarettes", limit = 20, order = 0, type = TrackerType.CIGARETTE, pricePerUnit = 0.55),
        TrackerConfig(id = "ryo", name = "Roll-ups", limit = 8, order = 1, type = TrackerType.RYO_ROLL, pricePerUnit = 0.22),
    )
    private val snapshots = mapOf(
        "cig" to TrackerSnapshot(name = "Cigarettes", type = TrackerType.CIGARETTE, target = 20, unitPrice = 0.55),
        "ryo" to TrackerSnapshot(name = "Roll-ups", type = TrackerType.RYO_ROLL, target = 8, unitPrice = 0.22),
    )

    private fun day(date: String, cig: Int, ryo: Int, open: Boolean = false) = DayDocument(
        date = date,
        counts = mapOf("cig" to cig.toDouble(), "ryo" to ryo.toDouble()),
        trackerSnapshots = snapshots,
        status = if (open) "open" else "closed",
        foldedIntoLifetime = !open,
    )

    // A full 30-day window: History opens on 30 days, and the chart leaves a
    // gap for a date with no record, so a short seed would leave most of the
    // chart empty. The first week matches the web demo exactly.
    private val pastCigarettes = listOf(
        17, 9, 19, 7, 13, 15, 8, 14, 16, 11, 18, 12, 10, 15, 17,
        13, 9, 16, 14, 12, 18, 11, 15, 13, 10, 17, 14, 12, 16,
    )
    private val days by lazy {
        listOf(day(today, 7, 3, open = true)) +
            pastCigarettes.mapIndexed { i, cig -> day(daysAgo(i + 1), cig, (cig + 2) / 3) }
    }

    /** Signed-in demo identity matching the web demo (src/demo/AuthContext.jsx). */
    private class ShowcaseAuth : AuthRepository by FakeAuth() {
        override val currentUser: Flow<User?> =
            flowOf(User(uid = "demo", email = "alex@tabak.pp", displayName = "Alex Rendine", photoUrl = null))
    }

    @Before
    fun startFakes() {
        val repo = FakeRepo(
            days = days,
            logEntries = emptyList<LogEntry>(),
            cfg = configs,
            userProfile = UserProfile(
                name = "Alex Rendine",
                accent = "#FF5F5F",
                unitPrice = 0.55,
                lifetimeAggregates = LifetimeAggregates(saved = 384.2, wasted = 1250.0, smokingUnits = 4200.0),
            ),
        )
        startKoin {
            modules(module {
                single<AuthRepository> { ShowcaseAuth() }
                single<RegistryRepository> { repo }
                single<LocalSettings> { FakeSettings() }
                single<NetworkObserver> { FakeNetwork() }
                single { AuthViewModel(get(), get()) }
                single { RegistryViewModel(get(), get(), get(), get()) }
            })
        }
    }

    @After
    fun stopFakes() = stopKoin()

    private fun navTo(label: String) {
        val byDescription = rule.onAllNodes(hasContentDescription(label) and hasClickAction())
        val target: SemanticsNodeInteraction =
            if (byDescription.fetchSemanticsNodes().isNotEmpty()) byDescription[0]
            else rule.onAllNodes(hasText(label) and hasClickAction())[0]
        target.performClick()
        rule.mainClock.advanceTimeBy(1_500)
        rule.waitForIdle()
    }

    private fun shot(name: String, mustShow: String) {
        rule.waitUntil(timeoutMillis = 10_000) {
            rule.onAllNodesWithText(mustShow, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        rule.mainClock.advanceTimeBy(2_000)
        rule.waitForIdle()
        val bitmap = rule.onRoot().captureToImage().asAndroidBitmap()
        assertTrue("$name rendered empty", bitmap.width > 0 && bitmap.height > 0)
        val dir = System.getenv("TABAKPP_SHOWCASE_DIR")?.takeIf { it.isNotBlank() } ?: return
        File(dir).mkdirs()
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("showcase: wrote ${File(dir, "$name.png").absolutePath} (${bitmap.width}x${bitmap.height})")
    }

    @Test
    fun capturesTrackHistoryAndSettingsWithSyntheticData() {
        rule.setContent { App(reducedMotion = true) }
        shot("track", "CIGARETTES")
        navTo("History")
        shot("history", "AT A GLANCE")
        navTo("Settings")
        // Show the tracker list (below the fold at this height), not just the
        // accent picker: the rows are what changed most on this screen.
        rule.onAllNodes(hasScrollAction())[0].performScrollToNode(hasText("ROLL-UPS"))
        shot("settings", "ROLL-UPS")
    }
}
