import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RegistryService, MAX_TRACKERS } from '../services/registryService';
import { SmokingCalculator } from '../utils/smokingCalculator';
import { mapFirestoreError } from '../utils/errorHandlers';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { FinancialSource, resolveDateFinancial, aggregateFinancials } from '../services/financialReadModel';

const emptyRegistry = () => ({
  configs: [],
  logs: [],
  dayDocs: [],
  activeCounts: {},
  lifetimeAggregates: null,
  profileSettings: null,
  avatar: null,
});

/**
 * useRegistry (Hardened Cross-Platform Engine)
 *
 * `today` (the tracking date, computed by the caller from
 * `getTrackingDate(now, dayStartHour)`) is now the key that decides which
 * `days/{date}` document this hook reads/writes for "live" counts (item 1) —
 * there is no shared mutable "current session" bucket that can carry counts
 * across a rollover boundary. When `today` changes (the 30s tick in App.jsx
 * notices the tracking date rolled over), this hook re-subscribes to the new
 * day doc and opportunistically folds the previous one into lifetime
 * aggregates via `reconcileStaleDays` — a convenience rollup, never what
 * decides which date a count belongs to (that already happened at write
 * time).
 *
 * ## Why everything keys on `uid`, never `user`
 *
 * Effects and callbacks here subscribe/mutate on `uid` (`user?.uid`), while
 * `user` is a Firebase `User` object whose identity changes on every token
 * refresh (~hourly). Depending on the whole object would tear down and rebuild
 * all six Firestore listeners mid-session. Reading only `uid` inside them lets
 * `react-hooks/exhaustive-deps` check the dependency lists for real instead of
 * reporting `user` as missing on every one.
 */
export const useRegistry = (user, today, unitPrice = 0.5, onTrackingDayChange = null, nowFn = () => new Date(), listenerEpoch = 0) => {
  // The narrow key every effect and callback below depends on (see above).
  const uid = user?.uid;
  const [configs, setConfigs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [dayDocs, setDayDocs] = useState([]);
  const [activeCounts, setActiveCounts] = useState({});
  const [lifetimeAggregates, setLifetimeAggregates] = useState(null);
  const [ledgers, setLedgers] = useState([]);
  const [ledgersLoaded, setLedgersLoaded] = useState(false);
  const [financialMode, setFinancialMode] = useState(null);
  const [profileSettings, setProfileSettings] = useState(null);
  /**
   * Distinguishes "still waiting for the profile" from "the profile listener
   * gave up". Without it, a failed `users/{uid}` read is indistinguishable
   * from a slow one: `profileSettings` stays null, App.jsx's `isHydrated`
   * never flips, and the user gets a skeleton forever with no retry path
   * (only a Dismiss button on a banner that hides the error).
   */
  const [profileLoaded, setProfileLoaded] = useState(false);
  const accountWriteState = useRef(null);
  const [avatar, setAvatar] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(!!user);
  const [isEndingDay, setIsEndingDay] = useState(false);
  // Errors from mutations (taps, edits, guards). Cleared by the next successful
  // mutation — never by a listener snapshot.
  const [registryError, setRegistryError] = useState(null);
  /**
   * Per-listener sync failures, keyed by listener ('profile', 'configs',
   * 'logs', 'days', 'day', 'ledgers'). Each key is cleared ONLY by a success
   * from that same listener (F-05): a healthy configs snapshot used to call
   * `setRegistryError(null)` and wipe a fatal error raised by a different,
   * still-dead listener, so the UI read as "in sync" while it was not.
   */
  const [listenerErrors, setListenerErrors] = useState({});
  const reportListenerError = useCallback((key, message) => {
    setListenerErrors((prev) => (prev[key] === message ? prev : { ...prev, [key]: message }));
  }, []);
  const clearListenerError = useCallback((key) => {
    setListenerErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const [configsHasPendingWrites, setConfigsHasPendingWrites] = useState(false);
  // Ids of tracker documents with unsynced local writes (see subscribeToConfigs).
  const [pendingConfigIds, setPendingConfigIds] = useState([]);
  /**
   * IN-FLIGHT MUTATION LEDGER (H-01 fix)
   * Tracks pending mutations with explicit date and tracker association.
   * Authoritative server baseline comes exclusively from Firestore onSnapshot.
   * Operations for day A can never contaminate day B's baseline.
   */
  const latestServerCountsRef = useRef({});
  const pendingOpsRef = useRef([]);
  const activeCountsRef = useRef(activeCounts);
  activeCountsRef.current = activeCounts;
  const isEndingDayRef = useRef(isEndingDay);
  isEndingDayRef.current = isEndingDay;
  const todayRef = useRef(today);
  todayRef.current = today;
  const profileSettingsRef = useRef(profileSettings);
  profileSettingsRef.current = profileSettings;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const onTrackingDayChangeRef = useRef(onTrackingDayChange);
  onTrackingDayChangeRef.current = onTrackingDayChange;
  // Injectable clock (Android RegistryViewModel parity): production uses the
  // real clock; tests pin it so day-boundary logic is deterministic.
  const nowFnRef = useRef(nowFn);
  nowFnRef.current = nowFn;

  const publishCounterOverlay = useCallback(() => {
    const server = latestServerCountsRef.current || {};
    const currentToday = todayRef.current;
    const pendingByTracker = {};

    // Only unabsorbed operations belonging to currentToday contribute to current active counts
    for (const op of pendingOpsRef.current) {
      if (op.trackingDate === currentToday && !op.acknowledged) {
        pendingByTracker[op.trackerId] = (pendingByTracker[op.trackerId] || 0) + op.delta;
      }
    }

    const keys = new Set([...Object.keys(server), ...Object.keys(pendingByTracker)]);
    if (keys.size === 0) {
      setActiveCounts({});
      return;
    }
    const next = {};
    keys.forEach((id) => {
      next[id] = Math.max(0, (server[id] || 0) + (pendingByTracker[id] || 0));
    });
    setActiveCounts(next);
  }, []);

  /**
   * Mirrors Android RegistryViewModel.trackingDateForMutation: the date that
   * decides which days/{date} document a mutation targets is derived from the
   * clock AT TAP TIME with the freshest known dayStartHour — never from the
   * (possibly stale) cached `today` prop, which is only refreshed by a 30s
   * interval that throttles in background tabs. If the day has rolled over
   * (midnight, custom day-start, DST), the cached day and the optimistic
   * ledger are advanced first so the UI transitions in the same frame.
   */
  const resolveTrackingDateForMutation = useCallback(() => {
    const dayStartHour = profileSettingsRef.current?.dayStartHour ?? SmokingCalculator.DAY_START_HOUR_DEFAULT;
    const fresh = SmokingCalculator.getTrackingDate(nowFnRef.current(), dayStartHour);
    if (fresh !== todayRef.current) {
      todayRef.current = fresh;
      latestServerCountsRef.current = {};
      pendingOpsRef.current = pendingOpsRef.current.filter((o) => o.trackingDate === fresh);
      publishCounterOverlay();
      onTrackingDayChangeRef.current?.(fresh);
    }
    return fresh;
  }, [publishCounterOverlay]);

  /** Taps are blocked while the user's dayStartHour is still unknown. */
  const guardDayStartKnown = useCallback(() => {
    if (loadingRef.current && !profileSettingsRef.current) {
      setRegistryError('Still syncing your profile — try again in a moment.');
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Profile listener: settings + lifetime aggregates only. No counters and no
  // avatar ride along on this document for updated accounts (item 12) — see
  // the separate day-doc and profile-extra (avatar) listeners below.
  useEffect(() => {
    accountWriteState.current = null;
    if (!uid) {
      const cleared = emptyRegistry();
      setConfigs(cleared.configs);
      setLogs(cleared.logs);
      setDayDocs(cleared.dayDocs);
      setActiveCounts(cleared.activeCounts);
      setLifetimeAggregates(cleared.lifetimeAggregates);
      setProfileSettings(cleared.profileSettings);
      setAvatar(cleared.avatar);
      setLedgers([]);
      setLedgersLoaded(false);
      setFinancialMode(null);
      setConfigsHasPendingWrites(false);
      setPendingConfigIds([]);
      pendingOpsRef.current = [];
      latestServerCountsRef.current = {};
      setLoading(false);
      setRegistryError(null);
      setListenerErrors({});
      setProfileLoaded(false);
      return undefined;
    }

    // Clear prior account data before attaching new listeners.
    setConfigs([]);
    setLogs([]);
    setDayDocs([]);
    setActiveCounts({});
    setLifetimeAggregates(null);
    setProfileSettings(null);
    setProfileLoaded(false);
    setAvatar(null);
    setLedgers([]);
    setLedgersLoaded(false);
    setFinancialMode(null);
    setConfigsHasPendingWrites(false);
    setPendingConfigIds([]);
    setLoading(true);
    setRegistryError(null);
    setListenerErrors({});
    latestServerCountsRef.current = {};
    pendingOpsRef.current = [];

    const onListenerError = (key) => (err) => {
      console.error(`[REGISTRY] ${key} listener error`, err);
      reportListenerError(key, 'Could not sync registry. Check your connection and try again.');
      // Terminal for the loading gate: leave the skeleton so the UI can offer
      // a retry (App.jsx renders SyncFailedState when profileLoaded && error).
      setProfileLoaded(true);
      setLoading(false);
    };

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (s) => {
        setProfileLoaded(true);
        clearListenerError('profile');
        if (!s.exists()) {
          setLifetimeAggregates({ saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 });
          setFinancialMode('LEGACY');
          setProfileSettings({
            name: '',
            accent: null,
            widgetSize: 'MEDIUM',
            unitPrice: 0.5,
            unitsPerPack: 20,
            dayStartHour: 6,
            purchaseType: 'PACK',
            pouchPrice: 0,
            estimatedYield: 0,
          });
          return;
        }
        const d = s.data();
        setFinancialMode(d.financialMode || 'LEGACY');
        accountWriteState.current = {
          deleting: d.deleting === true,
          leaseUntil: d.smokingMigrationLeaseUntil?.toMillis?.() || 0,
        };
        setLifetimeAggregates((prev) => {
          const next = d.lifetimeAggregates || { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 };
          if (
            prev &&
            prev.saved === next.saved &&
            prev.wasted === next.wasted &&
            prev.smokingUnits === next.smokingUnits &&
            prev.baselineSaved === next.baselineSaved
          ) {
            return prev;
          }
          return next;
        });
        setProfileSettings((prev) => {
          const next = {
            name: d.name || '',
            accent: d.accent || null,
            widgetSize: d.widgetSize || 'MEDIUM',
            unitPrice: d.unitPrice ?? 0.5,
            unitsPerPack: d.unitsPerPack ?? 20,
            dayStartHour: d.dayStartHour ?? 6,
            purchaseType: d.purchaseType || 'PACK',
            pouchPrice: d.pouchPrice ?? 0,
            estimatedYield: d.estimatedYield ?? 0,
            // Legacy fallback only — updated writes never touch this field.
            // Cleared automatically by migrateAvatarToProfileMeta.
            legacyAvatar: d.avatar || null,
          };
          if (prev) {
            const isUnchanged =
              prev.name === next.name &&
              prev.accent === next.accent &&
              prev.widgetSize === next.widgetSize &&
              prev.unitPrice === next.unitPrice &&
              prev.unitsPerPack === next.unitsPerPack &&
              prev.dayStartHour === next.dayStartHour &&
              prev.purchaseType === next.purchaseType &&
              prev.pouchPrice === next.pouchPrice &&
              prev.estimatedYield === next.estimatedYield &&
              prev.legacyAvatar === next.legacyAvatar;
            if (isUnchanged) return prev;
          }
          return next;
        });
      },
      onListenerError('profile')
    );

    const unsubConfigs = RegistryService.subscribeToConfigs(uid, (data, metadata) => {
      setConfigs(data);
      setLoading(false);
      clearListenerError('configs');
      setConfigsHasPendingWrites(metadata ? metadata.hasPendingWrites : false);
      setPendingConfigIds(metadata?.pendingIds ?? []);
    }, onListenerError('configs'));

    const unsubLogs = RegistryService.subscribeToLogs(uid, (data) => {
      setLogs(data);
      clearListenerError('logs');
    }, onListenerError('logs'));

    const unsubDays = RegistryService.subscribeToDays(uid, (data) => {
      setDayDocs(data);
      clearListenerError('days');
    }, onListenerError('days'));

    const unsubAvatar = RegistryService.subscribeToProfileExtra(uid, (data) => {
      setAvatar(data?.avatar ?? null);
    }, () => { /* non-fatal — avatar is decorative */ });

    return () => {
      unsubProfile();
      unsubConfigs();
      unsubLogs();
      unsubDays();
      unsubAvatar();
    };
  }, [uid, listenerEpoch, reportListenerError, clearListenerError]);

  /**
   * Canonical (OPTION B) daily ledgers — subscribed ONLY for accounts whose
   * server-side `financialMode` is MIGRATING/OPTION_B.
   *
   * A LEGACY account has no ledger by definition: the ledger is an OPTION_B
   * projection, `dailyLedger.js` is never imported by the app, and `canonical`
   * below returns null for LEGACY regardless of what is loaded. Subscribing
   * anyway billed a query per app start (Firestore bills the minimum read even
   * for an empty result) and kept a live listener on a collection that can only
   * ever be empty — a pure Spark-cost regression with no functional upside.
   *
   * Gated on a RESOLVED mode (`null` while the profile first loads) so the
   * ledger can never be skipped because the mode was still unknown, and
   * `ledgersLoaded` explicitly means "no ledger expected" for LEGACY.
   */
  useEffect(() => {
    if (!uid) return undefined;
    if (!financialMode) return undefined;
    if (financialMode === 'LEGACY') {
      setLedgers([]);
      setLedgersLoaded(true);
      return undefined;
    }
    // A mode change invalidates whatever was loaded before it: the new
    // subscription has not delivered a snapshot yet, so the projection must stay
    // gated (`canonical === null`) rather than read as "OPTION_B, no ledgers" —
    // which would render every date as unavailable/unknown money for a frame.
    setLedgers([]);
    setLedgersLoaded(false);
    return RegistryService.subscribeToLedgers(uid, (data) => {
      setLedgers(data);
      setLedgersLoaded(true);
      clearListenerError('ledgers');
    }, (err) => {
      // A ledger read failure must not silently imply "no ledger", and must
      // not let the legacy estimate stand in for authoritative money (F-03):
      // `ledgersLoaded` stays false (metrics render as unavailable) and the
      // failure is surfaced with a retry path (listenerEpoch re-subscribes).
      console.error('[REGISTRY] ledger listener error', err);
      setLedgersLoaded(false);
      reportListenerError('ledgers', 'Could not load your financial ledger. Totals are unavailable until it syncs.');
    });
  }, [uid, financialMode, listenerEpoch, reportListenerError, clearListenerError]);

  // Live "today" bucket — the dated day doc `today` currently points at. This
  // is the entire fix for item 1: `today` is recomputed independently of this
  // effect (in App.jsx, from wall-clock time), and whenever it changes this
  // effect tears down the old subscription and attaches a fresh one to the
  // new date's doc, which starts empty until the first tap creates it. There
  // is nothing to "reset" — the previous date's doc simply stops changing.
  const opSeqRef = useRef(0);
  const nextOpId = useCallback(() => `${Date.now()}_${++opSeqRef.current}_${Math.random().toString(36).slice(2, 7)}`, []);

  const purgeAcknowledgedOrCanceledOps = useCallback(() => {
    const byTracker = {};
    for (const op of pendingOpsRef.current) {
      if (!byTracker[op.trackerId]) byTracker[op.trackerId] = [];
      byTracker[op.trackerId].push(op);
    }

    const remaining = [];
    for (const trackerId of Object.keys(byTracker)) {
      const list = byTracker[trackerId];
      const server = latestServerCountsRef.current[trackerId] || 0;

      let settledIncrements = list.filter((o) => o.settled && o.delta > 0 && !o.acknowledged);
      let settledDecrements = list.filter((o) => o.settled && o.delta < 0 && !o.acknowledged);
      const unacknowledgedInFlight = list.filter((o) => !o.settled && !o.acknowledged);

      // Cancel matching pairs of settled increments and decrements (net delta = 0)
      while (settledIncrements.length > 0 && settledDecrements.length > 0) {
        settledIncrements.pop();
        settledDecrements.pop();
      }

      // Check remaining settled increments against server count
      for (const op of settledIncrements) {
        if (server >= op.targetCount) {
          op.acknowledged = true;
        } else {
          remaining.push(op);
        }
      }
      // Check remaining settled decrements against server count
      for (const op of settledDecrements) {
        if (server <= op.targetCount) {
          op.acknowledged = true;
        } else {
          remaining.push(op);
        }
      }

      for (const op of unacknowledgedInFlight) {
        remaining.push(op);
      }
    }

    pendingOpsRef.current = remaining;
  }, []);

  // Live "today" bucket — the dated day doc `today` currently points at. This
  // is the entire fix for item 1: `today` is recomputed independently of this
  // effect (in App.jsx, from wall-clock time), and whenever it changes this
  // effect tears down the old subscription and attaches a fresh one to the
  // new date's doc, which starts empty until the first tap creates it. There
  // is nothing to "reset" — the previous date's doc simply stops changing.
  useEffect(() => {
    if (!uid || !today) return undefined;
    latestServerCountsRef.current = {};
    publishCounterOverlay();

    const unsub = RegistryService.subscribeToDay(uid, today, (dayData) => {
      const newCounts = dayData?.counts || {};
      latestServerCountsRef.current = newCounts;

      // Reconcile pending operations against the updated server counts
      for (const op of pendingOpsRef.current) {
        if (op.trackingDate === today && !op.acknowledged) {
          const currentServer = newCounts[op.trackerId] || 0;
          if (op.delta > 0) {
            if (currentServer === op.targetCount) {
              op.acknowledged = true;
            } else if (currentServer > op.targetCount) {
              op.targetCount = currentServer + op.delta;
            }
          } else if (op.delta < 0) {
            if (currentServer === op.targetCount) {
              op.acknowledged = true;
            } else if (currentServer < op.targetCount) {
              op.targetCount = Math.max(0, currentServer + op.delta);
            }
          }
        }
      }

      purgeAcknowledgedOrCanceledOps();
      publishCounterOverlay();
      clearListenerError('day');
    }, (err) => {
      // F-02: a dead live-day listener means today's counts are frozen at
      // their last value. That must reach the user (it used to be console-only)
      // and be recoverable (listenerEpoch, bumped by Retry, re-subscribes).
      console.error('[REGISTRY] day listener error', err);
      reportListenerError('day', "Could not sync today's counts. Check your connection and try again.");
    });

    // Best-effort, idempotent: fold any day the tracking date has already
    // moved past into lifetimeAggregates. Safe to call every time `today`
    // changes or the app (re)starts — see reconcileStaleDays.
    RegistryService.reconcileStaleDays(uid, today).catch(() => { /* best-effort */ });

    return () => unsub();
  }, [uid, today, listenerEpoch, publishCounterOverlay, purgeAcknowledgedOrCanceledOps, reportListenerError, clearListenerError]);

  // First failing listener, in a stable order. Exposed separately so the UI
  // can offer Retry (re-subscribe) for sync failures, not just Dismiss.
  const syncError = ['profile', 'configs', 'logs', 'days', 'day', 'ledgers']
    .map((k) => listenerErrors[k]).find(Boolean) ?? null;

  const avatarValue = avatar ?? profileSettings?.legacyAvatar ?? null;
  const effectiveUnitPrice = profileSettings?.unitPrice ?? unitPrice;

  // OPTION B canonical projection (Part A/C). A ledger that has NOT loaded is
  // not a missing ledger — `ledgersLoaded` gates the whole projection.
  const canonical = useMemo(() => {
    if (!financialMode || financialMode === 'LEGACY' || !ledgersLoaded) return null;
    const byDate = Object.fromEntries(ledgers.map((l) => [l.date, l]));
    const dayDates = new Set(dayDocs.map((d) => d.date));
    const logDates = new Set(logs.map((l) => l.logDate));
    const hasActivity = (date) => dayDates.has(date) || logDates.has(date);
    const resolve = (date) => resolveDateFinancial({
      financialMode, ledger: byDate[date] || null, hasSourceActivity: hasActivity(date),
    });
    const dates = new Set([...Object.keys(byDate), ...dayDates, ...logDates]);
    return {
      ready: true,
      byDate,
      resolve,
      today: resolve(today),
      totals: aggregateFinancials([...dates].map(resolve)),
      // The UI listener is bounded (`subscribeToLedgers` maxDays). If it is full,
      // the window may be truncated — never present the total as complete.
      windowTruncated: ledgers.length >= 400,
      savedLifetime: lifetimeAggregates?.saved ?? 0,
      baselineSavedLifetime: lifetimeAggregates?.baselineSaved ?? 0,
    };
  }, [financialMode, ledgers, ledgersLoaded, dayDocs, logs, today, lifetimeAggregates]);

  const metrics = useMemo(() => {
    const base = SmokingCalculator.getGlobalMetrics(
      logs,
      configs,
      activeCounts,
      today,
      effectiveUnitPrice,
      lifetimeAggregates,
      dayDocs
    );
    const merged = {
      ...base,
      budgetLeft: base.budgetLeftToday,
    };
    if (!canonical || !canonical.ready) {
      // LEGACY (or mode not resolved yet): the legacy derivation owns money.
      if (!financialMode || financialMode === 'LEGACY') return merged;
      // MIGRATING/OPTION_B whose canonical ledger has not loaded — or whose
      // listener FAILED (F-03). The legacy base is not authoritative for this
      // account, so presenting it would disguise a failed read as a valid
      // estimate. Render money as unavailable instead.
      merged.financialSource = FinancialSource.MISSING_LEDGER;
      merged.financialComplete = false;
      merged.todayAvailable = false;
      merged.spentToday = null;
      merged.saved = null;
      merged.budgetLeftToday = null;
      merged.budgetLeft = null;
      merged.baselineSavedToday = null;
      return merged;
    }
    const t = canonical.today;
    merged.financialSource = t.source;
    merged.financialComplete = canonical.totals.complete && !canonical.windowTruncated;
    if (t.source === FinancialSource.CANONICAL) {
      merged.todayAvailable = true;
      merged.todayUnresolved = t.unresolved;
      merged.spentToday = t.canonical.spent;
      merged.saved = t.canonical.saved;
      merged.budgetLeftToday = t.canonical.saved;
      merged.budgetLeft = t.canonical.saved;
      merged.baselineSavedToday = t.canonical.baselineSaved;
      merged.smokingUnitsToday = t.canonical.smokingUnits;
      // Lifetime = folded total + today's still-open canonical credit (an open
      // day is not folded yet, exactly like the legacy session-on-top-of-lifetime).
      const todayOpen = t.eligible && canonical.byDate[today]?.foldedIntoLifetime !== true;
      merged.savedLifetime = canonical.savedLifetime + (todayOpen ? t.canonical.saved : 0);
      merged.baselineSavedLifetime = canonical.baselineSavedLifetime + (todayOpen ? t.canonical.baselineSaved : 0);
    } else if (t.source === FinancialSource.MISSING_LEDGER) {
      // Source activity exists but the canonical ledger does not — UNAVAILABLE,
      // never a silent legacy fallback or a fabricated zero.
      merged.todayAvailable = false;
      merged.spentToday = null;
      merged.saved = null;
      merged.budgetLeftToday = null;
      merged.budgetLeft = null;
      merged.baselineSavedToday = null;
    } else {
      // NO_FINANCIAL_ACTIVITY: a genuine zero contribution. The legacy base
      // would otherwise show a full phantom daily allowance — zero it.
      merged.todayAvailable = true;
      if (t.source === FinancialSource.NO_ACTIVITY) {
        merged.spentToday = 0;
        merged.saved = 0;
        merged.budgetLeftToday = 0;
        merged.budgetLeft = 0;
        merged.baselineSavedToday = 0;
        merged.smokingUnitsToday = 0;
        merged.savedLifetime = canonical.savedLifetime;
        merged.baselineSavedLifetime = canonical.baselineSavedLifetime;
      }
    }
    return merged;
  }, [logs, configs, activeCounts, effectiveUnitPrice, today, lifetimeAggregates, dayDocs, canonical, financialMode]);

  const runMutation = useCallback(async (fn, fallback) => {
    try {
      const result = await fn();
      setRegistryError(null);
      return result;
    } catch (e) {
      console.error(e);
      setRegistryError(mapFirestoreError(e, fallback));
      throw e;
    }
  }, []);

  const requireOnline = useCallback((_actionName) => {
    const state = accountWriteState.current;
    if (state?.deleting || state?.leaseUntil > Date.now()) {
      const message = state.deleting ? 'Account deletion is in progress. Retry deletion from Settings.' : 'History migration is in progress. Try again shortly.';
      setRegistryError(message);
      throw new Error(state.deleting ? 'ACCOUNT_DELETING' : 'MIGRATION_IN_PROGRESS');
    }
    if (!isOnlineRef.current) {
      const err = new Error('Connect to the internet to update this count.');
      err.code = 'offline';
      setRegistryError('Connect to the internet to update this count.');
      throw err;
    }
  }, []);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const increment = useCallback(async (id) => {
    if (!uid) return;
    requireOnline('increment');
    if (!guardDayStartKnown()) return;
    // Date derived from the clock at THIS moment (Android parity) — see
    // resolveTrackingDateForMutation.
    const trackingDate = resolveTrackingDateForMutation();
    const currentServer = latestServerCountsRef.current[id] || 0;
    let expectedBase = currentServer;
    for (const o of pendingOpsRef.current) {
      if (o.trackingDate === trackingDate && o.trackerId === id && !o.acknowledged) {
        expectedBase += o.delta;
      }
    }
    const op = {
      id: nextOpId(),
      trackerId: id,
      delta: 1,
      trackingDate,
      targetCount: Math.max(0, expectedBase + 1),
      settled: false,
      acknowledged: false,
    };
    pendingOpsRef.current.push(op);
    publishCounterOverlay();
    try {
      await runMutation(
        () => RegistryService.adjustCounter(uid, id, 1, trackingDate, effectiveUnitPrice, op.id),
        'Could not update counter.'
      );
      op.settled = true;
      purgeAcknowledgedOrCanceledOps();
      publishCounterOverlay();
      // The date this increment was written to — Undo must reverse exactly
      // this date, not whatever the tracking date is when Undo is clicked (F-01).
      return { trackingDate, operationId: op.id };
    } catch (e) {
      pendingOpsRef.current = pendingOpsRef.current.filter((o) => o.id !== op.id);
      publishCounterOverlay();
      setRegistryError(e?.message === 'DAY_CLOSED_NO_SNAPSHOT'
        ? mapFirestoreError(e)
        : 'Could not save that change. Your count was restored.');
      throw e;
    }
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId, publishCounterOverlay, purgeAcknowledgedOrCanceledOps, setRegistryError, resolveTrackingDateForMutation, guardDayStartKnown]);

  /**
   * Reverse one increment ON THE DATE IT WAS WRITTEN TO (F-01).
   *
   * Undo used to call `decrement(id)`, which re-derives the tracking date at
   * click time. An increment at 05:59:58 with a 06:00 day start, undone at
   * 06:00:02, therefore decremented the NEW day: a silent no-op when that day
   * was still empty (the 0-count guard), or a decrement of the wrong day's
   * count when it was not — the original increment survived either way.
   *
   * Same date as now → the ordinary optimistic decrement. Earlier date → a
   * direct write to that date: `adjustCounter` handles both a still-open past
   * day and one that `reconcileStaleDays` has meanwhile closed and folded
   * (late write: credit and lifetime are reconciled in one transaction); the
   * trusted backend accepts the previous date within its counter grace window.
   * It is not mirrored into the live overlay, which only shows today.
   */
  const undoIncrement = useCallback(async (id, originalTrackingDate) => {
    if (!uid) return undefined;
    if (!originalTrackingDate) return decrementRef.current(id);
    requireOnline('undoIncrement');
    if (!guardDayStartKnown()) return undefined;
    const fresh = resolveTrackingDateForMutation();
    if (fresh === originalTrackingDate) return decrementRef.current(id);
    try {
      return await runMutation(
        () => RegistryService.adjustCounter(uid, id, -1, originalTrackingDate, effectiveUnitPrice, nextOpId()),
        'Could not undo that change.'
      );
    } catch (e) {
      setRegistryError(e?.message === 'DAY_CLOSED_NO_SNAPSHOT' || e?.message === 'DAY_CLOSED'
        ? mapFirestoreError(e)
        : 'Could not undo that change. Edit the day in History instead.');
      throw e;
    }
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId, resolveTrackingDateForMutation, guardDayStartKnown]);

  const decrement = useCallback(async (id) => {
    if (!uid || (activeCountsRef.current[id] || 0) <= 0) return;
    requireOnline('decrement');
    if (!guardDayStartKnown()) return;
    const trackingDate = resolveTrackingDateForMutation();
    const currentServer = latestServerCountsRef.current[id] || 0;
    let expectedBase = currentServer;
    for (const o of pendingOpsRef.current) {
      if (o.trackingDate === trackingDate && o.trackerId === id && !o.acknowledged) {
        expectedBase += o.delta;
      }
    }
    const op = {
      id: nextOpId(),
      trackerId: id,
      delta: -1,
      trackingDate,
      targetCount: Math.max(0, expectedBase - 1),
      settled: false,
      acknowledged: false,
    };
    pendingOpsRef.current.push(op);
    publishCounterOverlay();
    try {
      await runMutation(
        () => RegistryService.adjustCounter(uid, id, -1, trackingDate, effectiveUnitPrice, op.id),
        'Could not update counter.'
      );
      op.settled = true;
      purgeAcknowledgedOrCanceledOps();
      publishCounterOverlay();
    } catch (e) {
      pendingOpsRef.current = pendingOpsRef.current.filter((o) => o.id !== op.id);
      publishCounterOverlay();
      setRegistryError(e?.message === 'DAY_CLOSED_NO_SNAPSHOT'
        ? mapFirestoreError(e)
        : 'Could not save that change. Your count was restored.');
      throw e;
    }
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId, publishCounterOverlay, purgeAcknowledgedOrCanceledOps, setRegistryError, resolveTrackingDateForMutation, guardDayStartKnown]);
  const decrementRef = useRef(decrement);
  decrementRef.current = decrement;

  /**
   * "Close day" — a UX affordance only (see registryService.closeDay). It
   * never decides which date a count belongs to; that already happened, at
   * write time, in `increment`/`decrement` above. The date is still derived
   * fresh at call time (Android parity) so a stale cached day can never
   * archive the wrong day.
   */
  const endDay = useCallback(async () => {
    if (!uid || isEndingDayRef.current) return;
    requireOnline('endDay');
    if (!guardDayStartKnown()) return;
    const closeDate = resolveTrackingDateForMutation();
    setIsEndingDay(true);
    try {
      await runMutation(
        () => RegistryService.closeDay(uid, closeDate),
        'Could not close the tracking day. Try again.'
      );
    } finally {
      setIsEndingDay(false);
    }
  }, [uid, runMutation, requireOnline, resolveTrackingDateForMutation, guardDayStartKnown]);

  const updateHistoricalLog = useCallback(async (logId, counts) => {
    if (!uid) return;
    requireOnline('updateHistoricalLog');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.updateHistoricalLog(uid, logId, counts, effectiveUnitPrice, opId),
      'Could not update history.'
    );
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId]);

  const updateHistoricalDay = useCallback(async (date, counts) => {
    if (!uid) return;
    requireOnline('updateHistoricalDay');
    return runMutation(
      () => RegistryService.updateHistoricalDay(uid, date, counts),
      'Could not update history.'
    );
  }, [uid, runMutation, requireOnline]);

  const deleteLog = useCallback(async (logId) => {
    if (!uid) return;
    requireOnline('deleteLog');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.deleteLog(uid, logId, effectiveUnitPrice, opId),
      'Could not delete entry.'
    );
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId]);

  const restoreLog = useCallback(async (log, allowUnresolved = false) => {
    if (!uid) return;
    requireOnline('restoreLog');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.restoreLog(uid, log, effectiveUnitPrice, opId, allowUnresolved || log?.allowUnresolved === true),
      'Could not restore entry.'
    );
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId]);

  const createManualEntry = useCallback(async (date, counts) => {
    if (!uid) return;
    requireOnline('createManualEntry');
    const opId = nextOpId();
    // Compare backfill against the freshly derived day (Android parity), not
    // the possibly stale cached one.
    return runMutation(
      () => RegistryService.createManualEntry(uid, date, counts, effectiveUnitPrice, resolveTrackingDateForMutation(), opId),
      'Could not create entry.'
    );
  }, [uid, effectiveUnitPrice, runMutation, requireOnline, resolveTrackingDateForMutation, nextOpId]);

  const reorder = useCallback(async (id, dir) => {
    if (!uid) return;
    requireOnline('reorder');
    const idx = configs.findIndex(x => x.id === id);
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= configs.length) return;
    return runMutation(
      () => RegistryService.reorderConfigs(uid, configs[idx], configs[targetIdx]),
      'Could not reorder trackers.'
    );
  }, [uid, configs, runMutation, requireOnline]);

  /**
   * Single-flight guard for tracker creation.
   *
   * `addProtocol` is a read-then-create: two calls in flight at once both read
   * the same config count and both pass the cap, and each writes a NEW auto-id
   * document (so neither overwrites the other). The result is a 9th tracker,
   * which no tracking day can use — `firestore.rules` caps a day's
   * `trackerSnapshots` map at 8, so `adjustCounter`/`createManualEntry` then
   * fail with TRACKER_LIMIT until the extra tracker is removed.
   *
   * The form already disables its Save button while saving, but a fast
   * double-click can reach this hook before React re-renders. Making the hook
   * single-flight removes the reachable-within-one-client half of the race; the
   * cross-device half is a documented limitation (rules cannot count documents,
   * so a Spark/client-only architecture cannot enforce a collection cap).
   */
  const addInFlightRef = useRef(null);
  const addProtocol = useCallback(async (data) => {
    if (!uid) return undefined;
    // A second call while one is in flight shares its outcome, so a caller
    // that awaits it can never treat "skipped" as "saved".
    if (addInFlightRef.current) return addInFlightRef.current;
    // Client-side cap matching firestore.rules' trackerSnapshots bound (AUD-005)
    // so a 9th tracker is rejected up-front instead of failing a day write.
    // It REJECTS (F-09): resolving here let the add form close as if the
    // tracker had been saved.
    if (configs.length >= MAX_TRACKERS) {
      setRegistryError(`You can track up to ${MAX_TRACKERS} counters at once.`);
      throw new Error('TRACKER_LIMIT');
    }
    const pending = runMutation(
      () => RegistryService.addProtocol(uid, { ...data, order: configs.length }),
      'Could not add tracker.'
    ).finally(() => { addInFlightRef.current = null; });
    addInFlightRef.current = pending;
    return pending;
  }, [uid, configs.length, runMutation]);

  const updateProtocol = useCallback(async (id, data) => {
    if (!uid) return;
    return runMutation(
      () => RegistryService.updateProtocol(uid, id, data),
      'Could not update tracker.'
    );
  }, [uid, runMutation]);

  const deleteProtocol = useCallback(async (id) => {
    if (!uid) return;
    requireOnline('deleteProtocol');
    return runMutation(
      () => RegistryService.deleteProtocol(uid, id, resolveTrackingDateForMutation()),
      'Could not delete tracker.'
    );
  }, [uid, runMutation, requireOnline, resolveTrackingDateForMutation]);

  const updateAvatar = useCallback(async (nextAvatar) => {
    if (!uid) return;
    return runMutation(
      () => RegistryService.updateAvatar(uid, nextAvatar),
      'Could not update avatar.'
    );
  }, [uid, runMutation]);

  return {
    configs, logs, dayDocs, metrics, loading, isEndingDay, isOnline, profileSettings, profileLoaded,
    // A mutation error wins (it is the freshest, user-caused event); otherwise
    // the first failing listener. `syncError` alone tells the UI to offer Retry.
    avatar: avatarValue, registryError: registryError ?? syncError, syncError, configsHasPendingWrites, pendingConfigIds,
    ledgers, ledgersLoaded, financialMode, canonical,
    clearRegistryError: () => { setRegistryError(null); setListenerErrors({}); },
    increment, decrement, undoIncrement, endDay, updateHistoricalLog, updateHistoricalDay, deleteLog, restoreLog,
    createManualEntry, reorder, addProtocol, updateProtocol, deleteProtocol, updateAvatar
  };
};
