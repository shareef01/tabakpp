package com.tabakpp.app.viewmodels

import com.tabakpp.app.data.AuthRepository
import com.tabakpp.app.data.LocalSettings
import com.tabakpp.app.data.LogEntry
import com.tabakpp.app.data.NetworkObserver
import com.tabakpp.app.data.RegistryRepository
import com.tabakpp.app.data.TrackerConfig
import com.tabakpp.app.data.User
import com.tabakpp.app.data.UserProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Records calls and lets tests drive currentUser + repo results. */
class FakeAuthRepository(
    override val isGoogleSignInAvailable: Boolean = true
) : AuthRepository {
    val currentUserFlow = MutableStateFlow<User?>(null)
    override val currentUser: Flow<User?> = currentUserFlow

    var signUpResult: Result<Unit> = Result.success(Unit)
    var signInResult: Result<Unit> = Result.success(Unit)
    var resetResult: Result<Unit> = Result.success(Unit)

    var lastSignUpEmail: String? = null
    var lastSignUpPassword: String? = null
    var lastSignUpDisplayName: String? = null
    var signUpCallCount = 0

    override suspend fun signInWithGoogle(): Result<Unit> = signInResult
    override suspend fun signInWithEmail(email: String, password: String): Result<Unit> = signInResult
    override suspend fun signUpWithEmail(email: String, password: String, displayName: String?): Result<Unit> {
        signUpCallCount++
        lastSignUpEmail = email
        lastSignUpPassword = password
        lastSignUpDisplayName = displayName
        return signUpResult
    }
    override suspend fun sendPasswordResetEmail(email: String): Result<Unit> = resetResult
    override suspend fun updateDisplayName(name: String): Result<Unit> = Result.success(Unit)
    override suspend fun signOut() { currentUserFlow.value = null }
    override suspend fun deleteAccount(password: String?): Result<Unit> = Result.success(Unit)
}

/** Records mutation calls; profile/configs/logs are driveable StateFlows. */
class FakeRegistryRepository : RegistryRepository {
    val profileFlow = MutableStateFlow<UserProfile?>(UserProfile())
    val configsFlow = MutableStateFlow<List<TrackerConfig>>(emptyList())
    val logsFlow = MutableStateFlow<List<LogEntry>>(emptyList())

    val addedConfigs = mutableListOf<TrackerConfig>()
    val updatedConfigs = mutableListOf<TrackerConfig>()
    val liveCounterDeltas = mutableListOf<Triple<String, String, Double>>()

    override fun subscribeToUserProfile(uid: String): Flow<UserProfile?> = profileFlow
    override fun subscribeToConfigs(uid: String): Flow<List<TrackerConfig>> = configsFlow
    override fun subscribeToLogs(uid: String): Flow<List<LogEntry>> = logsFlow

    override suspend fun updateLiveCounter(uid: String, trackerId: String, delta: Double) {
        liveCounterDeltas.add(Triple(uid, trackerId, delta))
    }
    override suspend fun endDay(uid: String, trackingDate: String) {}
    override suspend fun createManualEntry(uid: String, date: String, counts: Map<String, Double>) {}
    override suspend fun deleteLog(uid: String, logId: String) {}
    override suspend fun restoreLog(uid: String, log: LogEntry) {}
    override suspend fun updateHistoricalLog(uid: String, logId: String, counts: Map<String, Double>) {}
    override suspend fun addConfig(uid: String, config: TrackerConfig) { addedConfigs.add(config) }
    override suspend fun updateConfig(uid: String, config: TrackerConfig) { updatedConfigs.add(config) }
    override suspend fun deleteConfig(uid: String, configId: String) {}
    override suspend fun reorderConfigs(uid: String, configId1: String, order1: Int, configId2: String, order2: Int) {}
    override suspend fun updateProfileSettings(uid: String, profile: UserProfile) {}
    override suspend fun ensureUserDocument(uid: String, displayName: String?) {}
    override suspend fun migrateSmokingUnitsIfNeeded(uid: String) {}
    override suspend fun deleteAllUserData(uid: String) {}
}

class FakeNetworkObserver(online: Boolean = true) : NetworkObserver {
    override val isOnline: StateFlow<Boolean> = MutableStateFlow(online)
}

class FakeLocalSettings : LocalSettings {
    private val store = mutableMapOf<String, String>()
    override fun getString(key: String, defaultValue: String): String = store[key] ?: defaultValue
    override fun putString(key: String, value: String) { store[key] = value }
}

fun testUser(uid: String = "u1", name: String? = "Alex") =
    User(uid = uid, email = "a@b.com", displayName = name, photoUrl = null)
