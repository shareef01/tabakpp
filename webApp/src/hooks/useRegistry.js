import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RegistryService } from '../services/registryService';
import { SmokingCalculator } from '../utils/smokingCalculator';
import { mapFirestoreError } from '../utils/errorHandlers';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const emptyRegistry = () => ({
  configs: [],
  logs: [],
  activeCounts: {},
  lifetimeAggregates: null,
  profileSettings: null,
});

/**
 * useRegistry (Hardened Cross-Platform Engine)
 * Single profile listener feeds counters, aggregates, and settings hydration.
 */
export const useRegistry = (user, today, unitPrice = 0.5) => {
  const [configs, setConfigs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeCounts, setActiveCounts] = useState({});
  const [lifetimeAggregates, setLifetimeAggregates] = useState(null);
  const [profileSettings, setProfileSettings] = useState(null);
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

  useEffect(() => {
    if (!user) {
      const cleared = emptyRegistry();
      setConfigs(cleared.configs);
      setLogs(cleared.logs);
      setActiveCounts(cleared.activeCounts);
      setLifetimeAggregates(cleared.lifetimeAggregates);
      setProfileSettings(cleared.profileSettings);
      pendingDeltaRef.current = {};
      latestServerCountsRef.current = {};
      setLoading(false);
      setRegistryError(null);
      return undefined;
    }

    // Clear prior account data before attaching new listeners.
    setConfigs([]);
    setLogs([]);
    setActiveCounts({});
    setLifetimeAggregates(null);
    setProfileSettings(null);
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
          latestServerCountsRef.current = {};
          publishCounterOverlay();
          setLifetimeAggregates({ saved: 0, wasted: 0, smokingUnits: 0 });
          setProfileSettings({
            name: '',
            accent: null,
            widgetSize: 'MEDIUM',
            avatar: null,
            unitPrice: 0.5,
            dayStartHour: 6,
            purchaseType: 'PACK',
            pouchPrice: 0,
            estimatedYield: 0,
          });
          return;
        }
        const d = s.data();
        latestServerCountsRef.current = d.activeCounts || {};
        publishCounterOverlay();
        setLifetimeAggregates((prev) => {
          const next = d.lifetimeAggregates || { saved: 0, wasted: 0, smokingUnits: 0 };
          if (
            prev &&
            prev.saved === next.saved &&
            prev.wasted === next.wasted &&
            prev.smokingUnits === next.smokingUnits
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
            avatar: d.avatar || null,
            unitPrice: d.unitPrice ?? 0.5,
            dayStartHour: d.dayStartHour ?? 6,
            purchaseType: d.purchaseType || 'PACK',
            pouchPrice: d.pouchPrice ?? 0,
            estimatedYield: d.estimatedYield ?? 0,
          };
          if (prev) {
            const isUnchanged =
              prev.name === next.name &&
              prev.accent === next.accent &&
              prev.widgetSize === next.widgetSize &&
              prev.avatar === next.avatar &&
              prev.unitPrice === next.unitPrice &&
              prev.dayStartHour === next.dayStartHour &&
              prev.purchaseType === next.purchaseType &&
              prev.pouchPrice === next.pouchPrice &&
              prev.estimatedYield === next.estimatedYield;
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

    return () => {
      unsubProfile();
      unsubConfigs();
      unsubLogs();
    };
  }, [user?.uid, publishCounterOverlay]);

  const effectiveUnitPrice = profileSettings?.unitPrice ?? unitPrice;

  const metrics = useMemo(() => {
    const base = SmokingCalculator.getGlobalMetrics(
      logs,
      configs,
      activeCounts,
      today,
      effectiveUnitPrice,
      lifetimeAggregates
    );
    const xp = SmokingCalculator.calculateXP(logs, base.streak);
    return {
      ...base,
      budgetLeft: base.budgetLeftToday,
      rank: SmokingCalculator.getRank(xp),
      xp
    };
  }, [logs, configs, activeCounts, effectiveUnitPrice, today, lifetimeAggregates]);

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
    adjustPending(id, 1);
    publishCounterOverlay();
    try {
      await runMutation(
        () => RegistryService.adjustCounter(user.uid, id, 1),
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
  }, [user?.uid, runMutation, adjustPending, publishCounterOverlay]);

  const decrement = useCallback(async (id) => {
    if (!user || (activeCountsRef.current[id] || 0) <= 0) return;
    adjustPending(id, -1);
    publishCounterOverlay();
    try {
      await runMutation(
        () => RegistryService.adjustCounter(user.uid, id, -1),
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
  }, [user?.uid, runMutation, adjustPending, publishCounterOverlay]);

  const endDay = useCallback(async () => {
    if (!user || isEndingDayRef.current) return;
    setIsEndingDay(true);
    try {
      await runMutation(
        () => RegistryService.endDay(user.uid, today, effectiveUnitPrice),
        'Could not end day. Try again.'
      );
    } finally {
      setIsEndingDay(false);
    }
  }, [user?.uid, today, effectiveUnitPrice, runMutation]);

  const updateHistoricalLog = useCallback(async (logId, counts) => {
    if (!user) return;
    return runMutation(
      () => RegistryService.updateHistoricalLog(user.uid, logId, counts, effectiveUnitPrice),
      'Could not update history.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation]);

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
      () => RegistryService.deleteProtocol(user.uid, id),
      'Could not delete tracker.'
    );
  }, [user?.uid, runMutation]);

  return {
    configs, logs, metrics, loading, isEndingDay, isOnline, profileSettings, registryError,
    clearRegistryError: () => setRegistryError(null),
    increment, decrement, endDay, updateHistoricalLog, deleteLog, restoreLog, createManualEntry,
    reorder, addProtocol, updateProtocol, deleteProtocol
  };
};
