import { describe, it, expect } from 'vitest';
import { SmokingCalculator } from './smokingCalculator';

describe('SmokingCalculator Platinum Logic Verification', () => {
  const mockConfigs = [
    { id: 'c1', limit: 10, pricePerUnit: 1.0, type: 'CIGARETTE' },
    { id: 'c2', limit: 5, pricePerUnit: 0.5, type: 'RYO_ROLL' }
  ];

  it('calculates total count correctly across active session', () => {
    const activeCounts = { c1: 5, c2: 2 };
    expect(SmokingCalculator.getTotalCount(activeCounts, mockConfigs)).toBe(7);
  });

  it('calculates cumulative daily limit correctly', () => {
    expect(SmokingCalculator.getTotalLimit(mockConfigs)).toBe(15);
  });

  it('calculates day financials (Android Parity)', () => {
    const activeCounts = { c1: 8, c2: 2 }; // Spent = (8*1.0) + (2*0.5) = 9.0
    const financials = SmokingCalculator.calculateDayFinancials(activeCounts, mockConfigs);
    expect(financials.wasted).toBe(9.0);
    expect(financials.saved).toBe(3.5); // Saved = (10-8)*1.0 + (5-2)*0.5 = 2.0 + 1.5 = 3.5
  });

  describe('Streak Calculation (Android Parity)', () => {
    const today = '2024-07-14';

    it('returns 0 for no logs and no active session', () => {
      expect(SmokingCalculator.calculateStreak([], mockConfigs, {}, today)).toBe(0);
    });

    it('identifies a perfect streak correctly', () => {
      const logs = [
        { logDate: '2024-07-13', counts: { c1: 5, c2: 0 } },
        { logDate: '2024-07-12', counts: { c1: 5, c2: 0 } }
      ];
      // Today good (1 count), Sat good, Fri good. Total streak = 3.
      expect(SmokingCalculator.calculateStreak(logs, mockConfigs, {c1: 1}, today)).toBe(3);
    });

    it('breaks streak on over-limit day in history', () => {
      const logs = [
        { logDate: '2024-07-13', counts: { c1: 16, c2: 0 } }, // Over limit (15)
        { logDate: '2024-07-12', counts: { c1: 5, c2: 0 } }
      ];
      // Today is good (streak 1). 07-13 is bad (streak breaks).
      expect(SmokingCalculator.calculateStreak(logs, mockConfigs, {c1: 1}, today)).toBe(1);
    });

    it('returns 0 if last activity was more than 1 day ago', () => {
      const logs = [
        { logDate: '2024-07-11', counts: { c1: 5, c2: 0 } }
      ];
      // Today 07-14 is empty. Yesterday 07-13 is empty. Streak is 0.
      expect(SmokingCalculator.calculateStreak(logs, mockConfigs, {}, today)).toBe(0);
    });
  });

  it('calculates correct rank based on XP system', () => {
    expect(SmokingCalculator.getRank(100)).toBe('Apprentice');
    expect(SmokingCalculator.getRank(3000)).toBe('Scout');
    expect(SmokingCalculator.getRank(8000)).toBe('Veteran');
    expect(SmokingCalculator.getRank(20000)).toBe('Legend');
  });

  it('calculates XP correctly from logs and streaks', () => {
    const logs = [{id: 1}, {id: 2}];
    const streak = 5;
    // XP = (2 * 10) + (5 * 15) = 20 + 75 = 95
    expect(SmokingCalculator.calculateXP(logs, streak)).toBe(95);
  });

  it('formats currency with cent rounding (Android parity)', () => {
    expect(SmokingCalculator.formatCurrency(8.03)).toBe('8,03 €');
    expect(SmokingCalculator.formatCurrency(1.5)).toBe('1,50 €');
    expect(SmokingCalculator.formatCurrency(-1.5)).toBe('-1,50 €');
  });

  // Shared half-cent vectors. Kotlin used kotlin.math.round (Math.rint,
  // ties-to-even) where JS uses ties-up, so these printed a cent apart across
  // clients for identical stored data. Kotlin now uses floor(x + 0.5); the same
  // vectors are asserted in SmokingCalculatorTest.kt.
  it('breaks exact half-cent ties upward, matching Kotlin floor(x + 0.5)', () => {
    expect(SmokingCalculator.formatCurrency(0.125)).toBe('0,13 €');
    expect(SmokingCalculator.formatCurrency(0.135)).toBe('0,14 €');
    expect(SmokingCalculator.formatCurrency(2.505)).toBe('2,51 €');
    expect(SmokingCalculator.formatCurrency(0)).toBe('0,00 €');
  });

  it('calculates life lost and recovery minutes (Android parity)', () => {
    const configs = [{ id: 'c1', limit: 10, type: 'CIGARETTE' }];
    const logs = [{ logDate: '2024-05-19', counts: { c1: 10 }, origin: 'DAY_RESET' }];
    const active = { c1: 5 };
    expect(SmokingCalculator.calculateLifeLostMinutes(logs, configs, active)).toBe(165);
    expect(SmokingCalculator.calculateRecoveryMinutes(logs, configs, active, '2024-05-20')).toBe(55);
  });

  it('prefers lifetimeAggregates.saved and smokingUnits in getGlobalMetrics', () => {
    const configs = [{ id: 'c1', limit: 10, pricePerUnit: 1, type: 'CIGARETTE', isPrimaryTracked: true }];
    const logs = [{ logDate: '2024-05-19', counts: { c1: 5 }, origin: 'DAY_RESET' }];
    const m = SmokingCalculator.getGlobalMetrics(
      logs, configs, { c1: 2 }, '2024-05-20', 1.0, { saved: 99, wasted: 1, smokingUnits: 5 }
    );
    expect(m.savedLifetime).toBe(99);
    expect(m.lifeLost).toBe(77); // (5 archived + 2 active)*11
    expect(m.count).toBe(2);
  });

  it('sumSmokingUnits counts only smoking tracker types', () => {
    const configs = [
      { id: 'c1', type: 'CIGARETTE' },
      { id: 's1', type: 'SIMPLE' }
    ];
    expect(SmokingCalculator.sumSmokingUnits({ c1: 3, s1: 9 }, configs)).toBe(3);
  });

  it('validates YYYY-MM-DD dates', () => {
    expect(SmokingCalculator.isValidDate('2024-05-20')).toBe(true);
    expect(SmokingCalculator.isValidDate('2024-13-01')).toBe(false);
    expect(SmokingCalculator.isValidDate('abc')).toBe(false);
  });

  describe('isBackfillDateAllowed (Android parity)', () => {
    it('accepts the tracking day and earlier', () => {
      expect(SmokingCalculator.isBackfillDateAllowed('2024-05-20', '2024-05-20')).toBe(true);
      expect(SmokingCalculator.isBackfillDateAllowed('2024-05-19', '2024-05-20')).toBe(true);
      expect(SmokingCalculator.isBackfillDateAllowed('2023-12-31', '2024-05-20')).toBe(true);
    });

    it('rejects anything after the tracking day, including across boundaries', () => {
      expect(SmokingCalculator.isBackfillDateAllowed('2024-05-21', '2024-05-20')).toBe(false);
      expect(SmokingCalculator.isBackfillDateAllowed('2024-06-01', '2024-05-31')).toBe(false);
      expect(SmokingCalculator.isBackfillDateAllowed('2025-01-01', '2024-12-31')).toBe(false);
    });

    it('rejects impossible calendar dates regardless of the bound', () => {
      expect(SmokingCalculator.isBackfillDateAllowed('2026-02-31', '2026-12-31')).toBe(false);
      expect(SmokingCalculator.isBackfillDateAllowed('abc', '2024-05-20')).toBe(false);
    });

    it('applies no upper bound when the tracking day is unknown', () => {
      expect(SmokingCalculator.isBackfillDateAllowed('2099-01-01', null)).toBe(true);
      expect(SmokingCalculator.isBackfillDateAllowed('2099-01-01', '')).toBe(true);
    });
  });

  // A future-dated log slips past calculateStreak's "most recent is older than
  // yesterday" early return, so an inactive user reads as streak 1. That is the
  // concrete damage isBackfillDateAllowed prevents.
  it('shows why a future-dated log must never be written', () => {
    const configs = [{ id: 'c1', limit: 5, type: 'CIGARETTE' }];
    const stale = [{ logDate: '2024-01-01', counts: { c1: 1 }, origin: 'DAY_RESET' }];
    expect(SmokingCalculator.calculateStreak(stale, configs, {}, '2024-05-20')).toBe(0);

    const withFuture = [...stale, { logDate: '2099-01-01', counts: { c1: 1 }, origin: 'MANUAL_ENTRY' }];
    expect(SmokingCalculator.calculateStreak(withFuture, configs, {}, '2024-05-20')).toBe(1);
    expect(SmokingCalculator.isBackfillDateAllowed('2099-01-01', '2024-05-20')).toBe(false);
  });

  describe('Audit domain fixtures (Android parity)', () => {
    const fixtureConfig = (id, limit, price = 0.5) => ({
      id,
      limit,
      pricePerUnit: price,
      type: 'CIGARETTE',
      isPrimaryTracked: true,
      isFinanciallyTracked: true,
    });

    it('Fixture A — quota 20, count 5, unit €0.50', () => {
      const configs = [fixtureConfig('c1', 20, 0.5)];
      const fin = SmokingCalculator.calculateDayFinancials({ c1: 5 }, configs);
      expect(fin.wasted).toBe(2.5);
      expect(fin.saved).toBe(7.5);
      const m = SmokingCalculator.getGlobalMetrics([], configs, { c1: 5 }, '2026-01-01', 0.5);
      expect(m.count).toBe(5);
      expect(m.limit).toBe(20);
      expect(m.progress).toBeCloseTo(0.25);
    });

    it('Fixture B — exactly at quota', () => {
      const configs = [fixtureConfig('c1', 10, 0.5)];
      const fin = SmokingCalculator.calculateDayFinancials({ c1: 10 }, configs);
      expect(fin.wasted).toBe(5);
      expect(fin.saved).toBe(0);
    });

    it('Fixture C — above quota', () => {
      const configs = [fixtureConfig('c1', 10, 0.5)];
      const fin = SmokingCalculator.calculateDayFinancials({ c1: 12 }, configs);
      expect(fin.wasted).toBe(6);
      expect(fin.saved).toBe(0);
    });

    it('Fixture D — zero quota stays zero', () => {
      const configs = [fixtureConfig('c1', 0, 0.5)];
      expect(SmokingCalculator.getTotalLimit(configs)).toBe(0);
      const fin = SmokingCalculator.calculateDayFinancials({ c1: 0 }, configs);
      expect(fin.wasted).toBe(0);
      expect(fin.saved).toBe(0);
      const m = SmokingCalculator.getGlobalMetrics([], configs, { c1: 0 }, '2026-01-01', 0.5);
      expect(m.limit).toBe(0);
      expect(m.progress).toBe(0);
    });

    it('Fixture E — pack economics €8 / 20 units = €0.40', () => {
      expect(8 / 20).toBeCloseTo(0.4);
      const fin = SmokingCalculator.calculateDayFinancials(
        { c1: 5 },
        [fixtureConfig('c1', 20, 0.4)]
      );
      expect(fin.wasted).toBe(2);
    });

    it('Fixture F — pouch economics €6.50 / 65 units = €0.10', () => {
      expect(6.5 / 65).toBeCloseTo(0.1);
      const fin = SmokingCalculator.calculateDayFinancials(
        { c1: 10 },
        [fixtureConfig('c1', 20, 0.1)]
      );
      expect(fin.wasted).toBeCloseTo(1);
    });
  });

  describe('getTrackingDate (local day-start boundaries)', () => {
    it('rolls back before the configured day-start hour', () => {
      const before = new Date(2024, 4, 20, 5, 59, 0);
      expect(SmokingCalculator.getTrackingDate(before, 6)).toBe('2024-05-19');
    });

    it('belongs to the same calendar day at and after day start', () => {
      const at = new Date(2024, 4, 20, 6, 0, 0);
      const after = new Date(2024, 4, 20, 23, 59, 0);
      expect(SmokingCalculator.getTrackingDate(at, 6)).toBe('2024-05-20');
      expect(SmokingCalculator.getTrackingDate(after, 6)).toBe('2024-05-20');
    });

    it('handles a DST spring-forward local clock (no day skipped or repeated)', () => {
      // 2024-03-31 02:30 doesn't exist in most EU zones (clocks jump 02:00->03:00),
      // but Date arithmetic here is pure local wall-clock hours/date math with no
      // TZ database dependency, so this must not throw or misfire.
      const beforeDayStart = new Date(2024, 2, 31, 1, 30, 0);
      const afterJump = new Date(2024, 2, 31, 6, 30, 0);
      expect(SmokingCalculator.getTrackingDate(beforeDayStart, 6)).toBe('2024-03-30');
      expect(SmokingCalculator.getTrackingDate(afterJump, 6)).toBe('2024-03-31');
    });
  });

  describe('getLimitStatus (item 4/5 — zero-target semantics, three-state visual status)', () => {
    it('target=0, actual=0 -> on target ("at"), not a meaningless 0%', () => {
      expect(SmokingCalculator.getLimitStatus(0, 0)).toEqual({ status: 'at', aboveTarget: 0, belowTarget: 0 });
    });

    it('target=0, actual=1 -> 1 above target', () => {
      expect(SmokingCalculator.getLimitStatus(1, 0)).toEqual({ status: 'over', aboveTarget: 1, belowTarget: 0 });
    });

    it('target=0, actual=5 -> 5 above target', () => {
      expect(SmokingCalculator.getLimitStatus(5, 0)).toEqual({ status: 'over', aboveTarget: 5, belowTarget: 0 });
    });

    it('actual < target -> under', () => {
      expect(SmokingCalculator.getLimitStatus(3, 10)).toEqual({ status: 'under', aboveTarget: 0, belowTarget: 7 });
    });

    it('actual == target -> at (limit reached), distinct from over', () => {
      expect(SmokingCalculator.getLimitStatus(10, 10)).toEqual({ status: 'at', aboveTarget: 0, belowTarget: 0 });
    });

    it('actual > target -> over, with the exact overage', () => {
      expect(SmokingCalculator.getLimitStatus(12, 10)).toEqual({ status: 'over', aboveTarget: 2, belowTarget: 0 });
    });
  });

  describe('getReduction / calculateBaselineSavings (item 3 — baseline as first-class concept)', () => {
    it('returns null with no baseline set — never fabricates a reduction claim', () => {
      expect(SmokingCalculator.getReduction(8, null)).toBeNull();
      expect(SmokingCalculator.getReduction(8, undefined)).toBeNull();
    });

    it('baseline=20, target=10, actual=8: 12 below baseline, reduction 60%', () => {
      const reduction = SmokingCalculator.getReduction(8, 20);
      expect(reduction).toEqual({ baseline: 20, actual: 8, avoided: 12, percent: 0.6 });
      // Independently, goal adherence vs. target must be a different, unrelated number.
      expect(SmokingCalculator.getLimitStatus(8, 10)).toEqual({ status: 'under', aboveTarget: 0, belowTarget: 2 });
    });

    it('money saved comes from baseline vs. actual, never from target vs. actual', () => {
      const configs = [{ id: 'c1', limit: 10, baseline: 20, pricePerUnit: 1, isFinanciallyTracked: true }];
      const savings = SmokingCalculator.calculateBaselineSavings({ c1: 8 }, configs, 1);
      // 12 units avoided at €1 = €12 — NOT (target 10 - actual 8) * 1 = €2.
      expect(savings).toEqual({ moneySaved: 12, unitsAvoided: 12, hasBaseline: true });
    });

    it('a tracker with no baseline contributes nothing and is flagged', () => {
      const configs = [{ id: 'c1', limit: 10, pricePerUnit: 1 }];
      const savings = SmokingCalculator.calculateBaselineSavings({ c1: 3 }, configs, 1);
      expect(savings).toEqual({ moneySaved: 0, unitsAvoided: 0, hasBaseline: false });
    });

    it('never reports negative savings when actual exceeds baseline', () => {
      const configs = [{ id: 'c1', limit: 10, baseline: 5, pricePerUnit: 1 }];
      const savings = SmokingCalculator.calculateBaselineSavings({ c1: 9 }, configs, 1);
      expect(savings).toEqual({ moneySaved: 0, unitsAvoided: 0, hasBaseline: true });
    });
  });

  describe('buildTrackerSnapshot (item 2 — historical config immutability)', () => {
    it('captures target/baseline/price/name/type as of now', () => {
      const config = { name: 'Cigarettes', type: 'CIGARETTE', limit: 10, baseline: 20, pricePerUnit: 0.5 };
      expect(SmokingCalculator.buildTrackerSnapshot(config)).toEqual({
        name: 'Cigarettes',
        type: 'CIGARETTE',
        target: 10,
        baseline: 20,
        unitPrice: 0.5,
        isFinanciallyTracked: true,
        isPrimaryTracked: true,
      });
    });

    it('stores a null baseline rather than fabricating one', () => {
      const config = { name: 'Cig', type: 'CIGARETTE', limit: 10 };
      expect(SmokingCalculator.buildTrackerSnapshot(config).baseline).toBeNull();
    });
  });

  describe('calculateStreak with day-doc snapshots (item 2 — target changes never rewrite history)', () => {
    const config = () => ([{ id: 'c1', type: 'CIGARETTE', limit: 5 }]); // LIVE target is now 5
    const today = '2024-07-14';

    it('uses the day\'s stamped target (10), not today\'s live target (5), for a snapshot-backed day', () => {
      // Yesterday the target was 10 and the user smoked 8 — a legitimate success at the time.
      const dayDocs = [
        { date: '2024-07-13', counts: { c1: 8 }, trackerSnapshots: { c1: { target: 10 } } },
      ];
      // Without the snapshot (legacy behavior), 8 > today's live limit of 5 would break the streak.
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 1 }, today, dayDocs)).toBe(2);
    });

    it('falls back to the live limit when a day has no snapshot (documented legacy fallback)', () => {
      const logs = [{ logDate: '2024-07-13', counts: { c1: 8 }, origin: 'DAY_RESET' }];
      // No snapshot recorded for this legacy log — falls back to today's live limit (5), so 8 breaks it.
      expect(SmokingCalculator.calculateStreak(logs, config(), { c1: 1 }, today, [])).toBe(1);
    });

    it('changing today\'s target does not change whether a snapshotted historical day succeeded', () => {
      const dayDocs = [{ date: '2024-07-13', counts: { c1: 8 }, trackerSnapshots: { c1: { target: 10 } } }];
      const configsWithHigherLiveTarget = [{ id: 'c1', type: 'CIGARETTE', limit: 100 }];
      const streakWithLowLiveTarget = SmokingCalculator.calculateStreak([], config(), { c1: 1 }, today, dayDocs);
      const streakWithHighLiveTarget = SmokingCalculator.calculateStreak([], configsWithHigherLiveTarget, { c1: 1 }, today, dayDocs);
      // The historical day's within-limit result (8 <= stamped 10) is identical either way.
      expect(streakWithLowLiveTarget).toBe(2);
      expect(streakWithHighLiveTarget).toBe(2);
    });
  });

  describe('calculateStreak — today is never double-counted (AUD-001)', () => {
    const today = '2024-07-14';
    const config = () => ([{ id: 'c1', type: 'CIGARETTE', limit: 20 }]);

    it('keeps the streak alive while today is within target, with the overlay mirroring the persisted day doc', () => {
      const dayDocs = [
        { date: '2024-07-13', counts: { c1: 5 }, trackerSnapshots: { c1: { target: 20 } } },
        { date: today, counts: { c1: 12 }, trackerSnapshots: { c1: { target: 20 } } },
      ];
      // Persisted today = 12 and the overlay (server value, no pending) = 12.
      // Previously this read as 24 > 20 and collapsed the streak to 0.
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 12 }, today, dayDocs)).toBe(2);
    });

    it('breaks the streak only when the effective overlay count truly exceeds the target', () => {
      const dayDocs = [
        { date: '2024-07-13', counts: { c1: 5 }, trackerSnapshots: { c1: { target: 20 } } },
        { date: today, counts: { c1: 12 }, trackerSnapshots: { c1: { target: 20 } } },
      ];
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 21 }, today, dayDocs)).toBe(0);
    });

    it('a pending increment over target breaks the streak; rollback restores it', () => {
      const dayDocs = [{ date: today, counts: { c1: 20 }, trackerSnapshots: { c1: { target: 20 } } }];
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 20 }, today, dayDocs)).toBe(1);
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 21 }, today, dayDocs)).toBe(0); // +1 pending
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 20 }, today, dayDocs)).toBe(1); // rolled back
    });

    it('works when today has no day doc yet (first tap of the day)', () => {
      const dayDocs = [{ date: '2024-07-13', counts: { c1: 5 }, trackerSnapshots: { c1: { target: 20 } } }];
      expect(SmokingCalculator.calculateStreak([], config(), { c1: 1 }, today, dayDocs)).toBe(2);
    });

    it('adds a legacy/manual log dated today on top of the overlay', () => {
      // Manual backfill for today lives in the legacy ledger; it is additive
      // with the persisted day doc, which the overlay already reflects.
      const logs = [{ id: '2024-07-14_M1', logDate: today, counts: { c1: 9 }, origin: 'MANUAL_ENTRY' }];
      const dayDocs = [{ date: today, counts: { c1: 12 }, trackerSnapshots: { c1: { target: 20 } } }];
      // 12 (day doc, via overlay) + 9 (manual) = 21 > 20 → today is over target.
      expect(SmokingCalculator.calculateStreak(logs, config(), { c1: 12 }, today, dayDocs)).toBe(0);
    });

    it('falls back to the persisted day doc when the live overlay is empty (today never vanishes)', () => {
      // No snapshot on the day doc → the live limit applies, so the count is
      // what decides: 12 within a limit of 20, but over a limit of 2.
      const dayDocs = [{ date: today, counts: { c1: 12 } }];
      expect(SmokingCalculator.calculateStreak([], config(), {}, today, dayDocs)).toBe(1);
      const tight = [{ id: 'c1', type: 'CIGARETTE', limit: 2 }];
      expect(SmokingCalculator.calculateStreak([], tight, {}, today, dayDocs)).toBe(0);
    });

    it('distinguishes a loaded zero from a not-yet-loaded overlay (AUD-001 state matrix)', () => {
      const { mergeEffectiveToday } = SmokingCalculator;
      // Not loaded (empty overlay) → the persisted day doc is the best estimate.
      expect(mergeEffectiveToday({}, {}, { c1: 5 })).toEqual({ c1: 5 });
      // Loaded zero ({id:0}) is authoritative — never resurrect the stale 5.
      expect(mergeEffectiveToday({}, { c1: 0 }, { c1: 5 })).toEqual({ c1: 0 });
      // Loaded counts win over the persisted copy.
      expect(mergeEffectiveToday({}, { c1: 5 }, { c1: 3 })).toEqual({ c1: 5 });
      // Pending deltas (already folded into the overlay) are reflected.
      expect(mergeEffectiveToday({}, { c1: 6 }, { c1: 5 })).toEqual({ c1: 6 });
      expect(mergeEffectiveToday({}, { c1: 4 }, { c1: 5 })).toEqual({ c1: 4 });
      // Legacy/manual logs dated today stay additive in every case.
      expect(mergeEffectiveToday({ c1: 2 }, { c1: 3 }, { c1: 5 })).toEqual({ c1: 5 });
      // Missing doc, not loaded → empty.
      expect(mergeEffectiveToday(undefined, {}, undefined)).toEqual({});
    });
  });

  describe('calculateTrackingStreak (item 7 — tracking consistency vs. goal streak)', () => {
    const today = '2024-07-14';

    it('counts consecutive logged days even when over target every day', () => {
      const configs = [{ id: 'c1', type: 'CIGARETTE', limit: 1 }];
      const logs = [
        { logDate: '2024-07-13', counts: { c1: 20 }, origin: 'DAY_RESET' },
        { logDate: '2024-07-12', counts: { c1: 20 }, origin: 'DAY_RESET' },
      ];
      // Goal streak is 0 (way over target every day)...
      expect(SmokingCalculator.calculateStreak(logs, configs, { c1: 20 }, today)).toBe(0);
      // ...but the user tracked faithfully for 3 consecutive days.
      expect(SmokingCalculator.calculateTrackingStreak(logs, { c1: 20 }, today)).toBe(3);
    });

    it('is 0 when nothing was logged and no session is open', () => {
      expect(SmokingCalculator.calculateTrackingStreak([], {}, today)).toBe(0);
    });

    it('covers the 12 cross-platform fixture cases', () => {
      const _configs = [{ id: 'c1', type: 'CIGARETTE', limit: 10 }];
      const day = '2024-07-14';

      // 1. no history → 0
      expect(SmokingCalculator.calculateTrackingStreak([], {}, day)).toBe(0);

      // 2. one tracked day
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2024-07-14', counts: { c1: 1 } }],
        { c1: 0 }, day
      )).toBe(1);

      // 3. consecutive tracked days
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2024-07-13', counts: { c1: 3 } }, { logDate: '2024-07-12', counts: { c1: 3 } }],
        { c1: 1 }, day
      )).toBe(3);

      // 4. missing day breaks streak — log from 2 days ago with no session today = 0
      // (mostRecent 07-12 is older than yesterday 07-13, so streak is 0)
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2024-07-12', counts: { c1: 3 } }],
        {}, day
      )).toBe(0);

      // 5. tracked zero (manual entry with zero counts) preserves streak —
      // historical zero-count entries still count as tracked.
      // Today has active counts, 07-13 has a zero-count manual entry, 07-12 has positive.
      expect(SmokingCalculator.calculateTrackingStreak(
        [
          { logDate: '2024-07-13', counts: { c1: 0 }, origin: 'MANUAL_ENTRY' },
          { logDate: '2024-07-12', counts: { c1: 5 } }
        ],
        { c1: 1 }, day
      )).toBe(3); // today + 07-13 + 07-12 = 3

      // 6. manual-entry day counts as tracked
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2024-07-13', counts: { c1: 5 }, origin: 'MANUAL_ENTRY' }],
        { c1: 1 }, day
      )).toBe(2);

      // 7. dayDoc day counts as tracked — today has active count, yesterday is a dayDoc
      expect(SmokingCalculator.calculateTrackingStreak(
        [],
        { c1: 1 }, day,
        [{ date: '2024-07-13', counts: { c1: 3 }, trackerSnapshots: {}, aggregateCredit: null, status: 'closed' }]
      )).toBe(2);

      // 8. manual + dayDoc same date → still 1 streak day
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2024-07-13', counts: { c1: 4 }, origin: 'MANUAL_ENTRY' }],
        { c1: 1 }, day,
        [{ date: '2024-07-13', counts: { c1: 2 }, trackerSnapshots: {}, aggregateCredit: null, status: 'closed' }]
      )).toBe(2);

      // 9. goal missed but tracking preserved (over target every day)
      const overConfigs = [{ id: 'c1', type: 'CIGARETTE', limit: 1 }];
      const overLogs = [
        { logDate: '2024-07-13', counts: { c1: 20 } },
        { logDate: '2024-07-12', counts: { c1: 20 } }
      ];
      expect(SmokingCalculator.calculateStreak(overLogs, overConfigs, { c1: 20 }, day)).toBe(0);
      expect(SmokingCalculator.calculateTrackingStreak(overLogs, { c1: 20 }, day)).toBe(3);

      // 11. day-start boundary — missing yesterday breaks streak
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2024-07-11', counts: { c1: 5 } }],
        {}, day
      )).toBe(0);

      // 12. year/month boundary — streak spans December → January
      expect(SmokingCalculator.calculateTrackingStreak(
        [
          { logDate: '2024-01-01', counts: { c1: 3 } },
          { logDate: '2023-12-31', counts: { c1: 3 } },
          { logDate: '2023-12-30', counts: { c1: 3 } }
        ],
        { c1: 1 }, '2024-01-02'
      )).toBe(4); // today + Jan 1 + Dec 31 + Dec 30 = 4

      // --- Micro-fix: zero-only activeCounts bailout regression tests ---

      // Case A — zero active map, no history: today counts, streak = 1
      expect(SmokingCalculator.calculateTrackingStreak([], { c1: 0 }, '2026-09-18')).toBe(1);

      // Case B — zero active + stale history: today counts, yesterday missing, streak = 1
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2026-09-16', counts: { c1: 5 } }],
        { c1: 0 }, '2026-09-18'
      )).toBe(1);

      // Case C — empty active + stale history: no today evidence, streak = 0
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2026-09-16', counts: { c1: 5 } }],
        {}, '2026-09-18'
      )).toBe(0);

      // Case D — persisted zero current dayDoc: today counts, streak = 1
      expect(SmokingCalculator.calculateTrackingStreak(
        [], {}, '2026-09-18',
        [{ date: '2026-09-18', counts: { c1: 0 }, trackerSnapshots: {}, aggregateCredit: null, status: 'open' }]
      )).toBe(1);

      // Case E — zero manual log today: today counts, streak = 1
      expect(SmokingCalculator.calculateTrackingStreak(
        [{ logDate: '2026-09-18', counts: { c1: 0 }, origin: 'MANUAL_ENTRY' }],
        {}, '2026-09-18'
      )).toBe(1);

      // Case F — no evidence at all: streak = 0
      expect(SmokingCalculator.calculateTrackingStreak([], {}, '2026-09-18')).toBe(0);
    });
  });

  describe('computeDayCredit (item 2 — self-contained day-doc financials)', () => {
    it('computes wasted/saved/units/baselineSaved purely from stamped snapshots', () => {
      const snapshots = {
        c1: { target: 10, baseline: 20, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true },
      };
      const credit = SmokingCalculator.computeDayCredit({ c1: 8 }, snapshots, 0.5);
      expect(credit).toEqual({ wasted: 8, saved: 2, smokingUnits: 8, baselineSaved: 12 });
    });

    it('is unaffected by a live config that has since changed — the snapshot is authoritative', () => {
      const originalSnapshot = { c1: { target: 10, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true } };
      const creditNow = SmokingCalculator.computeDayCredit({ c1: 8 }, originalSnapshot, 0.5);
      // Even if this function were (incorrectly) called again after the live tracker's
      // target/price changed, the snapshot itself never changes, so results are stable.
      expect(creditNow.saved).toBe(2);
      expect(creditNow.wasted).toBe(8);
    });

    it('excludes non-financially-tracked trackers from money fields but still counts smoking units', () => {
      const snapshots = { c1: { target: 5, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: false } };
      const credit = SmokingCalculator.computeDayCredit({ c1: 3 }, snapshots, 0.5);
      expect(credit).toEqual({ wasted: 0, saved: 0, smokingUnits: 3, baselineSaved: 0 });
    });
  });

  describe('getGoalStatus (daily aggregate under/at/over)', () => {
    const cig = { id: 'c1', limit: 10, type: 'CIGARETTE', isPrimaryTracked: true };
    const ryo = { id: 'c2', limit: 5, type: 'RYO_ROLL', isPrimaryTracked: true };
    const simple = { id: 's1', limit: 3, type: 'SIMPLE', isPrimaryTracked: true };

    it('under target', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 7 }, [cig]);
      expect(gs.status).toBe('under');
      expect(gs.belowTarget).toBe(3);
      expect(gs.overTrackers).toBe(0);
      expect(gs.atTrackers).toBe(0);
      expect(gs.underTrackers).toBe(1);
      expect(gs.totalTrackers).toBe(1);
    });

    it('exactly at target', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 10 }, [cig]);
      expect(gs.status).toBe('at');
      expect(gs.belowTarget).toBe(0);
      expect(gs.overTrackers).toBe(0);
      expect(gs.atTrackers).toBe(1);
      expect(gs.underTrackers).toBe(0);
    });

    it('over target', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 12 }, [cig]);
      expect(gs.status).toBe('over');
      expect(gs.aboveTarget).toBe(2);
      expect(gs.overTrackers).toBe(1);
      expect(gs.atTrackers).toBe(0);
      expect(gs.underTrackers).toBe(0);
    });

    it('zero target / zero actual → at target', () => {
      const zeroCig = { ...cig, limit: 0 };
      const gs = SmokingCalculator.getGoalStatus({ c1: 0 }, [zeroCig]);
      expect(gs.status).toBe('at');
      expect(gs.overTrackers).toBe(0);
      expect(gs.atTrackers).toBe(1);
    });

    it('zero target / positive actual → over target', () => {
      const zeroCig = { ...cig, limit: 0 };
      const gs = SmokingCalculator.getGoalStatus({ c1: 1 }, [zeroCig]);
      expect(gs.status).toBe('over');
      expect(gs.overTrackers).toBe(1);
      expect(gs.aboveTarget).toBe(1);
    });

    it('multiple trackers all under', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 5, c2: 2 }, [cig, ryo]);
      expect(gs.status).toBe('under');
      expect(gs.belowTarget).toBe(8);
      expect(gs.overTrackers).toBe(0);
      expect(gs.underTrackers).toBe(2);
      expect(gs.atTrackers).toBe(0);
    });

    it('one tracker over, one under → aggregate is over', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 11, c2: 2 }, [cig, ryo]);
      expect(gs.status).toBe('over');
      expect(gs.overTrackers).toBe(1);
      expect(gs.aboveTarget).toBe(1);
      expect(gs.underTrackers).toBe(1);
    });

    it('all exactly at', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 10, c2: 5 }, [cig, ryo]);
      expect(gs.status).toBe('at');
      expect(gs.overTrackers).toBe(0);
      expect(gs.atTrackers).toBe(2);
      expect(gs.underTrackers).toBe(0);
    });

    it('mixed at + under → aggregate is at (not over)', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 10, c2: 2 }, [cig, ryo]);
      expect(gs.status).toBe('at');
      expect(gs.atTrackers).toBe(1);
      expect(gs.underTrackers).toBe(1);
    });

    it('fractional actual', () => {
      const gs = SmokingCalculator.getGoalStatus({ c1: 2.5 }, [{ ...cig, limit: 5 }]);
      expect(gs.status).toBe('under');
      expect(gs.belowTarget).toBe(2.5);
    });

    it('no trackers → null', () => {
      expect(SmokingCalculator.getGoalStatus({}, [])).toBeNull();
    });

    it('only SIMPLE trackers (no smoking) falls back to isPrimaryTracked', () => {
      const gs = SmokingCalculator.getGoalStatus({ s1: 2 }, [simple]);
      expect(gs.status).toBe('under');
      expect(gs.belowTarget).toBe(1);
    });

    it('getGlobalMetrics includes goalStatus', () => {
      const configs = [cig];
      const m = SmokingCalculator.getGlobalMetrics([], configs, { c1: 7 }, '2024-05-20');
      expect(m.goalStatus).not.toBeNull();
      expect(m.goalStatus.status).toBe('under');
      expect(m.goalStatus.belowTarget).toBe(3);
    });
  });

  describe('formatGoalDelta (cross-platform display parity)', () => {
    it('integer values: no trailing .0', () => {
      expect(SmokingCalculator.formatGoalDelta(0)).toBe('0');
      expect(SmokingCalculator.formatGoalDelta(1)).toBe('1');
      expect(SmokingCalculator.formatGoalDelta(5)).toBe('5');
    });

    it('fractional: trim trailing zeros', () => {
      expect(SmokingCalculator.formatGoalDelta(2.5)).toBe('2.5');
      expect(SmokingCalculator.formatGoalDelta(2.25)).toBe('2.25');
      expect(SmokingCalculator.formatGoalDelta(2.50)).toBe('2.5');
    });

    it('negative clamps to 0', () => {
      expect(SmokingCalculator.formatGoalDelta(-3)).toBe('0');
      expect(SmokingCalculator.formatGoalDelta(-1.5)).toBe('0');
    });
  });

  describe('mergeDayDocsIntoLogged (dated daily-document overlay)', () => {
    it('adds day-doc counts additively onto legacy logged counts', () => {
      const logged = { '2024-07-13': { c1: 2 } };
      const dayDocs = [{ date: '2024-07-13', counts: { c1: 1, c2: 4 } }, { date: '2024-07-14', counts: { c1: 5 } }];
      expect(SmokingCalculator.mergeDayDocsIntoLogged(logged, dayDocs)).toEqual({
        '2024-07-13': { c1: 3, c2: 4 },
        '2024-07-14': { c1: 5 },
      });
    });
  });

  describe('getFirstWeekGuidance (onboarding state)', () => {
    const today = '2024-05-20';
    const cig = { id: 'c1', limit: 10, type: 'CIGARETTE', isPrimaryTracked: true };

    it('no trackers → hasTracker=false', () => {
      const state = SmokingCalculator.getFirstWeekGuidance([], [], [], {}, today);
      expect(state.hasTracker).toBe(false);
      expect(state.hasTrackingEvidence).toBe(false);
      expect(state.showGettingStarted).toBe(false);
    });

    it('tracker/no data → showGettingStarted=true', () => {
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], [], {}, today);
      expect(state.hasTracker).toBe(true);
      expect(state.hasTrackingEvidence).toBe(false);
      expect(state.showGettingStarted).toBe(true);
    });

    it('trackcer + positive active count → evidence=true, card hidden', () => {
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], [], { c1: 3 }, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('tracker + zero-only activeCounts map → evidence=true (PR #45 presence semantics)', () => {
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], [], { c1: 0 }, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('tracker + zero current-day dayDoc → evidence=true (explicit zero is tracking)', () => {
      const dayDocs = [{ date: today, counts: { c1: 0 }, status: 'open' }];
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], dayDocs, {}, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('tracker + historical dayDoc → evidence=true', () => {
      const dayDocs = [{ date: '2024-05-19', counts: { c1: 5 }, status: 'closed' }];
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], dayDocs, {}, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('tracker + zero manual log → evidence=true', () => {
      const logs = [{ logDate: today, counts: { c1: 0 }, origin: 'MANUAL_ENTRY' }];
      const state = SmokingCalculator.getFirstWeekGuidance([cig], logs, [], {}, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('empty activeCounts → no evidence (Case B)', () => {
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], [], {}, today);
      expect(state.hasTrackingEvidence).toBe(false);
      expect(state.showGettingStarted).toBe(true);
    });

    it('empty current-day dayDoc → evidence=true (Case A: tracker deletion)', () => {
      const dayDocs = [{ date: today, counts: {} }];
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], dayDocs, {}, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('empty historical dayDoc → evidence=true (Case C)', () => {
      const dayDocs = [{ date: '2024-05-19', counts: {} }];
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], dayDocs, {}, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });

    it('empty dayDoc for different date → evidence=true', () => {
      const dayDocs = [{ date: '2024-05-15', counts: {} }];
      const state = SmokingCalculator.getFirstWeekGuidance([cig], [], dayDocs, {}, today);
      expect(state.hasTrackingEvidence).toBe(true);
      expect(state.showGettingStarted).toBe(false);
    });
  });

  describe('calculateLifeLostMinutes (AUD-008 — history survives tracker deletion)', () => {
    it('keeps the archived life-lost estimate when every smoking tracker is deleted', () => {
      // Only a non-smoking tracker remains (or none) — the historical smoking
      // units are a stored stamp and must not be erased by the deletion.
      const configs = [{ id: 'simple', type: 'SIMPLE', limit: 5 }];
      expect(SmokingCalculator.calculateLifeLostMinutes([], configs, {}, 100)).toBe(1100);
    });

    it('still adds today\'s live overlay for the trackers it can classify', () => {
      const configs = [{ id: 'cig', type: 'CIGARETTE', limit: 10 }];
      expect(SmokingCalculator.calculateLifeLostMinutes([], configs, { cig: 2 }, 100)).toBe((100 + 2) * 11);
    });

    it('legacy fallback (no stored total) returns 0 when no smoking tracker exists', () => {
      const configs = [{ id: 'simple', type: 'SIMPLE', limit: 5 }];
      expect(SmokingCalculator.calculateLifeLostMinutes([], configs, {}, null)).toBe(0);
    });
  });

  describe('Option B (day-level) financial contract — REFERENCE, AWAITING PRODUCT APPROVAL', () => {
    // See docs/financial-semantics.md §8. This does NOT change live behavior; it
    // pins the Option B target value so the (unapproved) policy change has a
    // concrete, testable contract the moment it is authorized.
    const snapshot = { cig: { type: 'CIGARETTE', target: 10, unitPrice: 1, isFinanciallyTracked: true } };

    it('computes ONE day-level credit from a date\'s combined consumption', () => {
      const combined = { cig: 5 }; // 2 (log A) + 3 (log B)
      const credit = SmokingCalculator.computeDayCredit(combined, snapshot, 0.5);
      expect(credit.wasted).toBeCloseTo(5); // 5 × €1
      expect(credit.saved).toBeCloseTo(5); // (10 − 5) × €1   ← Option B
    });

    it('differs from the current per-entry (Option A) sum', () => {
      const savedA = SmokingCalculator.computeDayCredit({ cig: 2 }, snapshot, 0.5).saved;
      const savedB = SmokingCalculator.computeDayCredit({ cig: 3 }, snapshot, 0.5).saved;
      expect(savedA + savedB).toBeCloseTo(15); // Option A (current)
      const optionB = SmokingCalculator.computeDayCredit({ cig: 5 }, snapshot, 0.5).saved;
      expect(optionB).toBeCloseTo(5);
      expect(optionB).not.toBeCloseTo(savedA + savedB);
    });

    it('consumption stays event-additive under both models', () => {
      const combined = { cig: 5 };
      const credit = SmokingCalculator.computeDayCredit(combined, snapshot, 0.5);
      expect(credit.wasted).toBeCloseTo(
        SmokingCalculator.computeDayCredit({ cig: 2 }, snapshot, 0.5).wasted +
        SmokingCalculator.computeDayCredit({ cig: 3 }, snapshot, 0.5).wasted
      );
    });
  });

  describe('expectedLifetimeAggregates (read-only integrity / repair primitive)', () => {
    it('recomputes the authoritative totals from stamped history', () => {
      const days = [{ date: '2026-07-01', foldedIntoLifetime: true, aggregateCredit: { saved: 5, wasted: 5, smokingUnits: 5, baselineSaved: 2 } }];
      const logs = [{ id: 'L', logDate: '2026-07-02', aggregateCredit: { saved: 8, wasted: 2, smokingUnits: 2, baselineSaved: 18 } }];
      expect(SmokingCalculator.expectedLifetimeAggregates(days, logs))
        .toEqual({ saved: 13, wasted: 7, smokingUnits: 7, baselineSaved: 20 });
    });

    it('ignores unfolded days and credit-less legacy logs', () => {
      const days = [{ date: 'd', foldedIntoLifetime: false, aggregateCredit: { saved: 9, wasted: 9, smokingUnits: 9, baselineSaved: 9 } }];
      const logs = [{ id: 'L', logDate: 'd' }]; // pre-aggregateCredit legacy
      expect(SmokingCalculator.expectedLifetimeAggregates(days, logs))
        .toEqual({ saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 });
    });

    it('is NOT complete from a bounded window — it only sums what it is given', () => {
      // The live UI windows are limit(400) days / limit(1200) logs; a total
      // derived from them can UNDERCOUNT. Completeness is the caller's
      // responsibility: reconciliation must feed the FULL paginated history
      // (e.g. readCompleteExportSnapshot), never the bounded live subscriptions.
      const allLogs = Array.from({ length: 5 }, (_, i) => ({
        id: `L${i}`, logDate: `2026-07-0${i + 1}`,
        aggregateCredit: { saved: 1, wasted: 1, smokingUnits: 1, baselineSaved: 0 },
      }));
      const boundedWindow = allLogs.slice(0, 3); // as a limit(3) window would return
      expect(SmokingCalculator.expectedLifetimeAggregates([], boundedWindow).saved).toBe(3);
      expect(SmokingCalculator.expectedLifetimeAggregates([], allLogs).saved).toBe(5); // true value
    });

    it('sums fractional currency precisely (cent-space parity with Kotlin)', () => {
      const logs = [
        { id: 'A', aggregateCredit: { saved: 0.1, wasted: 0.2, smokingUnits: 0, baselineSaved: 0.3 } },
        { id: 'B', aggregateCredit: { saved: 0.2, wasted: 0.1, smokingUnits: 0, baselineSaved: 0.3 } },
      ];
      const r = SmokingCalculator.expectedLifetimeAggregates([], logs);
      expect(r.saved).toBeCloseTo(0.3, 10);
      expect(r.wasted).toBeCloseTo(0.3, 10);
      expect(r.baselineSaved).toBeCloseTo(0.6, 10);
    });

    // Test-only read-only integrity diagnostic (developer mechanism, not wired
    // into any production path). See docs/financial-semantics.md §5-style design.
    const integrityReport = (stored, dayDocs, logs) => {
      const expected = SmokingCalculator.expectedLifetimeAggregates(dayDocs, logs);
      const difference = {};
      ['saved', 'wasted', 'smokingUnits', 'baselineSaved'].forEach((k) => {
        difference[k] = (stored?.[k] ?? 0) - expected[k];
      });
      const missingCreditRecords =
        (dayDocs || []).filter((d) => d.foldedIntoLifetime && !d.aggregateCredit).length +
        (logs || []).filter((l) => !l.aggregateCredit).length;
      const hasDrift = ['saved', 'wasted', 'smokingUnits', 'baselineSaved'].some((k) => Math.abs(difference[k]) > 1e-9);
      return { stored, expected, difference, missingCreditRecords, hasDrift };
    };

    it('diagnostic reports zero drift when the stored aggregate matches history', () => {
      const days = [{ foldedIntoLifetime: true, aggregateCredit: { saved: 5, wasted: 5, smokingUnits: 5, baselineSaved: 2 } }];
      const logs = [{ aggregateCredit: { saved: 8, wasted: 2, smokingUnits: 2, baselineSaved: 18 } }];
      const stored = { saved: 13, wasted: 7, smokingUnits: 7, baselineSaved: 20 };
      const rep = integrityReport(stored, days, logs);
      expect(rep.hasDrift).toBe(false);
      expect(rep.difference).toEqual({ saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 });
      expect(rep.missingCreditRecords).toBe(0);
    });

    it('diagnostic detects a stored-vs-history drift and quantifies it', () => {
      // Illustrative example from the brief: stored saved €120 vs expected €115.
      const days = [{ foldedIntoLifetime: true, aggregateCredit: { saved: 115, wasted: 80, smokingUnits: 160, baselineSaved: 85 } }];
      const stored = { saved: 120, wasted: 80, smokingUnits: 160, baselineSaved: 90 };
      const rep = integrityReport(stored, days, []);
      expect(rep.hasDrift).toBe(true);
      expect(rep.difference.saved).toBeCloseTo(5);
      expect(rep.difference.baselineSaved).toBeCloseTo(5);
      expect(rep.difference.wasted).toBeCloseTo(0);
      expect(rep.difference.smokingUnits).toBeCloseTo(0);
    });

    it('diagnostic surfaces missing-credit records instead of silently trusting zero', () => {
      const logs = [{ id: 'legacy' }]; // no aggregateCredit → contributes 0, but is flagged
      const rep = integrityReport({ saved: 40, wasted: 0, smokingUnits: 0, baselineSaved: 0 }, [], logs);
      expect(rep.missingCreditRecords).toBe(1);
      expect(rep.hasDrift).toBe(true); // stored 40 has no reconstructible source
    });
  });

  describe('Option B canonical day-level aggregator + dry-run (PREPARED, not wired)', () => {
    const dayDoc = (date, counts, snapshots) => ({ date, counts, trackerSnapshots: snapshots || {}, status: 'closed' });
    const manLog = (date, counts, credit) => ({ id: `${date}_M`, logDate: date, counts, origin: 'MANUAL_ENTRY', aggregateCredit: credit });

    it('Phase 3 example: day doc 3 + logs 2 + 1 (target 10, baseline 15, €1)', () => {
      const snap = { cig: { type: 'CIGARETTE', target: 10, baseline: 15, unitPrice: 1, isFinanciallyTracked: true } };
      const day = dayDoc('2026-10-01', { cig: 3 }, snap);
      const logs = [
        manLog('2026-10-01', { cig: 2 }, { wasted: 2, saved: 8, smokingUnits: 2, baselineSaved: 13 }),
        manLog('2026-10-01', { cig: 1 }, { wasted: 1, saved: 9, smokingUnits: 1, baselineSaved: 14 }),
      ];
      const r = SmokingCalculator.calculateDailyFinancials(day, logs, [], 0.5);
      expect(r.counts.cig).toBe(6);
      expect(r.spent).toBeCloseTo(6); // 6 × €1
      expect(r.saved).toBeCloseTo(4); // (10 − 6) × €1
      expect(r.baselineSaved).toBeCloseTo(9); // (15 − 6) × €1
      expect(r.smokingUnits).toBe(6);
      expect(r.ambiguous).toBe(false);
    });

    it('two manual logs, no day doc (target 10, €1, 2 & 3) ⇒ ONE allowance (saved €5)', () => {
      const logs = [
        manLog('2026-10-01', { cig: 2 }, { wasted: 2, saved: 8, smokingUnits: 2, baselineSaved: 0 }),
        manLog('2026-10-01', { cig: 3 }, { wasted: 3, saved: 7, smokingUnits: 3, baselineSaved: 0 }),
      ];
      const r = SmokingCalculator.calculateDailyFinancials(null, logs, [], 0.5);
      expect(r.spent).toBeCloseTo(5);
      expect(r.saved).toBeCloseTo(5); // NOT 15
      expect(r.smokingUnits).toBe(5);
    });

    it('de-duplicates a legacy archive against the day document', () => {
      const snap = { cig: { type: 'CIGARETTE', target: 10, unitPrice: 1, isFinanciallyTracked: true } };
      const day = dayDoc('2026-10-01', { cig: 4 }, snap);
      const archive = { id: '2026-10-01_DAY', logDate: '2026-10-01', counts: { cig: 4 }, origin: 'DAY_RESET', aggregateCredit: { wasted: 4, saved: 6, smokingUnits: 4, baselineSaved: 0 } };
      expect(SmokingCalculator.calculateDailyFinancials(day, [archive], [], 0.5).counts.cig).toBe(4);
    });

    it('flags ambiguous stamps and non-reconstructible logs', () => {
      const logs = [
        manLog('2026-10-01', { cig: 2 }, { wasted: 2, saved: 8, smokingUnits: 2, baselineSaved: 0 }), // price €1
        manLog('2026-10-01', { cig: 3 }, { wasted: 6, saved: 4, smokingUnits: 3, baselineSaved: 0 }), // price €2
      ];
      expect(SmokingCalculator.calculateDailyFinancials(null, logs, [], 0.5).ambiguous).toBe(true);
      const noCredit = [{ id: 'L', logDate: '2026-10-01', counts: { cig: 2 } }];
      expect(SmokingCalculator.calculateDailyFinancials(null, noCredit, [], 0.5).missingConfig).toContain('cig');
    });

    it('dry-run classifies dates and quantifies the Option B difference', () => {
      const logs = [
        manLog('2026-10-01', { cig: 2 }, { wasted: 2, saved: 8, smokingUnits: 2, baselineSaved: 0 }),
        manLog('2026-10-01', { cig: 3 }, { wasted: 3, saved: 7, smokingUnits: 3, baselineSaved: 0 }),
      ];
      const report = SmokingCalculator.optionBDailyDryRun([], logs, 0.5);
      expect(report).toHaveLength(1);
      expect(report[0].legacySaved).toBeCloseTo(15);
      expect(report[0].optionBSaved).toBeCloseTo(5);
      expect(report[0].deltaSaved).toBeCloseTo(-10);
      expect(report[0].category).toBe('A');
    });

    it('dry-run: Category D (already correct) and Category C (non-reconstructible)', () => {
      // D — a single folded day doc whose credit already matches Option B.
      const day = { date: '2026-10-02', counts: { cig: 4 }, status: 'closed', foldedIntoLifetime: true,
        trackerSnapshots: { cig: { type: 'CIGARETTE', target: 10, unitPrice: 1, isFinanciallyTracked: true } },
        aggregateCredit: { saved: 6, wasted: 4, smokingUnits: 4, baselineSaved: 0 } };
      const dReport = SmokingCalculator.optionBDailyDryRun([day], [], 1);
      expect(dReport[0].category).toBe('D');
      expect(dReport[0].deltaSaved).toBeCloseTo(0);

      // C — a legacy manual log with no stamped credit (missing historical inputs).
      const cReport = SmokingCalculator.optionBDailyDryRun([], [{ id: 'L', logDate: '2026-10-03', counts: { cig: 2 } }], 0.5);
      expect(cReport[0].category).toBe('C');
      expect(cReport[0].missingConfig).toContain('cig');
    });
  });
});
