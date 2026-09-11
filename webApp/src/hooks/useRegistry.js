import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RegistryService } from '../services/registryService';
import { SmokingCalculator } from '../utils/smokingCalculator';
import { mapFirestoreError } from '../utils/errorHandlers';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

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
export const useRegistry = (user, today, unitPrice = 0.5) => {
  const [configs, setConfigs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [dayDocs, setDayDocs] = useState([]);
  const [activeCounts, setActiveCounts] = useState({});
  const [lifetimeAggregates, setLifetimeAggregates] = useState(null);
  const [profileSettings, setProfileSettings] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(!!user);
  const [isEndingDay, setIsEndingDay] = useState(false);
  const [registryError, setRegistryError] = useState(null);
  /** Optimistic overlay: display = server + pendingDelta (Android RegistryViewModel parity). */
  const latestServerCountsRef = useRef({});
  const pendingDeltaRef = useRef({});
  const activeCountsRef = useRef(activeCounts);
  activeCountsRef.current = activeCounts;
  const isEndingDayRef = useRef(isEndingDay);
  isEndingDayRef.current = isEndingDay;
  const todayRef = useRef(today);
  todayRef.current = today;

  const publishCounterOverlay = useCallback(() => {
    const pending = pendingDeltaRef.current;
    const server = latestServerCountsRef.current || {};
    const keys = new Set([...Object.keys(server), ...Object.keys(pending)]);
    if (keys.size === 0) {
      setActiveCounts({});
      return;
    }
    const next = {};
    keys.forEach((id) => {
      next[id] = Math.max(0, (server[id] || 0) + (pending[id] || 0));
    });
    setActiveCounts(next);
  }, []);

  const adjustPending = useCallback((id, delta) => {
    const next = (pendingDeltaRef.current[id] || 0) + delta;
    if (Math.abs(next) < 1e-9) delete pendingDeltaRef.current[id];
    else pendingDeltaRef.current[id] = next;
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
      pendingDeltaRef.current = {};
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
    setLoading(true);
    setRegistryError(null);
    latestServerCountsRef.current = {};
    pendingDeltaRef.current = {};

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

    const unsubConfigs = RegistryService.subscribeToConfigs(user.uid, (data) => {
      setConfigs(data);
      setLoading(false);
      setRegistryError(null);
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

    return () => {
      unsubProfile();
      unsubConfigs();
      unsubLogs();
      unsubDays();
      unsubAvatar();
    };
  }, [user?.uid]);

  // Live "today" bucket — the dated day doc `today` currently points at. This
  // is the entire fix for item 1: `today` is recomputed independently of this
  // effect (in App.jsx, from wall-clock time), and whenever it changes this
  // effect tears down the old subscription and attaches a fresh one to the
  // new date's doc, which starts empty until the first tap creates it. There
  // is nothing to "reset" — the previous date's doc simply stops changing.
  useEffect(() => {
    if (!user || !today) return undefined;
    latestServerCountsRef.current = {};
    pendingDeltaRef.current = {};
    publishCounterOverlay();

    const unsub = RegistryService.subscribeToDay(user.uid, today, (dayData) => {
      latestServerCountsRef.current = dayData?.counts || {};
      publishCounterOverlay();
    }, (err) => console.error('[REGISTRY] day listener error', err));

    // Best-effort, idempotent: fold any day the tracking date has already
    // moved past into lifetimeAggregates. Safe to call every time `today`
    // changes or the app (re)starts — see reconcileStaleDays.
    RegistryService.reconcileStaleDays(user.uid, today).catch(() => { /* best-effort */ });

    return () => unsub();
  }, [user?.uid, today, publishCounterOverlay]);

  const avatarValue = avatar ?? profileSettings?.legacyAvatar ?? null;
  const effectiveUnitPrice = profileSettings?.unitPrice ?? unitPrice;

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
    return {
      ...base,
      budgetLeft: base.budgetLeftToday,
    };
  }, [logs, configs, activeCounts, effectiveUnitPrice, today, lifetimeAggregates, dayDocs]);

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

  const increment = useCallback(async (id) => {
    if (!user) return;
    const trackingDate = todayRef.current;
    adjustPending(id, 1);
    publishCounterOverlay();
    try {
      await runMutation(
        () => RegistryService.adjustCounter(user.uid, id, 1, trackingDate, effectiveUnitPrice),
        'Could not update counter.'
      );
      latestServerCountsRef.current = {
        ...latestServerCountsRef.current,
        [id]: Math.max(0, (latestServerCountsRef.current[id] || 0) + 1),
      };
      adjustPending(id, -1);
      publishCounterOverlay();
    } catch (e) {
      adjustPending(id, -1);
      publishCounterOverlay();
      throw e;
    }
  }, [user?.uid, effectiveUnitPrice, runMutation, adjustPending, publishCounterOverlay]);

  const decrement = useCallback(async (id) => {
    if (!user || (activeCountsRef.current[id] || 0) <= 0) return;
    const trackingDate = todayRef.current;
    adjustPending(id, -1);
    publishCounterOverlay();
    try {
      await runMutation(
        () => RegistryService.adjustCounter(user.uid, id, -1, trackingDate, effectiveUnitPrice),
        'Could not update counter.'
      );
      latestServerCountsRef.current = {
        ...latestServerCountsRef.current,
        [id]: Math.max(0, (latestServerCountsRef.current[id] || 0) - 1),
      };
      adjustPending(id, 1);
      publishCounterOverlay();
    } catch (e) {
      adjustPending(id, 1);
      publishCounterOverlay();
      throw e;
    }
  }, [user?.uid, effectiveUnitPrice, runMutation, adjustPending, publishCounterOverlay]);

  /**
   * "Close day" — a UX affordance only (see registryService.closeDay). It
   * never decides which date a count belongs to; that already happened, at
   * write time, in `increment`/`decrement` above.
   */
  const endDay = useCallback(async () => {
    if (!user || isEndingDayRef.current) return;
    setIsEndingDay(true);
    try {
      await runMutation(
        () => RegistryService.closeDay(user.uid, today),
        'Could not close the tracking day. Try again.'
      );
    } finally {
      setIsEndingDay(false);
    }
  }, [user?.uid, today, runMutation]);

  const updateHistoricalLog = useCallback(async (logId, counts) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.updateHistoricalLog(user.uid, logId, counts, effectiveUnitPrice),
      'Could not update history.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation]);

  const updateHistoricalDay = useCallback(async (date, counts) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.updateHistoricalDay(user.uid, date, counts),
      'Could not update history.'
    );
  }, [user?.uid, runMutation]);

  const deleteLog = useCallback(async (logId) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.deleteLog(user.uid, logId, effectiveUnitPrice),
      'Could not delete entry.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation]);

  const restoreLog = useCallback(async (log) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.restoreLog(user.uid, log, effectiveUnitPrice),
      'Could not restore entry.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation]);

  const createManualEntry = useCallback(async (date, counts) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.createManualEntry(user.uid, date, counts, effectiveUnitPrice, today),
      'Could not create entry.'
    );
  }, [user?.uid, effectiveUnitPrice, today, runMutation]);

  const reorder = useCallback(async (id, dir) => {
    if (!user) return;
    const idx = configs.findIndex(x => x.id === id);
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= configs.length) return;
    return runMutation(
      () => RegistryService.reorderConfigs(user.uid, configs[idx], configs[targetIdx]),
      'Could not reorder trackers.'
    );
  }, [user?.uid, configs, runMutation]);

  const addProtocol = useCallback(async (data) => {
    if (!user) return;
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
    return runMutation(
      () => RegistryService.deleteProtocol(user.uid, id, todayRef.current),
      'Could not delete tracker.'
    );
  }, [user?.uid, runMutation]);

  const updateAvatar = useCallback(async (nextAvatar) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.updateAvatar(user.uid, nextAvatar),
      'Could not update avatar.'
    );
  }, [user?.uid, runMutation]);

  return {
    configs, logs, dayDocs, metrics, loading, isEndingDay, isOnline, profileSettings,
    avatar: avatarValue, registryError,
    clearRegistryError: () => setRegistryError(null),
    increment, decrement, endDay, updateHistoricalLog, updateHistoricalDay, deleteLog, restoreLog,
    createManualEntry, reorder, addProtocol, updateProtocol, deleteProtocol, updateAvatar
  };
};
