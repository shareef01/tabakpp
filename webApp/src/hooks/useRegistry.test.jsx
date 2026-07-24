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
  unsub: { profile: vi.fn(), configs: vi.fn(), logs: vi.fn() },
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
    adjustCounter: vi.fn(),
    endDay: vi.fn(),
    reorderConfigs: vi.fn(),
    addProtocol: vi.fn(),
    updateProtocol: vi.fn(),
    deleteProtocol: vi.fn(),
    updateHistoricalLog: vi.fn(),
    deleteLog: vi.fn(),
    restoreLog: vi.fn(),
    createManualEntry: vi.fn(),
  },
}));

const USER = { uid: 'u1' };
const TODAY = '2026-07-20';
const CIG = { id: 'cig', name: 'Cigarette', type: 'CIGARETTE', limit: 10, pricePerUnit: 1.0, isPrimaryTracked: true };

const profileSnap = (data) => ({ exists: () => true, data: () => data });
const defaultProfile = (over = {}) => ({
  activeCounts: {}, lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0 },
  accent: '#111', widgetSize: 'MEDIUM', avatar: null, unitPrice: 0.5, dayStartHour: 6, ...over,
});

// Mount the hook and push an initial profile/configs/logs snapshot through.
const mountHydrated = ({ user = USER, profile = defaultProfile(), configs = [CIG], logs = [] } = {}) => {
  const view = renderHook((props) => useRegistry(props.user, TODAY, 0.5), { initialProps: { user } });
  if (user) {
    act(() => cap.profileCb.current(profileSnap(profile)));
    act(() => cap.configsCb.current(configs));
    act(() => cap.logsCb.current(logs));
  }
  return view;
};

beforeEach(() => {
  cap.profileCb.current = null;
  cap.configsCb.current = null;
  cap.logsCb.current = null;
  vi.clearAllMocks();
  // Re-establish a resolving default for every action spy (clearAllMocks keeps
  // implementations, but individual tests may override endDay).
  for (const fn of Object.values(RegistryService)) {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue(undefined);
  }
});

describe('useRegistry hydration', () => {
  it('subscribes and exposes configs, logs, settings and clears loading', () => {
    const { result } = mountHydrated({
      profile: defaultProfile({ activeCounts: { cig: 3 }, accent: '#abc', unitPrice: 0.25 }),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.configs).toEqual([CIG]);
    expect(result.current.profileSettings.accent).toBe('#abc');
    expect(result.current.profileSettings.unitPrice).toBe(0.25);
    // metrics come from the real SmokingCalculator over the live session
    expect(result.current.metrics.count).toBe(3);
    expect(result.current.metrics.limit).toBe(10);
  });

  it('derives rank and the budgetLeft alias', () => {
    const { result } = mountHydrated({ profile: defaultProfile({ activeCounts: { cig: 2 } }) });
    expect(typeof result.current.metrics.rank).toBe('string');
    expect(result.current.metrics.budgetLeft).toBe(result.current.metrics.budgetLeftToday);
  });
});

describe('useRegistry counter actions', () => {
  it('increments through RegistryService', async () => {
    const { result } = mountHydrated();
    await act(async () => { await result.current.increment('cig'); });
    expect(RegistryService.adjustCounter).toHaveBeenCalledWith('u1', 'cig', 1);
  });

  it('updates the count optimistically before Firestore resolves', async () => {
    let release;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    const { result } = mountHydrated({ profile: defaultProfile({ activeCounts: { cig: 2 } }) });

    let pending;
    act(() => { pending = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(3);

    await act(async () => {
      release();
      await pending;
    });
    expect(RegistryService.adjustCounter).toHaveBeenCalledWith('u1', 'cig', 1);
  });

  it('decrements only when the live count is above zero', async () => {
    const { result } = mountHydrated({ profile: defaultProfile({ activeCounts: { cig: 0 } }) });

    await act(async () => { await result.current.decrement('cig'); });
    expect(RegistryService.adjustCounter).not.toHaveBeenCalled();

    act(() => cap.profileCb.current(profileSnap(defaultProfile({ activeCounts: { cig: 2 } }))));
    await act(async () => { await result.current.decrement('cig'); });
    expect(RegistryService.adjustCounter).toHaveBeenCalledWith('u1', 'cig', -1);
  });

  it('rolls back an optimistic increment when the write fails', async () => {
    RegistryService.adjustCounter.mockRejectedValueOnce(new Error('denied'));
    const { result } = mountHydrated({ profile: defaultProfile({ activeCounts: { cig: 2 } }) });

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

describe('useRegistry.endDay', () => {
  it('guards against a concurrent second call while one is in flight', async () => {
    let release;
    RegistryService.endDay.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = mountHydrated();

    act(() => { result.current.endDay(); });
    expect(result.current.isEndingDay).toBe(true);
    expect(RegistryService.endDay).toHaveBeenCalledTimes(1);

    // second invocation while still pending must be ignored
    act(() => { result.current.endDay(); });
    expect(RegistryService.endDay).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    expect(result.current.isEndingDay).toBe(false);
  });

  it('passes the tracking date and effective unit price', async () => {
    const { result } = mountHydrated({ profile: defaultProfile({ unitPrice: 0.9 }) });
    await act(async () => { await result.current.endDay(); });
    expect(RegistryService.endDay).toHaveBeenCalledWith('u1', TODAY, 0.9);
  });
});

describe('useRegistry optimistic deferral', () => {
  it('defers a server snapshot while an increment is in flight, then applies it on settle', async () => {
    let release;
    RegistryService.adjustCounter.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    const { result } = mountHydrated({ profile: defaultProfile({ activeCounts: { cig: 2 } }) });

    let pending;
    act(() => { pending = result.current.increment('cig'); });
    expect(result.current.metrics.activeCounts.cig).toBe(3);

    // A server snapshot arriving mid-flight must not stomp the optimistic count.
    act(() => cap.profileCb.current(profileSnap(defaultProfile({ activeCounts: { cig: 9 } }))));
    expect(result.current.metrics.activeCounts.cig).toBe(3);

    // Once the write settles, the deferred server count is applied.
    await act(async () => { release(); await pending; });
    expect(result.current.metrics.activeCounts.cig).toBe(9);
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
});

describe('useRegistry lifecycle', () => {
  it('clears prior account state when user becomes null', () => {
    const { result, rerender } = mountHydrated({
      configs: [CIG],
      profile: defaultProfile({ activeCounts: { cig: 3 } }),
    });
    expect(result.current.configs).toHaveLength(1);
    act(() => rerender({ user: null }));
    expect(result.current.configs).toEqual([]);
    expect(result.current.metrics.activeCounts).toEqual({});
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes every listener on unmount', () => {
    const { unmount } = mountHydrated();
    unmount();
    expect(cap.unsub.profile).toHaveBeenCalled();
    expect(cap.unsub.configs).toHaveBeenCalled();
    expect(cap.unsub.logs).toHaveBeenCalled();
  });

  it('tracks connectivity via window online/offline events', () => {
    const { result } = mountHydrated();
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.isOnline).toBe(false);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current.isOnline).toBe(true);
  });
});
