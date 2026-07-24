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
  /** Skip snapshot stomps while optimistic counter writes are in flight. */
  const counterInFlightRef = useRef(0);
  const latestServerCountsRef = useRef({});
  const deferredServerCountsRef = useRef(false);
  const activeCountsRef = useRef(activeCounts);
  activeCountsRef.current = activeCounts;
  const isEndingDayRef = useRef(isEndingDay);
  isEndingDayRef.current = isEndingDay;

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
    counterInFlightRef.current = 0;
    latestServerCountsRef.current = {};
    deferredServerCountsRef.current = false;

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
          if (counterInFlightRef.current === 0) {
            setActiveCounts({});
          } else {
            deferredServerCountsRef.current = true;
          }
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
        if (counterInFlightRef.current === 0) {
          setActiveCounts(latestServerCountsRef.current);
        } else {
          deferredServerCountsRef.current = true;
        }
        setLifetimeAggregates(d.lifetimeAggregates || { saved: 0, wasted: 0, smokingUnits: 0 });
        setProfileSettings({
          name: d.name || '',
          accent: d.accent || null,
          widgetSize: d.widgetSize || 'MEDIUM',
          avatar: d.avatar || null,
          unitPrice: d.unitPrice ?? 0.5,
          dayStartHour: d.dayStartHour ?? 6,
          purchaseType: d.purchaseType || 'PACK',
          pouchPrice: d.pouchPrice ?? 0,
          estimatedYield: d.estimatedYield ?? 0,
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
  }, [user?.uid]);

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
      rank: SmokingCalculator.getRank(xp)
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

  const settleCounterFlight = useCallback(() => {
    counterInFlightRef.current = Math.max(0, counterInFlightRef.current - 1);
    if (counterInFlightRef.current === 0 && deferredServerCountsRef.current) {
      deferredServerCountsRef.current = false;
      setActiveCounts(latestServerCountsRef.current);
    }
  }, []);

  const increment = useCallback(async (id) => {
    if (!user) return;
    counterInFlightRef.current += 1;
    setActiveCounts((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    try {
      await runMutation(
        () => RegistryService.adjustCounter(user.uid, id, 1),
        'Could not update counter.'
      );
    } catch (e) {
      setActiveCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }));
      throw e;
    } finally {
      settleCounterFlight();
    }
  }, [user?.uid, runMutation, settleCounterFlight]);

  const decrement = useCallback(async (id) => {
    if (!user || (activeCountsRef.current[id] || 0) <= 0) return;
    counterInFlightRef.current += 1;
    setActiveCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) - 1) }));
    try {
      await runMutation(
        () => RegistryService.adjustCounter(user.uid, id, -1),
        'Could not update counter.'
      );
    } catch (e) {
      setActiveCounts((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
      throw e;
    } finally {
      settleCounterFlight();
    }
  }, [user?.uid, runMutation, settleCounterFlight]);

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
      () => RegistryService.createManualEntry(user.uid, date, counts, effectiveUnitPrice),
      'Could not create entry.'
    );
  }, [user?.uid, effectiveUnitPrice, runMutation]);

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
