package com.tabakpp.app.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tabakpp.app.data.*
import com.tabakpp.app.domain.SmokingCalculator
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.datetime.Clock

@OptIn(ExperimentalCoroutinesApi::class)
class RegistryViewModel(
    private val authRepository: AuthRepository,
    private val registryRepository: RegistryRepository,
    private val localSettings: LocalSettings,
    private val networkObserver: NetworkObserver
) : ViewModel() {

    val isOnline = networkObserver.isOnline

    private val authUser: StateFlow<User?> = authRepository.currentUser
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val userUid: Flow<String?> = authUser.map { it?.uid }

    val userProfile: StateFlow<UserProfile?> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(null)
        else registryRepository.subscribeToUserProfile(uid)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val configs: StateFlow<List<TrackerConfig>> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(emptyList())
        else registryRepository.subscribeToConfigs(uid)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val logs: StateFlow<List<LogEntry>> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(emptyList())
        else registryRepository.subscribeToLogs(uid)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val historyIsTruncated: StateFlow<Boolean> = logs
        .map { it.size.toLong() >= LIVE_LOG_QUERY_LIMIT }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    private val _loading = MutableStateFlow(true)
    val loading = _loading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private val _endingDay = MutableStateFlow(false)
    val endingDay = _endingDay.asStateFlow()

    private val _trackingDay = MutableStateFlow(SmokingCalculator.getTrackingDate(Clock.System.now()))
    val trackingDay = _trackingDay.asStateFlow()

    // Local accent color for fast startup
    private val _localAccent = MutableStateFlow(
        localSettings.getString("tabak_accent_last", "#FF5F5F")
    )
    val localAccent = _localAccent.asStateFlow()

    val friendlyError = _error.map { raw ->
        raw
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    init {
        // Refresh tracking day periodically
        viewModelScope.launch {
            while (true) {
                val profile = userProfile.value
                val dayStartHour = profile?.dayStartHour ?: SmokingCalculator.DEFAULT_DAY_START_HOUR
                _trackingDay.value = SmokingCalculator.getTrackingDate(
                    now = Clock.System.now(), 
                    dayStartHour = dayStartHour,
                    timeZone = kotlinx.datetime.TimeZone.currentSystemDefault()
                )
                delay(30000) // 30 seconds
            }
        }

        // On each auth session: ensure profile exists, then clear loading (with timeout).
        // Singleton VM must re-run this per uid — a one-shot take(1) would hang forever
        // if the first session had no user doc. collectLatest cancels in-flight work on sign-out.
        viewModelScope.launch {
            authUser.collectLatest { user ->
                if (user == null) {
                    _loading.value = false
                    return@collectLatest
                }
                _loading.value = true
                try {
                    registryRepository.ensureUserDocument(user.uid, user.displayName)
                    registryRepository.migrateSmokingUnitsIfNeeded(user.uid)
                } catch (e: Exception) {
                    setError(e, "Could not prepare your profile. Try again.")
                }
                val profile = withTimeoutOrNull(12_000L) {
                    userProfile.filterNotNull().first()
                }
                if (profile == null && userProfile.value == null) {
                    _error.value = _error.value
                        ?: "Profile sync timed out. Check your connection and try again."
                }
                _loading.value = false
            }
        }

        // Sync local accent with profile
        viewModelScope.launch {
            userProfile.collect { profile ->
                profile?.accent?.let { accent ->
                    if (accent != _localAccent.value) {
                        _localAccent.value = accent
                        localSettings.putString("tabak_accent_last", accent)
                        authUser.value?.uid?.let { uid ->
                            localSettings.putString("tabak_accent_$uid", accent)
                        }
                    }
                }
            }
        }
    }

    val metrics: StateFlow<SmokingCalculator.GlobalMetrics?> = combine(
        logs, configs, userProfile, trackingDay
    ) { l, c, p, td ->
        if (p == null || td.isEmpty()) null
        else SmokingCalculator.getGlobalMetrics(
            logs = l,
            configs = c,
            activeCounts = p.activeCounts,
            trackingDay = td,
            userPrice = p.unitPrice,
            lifetimeAggregates = p.lifetimeAggregates
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun increment(trackerId: String, onSuccess: () -> Unit = {}) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.updateLiveCounter(uid, trackerId, 1.0)
                onSuccess()
            } catch (e: Exception) {
                setError(e, "Could not update the counter. Try again.")
            }
        }
    }

    fun undoIncrement(trackerId: String) {
        decrement(trackerId)
    }

    fun decrement(trackerId: String) {
        val uid = authUser.value?.uid ?: return
        val currentCount = userProfile.value?.activeCounts?.get(trackerId) ?: 0.0
        if (currentCount <= 0.0) return // Domain validation: Prevent negative counts

        viewModelScope.launch {
            try {
                registryRepository.updateLiveCounter(uid, trackerId, -1.0)
            } catch (e: Exception) {
                setError(e, "Could not update the counter. Try again.")
            }
        }
    }

    fun endDay() {
        val uid = authUser.value?.uid ?: return
        val td = trackingDay.value
        viewModelScope.launch {
            _endingDay.value = true
            try {
                registryRepository.endDay(uid, td)
            } catch (e: Exception) {
                setError(e, "Could not archive the tracking day. Try again.")
            } finally {
                _endingDay.value = false
            }
        }
    }

    fun createManualEntry(date: String, counts: Map<String, Double>) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.createManualEntry(uid, date, counts)
            } catch (e: Exception) {
                setError(e, "Could not create the history entry. Try again.")
            }
        }
    }

    fun deleteLog(log: LogEntry, onSuccess: () -> Unit = {}) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.deleteLog(uid, log.id)
                onSuccess()
            } catch (e: Exception) {
                setError(e, "Could not delete the history entry. Try again.")
            }
        }
    }

    fun restoreLog(log: LogEntry) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.restoreLog(uid, log)
            } catch (e: Exception) {
                setError(e, "Could not restore the history entry. Try again.")
            }
        }
    }

    fun addTracker(config: TrackerConfig) {
        val uid = authUser.value?.uid ?: return
        val currentConfigs = configs.value
        val nextOrder = if (currentConfigs.isEmpty()) 0 else currentConfigs.maxOf { it.order } + 1
        val sanitized = config.copy(
            name = InputSanitizer.trackerName(config.name),
            limit = config.limit.coerceIn(0, 10_000),
            pricePerUnit = config.pricePerUnit?.takeIf { it.isFinite() }?.coerceIn(0.0, 1_000.0)
        )
        if (sanitized.name.isBlank()) return
        
        viewModelScope.launch {
            try {
                registryRepository.addConfig(uid, sanitized.copy(order = nextOrder))
            } catch (e: Exception) {
                setError(e, "Could not add the tracker. Try again.")
            }
        }
    }

    fun updateTracker(config: TrackerConfig) {
        val uid = authUser.value?.uid ?: return
        val sanitized = config.copy(
            name = InputSanitizer.trackerName(config.name),
            limit = config.limit.coerceIn(0, 10_000),
            pricePerUnit = config.pricePerUnit?.takeIf { it.isFinite() }?.coerceIn(0.0, 1_000.0)
        )
        if (sanitized.name.isBlank()) return
        viewModelScope.launch {
            try {
                registryRepository.updateConfig(uid, sanitized)
            } catch (e: Exception) {
                setError(e, "Could not update the tracker. Try again.")
            }
        }
    }

    fun deleteTracker(configId: String) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.deleteConfig(uid, configId)
            } catch (e: Exception) {
                setError(e, "Could not delete the tracker. Try again.")
            }
        }
    }

    fun reorderTracker(index: Int, up: Boolean) {
        val list = configs.value.toMutableList()
        if (up && index > 0) {
            val c1 = list[index]
            val c2 = list[index - 1]
            reorderTracker(c1.id, index - 1, c2.id, index)
        } else if (!up && index < list.size - 1) {
            val c1 = list[index]
            val c2 = list[index + 1]
            reorderTracker(c1.id, index + 1, c2.id, index)
        }
    }

    private fun reorderTracker(configId1: String, order1: Int, configId2: String, order2: Int) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.reorderConfigs(uid, configId1, order1, configId2, order2)
            } catch (e: Exception) {
                setError(e, "Could not reorder trackers. Try again.")
            }
        }
    }

    fun updateLog(logId: String, counts: Map<String, Double>) {
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.updateHistoricalLog(uid, logId, counts)
            } catch (e: Exception) {
                setError(e, "Could not update the history entry. Try again.")
            }
        }
    }

    fun updateProfile(updater: (UserProfile) -> UserProfile) {
        val uid = authUser.value?.uid ?: return
        val current = userProfile.value ?: UserProfile()
        val updated = updater(current)
        viewModelScope.launch {
            try {
                registryRepository.updateProfileSettings(uid, updated)
            } catch (e: Exception) {
                setError(e, "Could not update settings. Try again.")
            }
        }
    }

    fun updateDisplayName(name: String) {
        viewModelScope.launch {
            authRepository.updateDisplayName(name)
                .onFailure { setError(it, "Could not update your display name. Try again.") }
        }
    }

    private fun setError(throwable: Throwable, fallback: String) {
        _error.value = RegistryErrorMapper.map(throwable, fallback)
    }

    fun clearError() {
        _error.value = null
    }
}
