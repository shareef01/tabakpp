import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { RegistryService } from '../services/registryService';
import { useRegistry } from './useRegistry';

// Capture the subscription callbacks so tests can drive Firestore snapshots
// by hand. RegistryService is fully mocked; the real SmokingCalculator runs so
// the derived metrics are exercised for real.
const cap = vi.hoisted(() => ({
  profileCb: { current: null },
  profileErr: { current: null },
  configsCb: { current: null },
  logsCb: { current: null },
  daysCb: { current: null },
  dayCb: { current: null },
  avatarCb: { current: null },
  unsub: { profile: vi.fn(), configs: vi.fn(), logs: vi.fn(), days: vi.fn(), day: vi.fn(), avatar: vi.fn() },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => ({ path: path.join('/') }),
  onSnapshot: (_ref, cb, errCb) => {
    cap.profileCb.current = cb;
    cap.profileErr.current = errCb || null;
    return cap.unsub.profile;
  },
}));

vi.mock('../services/registryService', () => ({
  RegistryService: {
    subscribeToConfigs: (_uid, cb, errCb) => {
      cap.configsCb.current = cb;
      cap.configsErr = errCb;
      return cap.unsub.configs;
    },
    subscribeToLogs: (_uid, cb, errCb) => {
      cap.logsCb.current = cb;
      cap.logsErr = errCb;
      return cap.unsub.logs;
    },
    subscribeToDays: (_uid, cb) => {
      cap.daysCb.current = cb;
      return cap.unsub.days;
    },
    subscribeToDay: (_uid, _date, cb, errCb) => {
      cap.dayCb.current = cb;
      cap.dayErr = errCb;
      return cap.unsub.day;
    },
    subscribeToProfileExtra: (_uid, cb) => {
      cap.avatarCb.current = cb;
      return cap.unsub.avatar;
    },
    reconcileStaleDays: vi.fn(),
    adjustCounter: vi.fn(),
    closeDay: vi.fn(),
    reorderConfigs: vi.fn(),
    addProtocol: vi.fn(),
    updateProtocol: vi.fn(),
    deleteProtocol: vi.fn(),
    updateHistoricalLog: vi.fn(),
    updateHistoricalDay: vi.fn(),
    deleteLog: vi.fn(),
    restoreLog: vi.fn(),
    createManualEntry: vi.fn(),
    updateAvatar: vi.fn(),
  },
}));

const USER = { uid: 'u1' };
const TODAY = '2026-07-20';
const CIG = { id: 'cig', name: 'Cigarette', type: 'CIGARETTE', limit: 10, pricePerUnit: 1.0, isPrimaryTracked: true };

const profileSnap = (data) => ({ exists: () => true, data: () => data });
const defaultProfile = (over = {}) => ({
  lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
  accent: '#111', widgetSize: 'MEDIUM', unitPrice: 0.5, dayStartHour: 6, ...over,
});
const dayData = (counts = {}, over = {}) => ({ date: TODAY, counts, trackerSnapshots: {}, status: 'open', ...over });

// Mount the hook and push an initial profile/configs/logs/day snapshot through.
const mountHydrated = ({ user = USER, profile = defaultProfile(), configs = [CIG], logs = [], day = dayData() } = {}) => {
  const view = renderHook((props) => useRegistry(props.user, TODAY, 0.5), { initialProps: { user } });
  if (user) {
    act(() => cap.profileCb.current(profileSnap(profile)));
    act(() => cap.configsCb.current(configs));
    act(() => cap.logsCb.current(logs));
    act(() => cap.daysCb.current([]));
    act(() => cap.dayCb.current(day));
    act(() => cap.avatarCb.current({ avatar: null }));
  }
  return view;
};

beforeEach(() => {
  cap.profileCb.current = null;
  cap.configsCb.current = null;
  cap.logsCb.current = null;
  cap.daysCb.current = null;
  cap.dayCb.current = null;
  cap.avatarCb.current = null;
  vi.clearAllMocks();
  // Re-establish a resolving default for every action spy (clearAllMocks keeps
  // implementations, but individual tests may override closeDay).
  for (const fn of Object.values(RegistryService)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue(undefined);
  }
});

describe('useRegistry hydration', () => {
  it('subscribes and exposes configs, logs, settings and clears loading', () => {
    const { result } = mountHydrated({
      profile: defaultProfile({ accent: '#abc', unitPrice: 0.25 }),
      day: dayData({ cig: 3 }),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.configs).toEqual([CIG]);
    expect(result.current.profileSettings.accent).toBe('#abc');
    expect(result.current.profileSettings.unitPrice).toBe(0.25);
    // metrics come from the real SmokingCalculator over the live day doc
    expect(result.current.metrics.count).toBe(3);
    expect(result.current.metrics.limit).toBe(10);
  });

  it('derives the budgetLeft alias', () => {
    const { result } = mountHydrated({ day: dayData({ cig: 2 }) });
    expect(result.current.metrics.budgetLeft).toBe(result.current.metrics.budgetLeftToday);
  });

  it('reconciles stale open days whenever the tracking date is (re)established', () => {
    mountHydrated();
    expect(RegistryService.reconcileStaleDays).toHaveBeenCalledWith('u1', TODAY);
  });
});

describe('useRegistry counter actions', () => {
  it('increments through RegistryService with the tracking date and unit price', async () => {
    const { result } = mountHydrated();
    await act(async () => { await result.current.increment('cig'); });
    expect(RegistryService.adjustCounter).toHaveBeenCalledWith('u1', 'cig', 1, TODAY, 0.5);
  });

  it('updates the count optimistically before Firestore resolves', async () => {
    let release;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 2 }) });

    let pending;
    act(() => { pending = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(3);

    await act(async () => {
      release();
      await pending;
    });
    expect(RegistryService.adjustCounter).toHaveBeenCalledWith('u1', 'cig', 1, TODAY, 0.5);
  });

  it('decrements only when the live count is above zero', async () => {
    const { result } = mountHydrated({ day: dayData({ cig: 0 }) });

    await act(async () => { await result.current.decrement('cig'); });
    expect(RegistryService.adjustCounter).not.toHaveBeenCalled();

    act(() => cap.dayCb.current(dayData({ cig: 2 })));
    await act(async () => { await result.current.decrement('cig'); });
    expect(RegistryService.adjustCounter).toHaveBeenCalledWith('u1', 'cig', -1, TODAY, 0.5);
  });

  it('rolls back an optimistic increment when the write fails', async () => {
    RegistryService.adjustCounter.mockRejectedValueOnce(new Error('denied'));
    const { result } = mountHydrated({ day: dayData({ cig: 2 }) });

    await act(async () => {
      await expect(result.current.increment('cig')).rejects.toThrow('denied');
    });
    expect(result.current.metrics.activeCounts.cig).toBe(2);
  });

  it('is inert with no signed-in user', async () => {
    const { result } = mountHydrated({ user: null });
    await act(async () => { await result.current.increment('cig'); });
    await act(async () => { await result.current.decrement('cig'); });
    expect(RegistryService.adjustCounter).not.toHaveBeenCalled();
  });
});

describe('useRegistry.endDay (closeDay under the hood)', () => {
  it('guards against a concurrent second call while one is in flight', async () => {
    let release;
    RegistryService.closeDay.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = mountHydrated();

    act(() => { result.current.endDay(); });
    expect(result.current.isEndingDay).toBe(true);
    expect(RegistryService.closeDay).toHaveBeenCalledTimes(1);

    // second invocation while still pending must be ignored
    act(() => { result.current.endDay(); });
    expect(RegistryService.closeDay).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    expect(result.current.isEndingDay).toBe(false);
  });

  it('never assigns a date — it only closes the current tracking date', async () => {
    const { result } = mountHydrated();
    await act(async () => { await result.current.endDay(); });
    expect(RegistryService.closeDay).toHaveBeenCalledWith('u1', TODAY);
  });
});

describe('useRegistry optimistic overlay', () => {
  it('merges mid-flight server snapshots with pending taps', async () => {
    let release;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 2 }) });

    let pending;
    act(() => { pending = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(3);

    // Higher mid-flight snapshot merges with the still-pending tap.
    act(() => cap.dayCb.current(dayData({ cig: 9 })));
    expect(result.current.metrics.activeCounts.cig).toBe(10);

    await act(async () => { release(); await pending; });
    expect(result.current.metrics.activeCounts.cig).toBe(10);
  });

  it('does not snap back on a stale server echo during burst taps', async () => {
    const releases = [];
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { releases.push(resolve); })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 2 }) });

    let pending1;
    let pending2;
    act(() => {
      pending1 = result.current.increment('cig');
      pending2 = result.current.increment('cig');
    });
    expect(result.current.metrics.activeCounts.cig).toBe(4);

    act(() => cap.dayCb.current(dayData({ cig: 2 })));
    expect(result.current.metrics.activeCounts.cig).toBe(4);

    await act(async () => {
      releases.forEach((release) => release());
      await pending1;
      await pending2;
    });
    expect(result.current.metrics.activeCounts.cig).toBe(4);
  });
});

describe('useRegistry listener errors', () => {
  it('surfaces registryError and clears loading when a listener fails', () => {
    const { result } = renderHook(() => useRegistry(USER, TODAY, 0.5));
    act(() => {
      cap.profileErr.current?.(new Error('permission-denied'));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.registryError).toMatch(/Could not sync registry/);
  });
});

describe('useRegistry.reorder', () => {
  const configs = [
    { ...CIG, id: 'a', order: 0 },
    { ...CIG, id: 'b', order: 1 },
    { ...CIG, id: 'c', order: 2 },
  ];

  it('swaps a config with its neighbour', () => {
    const { result } = mountHydrated({ configs });
    act(() => { result.current.reorder('b', 'up'); });
    expect(RegistryService.reorderConfigs).toHaveBeenCalledWith('u1', configs[1], configs[0]);
  });

  it('is a no-op at the list boundaries', () => {
    const { result } = mountHydrated({ configs });
    act(() => { result.current.reorder('a', 'up'); });
    act(() => { result.current.reorder('c', 'down'); });
    expect(RegistryService.reorderConfigs).not.toHaveBeenCalled();
  });
});

describe('useRegistry protocol helpers', () => {
  it('assigns the next order index when adding a protocol', () => {
    const { result } = mountHydrated({ configs: [CIG, { ...CIG, id: 'c2' }] });
    act(() => { result.current.addProtocol({ name: 'New' }); });
    expect(RegistryService.addProtocol).toHaveBeenCalledWith('u1', { name: 'New', order: 2 });
  });

  it('deleteProtocol passes the current tracking date for live cleanup', () => {
    const { result } = mountHydrated();
    act(() => { result.current.deleteProtocol('cig'); });
    expect(RegistryService.deleteProtocol).toHaveBeenCalledWith('u1', 'cig', TODAY);
  });
});

describe('useRegistry lifecycle', () => {
  it('clears prior account state when user becomes null', () => {
    const { result, rerender } = mountHydrated({
      configs: [CIG],
      day: dayData({ cig: 3 }),
    });
    expect(result.current.configs).toHaveLength(1);
    act(() => rerender({ user: null }));
    expect(result.current.configs).toEqual([]);
    expect(result.current.metrics.activeCounts).toEqual({});
    expect(result.current.loading).toBe(false);
  });

  it('drops the previous account when switching users', () => {
    const USER_B = { uid: 'u2' };
    const { result, rerender } = mountHydrated({
      configs: [CIG],
      profile: defaultProfile({ accent: '#abc' }),
      day: dayData({ cig: 3 }),
    });
    expect(result.current.profileSettings.accent).toBe('#abc');

    rerender({ user: USER_B });
    expect(result.current.configs).toEqual([]);
    expect(result.current.profileSettings).toBeNull();
    expect(result.current.loading).toBe(true);

    act(() => cap.profileCb.current(profileSnap(defaultProfile({ accent: '#def' }))));
    act(() => cap.configsCb.current([]));
    act(() => cap.logsCb.current([]));
    expect(result.current.loading).toBe(false);
    expect(result.current.profileSettings.accent).toBe('#def');
  });

  it('unsubscribes every listener on unmount', () => {
    const { unmount } = mountHydrated();
    unmount();
    expect(cap.unsub.profile).toHaveBeenCalled();
    expect(cap.unsub.configs).toHaveBeenCalled();
    expect(cap.unsub.logs).toHaveBeenCalled();
    expect(cap.unsub.days).toHaveBeenCalled();
    expect(cap.unsub.day).toHaveBeenCalled();
    expect(cap.unsub.avatar).toHaveBeenCalled();
  });

  it('tracks connectivity via window online/offline events', () => {
    const { result } = mountHydrated();
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.isOnline).toBe(false);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current.isOnline).toBe(true);
  });
});

describe('H-01 Concurrency & Day Rollover Invariants', () => {
  it('Scenario A: listener snapshot arrives before mutation completes without double-counting', async () => {
    let releaseMutation;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { releaseMutation = resolve; })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 5 }) });
    expect(result.current.metrics.activeCounts.cig).toBe(5);

    // User taps increment -> optimistic UI shows 6
    let pending;
    act(() => { pending = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(6);

    // Firestore listener emits server count = 6 BEFORE mutation promise resolves
    act(() => cap.dayCb.current(dayData({ cig: 6 })));
    // Invariant: MUST NOT double-count to 7!
    expect(result.current.metrics.activeCounts.cig).toBe(6);

    // Mutation promise finally resolves
    await act(async () => {
      releaseMutation();
      await pending;
    });
    // Invariant: MUST remain 6!
    expect(result.current.metrics.activeCounts.cig).toBe(6);
  });

  it('Scenario B: mutation promise resolves before snapshot without downward flicker', async () => {
    let releaseMutation;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { releaseMutation = resolve; })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 5 }) });
    expect(result.current.metrics.activeCounts.cig).toBe(5);

    let pending;
    act(() => { pending = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(6);

    // Mutation promise resolves BEFORE snapshot arrives
    await act(async () => {
      releaseMutation();
      await pending;
    });
    // Invariant: MUST NOT flicker down to 5! Stays at 6!
    expect(result.current.metrics.activeCounts.cig).toBe(6);

    // Snapshot finally arrives
    act(() => cap.dayCb.current(dayData({ cig: 6 })));
    expect(result.current.metrics.activeCounts.cig).toBe(6);
  });

  it('Scenario C: two very fast increments before any acknowledgements', async () => {
    const releases = [];
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { releases.push(resolve); })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 5 }) });

    let p1, p2;
    act(() => { p1 = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(6);
    act(() => { p2 = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(7);

    // First snapshot arrives
    act(() => cap.dayCb.current(dayData({ cig: 6 })));
    expect(result.current.metrics.activeCounts.cig).toBe(7);

    // Second snapshot arrives
    act(() => cap.dayCb.current(dayData({ cig: 7 })));
    expect(result.current.metrics.activeCounts.cig).toBe(7);

    // Mutations resolve
    await act(async () => {
      releases.forEach((r) => r());
      await Promise.all([p1, p2]);
    });
    expect(result.current.metrics.activeCounts.cig).toBe(7);
  });

  it('Scenario D: increment and decrement overlap cleanly', async () => {
    const releases = [];
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { releases.push(resolve); })
    );
    const { result } = mountHydrated({ day: dayData({ cig: 5 }) });

    let p1, p2;
    act(() => { p1 = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(6);
    act(() => { p2 = result.current.decrement('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(5);

    await act(async () => {
      releases.forEach((r) => r());
      await Promise.all([p1, p2]);
    });
    expect(result.current.metrics.activeCounts.cig).toBe(5);
  });

  it('Scenario F: midnight day-rollover while mutation for yesterday is in flight does not mutate today', async () => {
    let releaseYesterday;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { releaseYesterday = resolve; })
    );
    const TOMORROW = '2026-07-21';
    const { result, rerender } = renderHook(
      (props) => useRegistry(props.user, props.today, 0.5),
      { initialProps: { user: USER, today: TODAY } }
    );
    act(() => cap.profileCb.current(profileSnap(defaultProfile())));
    act(() => cap.configsCb.current([CIG]));
    act(() => cap.logsCb.current([]));
    act(() => cap.daysCb.current([]));
    act(() => cap.dayCb.current(dayData({ cig: 5 })));
    act(() => cap.avatarCb.current({ avatar: null }));

    expect(result.current.metrics.activeCounts.cig).toBe(5);

    // User taps increment at 23:59:59 for yesterday
    let pendingYesterday;
    act(() => { pendingYesterday = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(6);

    // Wall-clock midnight arrives -> today changes to TOMORROW
    act(() => {
      rerender({ user: USER, today: TOMORROW });
    });
    // Attach listener for TOMORROW (starts empty / 0)
    act(() => {
      cap.dayCb.current({ date: TOMORROW, counts: {}, trackerSnapshots: {}, status: 'open' });
    });

    // Invariant: Today MUST be 0! Yesterday's pending operation must NOT infect today!
    expect(result.current.metrics.activeCounts.cig || 0).toBe(0);

    // Yesterday's mutation finishes afterward
    await act(async () => {
      releaseYesterday();
      await pendingYesterday;
    });

    // Invariant: Today MUST STILL be 0! Not mutated by yesterday's resolved operation!
    expect(result.current.metrics.activeCounts.cig || 0).toBe(0);
  });

  it('Scenario H: mutation failure cleanly rolls back display', async () => {
    RegistryService.adjustCounter.mockRejectedValueOnce(new Error('Network error'));
    const { result } = mountHydrated({ day: dayData({ cig: 5 }) });
    expect(result.current.metrics.activeCounts.cig).toBe(5);

    let failed = false;
    await act(async () => {
      try {
        await result.current.increment('cig');
      } catch {
        failed = true;
      }
    });
    expect(failed).toBe(true);
    expect(result.current.metrics.activeCounts.cig).toBe(5);
  });
});
