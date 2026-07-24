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
});
