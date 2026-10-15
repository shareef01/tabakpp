package com.tabakpp.app.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tabakpp.app.data.*
import com.tabakpp.app.domain.DateFinancial
import com.tabakpp.app.domain.ExportBuilder
import com.tabakpp.app.domain.ExportFormat
import com.tabakpp.app.domain.ExportState
import com.tabakpp.app.domain.FinancialReadModel
import com.tabakpp.app.domain.FinancialSource
import com.tabakpp.app.domain.FinancialTotals
import com.tabakpp.app.domain.SmokingCalculator
import com.tabakpp.app.domain.HistoryCursor
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Clock
import kotlinx.datetime.TimeZone

@OptIn(ExperimentalCoroutinesApi::class)
class RegistryViewModel(
    private val authRepository: AuthRepository,
    private val registryRepository: RegistryRepository,
    private val localSettings: LocalSettings,
    private val networkObserver: NetworkObserver,
    // Test seams (production defaults preserve exact behavior): the tracking
    // date must be derived from the clock AT MUTATION TIME (see
    // [currentTrackingDate]), so tests inject a fixed clock/zone to prove
    // midnight, custom-boundary, and DST rollovers deterministically.
    private val clock: Clock = Clock.System,
    private val timeZoneProvider: () -> TimeZone = { TimeZone.currentSystemDefault() }
) : ViewModel() {

    val isOnline = networkObserver.isOnline

    private val authUser: StateFlow<User?> = authRepository.currentUser
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val userUid: Flow<String?> = authUser.map { it?.uid }

    /**
     * Live (uid, financialMode) for routing — no profile read per mutation, and
     * a migration takes effect as it happens. Paired with the uid so a cached
     * mode can never apply to a different signed-in account; null until the
     * first snapshot or after a listener error, which makes routing fall back to
     * a one-off read (fail-closed, never a silent LEGACY default).
     */
    private val liveFinancialMode: StateFlow<Pair<String, String>?> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(null)
        else registryRepository.subscribeToFinancialMode(uid)
            .map<String, Pair<String, String>?> { uid to it }
            .onStart { emit(null) }
            .catch { emit(null) }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private suspend fun currentFinancialMode(uid: String): String =
        liveFinancialMode.value?.takeIf { it.first == uid }?.second
            ?: registryRepository.getFinancialMode(uid)

    // Every Firestore-backed flow below is defensively `.catch`-guarded: a
    // rejected/failed listener (permission-denied, a dropped connection, an
    // expired token — anything) must degrade to an error message, never
    // propagate as an uncaught exception and kill the app. This mirrors the
    // web client's onListenerError callbacks, which have always done this.

    val userProfile: StateFlow<UserProfile?> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(null)
        else registryRepository.subscribeToUserProfile(uid)
    }.catch { e -> setError(e, "Could not sync your profile. Check your connection and try again."); emit(null) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val configs: StateFlow<List<TrackerConfig>> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(emptyList())
        else registryRepository.subscribeToConfigs(uid)
    }.catch { e -> setError(e, "Could not sync your trackers. Check your connection and try again."); emit(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val logs: StateFlow<List<LogEntry>> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(emptyList())
        else registryRepository.subscribeToLogs(uid).onStart { emit(emptyList()) }
    }.catch { e -> setError(e, "Could not sync your history. Check your connection and try again."); emit(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** Bounded window of `days/{date}` documents (item 1) — chart/streak use. */
    val dayDocs: StateFlow<List<DayDocument>> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(emptyList())
        else registryRepository.subscribeToDays(uid).onStart { emit(emptyList()) }
    }.catch { e -> setError(e, "Could not sync your history. Check your connection and try again."); emit(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** Avatar (item 12) — decoupled from the high-frequency profile document. */
    val avatar: StateFlow<String?> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(null)
        else registryRepository.subscribeToProfileExtra(uid).map { it?.avatar }
    }.catch { _ ->
        // Avatar is decorative — fail silently (no avatar shown) rather than
        // surfacing a user-facing error for a non-essential listener.
        emit(null)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val historyIsTruncated: StateFlow<Boolean> = logs
        .map { it.size.toLong() >= LIVE_LOG_QUERY_LIMIT }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    private val olderLogs = MutableStateFlow<List<LogEntry>>(emptyList())
    private val olderDays = MutableStateFlow<List<DayDocument>>(emptyList())
    val historyLogs = combine(olderLogs, logs) { older, live -> (older + live).associateBy { it.id }.values.sortedWith(
        compareByDescending<LogEntry> { it.logDate }.thenByDescending { it.id }) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val historyDays = combine(olderDays, dayDocs) { older, live -> (older + live).associateBy { it.date }.values.sortedByDescending { it.date } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    private var logCursor: HistoryCursor? = null
    private var dayCursor: HistoryCursor? = null
    private var logsExhausted = false
    private var daysExhausted = false
    private var historyGeneration = 0
    private val _loadingOlderHistory = MutableStateFlow(false)
    val loadingOlderHistory = _loadingOlderHistory.asStateFlow()
    private val _hasOlderHistory = MutableStateFlow(true)
    val hasOlderHistory = _hasOlderHistory.asStateFlow()

    fun loadOlderHistory() {
        val uid = authUser.value?.uid ?: return
        if (_loadingOlderHistory.value || !_hasOlderHistory.value) return
        _loadingOlderHistory.value = true
        val generation = historyGeneration
        viewModelScope.launch {
            try {
                if (!logsExhausted) {
                    val page = registryRepository.fetchOlderLogs(uid, logCursor ?: logs.value.lastOrNull()?.let { HistoryCursor(it.logDate, it.id) })
                    if (generation != historyGeneration || uid != authUser.value?.uid) return@launch
                    olderLogs.value = (olderLogs.value + page.items).distinctBy { it.id }
                    logCursor = page.cursor
                    logsExhausted = !page.hasMore
                }
                if (!daysExhausted) {
                    val page = registryRepository.fetchOlderDays(uid, dayCursor ?: dayDocs.value.lastOrNull()?.let { HistoryCursor(it.date, it.date) })
                    if (generation != historyGeneration || uid != authUser.value?.uid) return@launch
                    olderDays.value = (olderDays.value + page.items).distinctBy { it.date }
                    dayCursor = page.cursor
                    daysExhausted = !page.hasMore
                }
                _hasOlderHistory.value = !(logsExhausted && daysExhausted)
            } catch (e: Exception) {
                if (generation == historyGeneration) setError(e, "Could not load older history. Try again.")
            } finally {
                if (generation == historyGeneration) _loadingOlderHistory.value = false
            }
        }
    }

    private val _loading = MutableStateFlow(true)
    val loading = _loading.asStateFlow()

    /** Already mapped to user-safe copy by [RegistryErrorMapper] in [setError]. */
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private val _endingDay = MutableStateFlow(false)
    val endingDay = _endingDay.asStateFlow()

    /**
     * End-day outcome — emitted after [endDay] completes so the UI can distinguish
     * success from failure and close/retain the confirmation dialog accordingly.
     * Null when no end-day operation is in progress.
     */
    private val _endDayResult = MutableSharedFlow<Boolean>()
    val endDayResult = _endDayResult.asSharedFlow()

    // IN-FLIGHT MUTATION LEDGER (H-01 fix: parity with Web useRegistry.js)
    // Tracks in-flight mutations explicitly by trackingDate and trackerId.
    // Authoritative baseline is exclusively from realtime Firestore listener snapshots.
    private data class PendingOp(
        val id: String,
        val trackerId: String,
        val delta: Double,
        val trackingDate: String,
        var targetCount: Double,
        var settled: Boolean = false,
        var acknowledged: Boolean = false
    )

    private val _activeCounts = MutableStateFlow<Map<String, Double>>(emptyMap())
    val activeCounts = _activeCounts.asStateFlow()
    private var latestServerCounts: Map<String, Double> = emptyMap()
    private val pendingOps = mutableListOf<PendingOp>()
    private var opSequence: Long = 0L

    // Serialize counter-write transactions so rapid taps cannot fire
    // concurrent Firestore `runTransaction` calls on the same `days/{date}`
    // document (which abort one another and surface as "Could not save that
    // change"). Each increment/decrement must wait for the previous to land.
    private val counterWriteMutex = Mutex()

    private fun nextOpId(): String =
        "${clock.now().toEpochMilliseconds()}_${++opSequence}"

    /**
     * Resolve the tracking date AT MUTATION TIME (AUD-011). `_trackingDay` is
     * refreshed by a 30s loop, so near the configured day boundary it can be up
     * to one tick stale; a write must not be misfiled onto the previous day.
     * Assigning the flow here also re-subscribes to the correct day doc
     * immediately instead of waiting for the next tick.
     */
    private fun resolveTrackingDate(): String {
        val dayStartHour = userProfile.value?.dayStartHour ?: SmokingCalculator.DEFAULT_DAY_START_HOUR
        val fresh = SmokingCalculator.getTrackingDate(Clock.System.now(), dayStartHour)
        if (fresh != _trackingDay.value) _trackingDay.value = fresh
        return fresh
    }

    private fun publishCounterOverlay() {
        val server = latestServerCounts
        val currentDay = trackingDay.value
        val pendingByTracker = mutableMapOf<String, Double>()

        for (op in pendingOps) {
            if (op.trackingDate == currentDay && !op.acknowledged) {
                pendingByTracker[op.trackerId] = (pendingByTracker[op.trackerId] ?: 0.0) + op.delta
            }
        }

        val keys = server.keys + pendingByTracker.keys
        if (keys.isEmpty()) {
            _activeCounts.value = emptyMap()
            return
        }
        _activeCounts.value = keys.associateWith { id ->
            maxOf(0.0, (server[id] ?: 0.0) + (pendingByTracker[id] ?: 0.0))
        }
    }

    private fun purgeAcknowledgedOrCanceledOps() {
        val byTracker = pendingOps.groupBy { it.trackerId }
        val remaining = mutableListOf<PendingOp>()

        for ((trackerId, list) in byTracker) {
            val server = latestServerCounts[trackerId] ?: 0.0
            val settledIncrements = list.filter { it.settled && it.delta > 0 && !it.acknowledged }.toMutableList()
            val settledDecrements = list.filter { it.settled && it.delta < 0 && !it.acknowledged }.toMutableList()
            val unacknowledgedInFlight = list.filter { !it.settled && !it.acknowledged }

            // Cancel matching pairs of settled increments and decrements (net delta = 0)
            while (settledIncrements.isNotEmpty() && settledDecrements.isNotEmpty()) {
                settledIncrements.removeAt(settledIncrements.lastIndex)
                settledDecrements.removeAt(settledDecrements.lastIndex)
            }

            for (op in settledIncrements) {
                if (server >= op.targetCount) {
                    op.acknowledged = true
                } else {
                    remaining.add(op)
                }
            }
            for (op in settledDecrements) {
                if (server <= op.targetCount) {
                    op.acknowledged = true
                } else {
                    remaining.add(op)
                }
            }
            remaining.addAll(unacknowledgedInFlight)
        }

        pendingOps.clear()
        pendingOps.addAll(remaining)
    }

    // Serialize settings writes and chain off the last submitted snapshot so
    // rapid accent/size/name edits cannot overwrite each other mid-flight.
    private val profileWriteMutex = Mutex()
    private var lastSubmittedProfile: UserProfile? = null

    private val _trackingDay = MutableStateFlow(currentTrackingDate())
    val trackingDay = _trackingDay.asStateFlow()

    /**
     * The tracking date derived from the clock RIGHT NOW with the freshest
     * known day-start hour. This — not the cached [_trackingDay] — is what
     * decides which `days/{date}` document a mutation targets. The cached
     * state is only a UI reflection (live-listener key, metrics "today").
     */
    private fun resolvedTimeZone(): TimeZone =
        userProfile.value?.timeZone?.let { runCatching { TimeZone.of(it) }.getOrNull() } ?: timeZoneProvider()

    private fun currentTrackingDate(): String =
        SmokingCalculator.getTrackingDate(
            now = clock.now(),
            dayStartHour = userProfile.value?.dayStartHour ?: SmokingCalculator.DEFAULT_DAY_START_HOUR,
            timeZone = resolvedTimeZone()
        )

    /**
     * Derive the authoritative date for a mutation and, if the cached UI day
     * has fallen behind (midnight/custom-boundary/DST rollover while the app
     * is open or resumed from a throttled background), advance it first.
     *
     * Advancing [_trackingDay] re-keys the live `days/{date}` listener and
     * metrics, so the UI transitions to the new day in the same frame the tap
     * lands. The optimistic ledger is also reset: ops dated the previous day
     * belong to that day's document (in-flight writes still settle there via
     * their own transaction) and must not overlay — nor let their targetCounts
     * (computed from the old day's server counts) poison acknowledgement of
     * new-day ops.
     */
    private fun trackingDateForMutation(): String {
        val fresh = currentTrackingDate()
        if (fresh != _trackingDay.value) {
            _trackingDay.value = fresh
            latestServerCounts = emptyMap()
            pendingOps.removeAll { it.trackingDate != fresh }
            publishCounterOverlay()
        }
        return fresh
    }

    // Local accent color for fast startup
    private val _localAccent = MutableStateFlow(
        localSettings.getString("tabak_accent_last", "#FF5F5F")
    )
    val localAccent = _localAccent.asStateFlow()

    init {
        viewModelScope.launch {
            userUid.distinctUntilChanged().collect {
                historyGeneration++
                olderLogs.value = emptyList(); olderDays.value = emptyList()
                logCursor = null; dayCursor = null
                logsExhausted = false; daysExhausted = false
                _hasOlderHistory.value = true; _loadingOlderHistory.value = false
            }
        }
        viewModelScope.launch {
            userUid.distinctUntilChanged().collectLatest {
                var previous = emptyList<DayDocument>()
                var first = true
                dayDocs.collect { head ->
                    if (first) { first = false; return@collect }
                    val oldest = head.lastOrNull()?.date
                    if (head.size.toLong() >= LIVE_DAYS_QUERY_LIMIT && oldest != null) {
                        val evicted = previous.filter { it.date < oldest }
                        if (evicted.isNotEmpty()) olderDays.value = (evicted + olderDays.value).associateBy { it.date }.values.toList()
                    }
                    previous = head
                }
            }
        }
        viewModelScope.launch {
            userUid.distinctUntilChanged().collectLatest {
                var previous = emptyList<LogEntry>()
                var first = true
                logs.collect { head ->
                    if (first) { first = false; return@collect }
                    val oldest = head.lastOrNull()
                    if (head.size.toLong() >= LIVE_LOG_QUERY_LIMIT && oldest != null) {
                        val evicted = previous.filter { it.logDate < oldest.logDate || (it.logDate == oldest.logDate && it.id < oldest.id) }
                        if (evicted.isNotEmpty()) olderLogs.value = (evicted + olderLogs.value).associateBy { it.id }.values.toList()
                    }
                    previous = head
                }
            }
        }
        // Refresh tracking day periodically (UI refresher only — mutations
        // derive their date independently via [trackingDateForMutation], so a
        // throttled poll can never mis-date a count).
        viewModelScope.launch {
            while (true) {
                _trackingDay.value = currentTrackingDate()
                delay(30000) // 30 seconds
            }
        }

        // Recompute the tracking day IMMEDIATELY whenever the profile changes —
        // the 30s poll above can leave the default dayStartHour applied for up
        // to half a minute after sign-in/profile load. Mutations additionally
        // re-derive the date at tap time (see [trackingDateForMutation]); this
        // collector keeps the UI in sync without any user action.
        viewModelScope.launch {
            userProfile.collect { _trackingDay.value = currentTrackingDate() }
        }

        // On each auth session: ensure profile exists, then clear loading (with timeout).
        // Singleton VM must re-run this per uid — a one-shot take(1) would hang forever
        // if the first session had no user doc. collectLatest cancels in-flight work on sign-out.
        viewModelScope.launch {
            authUser.collectLatest { user ->
                if (user == null) {
                    lastSubmittedProfile = null
                    pendingOps.clear()
                    latestServerCounts = emptyMap()
                    publishCounterOverlay()
                    _loading.value = false
                    return@collectLatest
                }
                lastSubmittedProfile = null
                _loading.value = true
                try {
                    registryRepository.ensureUserDocument(user.uid, user.displayName)
                    // The two financial legacy migrations write lifetimeAggregates /
                    // day docs, which a MIGRATING/OPTION_B account's rules deny — and
                    // the trusted migration already owns that state. Skip them there
                    // (web parity) instead of failing "Could not prepare your profile".
                    if (!financialLocked(user.uid)) {
                        registryRepository.migrateSmokingUnitsIfNeeded(user.uid)
                        // One-time, idempotent, self-healing migration (activeCounts ->
                        // days). Safe every session: a no-op once already applied.
                        registryRepository.migrateLegacyActiveCounts(user.uid)
                    }
                    // avatar -> meta/profile is not financial and is always allowed.
                    registryRepository.migrateAvatarToProfileMeta(user.uid)
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

        // Live "today" bucket (item 1's actual fix): re-subscribe to
        // `days/{trackingDay}` whenever the tracking date changes (computed
        // above from wall-clock time), and opportunistically fold any day
        // the date has already moved past — a convenience rollup, never what
        // decides which date a count belongs to (that already happened, at
        // write time, in increment/decrement below).
        viewModelScope.launch {
            combine(userUid, _trackingDay) { uid, day -> uid to day }
                .distinctUntilChanged()
                .flatMapLatest { (uid, day) ->
                    latestServerCounts = emptyMap()
                    publishCounterOverlay()
                    if (uid == null) flowOf(null)
                    else registryRepository.subscribeToDay(uid, day).catch { e ->
                        setError(e, "Could not sync today's counts. Check your connection and try again.")
                        emit(null)
                    }
                }
                .catch { e ->
                    setError(e, "Could not sync today's counts. Check your connection and try again.")
                }
                .collect { day ->
                    val newCounts = day?.counts ?: emptyMap()
                    latestServerCounts = newCounts
                    val currentDay = trackingDay.value

                    for (op in pendingOps) {
                        if (op.trackingDate == currentDay && !op.acknowledged) {
                            val currentServer = newCounts[op.trackerId] ?: 0.0
                            if (op.delta > 0) {
                                if (currentServer == op.targetCount) {
                                    op.acknowledged = true
                                } else if (currentServer > op.targetCount) {
                                    op.targetCount = currentServer + op.delta
                                }
                            } else if (op.delta < 0) {
                                if (currentServer == op.targetCount) {
                                    op.acknowledged = true
                                } else if (currentServer < op.targetCount) {
                                    op.targetCount = maxOf(0.0, currentServer + op.delta)
                                }
                            }
                        }
                    }

                    purgeAcknowledgedOrCanceledOps()
                    publishCounterOverlay()
                }
        }
        viewModelScope.launch {
            combine(userUid, _trackingDay) { uid, day -> uid to day }.collect { (uid, day) ->
                if (uid != null) {
                    try {
                        if (optionBActive(uid)) {
                            // OPTION_B: each stale day closes through the trusted
                            // DAY_CLOSE (same deterministic id as endDay/web, so a
                            // concurrent close from another device is idempotent).
                            for (date in registryRepository.listStaleOpenDays(uid, day)) {
                                runCatching {
                                    gateway().execute("DAY_CLOSE", mapOf("operationId" to "close_$date", "date" to date))
                                }
                            }
                        } else {
                            registryRepository.reconcileStaleDays(uid, day)
                        }
                    } catch (_: Exception) {
                        // Best-effort — self-heals on the next tick/app start.
                    }
                }
            }
        }

        // Release the settings write-chain baseline as soon as the server echoes
        // back exactly what we last submitted.
        viewModelScope.launch {
            userProfile.collect { profile ->
                val submitted = lastSubmittedProfile
                if (profile != null && submitted != null && sameSettings(profile, submitted)) {
                    lastSubmittedProfile = null
                }
            }
        }
    }

    private data class MetricsInputs(
        val logs: List<LogEntry>,
        val configs: List<TrackerConfig>,
        val activeCounts: Map<String, Double>,
        val profile: UserProfile?,
        val trackingDay: String
    )

    /** Server-side financial mode ('LEGACY' default) — drives the read projection. */
    val financialMode: StateFlow<String> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf("LEGACY")
        else flow { emit(registryRepository.getFinancialMode(uid)) }
    }.catch { e -> setError(e, "Could not read the account financial mode."); emit("LEGACY") }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "LEGACY")

    /** Canonical OPTION B daily ledgers (bounded recent window; the trusted callable writes them). */
    val ledgers: StateFlow<List<DailyFinancialRecord>> = userUid.flatMapLatest { uid ->
        if (uid == null) flowOf(emptyList())
        else registryRepository.subscribeToLedgers(uid)
    }.catch { e -> setError(e, "Could not sync the financial ledger. Check your connection."); emit(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    data class CanonicalFinancials(
        val mode: String,
        val today: DateFinancial,
        val totals: FinancialTotals,
        val windowTruncated: Boolean
    )

    private data class CanonicalInputs(val mode: String, val ledgers: List<DailyFinancialRecord>)
    private data class ActivityInputs(val trackingDay: String, val days: List<DayDocument>, val logs: List<LogEntry>)

    /**
     * Mode-aware canonical financial projection (Kotlin parity with the Web read
     * contract). Null for LEGACY (legacy behaviour preserved). Consumes the
     * persisted server-calculated values — never recomputes Option-B credit.
     */
    val canonical: StateFlow<CanonicalFinancials?> = combine(
        combine(financialMode, ledgers, ::CanonicalInputs),
        combine(trackingDay, dayDocs, logs, ::ActivityInputs),
    ) { fin, act ->
        if (fin.mode == "LEGACY") null
        else {
            val byDate = fin.ledgers.associateBy { it.date }
            val dayDates = act.days.map { it.date }.toSet()
            val logDates = act.logs.map { it.logDate }.toSet()
            fun resolve(date: String): DateFinancial = FinancialReadModel.resolveDateFinancial(
                fin.mode, byDate[date], dayDates.contains(date) || logDates.contains(date)
            )
            val dates = (byDate.keys + dayDates + logDates).toSortedSet()
            CanonicalFinancials(
                mode = fin.mode,
                today = resolve(act.trackingDay),
                totals = FinancialReadModel.aggregateFinancials(dates.map { resolve(it) }),
                windowTruncated = fin.ledgers.size >= 400,
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val metrics: StateFlow<SmokingCalculator.GlobalMetrics?> = combine(
        combine(logs, configs, _activeCounts, userProfile, trackingDay, ::MetricsInputs),
        dayDocs,
        canonical,
    ) { inputs, dd, canon ->
        val p = inputs.profile
        if (p == null || inputs.trackingDay.isEmpty()) null
        else {
            val base = SmokingCalculator.getGlobalMetrics(
                logs = inputs.logs,
                configs = inputs.configs,
                activeCounts = inputs.activeCounts,
                trackingDay = inputs.trackingDay,
                userPrice = p.unitPrice,
                lifetimeAggregates = p.lifetimeAggregates,
                dayDocs = dd
            )
            if (canon == null) base
            else when (canon.today.source) {
                FinancialSource.OPTION_B_CANONICAL -> {
                    val c = canon.today.canonical!!
                    val foldedToday = ledgers.value.firstOrNull { it.date == inputs.trackingDay }?.foldedIntoLifetime == true
                    val openCredit = canon.today.eligible && !foldedToday
                    base.copy(
                        spentToday = c.spent,
                        saved = c.saved,
                        budgetLeftToday = c.saved,
                        baselineSavedToday = c.baselineSaved,
                        savedLifetime = p.lifetimeAggregates.saved + (if (openCredit) c.saved else 0.0),
                        baselineSavedLifetime = p.lifetimeAggregates.baselineSaved + (if (openCredit) c.baselineSaved else 0.0),
                        todayAvailable = true,
                        todayUnresolved = canon.today.unresolved,
                    )
                }
                FinancialSource.MISSING_CANONICAL_LEDGER -> base.copy(
                    // Source activity exists but the authoritative ledger is gone —
                    // UNAVAILABLE, never a legacy fallback or a fabricated zero.
                    spentToday = 0.0,
                    saved = 0.0,
                    budgetLeftToday = 0.0,
                    baselineSavedToday = 0.0,
                    todayAvailable = false,
                    todayUnresolved = null,
                )
                FinancialSource.NO_ACTIVITY -> base.copy(
                    spentToday = 0.0,
                    saved = 0.0,
                    budgetLeftToday = 0.0,
                    baselineSavedToday = 0.0,
                    savedLifetime = p.lifetimeAggregates.saved,
                    baselineSavedLifetime = p.lifetimeAggregates.baselineSaved,
                )
                else -> base
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /**
     * OPTION B routing switch. When true AND the account's server-side
     * `financialMode == 'OPTION_B'`, every financial mutation routes through
     * [optionBGateway]. Production (Koin) enables it together with the real
     * gateway — routing is effectively per account, by server mode. The default
     * false only keeps unit tests that build a bare view model on the legacy path.
     */
    var optionBLedgerEnabled: Boolean = false

    /** Trusted write gateway (OPTION_B). Injected; never a direct Firestore write. */
    var optionBGateway: TrustedFinancial? = null

    private suspend fun optionBActive(uid: String): Boolean =
        optionBLedgerEnabled && currentFinancialMode(uid) == "OPTION_B"

    /**
     * MIGRATING/OPTION_B: the trusted function owns all financial state and the
     * rules deny direct client financial writes (parity with the web
     * `financialWritesLocked`). Independent of [optionBLedgerEnabled].
     */
    private suspend fun financialLocked(uid: String): Boolean =
        currentFinancialMode(uid).let { it == "MIGRATING" || it == "OPTION_B" }

    /**
     * The injected gateway, with every call stamped with the device's CURRENT
     * tracking date (parity with the web `trustedExecute`). The server has no
     * timezone for the user and accepts this, bounds-checked, as the user's
     * "today" instead of evaluating it in UTC.
     */
    private fun gateway(): TrustedFinancial {
        val inner = optionBGateway ?: error("OPTION_B requires the trusted financial gateway")
        return object : TrustedFinancial {
            override suspend fun execute(type: String, payload: Map<String, Any?>) =
                inner.execute(
                    type,
                    payload + mapOf(
                        "currentTrackingDate" to currentTrackingDateNow(),
                        "timeZone" to resolvedTimeZone().id
                    )
                )
        }
    }

    /** Same rule as [resolveTrackingDate], without its flow side effect. */
    private fun currentTrackingDateNow(): String = SmokingCalculator.getTrackingDate(
        clock.now(),
        userProfile.value?.dayStartHour ?: SmokingCalculator.DEFAULT_DAY_START_HOUR,
        timeZone = resolvedTimeZone()
    )

    private fun mutationBlocked(): Boolean {
        val profile = userProfile.value ?: return false
        val lease = profile.smokingMigrationLeaseUntil
        val leased = lease != null && lease.seconds * 1000 + lease.nanoseconds / 1_000_000 > Clock.System.now().toEpochMilliseconds()
        if (!profile.deleting && !leased) return false
        setError(Exception(if (profile.deleting) "ACCOUNT_DELETING" else "MIGRATION_IN_PROGRESS"),
            if (profile.deleting) "Account deletion is in progress. Retry deletion from Settings." else "History migration is in progress. Try again shortly.")
        return true
    }


    fun increment(trackerId: String, onSuccess: () -> Unit = {}) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to update this count.")
            return
        }
        // Block writes until the profile sync resolves (or times out): before
        // the user's dayStartHour is known, a tap near a custom day boundary
        // would be dated with the default hour and land on the wrong
        // days/{date} document. Once loading clears (profile loaded OR 12s
        // timeout), taps proceed with the best-known hour.
        if (_loading.value && userProfile.value == null) {
            _error.value = "Still syncing your profile — try again in a moment."
            return
        }
        // The date is derived from the clock at THIS moment, never from the
        // (possibly stale) cached tracking day.
        val trackingDate = trackingDateForMutation()
        val price = userProfile.value?.unitPrice ?: 0.5
        val currentServer = latestServerCounts[trackerId] ?: 0.0

        var expectedBase = currentServer
        for (o in pendingOps) {
            if (o.trackingDate == trackingDate && o.trackerId == trackerId && !o.acknowledged) {
                expectedBase += o.delta
            }
        }

        val op = PendingOp(
            id = nextOpId(),
            trackerId = trackerId,
            delta = 1.0,
            trackingDate = trackingDate,
            targetCount = maxOf(0.0, expectedBase + 1.0)
        )
        pendingOps.add(op)
        publishCounterOverlay()

        viewModelScope.launch {
            counterWriteMutex.withLock {
                try {
                    if (optionBActive(uid)) {
                        gateway().execute("COUNTER_INCREMENT", mapOf("operationId" to op.id, "date" to trackingDate, "trackerId" to trackerId, "delta" to 1.0, "defaultUnitPrice" to price))
                    } else {
                        registryRepository.updateLiveCounter(uid, trackerId, 1.0, trackingDate, price)
                    }
                    op.settled = true
                    purgeAcknowledgedOrCanceledOps()
                    publishCounterOverlay()
                    onSuccess()
                } catch (e: Exception) {
                    pendingOps.removeAll { it.id == op.id }
                    publishCounterOverlay()
                    setError(e, "Could not save that change. Your count was restored.")
                }
            }
        }
    }

    fun undoIncrement(trackerId: String) {
        decrement(trackerId)
    }

    fun decrement(trackerId: String) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if ((_activeCounts.value[trackerId] ?: 0.0) <= 0.0) return // Prevent negative counts
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to update this count.")
            return
        }
        if (_loading.value && userProfile.value == null) {
            _error.value = "Still syncing your profile — try again in a moment."
            return
        }
        val trackingDate = trackingDateForMutation()
        val price = userProfile.value?.unitPrice ?: 0.5
        val currentServer = latestServerCounts[trackerId] ?: 0.0

        var expectedBase = currentServer
        for (o in pendingOps) {
            if (o.trackingDate == trackingDate && o.trackerId == trackerId && !o.acknowledged) {
                expectedBase += o.delta
            }
        }

        val op = PendingOp(
            id = nextOpId(),
            trackerId = trackerId,
            delta = -1.0,
            trackingDate = trackingDate,
            targetCount = maxOf(0.0, expectedBase - 1.0)
        )
        pendingOps.add(op)
        publishCounterOverlay()

        viewModelScope.launch {
            counterWriteMutex.withLock {
                try {
                    if (optionBActive(uid)) {
                        gateway().execute("COUNTER_DECREMENT", mapOf("operationId" to op.id, "date" to trackingDate, "trackerId" to trackerId, "delta" to -1.0, "defaultUnitPrice" to price))
                    } else {
                        registryRepository.updateLiveCounter(uid, trackerId, -1.0, trackingDate, price)
                    }
                    op.settled = true
                    purgeAcknowledgedOrCanceledOps()
                    publishCounterOverlay()
                } catch (e: Exception) {
                    pendingOps.removeAll { it.id == op.id }
                    publishCounterOverlay()
                    setError(e, "Could not save that change. Your count was restored.")
                }
            }
        }
    }

    /**
     * Close the tracking day — a UX affordance only (see
     * RegistryRepository.closeDay). It never decides which date a count
     * belongs to; that already happened, at write time, in
     * increment/decrement above.
     */
    fun endDay() {
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to end the tracking day.")
            viewModelScope.launch { _endDayResult.emit(false) }
            return
        }
        // Same protection as increment/decrement: closing with an unknown
        // dayStartHour would archive the wrong day.
        if (_loading.value && userProfile.value == null) {
            _error.value = "Still syncing your profile — try again in a moment."
            viewModelScope.launch { _endDayResult.emit(false) }
            return
        }
        // Fresh derivation: closing must archive the day the clock says is
        // current, even if the cached tracking day has not caught up yet.
        val td = trackingDateForMutation()
        viewModelScope.launch {
            _endingDay.value = true
            try {
                // Wait for any in-flight counter writes to settle so the
                // server-side day document reflects all local increments
                // before closeDay evaluates hasOpenSession(day.counts).
                // Without this, a pending increment causes closeDay to
                // read stale server counts (still 0) and throw NOTHING_TO_ARCHIVE.
                counterWriteMutex.withLock {
                    if (optionBActive(uid)) {
                        // Deterministic id for "close this date": a retried request
                        // after a lost response stays idempotent (web parity).
                        gateway().execute("DAY_CLOSE", mapOf("operationId" to "close_$td", "date" to td))
                    } else {
                        registryRepository.closeDay(uid, td)
                    }
                }
                _endDayResult.emit(true)
            } catch (e: Exception) {
                setError(e, "Could not close the tracking day. Try again.")
                _endDayResult.emit(false)
            } finally {
                _endingDay.value = false
            }
        }
    }

    fun createManualEntry(date: String, counts: Map<String, Double>) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to save this entry.")
            return
        }
        // Backfill cannot run forward. Firestore rules only check the YYYY-MM-DD
        // pattern, so this is the last enforcement point before the write (the
        // web guards in RegistryService.createManualEntry for the same reason).
        // Compare against the freshly derived day, not the cached one.
        if (!SmokingCalculator.isBackfillDateAllowed(date, trackingDateForMutation())) {
            _error.value = "Pick today or an earlier date."
            return
        }
        viewModelScope.launch {
            try {
                if (optionBActive(uid)) {
                    val opId = nextOpId()
                    val logId = "${date}-M-$opId"
                    gateway().execute("MANUAL_CREATE", mapOf(
                        "operationId" to opId, "date" to date, "logId" to logId, "counts" to counts,
                        "defaultUnitPrice" to (userProfile.value?.unitPrice ?: 0.5)
                    ))
                } else {
                    registryRepository.createManualEntry(uid, date, counts)
                }
            } catch (e: Exception) {
                setError(e, "Could not create the history entry. Try again.")
            }
        }
    }

    fun deleteLog(log: LogEntry, onSuccess: () -> Unit = {}) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to delete this entry.")
            return
        }
        viewModelScope.launch {
            try {
                if (optionBActive(uid)) {
                    gateway().execute("MANUAL_DELETE", mapOf("operationId" to nextOpId(), "date" to log.logDate, "logId" to log.id, "defaultUnitPrice" to (userProfile.value?.unitPrice ?: 0.5)))
                } else {
                    registryRepository.deleteLog(uid, log.id)
                }
                if (authUser.value?.uid == uid) olderLogs.value = olderLogs.value.filterNot { it.id == log.id }
                onSuccess()
            } catch (e: Exception) {
                setError(e, "Could not delete the history entry. Try again.")
            }
        }
    }

    fun restoreLog(log: LogEntry) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to restore this entry.")
            return
        }
        viewModelScope.launch {
            try {
                if (optionBActive(uid)) {
                    gateway().execute("MANUAL_RESTORE", mapOf("operationId" to nextOpId(), "date" to log.logDate, "logId" to log.id, "counts" to log.counts, "defaultUnitPrice" to (userProfile.value?.unitPrice ?: 0.5)))
                } else {
                    registryRepository.restoreLog(uid, log)
                }
                if (authUser.value?.uid == uid) olderLogs.value = (olderLogs.value + log).distinctBy { it.id }
            } catch (e: Exception) {
                setError(e, "Could not restore the history entry. Try again.")
            }
        }
    }

    fun addTracker(config: TrackerConfig) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        val currentConfigs = configs.value
        // Client-side cap matching firestore.rules' trackerSnapshots bound
        // (AUD-005) so a 9th tracker is rejected up-front instead of failing a
        // later day write with permission-denied.
        if (currentConfigs.size >= MAX_TRACKERS) {
            _error.value = "You can track up to $MAX_TRACKERS counters at once."
            return
        }
        val nextOrder = if (currentConfigs.isEmpty()) 0 else currentConfigs.maxOf { it.order } + 1
        val sanitized = config.copy(
            name = InputSanitizer.trackerName(config.name),
            limit = config.limit.coerceIn(0, 10_000),
            pricePerUnit = config.pricePerUnit?.takeIf { it.isFinite() }?.coerceIn(0.0, 1_000.0),
            baseline = config.baseline?.coerceIn(0, 10_000)
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
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        val sanitized = config.copy(
            name = InputSanitizer.trackerName(config.name),
            limit = config.limit.coerceIn(0, 10_000),
            pricePerUnit = config.pricePerUnit?.takeIf { it.isFinite() }?.coerceIn(0.0, 1_000.0),
            baseline = config.baseline?.coerceIn(0, 10_000)
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
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to delete this tracker.")
            return
        }
        // Fresh derivation: hasOpenSession must evaluate the day the clock
        // says is current, not a possibly stale cached tracking day.
        val trackingDate = trackingDateForMutation()
        viewModelScope.launch {
            try {
                if (optionBActive(uid)) {
                    // The backend deletes the config and drops the tracker from the
                    // current open day + ledger (historical days keep frozen state).
                    gateway().execute("TRACKER_DELETE", mapOf(
                        "operationId" to "del_${configId}_$trackingDate", "date" to trackingDate, "trackerId" to configId,
                    ))
                } else {
                    registryRepository.deleteConfig(uid, configId, trackingDate)
                }
            } catch (e: Exception) {
                setError(e, "Could not delete the tracker. Try again.")
            }
        }
    }

    fun reorderTracker(index: Int, up: Boolean) {
        if (mutationBlocked()) return
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
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to reorder trackers.")
            return
        }
        viewModelScope.launch {
            try {
                registryRepository.reorderConfigs(uid, configId1, order1, configId2, order2)
            } catch (e: Exception) {
                setError(e, "Could not reorder trackers. Try again.")
            }
        }
    }

    fun updateLog(logId: String, counts: Map<String, Double>) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to save this change.")
            return
        }
        viewModelScope.launch {
            try {
                if (optionBActive(uid)) {
                    val date = logs.value.firstOrNull { it.id == logId }?.logDate
                        ?: registryRepository.getLogDate(uid, logId)
                        ?: throw IllegalStateException("LOG_NOT_FOUND")
                    gateway().execute("MANUAL_UPDATE", mapOf(
                        "operationId" to nextOpId(), "date" to date, "logId" to logId, "counts" to counts,
                    ))
                } else {
                    registryRepository.updateHistoricalLog(uid, logId, counts)
                }
                if (olderLogs.value.any { it.id == logId }) {
                    val updated = registryRepository.getHistoricalLog(uid, logId)
                    if (authUser.value?.uid == uid && updated != null) {
                        olderLogs.value = olderLogs.value.map { if (it.id == logId) updated else it }
                    }
                }
            } catch (e: Exception) {
                setError(e, "Could not update the history entry. Try again.")
            }
        }
    }

    /** Edit a closed `days/{date}` record — the dated-model equivalent of [updateLog]. */
    fun updateDayRecord(date: String, counts: Map<String, Double>) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        if (!networkObserver.isOnline.value) {
            setError(Exception("offline"), "Connect to the internet to save this change.")
            return
        }
        viewModelScope.launch {
            try {
                if (optionBActive(uid)) {
                    gateway().execute("HISTORICAL_DAY_UPDATE", mapOf(
                        "operationId" to nextOpId(), "date" to date, "counts" to counts,
                    ))
                } else {
                    registryRepository.updateHistoricalDay(uid, date, counts)
                }
                if (olderDays.value.any { it.date == date }) {
                    val updated = registryRepository.getHistoricalDay(uid, date)
                    if (authUser.value?.uid == uid && updated != null) {
                        olderDays.value = olderDays.value.map { if (it.date == date) updated else it }
                    }
                }
            } catch (e: Exception) {
                setError(e, "Could not update the history entry. Try again.")
            }
        }
    }

    fun updateAvatar(avatar: String?) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            try {
                registryRepository.updateAvatar(uid, avatar)
            } catch (e: Exception) {
                setError(e, "Could not update your avatar. Try again.")
            }
        }
    }

    fun updateProfile(updater: (UserProfile) -> UserProfile) {
        if (mutationBlocked()) return
        val uid = authUser.value?.uid ?: return
        viewModelScope.launch {
            profileWriteMutex.withLock {
                val current = lastSubmittedProfile ?: userProfile.value ?: return@withLock
                val updated = updater(current)
                try {
                    registryRepository.updateProfileSettings(uid, updated)
                    lastSubmittedProfile = updated
                } catch (e: Exception) {
                    lastSubmittedProfile = userProfile.value
                    setError(e, "Could not update settings. Try again.")
                }
            }
        }
    }

    /** Compares only the fields [RegistryRepository.updateProfileSettings] writes. */
    private fun sameSettings(a: UserProfile, b: UserProfile): Boolean =
        a.name == b.name &&
            a.accent == b.accent &&
            a.widgetSize == b.widgetSize &&
            a.purchaseType == b.purchaseType &&
            a.unitPrice == b.unitPrice &&
            a.pouchPrice == b.pouchPrice &&
            a.estimatedYield == b.estimatedYield &&
            a.dayStartHour == b.dayStartHour &&
            a.timeZone == b.timeZone

    fun updateDisplayName(name: String) {
        if (mutationBlocked()) return
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

    /**
     * Export state for the UI — idle by default, Exporting while the complete
     * snapshot is being read, Ready with the built artifact.
     */
    private val _exportState = MutableStateFlow<ExportState>(ExportState.Idle)
    val exportState: StateFlow<ExportState> = _exportState.asStateFlow()

    /**
     * Reads a complete, unbounded export snapshot from the repository (NOT
     * the bounded live-query collections), then builds the requested format.
     * Strictly read-only — does not close days, reconcile, migrate, or write.
     */
    fun exportData(format: ExportFormat) {
        val uid = authUser.value?.uid
        if (uid == null) {
            _exportState.value = ExportState.Error("Sign in to export your data.")
            return
        }
        viewModelScope.launch {
            _exportState.value = ExportState.Exporting
            try {
                val snapshot = registryRepository.readCompleteExportSnapshot(uid)
                val unitPrice = userProfile.value?.unitPrice ?: 0.5
                val result = when (format) {
                    ExportFormat.JSON -> ExportBuilder.buildJson(
                        snapshot.profile, snapshot.profileMeta, snapshot.configs,
                        snapshot.days, snapshot.logs
                    )
                    ExportFormat.CSV -> ExportBuilder.buildCsv(
                        snapshot.profile, snapshot.configs, snapshot.days, snapshot.logs, unitPrice
                    )
                }
                _exportState.value = ExportState.Ready(result, format)
            } catch (e: Exception) {
                _exportState.value = ExportState.Error(
                    e.message ?: "Could not export your data. Try again."
                )
            }
        }
    }

    fun clearExportState() {
        _exportState.value = ExportState.Idle
    }

    fun setExportError(message: String) {
        _exportState.value = ExportState.Error(message)
    }
}
