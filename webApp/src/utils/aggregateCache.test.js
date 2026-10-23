import { describe, it, expect } from 'vitest';
import { SmokingCalculator } from './smokingCalculator';

/**
 * Guards the identity-keyed memo around `aggregateLoggedCounts` (see
 * smokingCalculator.js). The memo exists because `getGlobalMetrics` used to
 * re-aggregate the same `logs` array five to eight times per call, and
 * `metrics` recomputes on every counter tap.
 *
 * The risk it introduces is stale shared state: if any caller mutates the
 * cached object, or if a caller's per-day overlay leaked back into the cache,
 * a later call with different inputs would silently return the earlier answer.
 * These tests pin exactly that.
 */
describe('aggregateLoggedCounts memoization', () => {
  const configs = [
    { id: 'c1', limit: 10, pricePerUnit: 1, type: 'CIGARETTE' },
    { id: 'c2', limit: 5, pricePerUnit: 0.5, type: 'RYO_ROLL' },
  ];
  const logs = [
    { id: 'a', logDate: '2026-10-01', counts: { c1: 4, c2: 1 } },
    { id: 'b', logDate: '2026-10-01', counts: { c1: 1 } },
    { id: 'c', logDate: '2026-10-02', counts: { c1: 12 } },
  ];

  it('public aggregateLoggedCounts still returns a fresh, mutable object per call', () => {
    const first = SmokingCalculator.aggregateLoggedCounts(logs);
    const second = SmokingCalculator.aggregateLoggedCounts(logs);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    // External callers may mutate the result; the next call must be unaffected.
    first['2026-10-01'].c1 = 999;
    first['2026-12-31'] = { c1: 1 };
    const third = SmokingCalculator.aggregateLoggedCounts(logs);
    expect(third['2026-10-01'].c1).toBe(5);
    expect(third['2026-12-31']).toBeUndefined();
  });

  it('does not leak the per-day overlay back into the shared aggregate', () => {
    // Same `logs` identity, three different inputs. If projectLoggedCounts'
    // overlay were written into the cached object, call 2 and 3 would inherit
    // call 1's activeCounts.
    const base = SmokingCalculator.getGlobalMetrics(logs, configs, {}, '2026-10-03');
    const withOne = SmokingCalculator.getGlobalMetrics(logs, configs, { c1: 1 }, '2026-10-03');
    const withFive = SmokingCalculator.getGlobalMetrics(logs, configs, { c1: 5 }, '2026-10-03');

    expect(base.count).toBe(0);
    expect(withOne.count).toBe(1);
    expect(withFive.count).toBe(5);
    // Streak is computed from the same projection, so it must track the
    // overlay too: an empty/under-target today is still "within limits"
    // (streak 1), while exceeding a target breaks the streak (streak 0).
    // If the overlay leaked into the shared aggregate, the third call would
    // have inherited the second call's view of today.
    expect(base.streak).toBe(1);
    expect(withFive.streak).toBe(1);
    const overTarget = SmokingCalculator.getGlobalMetrics(logs, configs, { c1: 11 }, '2026-10-03');
    expect(overTarget.streak).toBe(0);
  });

  it('recomputes when the logs array identity changes', () => {
    const before = SmokingCalculator.getGlobalMetrics(logs, configs, {}, '2026-10-03');

    const extended = [...logs, { id: 'd', logDate: '2026-10-03', counts: { c1: 20 } }];
    const after = SmokingCalculator.getGlobalMetrics(extended, configs, {}, '2026-10-03');

    expect(after.savedLifetime).not.toBe(before.savedLifetime);
    expect(after.trackingStreak).toBeGreaterThanOrEqual(before.trackingStreak);
  });

  it('produces identical results to an uncached aggregation', () => {
    const cached = SmokingCalculator.getGlobalMetrics(logs, configs, { c1: 2 }, '2026-10-03');
    const uncached = SmokingCalculator.getGlobalMetrics([...logs], configs, { c1: 2 }, '2026-10-03');
    expect(cached).toEqual(uncached);
  });

  it('tolerates non-array input without caching', () => {
    expect(SmokingCalculator.getGlobalMetrics(null, configs, {}, '2026-10-03').count).toBe(0);
    expect(SmokingCalculator.getGlobalMetrics(undefined, configs, {}, '2026-10-03').count).toBe(0);
  });
});
