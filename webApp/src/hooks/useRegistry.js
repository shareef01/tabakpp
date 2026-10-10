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
 */
export const useRegistry = (user, today, unitPrice = 0.5, dayStartHour = 6, onRollover = null) => {
  const [configs, setConfigs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [dayDocs, setDayDocs] = useState([]);
  const [activeCounts, setActiveCounts] = useState({});
  const [lifetimeAggregates, setLifetimeAggregates] = useState(null);
  const [ledgers, setLedgers] = useState([]);
  const [ledgersLoaded, setLedgersLoaded] = useState(false);
  const [financialMode, setFinancialMode] = useState(null);
  const [profileSettings, setProfileSettings] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(!!user);
  const [isEndingDay, setIsEndingDay] = useState(false);
  const [registryError, setRegistryError] = useState(null);
  const [configsHasPendingWrites, setConfigsHasPendingWrites] = useState(false);
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
  const dayStartHourRef = useRef(dayStartHour);
  dayStartHourRef.current = dayStartHour;
  const onRolloverRef = useRef(onRollover);
  onRolloverRef.current = onRollover;

  /**
   * Resolve the tracking date for a write AT WRITE TIME (AUD-011). `today` is
   * refreshed by a 30s timer, so near the configured day boundary it can be up
   * to one tick stale and a write could be misfiled onto the previous day.
   *
   * When the owner supplies an [onRollover] handler (App passes its `setToday`),
   * the date is recomputed from wall-clock and the owner is notified so the day
   * subscription re-attaches immediately. Without a handler the hook keeps the
   * injected `today` as the single source of truth — the contract existing
   * callers and tests rely on.
   */
  const resolveWriteDate = useCallback(() => {
    const acceptRollover = onRolloverRef.current;
    if (typeof acceptRollover !== 'function') return todayRef.current;
    const fresh = SmokingCalculator.getTrackingDate(new Date(), dayStartHourRef.current);
    if (fresh !== todayRef.current) acceptRollover(fresh);
    return fresh;
  }, []);

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
    if (!user) {
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
      pendingOpsRef.current = [];
      latestServerCountsRef.current = {};
      setLoading(false);
      setRegistryError(null);
      return undefined;
    }

    // Clear prior account data before attaching new listeners.
    setConfigs([]);
    setLogs([]);
    setDayDocs([]);
    setActiveCounts({});
    setLifetimeAggregates(null);
    setProfileSettings(null);
    setAvatar(null);
    setLedgers([]);
    setLedgersLoaded(false);
    setFinancialMode(null);
    setConfigsHasPendingWrites(false);
    setLoading(true);
    setRegistryError(null);
    latestServerCountsRef.current = {};
    pendingOpsRef.current = [];

    const onListenerError = (err) => {
      console.error('[REGISTRY] listener error', err);
      setRegistryError('Could not sync registry. Check your connection and try again.');
      setLoading(false);
    };

    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (s) => {
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
      onListenerError
    );

    const unsubConfigs = RegistryService.subscribeToConfigs(user.uid, (data, metadata) => {
      setConfigs(data);
      setLoading(false);
      setRegistryError(null);
      setConfigsHasPendingWrites(metadata ? metadata.hasPendingWrites : false);
    }, onListenerError);

    const unsubLogs = RegistryService.subscribeToLogs(user.uid, (data) => {
      setLogs(data);
    }, onListenerError);

    const unsubDays = RegistryService.subscribeToDays(user.uid, (data) => {
      setDayDocs(data);
    }, onListenerError);

    const unsubAvatar = RegistryService.subscribeToProfileExtra(user.uid, (data) => {
      setAvatar(data?.avatar ?? null);
    }, () => { /* non-fatal — avatar is decorative */ });

    const unsubLedgers = RegistryService.subscribeToLedgers(user.uid, (data) => {
      setLedgers(data);
      setLedgersLoaded(true);
    }, () => { /* a ledger read failure must not silently imply "no ledger" */
      setLedgersLoaded(false);
    });

    return () => {
      unsubProfile();
      unsubConfigs();
      unsubLogs();
      unsubDays();
      unsubAvatar();
      unsubLedgers();
    };
  }, [user?.uid]);

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
    if (!user || !today) return undefined;
    latestServerCountsRef.current = {};
    publishCounterOverlay();

    const unsub = RegistryService.subscribeToDay(user.uid, today, (dayData) => {
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
    }, (err) => console.error('[REGISTRY] day listener error', err));

    // Best-effort, idempotent: fold any day the tracking date has already
    // moved past into lifetimeAggregates. Safe to call every time `today`
    // changes or the app (re)starts — see reconcileStaleDays.
    RegistryService.reconcileStaleDays(user.uid, today).catch(() => { /* best-effort */ });

    return () => unsub();
  }, [user?.uid, today, publishCounterOverlay, purgeAcknowledgedOrCanceledOps]);

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
    if (!canonical || !canonical.ready) return merged;
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
  }, [logs, configs, activeCounts, effectiveUnitPrice, today, lifetimeAggregates, dayDocs, canonical]);

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
    if (!user) return;
    requireOnline('increment');
    const trackingDate = resolveWriteDate();
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
        () => RegistryService.adjustCounter(user.uid, id, 1, trackingDate, effectiveUnitPrice, op.id),
        'Could not update counter.'
      );
      op.settled = true;
      purgeAcknowledgedOrCanceledOps();
      publishCounterOverlay();
    } catch (e) {
      pendingOpsRef.current = pendingOpsRef.current.filter((o) => o.id !== op.id);
      publishCounterOverlay();
      setRegistryError('Could not save that change. Your count was restored.');
      throw e;
    }
  }, [user?.uid, effectiveUnitPrice, runMutation, nextOpId, publishCounterOverlay, purgeAcknowledgedOrCanceledOps, setRegistryError, resolveWriteDate]);

  const decrement = useCallback(async (id) => {
    if (!user || (activeCountsRef.current[id] || 0) <= 0) return;
    requireOnline('decrement');
    const trackingDate = resolveWriteDate();
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
        () => RegistryService.adjustCounter(user.uid, id, -1, trackingDate, effectiveUnitPrice, op.id),
        'Could not update counter.'
      );
      op.settled = true;
      purgeAcknowledgedOrCanceledOps();
      publishCounterOverlay();
    } catch (e) {
      pendingOpsRef.current = pendingOpsRef.current.filter((o) => o.id !== op.id);
      publishCounterOverlay();
      setRegistryError('Could not save that change. Your count was restored.');
      throw e;
    }
  }, [user?.uid, effectiveUnitPrice, runMutation, nextOpId, publishCounterOverlay, purgeAcknowledgedOrCanceledOps, setRegistryError, resolveWriteDate]);

  /**
   * "Close day" — a UX affordance only (see registryService.closeDay). It
   * never decides which date a count belongs to; that already happened, at
   * write time, in `increment`/`decrement` above.
   */
  const endDay = useCallback(async () => {
    if (!user || isEndingDayRef.current) return;
    requireOnline('endDay');
    setIsEndingDay(true);
    try {
      await runMutation(
        () => RegistryService.closeDay(user.uid, today),
        'Could not close the tracking day. Try again.'
      );
    } finally {
      setIsEndingDay(false);
    }
  }, [user?.uid, today, runMutation, requireOnline]);

  const updateHistoricalLog = useCallback(async (logId, counts) => {
    if (!user) return;
    requireOnline('updateHistoricalLog');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.updateHistoricalLog(user.uid, logId, counts, effectiveUnitPrice, opId),
      'Could not update history.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId]);

  const updateHistoricalDay = useCallback(async (date, counts) => {
    if (!user) return;
    requireOnline('updateHistoricalDay');
    return runMutation(
      () => RegistryService.updateHistoricalDay(user.uid, date, counts),
      'Could not update history.'
    );
  }, [user?.uid, runMutation, requireOnline]);

  const deleteLog = useCallback(async (logId) => {
    if (!user) return;
    requireOnline('deleteLog');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.deleteLog(user.uid, logId, effectiveUnitPrice, opId),
      'Could not delete entry.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId]);

  const restoreLog = useCallback(async (log) => {
    if (!user) return;
    requireOnline('restoreLog');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.restoreLog(user.uid, log, effectiveUnitPrice, opId),
      'Could not restore entry.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation, requireOnline, nextOpId]);

  const createManualEntry = useCallback(async (date, counts) => {
    if (!user) return;
    requireOnline('createManualEntry');
    const opId = nextOpId();
    return runMutation(
      () => RegistryService.createManualEntry(user.uid, date, counts, effectiveUnitPrice, resolveWriteDate(), opId),
      'Could not create entry.'
    );
  }, [user?.uid, effectiveUnitPrice, today, runMutation, requireOnline, resolveWriteDate, nextOpId]);

  const reorder = useCallback(async (id, dir) => {
    if (!user) return;
    requireOnline('reorder');
    const idx = configs.findIndex(x => x.id === id);
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= configs.length) return;
    return runMutation(
      () => RegistryService.reorderConfigs(user.uid, configs[idx], configs[targetIdx]),
      'Could not reorder trackers.'
    );
  }, [user?.uid, configs, runMutation, requireOnline]);

  const addProtocol = useCallback(async (data) => {
    if (!user) return;
    // Client-side cap matching firestore.rules' trackerSnapshots bound (AUD-005)
    // so a 9th tracker is rejected up-front instead of failing a day write.
    if (configs.length >= MAX_TRACKERS) {
      setRegistryError(`You can track up to ${MAX_TRACKERS} counters at once.`);
      return;
    }
    return runMutation(
      () => RegistryService.addProtocol(user.uid, { ...data, order: configs.length }),
      'Could not add tracker.'
    );
  }, [user?.uid, configs.length, runMutation]);

  const updateProtocol = useCallback(async (id, data) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.updateProtocol(user.uid, id, data),
      'Could not update tracker.'
    );
  }, [user?.uid, runMutation]);

  const deleteProtocol = useCallback(async (id) => {
    if (!user) return;
    requireOnline('deleteProtocol');
    return runMutation(
      () => RegistryService.deleteProtocol(user.uid, id, todayRef.current),
      'Could not delete tracker.'
    );
  }, [user?.uid, runMutation, requireOnline]);

  const updateAvatar = useCallback(async (nextAvatar) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.updateAvatar(user.uid, nextAvatar),
      'Could not update avatar.'
    );
  }, [user?.uid, runMutation]);

  return {
    configs, logs, dayDocs, metrics, loading, isEndingDay, isOnline, profileSettings,
    avatar: avatarValue, registryError, configsHasPendingWrites,
    ledgers, ledgersLoaded, financialMode, canonical,
    clearRegistryError: () => setRegistryError(null),
    increment, decrement, endDay, updateHistoricalLog, updateHistoricalDay, deleteLog, restoreLog,
    createManualEntry, reorder, addProtocol, updateProtocol, deleteProtocol, updateAvatar
  };
};
