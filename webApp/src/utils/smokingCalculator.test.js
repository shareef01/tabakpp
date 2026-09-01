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
  });
});
