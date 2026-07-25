package com.tabakpp.app.viewmodels

import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.TrackerType
import com.tabakpp.app.data.UserProfile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class RegistryViewModelTest {

    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var auth: FakeAuthRepository
    private lateinit var registry: FakeRegistryRepository
    private lateinit var activation: CoroutineScope

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        auth = FakeAuthRepository().apply { currentUserFlow.value = testUser("u1") }
        registry = FakeRegistryRepository()
        activation = CoroutineScope(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        activation.cancel()
        Dispatchers.resetMain()
    }

    private fun vm(): RegistryViewModel {
        val vm = RegistryViewModel(auth, registry, FakeLocalSettings(), FakeNetworkObserver())
        // WhileSubscribed flows only mirror upstream while collected — keep them hot.
        activation.launch { vm.configs.collect {} }
        activation.launch { vm.userProfile.collect {} }
        return vm
    }

    @Test
    fun addTracker_sanitizesNameAndCoercesLimitAndPrice() {
        val vm = vm()
        vm.addTracker(
            TrackerConfig(
                id = "", name = "  My<Tracker>  ", limit = 99_999, order = 0,
                type = TrackerType.CIGARETTE, pricePerUnit = 5_000.0
            )
        )

        assertEquals(1, registry.addedConfigs.size)
        val saved = registry.addedConfigs.first()
        assertEquals("MyTracker", saved.name)   // markup stripped, trimmed
        assertEquals(10_000, saved.limit)        // coerced to max
        assertEquals(1_000.0, saved.pricePerUnit) // coerced to max
    }

    @Test
    fun addTracker_rejectsBlankNameAfterSanitization() {
        val vm = vm()
        vm.addTracker(TrackerConfig(id = "", name = "<<<>>>", limit = 5, order = 0))
        assertTrue(registry.addedConfigs.isEmpty(), "a name that sanitizes to blank must be dropped")
    }

    @Test
    fun addTracker_assignsNextOrderAfterExistingConfigs() {
        registry.configsFlow.value = listOf(
            TrackerConfig(id = "a", name = "A", limit = 5, order = 2),
            TrackerConfig(id = "b", name = "B", limit = 5, order = 7)
        )
        val vm = vm()
        vm.addTracker(TrackerConfig(id = "", name = "C", limit = 5, order = 0))

        assertEquals(8, registry.addedConfigs.first().order) // max(2,7) + 1
    }

    @Test
    fun decrement_blocksWhenCountIsZero() {
        registry.profileFlow.value = UserProfile(activeCounts = mapOf("t1" to 0.0))
        val vm = vm()
        vm.decrement("t1")
        assertTrue(registry.liveCounterDeltas.isEmpty(), "must not write a negative counter")
    }

    @Test
    fun decrement_writesNegativeDeltaWhenCountPositive() {
        registry.profileFlow.value = UserProfile(activeCounts = mapOf("t1" to 3.0))
        val vm = vm()
        vm.decrement("t1")

        assertEquals(1, registry.liveCounterDeltas.size)
        assertEquals(Triple("u1", "t1", -1.0), registry.liveCounterDeltas.first())
    }
}
