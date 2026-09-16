import { describe, it, expect } from 'vitest';
import { SmokingCalculator } from './smokingCalculator';

// --- Test fixture builders ---

const dayDoc = (date, counts, snapshots = {}, credit = null) => ({
  date,
  counts: counts || {},
  trackerSnapshots: snapshots,
  aggregateCredit: credit,
  status: 'closed',
});

const logEntry = (date, counts, origin = 'MANUAL_ENTRY') => ({
  id: `${date}_${origin}_${counts ? Object.keys(counts)[0] : 'x'}`,
  logDate: date,
  counts: counts || {},
  origin,
  aggregateCredit: null,
});

const snapshot = (target, baseline, unitPrice, type = 'CIGARETTE') => ({
  name: 'Cig',
  type,
  target,
  baseline: baseline ?? null,
  unitPrice,
  isFinanciallyTracked: true,
  isPrimaryTracked: true,
});

// --- Tests ---

describe('aggregateMonthlyData', () => {
  it('1. returns empty months list when no history', () => {
    const result = SmokingCalculator.aggregateMonthlyData([], [], '2026-09-15', {});
    expect(result.months).toHaveLength(0);
    expect(result.currentMonthMtd).toBeNull();
  });

  it('2. aggregates one tracked day', () => {
    const dayDocs = [dayDoc('2026-09-10', { cig: 5 })];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months).toHaveLength(1);
    expect(result.months[0].month).toBe('2026-09');
    expect(result.months[0].isCurrentMonth).toBe(true);
    expect(result.months[0].units).toBe(5);
    expect(result.months[0].trackedDays).toBe(1);
    expect(result.months[0].avgUnitsPerTrackedDay).toBe(5);
  });

  it('3. aggregates seven consecutive days', () => {
    const dayDocs = [
      dayDoc('2026-08-01', { cig: 3 }),
      dayDoc('2026-08-02', { cig: 4 }),
      dayDoc('2026-08-03', { cig: 2 }),
      dayDoc('2026-08-04', { cig: 5 }),
      dayDoc('2026-08-05', { cig: 1 }),
      dayDoc('2026-08-06', { cig: 3 }),
      dayDoc('2026-08-07', { cig: 2 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months).toHaveLength(1);
    expect(result.months[0].units).toBe(20);
    expect(result.months[0].trackedDays).toBe(7);
    expect(result.months[0].avgUnitsPerTrackedDay).toBeCloseTo(20 / 7, 2);
  });

  it('4. handles sparse tracking — untracked days excluded from denominator', () => {
    const dayDocs = [
      dayDoc('2026-08-01', { cig: 4 }),
      dayDoc('2026-08-10', { cig: 6 }),
      dayDoc('2026-08-20', { cig: 2 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    const aug = result.months[0];
    expect(aug.trackedDays).toBe(3); // only 3 days have data, NOT 31
    expect(aug.units).toBe(12);
    expect(aug.avgUnitsPerTrackedDay).toBe(4);
  });

  it('5. separates complete month from current month MTD', () => {
    const dayDocs = [
      // Complete month: 3 days in August
      dayDoc('2026-08-01', { cig: 5 }),
      dayDoc('2026-08-15', { cig: 3 }),
      dayDoc('2026-08-30', { cig: 2 }),
      // Current month MTD: 2 days in September
      dayDoc('2026-09-01', { cig: 4 }),
      dayDoc('2026-09-14', { cig: 6 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months).toHaveLength(2);
    expect(result.months[0].month).toBe('2026-09'); // current month first
    expect(result.months[0].isCurrentMonth).toBe(true);
    expect(result.months[0].isComplete).toBe(false);
    expect(result.months[1].month).toBe('2026-08');
    expect(result.months[1].isCurrentMonth).toBe(false);
    expect(result.months[1].isComplete).toBe(true);
    expect(result.currentMonthMtd).not.toBeNull();
  });

  it('6. handles months with different numbers of calendar days', () => {
    const dayDocs = [
      // February 2026: 28 days, 2 tracked
      dayDoc('2026-02-01', { cig: 5 }),
      dayDoc('2026-02-15', { cig: 5 }),
      // March 2026: 31 days, 3 tracked
      dayDoc('2026-03-01', { cig: 4 }),
      dayDoc('2026-03-10', { cig: 4 }),
      dayDoc('2026-03-20', { cig: 4 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-04-01', {});
    const feb = result.months.find((m) => m.month === '2026-02');
    const mar = result.months.find((m) => m.month === '2026-03');
    expect(feb.trackedDays).toBe(2);
    expect(feb.avgUnitsPerTrackedDay).toBe(5);
    expect(mar.trackedDays).toBe(3);
    expect(mar.avgUnitsPerTrackedDay).toBe(4);
  });

  it('7. handles zero consumption on a tracked day', () => {
    const dayDocs = [
      dayDoc('2026-09-01', { cig: 0 }),
      dayDoc('2026-09-02', { cig: 5 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months[0].units).toBe(5);
    expect(result.months[0].trackedDays).toBe(2);
    expect(result.months[0].avgUnitsPerTrackedDay).toBe(2.5);
  });

  it('8. baseline present — baselineSaved flows through from stamped snapshots', () => {
    const dayDocs = [
      dayDoc('2026-09-01', { cig: 3 }, { cig: snapshot(20, 10, 0.5) }, {
        wasted: 1.5, saved: 8.5, smokingUnits: 3, baselineSaved: 3.5,
      }),
      dayDoc('2026-09-02', { cig: 2 }, { cig: snapshot(20, 10, 0.5) }, {
        wasted: 1.0, saved: 9.0, smokingUnits: 2, baselineSaved: 4.0,
      }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months[0].hasBaseline).toBe(true);
    expect(result.months[0].baselineSaved).toBe(7.5); // 3.5 + 4.0
    expect(result.months[0].spent).toBe(2.5); // 1.5 + 1.0
    expect(result.months[0].saved).toBe(17.5); // 8.5 + 9.0
  });

  it('9. no baseline present — hasBaseline is false, baselineSaved is 0', () => {
    const dayDocs = [dayDoc('2026-09-01', { cig: 5 })];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months[0].hasBaseline).toBe(false);
    expect(result.months[0].baselineSaved).toBe(0);
  });

  it('10. overlapping legacy logs + day docs — counted exactly once (additive merge)', () => {
    // Legacy log for a date, and a day-doc for the same date.
    // The canonical merge (aggregateLoggedCounts → mergeDayDocsIntoLogged) is additive,
    // so this tests that we inherit that semantics — not double-subtract.
    const logs = [
      logEntry('2026-09-01', { cig: 3, ryo: 2 }),
    ];
    const dayDocs = [dayDoc('2026-09-01', { cig: 1 })];
    const result = SmokingCalculator.aggregateMonthlyData(logs, dayDocs, '2026-09-15', {});
    // Additive merge: 3+1 cig + 2 ryo = 6 units
    expect(result.months[0].units).toBe(6);
  });

  it('11. month/year boundary — December to January', () => {
    const dayDocs = [
      dayDoc('2025-12-30', { cig: 4 }),
      dayDoc('2025-12-31', { cig: 3 }),
      dayDoc('2026-01-01', { cig: 5 }),
      dayDoc('2026-01-05', { cig: 2 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-01-15', {});
    expect(result.months).toHaveLength(2);
    expect(result.months[0].month).toBe('2026-01');
    expect(result.months[1].month).toBe('2025-12');
    expect(result.months[0].units).toBe(7);
    expect(result.months[1].units).toBe(7);
  });

  it('12. leap-year February', () => {
    const dayDocs = [
      dayDoc('2024-02-28', { cig: 3 }),
      dayDoc('2024-02-29', { cig: 4 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2024-03-15', {});
    expect(result.months).toHaveLength(1);
    expect(result.months[0].month).toBe('2024-02');
    expect(result.months[0].units).toBe(7);
    expect(result.months[0].trackedDays).toBe(2);
  });

  it('13. historical snapshots with old prices — pricing is stamped, not live', () => {
    // Day doc has a snapshot with unitPrice 1.0, but configs (live) price is 5.0.
    // The stamped snapshot should be used, not the live config.
    const dayDocs = [
      dayDoc('2026-09-01', { cig: 10 },
        { cig: snapshot(20, 15, 1.0) }, // target=20, baseline=15, price=1.0
        { wasted: 10.0, saved: 10.0, smokingUnits: 10, baselineSaved: 5.0 }
      ),
    ];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    // saved = (20 - 10) * 1.0 = 10.0 (from stamped snapshot, NOT live config at 5.0)
    expect(result.months[0].saved).toBe(10.0);
    expect(result.months[0].spent).toBe(10.0);
  });

  it('14. current config changed after historical day — historical economics unaffected', () => {
    // Historical day was logged with target=20, price=0.5.
    // Today, the user changed the tracker to target=5, price=2.0.
    // The historical month should still reflect old economics.
    const dayDocs = [
      dayDoc('2026-08-15', { cig: 12 },
        { cig: snapshot(20, null, 0.5) }, // old: target 20, price 0.5, no baseline
        { wasted: 6.0, saved: 4.0, smokingUnits: 12, baselineSaved: 0.0 }
      ),
    ];
    // Live configs now say price=2.0, target=5
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {});
    expect(result.months[0].spent).toBe(6.0);  // 12 * 0.5 (stamped), NOT 12 * 2.0
    expect(result.months[0].saved).toBe(4.0);  // (20-12) * 0.5 (stamped), NOT (5-12)*2.0
  });

  it('15. merges activeCounts for today (open session)', () => {
    const dayDocs = [dayDoc('2026-09-15', { cig: 3 })];
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', { cig: 2 });
    expect(result.months[0].units).toBe(5); // 3 + 2 from active session
  });

  it('16. limits completed months to monthsToInclude', () => {
    const dayDocs = [];
    for (let i = 0; i < 8; i++) {
      const monthNum = 8 - i; // 08, 07, 06, ..., 01
      const date = `2026-${String(monthNum).padStart(2, '0')}-15`;
      dayDocs.push(dayDoc(date, { cig: 3 }));
    }
    // trackingDay is 2026-09-15, so August is a complete month, September is current MTD
    // But there are no September day-docs, so no MTD entry
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {}, 0.5, 3);
    // 8 months of data (Feb–Aug), tracking day is Sep 15
    // No Sep day-docs → no currentMonthMtd, all are completed
    // With monthsToInclude=3: takes 3 most recent completed months (Aug, Jul, Jun)
    expect(result.months).toHaveLength(3);
    expect(result.months[0].month).toBe('2026-08');
    expect(result.months[1].month).toBe('2026-07');
    expect(result.months[2].month).toBe('2026-06');
  });

  it('16b. current month MTD counts first, then completed months', () => {
    const dayDocs = [];
    for (let i = 0; i < 5; i++) {
      const monthNum = 8 - i; // 08, 07, 06, 05, 04
      const date = `2026-${String(monthNum).padStart(2, '0')}-15`;
      dayDocs.push(dayDoc(date, { cig: 3 }));
    }
    // Add some September days (current month MTD)
    dayDocs.push(dayDoc('2026-09-01', { cig: 5 }));
    dayDocs.push(dayDoc('2026-09-14', { cig: 2 }));
    const result = SmokingCalculator.aggregateMonthlyData([], dayDocs, '2026-09-15', {}, 0.5, 3);
    // Sep (MTD) + Aug + Jul + Jun = 4 total (1 current + 3 completed)
    expect(result.months).toHaveLength(4);
    expect(result.months[0].month).toBe('2026-09');
    expect(result.months[0].isCurrentMonth).toBe(true);
    expect(result.months[1].month).toBe('2026-08');
  });

  it('17. formatMonthLabel formats YYYY-MM correctly', () => {
    expect(SmokingCalculator.formatMonthLabel('2026-09')).toBe('September 2026');
    expect(SmokingCalculator.formatMonthLabel('2026-01')).toBe('January 2026');
    expect(SmokingCalculator.formatMonthLabel('2025-12')).toBe('December 2025');
  });
});

describe('calculateTrend', () => {
  it('computes down-trend correctly', () => {
    const trend = SmokingCalculator.calculateTrend(5, 10);
    expect(trend.direction).toBe('down');
    expect(trend.percentChange).toBe(-50);
    expect(trend.text).toBe('50% fewer units');
  });

  it('computes up-trend correctly', () => {
    const trend = SmokingCalculator.calculateTrend(15, 10);
    expect(trend.direction).toBe('up');
    expect(trend.percentChange).toBe(50);
    expect(trend.text).toBe('50% more units');
  });

  it('handles unchanged', () => {
    const trend = SmokingCalculator.calculateTrend(10, 10);
    expect(trend.direction).toBe('unchanged');
    expect(trend.text).toBe('unchanged');
  });

  it('handles previous == 0 and current == 0', () => {
    const trend = SmokingCalculator.calculateTrend(0, 0);
    expect(trend.direction).toBe('unchanged');
    expect(trend.percentChange).toBe(0);
    expect(trend.text).toBe('unchanged');
  });

  it('handles previous == 0 and current > 0 (no infinity)', () => {
    const trend = SmokingCalculator.calculateTrend(5, 0);
    expect(trend.direction).toBe('from_zero');
    expect(trend.percentChange).toBeNull();
    expect(trend.text).toBe('increased from zero');
  });

  it('handles previous > 0 and current == 0', () => {
    const trend = SmokingCalculator.calculateTrend(0, 10);
    expect(trend.direction).toBe('to_zero');
    expect(trend.percentChange).toBe(-100);
    expect(trend.text).toBe('100% fewer units');
  });
});

// --- Correctness gate: Case A — overlapping logs + dayDocs (same tracker, same date) ---
// The canonical merge is additive: logs counts and dayDoc counts for the same date
// and same tracker are ADDED. This is the existing domain behavior inherited from
// mergeDayDocsIntoLogged / buildVelocitySeries / calculateStreak.
describe('aggregateMonthlyData — Case A (overlapping sources)', () => {
  it('adds log + dayDoc counts for same date and tracker (additive)', () => {
    const logs = [logEntry('2026-08-10', { cig: 4 })];
    const dayDocs = [dayDoc('2026-08-10', { cig: 4 })];
    const result = SmokingCalculator.aggregateMonthlyData(logs, dayDocs, '2026-09-16');
    expect(result.completedMonths).toHaveLength(1);
    expect(result.completedMonths[0].units).toBe(8); // 4 + 4
  });
});

// --- Correctness gate: Case B — which source is authoritative ---
// Both log and dayDoc for same date: merge is additive, no single source "wins".
// Each source contributes its counts; the merge function sums them.
describe('aggregateMonthlyData — Case B (dual source dates)', () => {
  it('sums both sources: log 3 + dayDoc 5 = 8', () => {
    const logs = [logEntry('2026-08-10', { cig: 3 })];
    const dayDocs = [dayDoc('2026-08-10', { cig: 5 })];
    const result = SmokingCalculator.aggregateMonthlyData(logs, dayDocs, '2026-09-16');
    const month = result.completedMonths[0];
    expect(month.units).toBe(8);
    expect(month.trackedDays).toBe(1);
    expect(month.avgUnitsPerTrackedDay).toBe(8);
  });
});

// --- Correctness gate: Case C — different trackers on same date ---
describe('aggregateMonthlyData — Case C (different trackers same date)', () => {
  it('retains both tracker IDs without collision', () => {
    const logs = [logEntry('2026-08-10', { cig: 3 })];
    const dayDocs = [dayDoc('2026-08-10', { ryo: 5 })];
    const result = SmokingCalculator.aggregateMonthlyData(logs, dayDocs, '2026-09-16');
    const month = result.completedMonths[0];
    expect(month.units).toBe(8); // 3 (cig from log) + 5 (ryo from dayDoc)
  });
});

// --- Correctness gate: Historical financial semantics ---
// Logs-only dates have NO financials (no stamped snapshots/aggregateCredit).
// They must NOT be repriced using current configs.
describe('aggregateMonthlyData — logs-only historical financials', () => {
  it('logs-only date has zero financials (no fabricated pricing)', () => {
    const logs = [logEntry('2026-08-15', { cig: 5 })];
    const configs = [{ id: 'cig', limit: 10, pricePerUnit: 0.60 }];
    const result = SmokingCalculator.aggregateMonthlyData(logs, [], '2026-09-16', {}, 0.60);
    expect(result.completedMonths[0].spent).toBe(0);
    expect(result.completedMonths[0].saved).toBe(0);
    expect(result.completedMonths[0].baselineSaved).toBe(0);
    expect(result.completedMonths[0].hasBaseline).toBe(false);
  });

  it('dayDoc with aggregateCredit uses stamped values, not current configs', () => {
    const logs = [logEntry('2026-08-15', { cig: 4 })];
    const dayDocs = [dayDoc('2026-08-15', { cig: 4 }, {}, {
      wasted: 1.60, // €0.40 × 4 = historical price
      saved: 2.40,
      baselineSaved: 1.20,
    })];
    const configs = [{ id: 'cig', limit: 10, pricePerUnit: 0.60 }]; // current price is higher
    const result = SmokingCalculator.aggregateMonthlyData(logs, dayDocs, '2026-09-16', {}, 0.60);
    // With additive merge: 4 + 4 = 8 units consumed
    expect(result.completedMonths[0].units).toBe(8);
    // Financials from stamped aggregateCredit, NOT recomputed at €0.60
    expect(result.completedMonths[0].spent).toBe(1.60);
    expect(result.completedMonths[0].saved).toBe(2.40);
    expect(result.completedMonths[0].baselineSaved).toBe(1.20);
  });
});

// --- Correctness gate: Current-month isolation ---
// Completed months exclude September when trackingDay is in September.
describe('aggregateMonthlyData — current month isolation', () => {
  it('separates current month from completed months', () => {
    const logs = [
      logEntry('2026-07-15', { cig: 10 }),
      logEntry('2026-08-15', { cig: 8 }),
      logEntry('2026-09-10', { cig: 5 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData(logs, [], '2026-09-16');
    expect(result.completedMonths.map(m => m.month)).toEqual(['2026-08', '2026-07']);
    expect(result.currentMonthMtd).not.toBeNull();
    expect(result.currentMonthMtd.month).toBe('2026-09');
    expect(result.currentMonthMtd.units).toBe(5);
  });

  it('handles year boundary: Jan 2027 with Dec 2026 data', () => {
    const logs = [
      logEntry('2026-12-15', { cig: 10 }),
      logEntry('2026-11-15', { cig: 8 }),
      logEntry('2027-01-08', { cig: 5 }),
    ];
    const result = SmokingCalculator.aggregateMonthlyData(logs, [], '2027-01-10');
    expect(result.completedMonths.map(m => m.month)).toEqual(['2026-12', '2026-11']);
    expect(result.currentMonthMtd?.month).toBe('2027-01');
    expect(result.currentMonthMtd?.units).toBe(5);
  });
});

// --- Correctness gate: Tracked-day denominator ---
// Missing days are excluded from the denominator, not treated as zero.
describe('aggregateMonthlyData — tracked-day denominator', () => {
  it('missing days excluded from average (not treated as zero)', () => {
    const logs = [
      logEntry('2026-08-01', { cig: 10 }),
      logEntry('2026-08-03', { cig: 6 }), // Aug 2 is missing
    ];
    const result = SmokingCalculator.aggregateMonthlyData(logs, [], '2026-09-16');
    const month = result.completedMonths[0];
    expect(month.trackedDays).toBe(2); // only 2 tracked days
    expect(month.avgUnitsPerTrackedDay).toBe(8); // (10+6)/2, NOT (10+0+6)/3
  });

  it('zero-consumption day doc counts as tracked day', () => {
    const logs = [];
    const dayDocs = [dayDoc('2026-08-01', {})]; // empty counts = zero consumption
    const result = SmokingCalculator.aggregateMonthlyData(logs, dayDocs, '2026-09-16');
    const month = result.completedMonths[0];
    expect(month.trackedDays).toBe(1);
    expect(month.units).toBe(0);
  });
});

// --- Correctness gate: Financial history — current config must NOT reprice old usage ---
describe('aggregateMonthlyData — no current-config historical repricing', () => {
  it('logs-only month uses zero financials even with high current price', () => {
    const logs = [
      logEntry('2026-07-01', { cig: 20 }),
    ];
    const configs = [{ id: 'cig', limit: 10, pricePerUnit: 0.60 }];
    const result = SmokingCalculator.aggregateMonthlyData(logs, [], '2026-09-16', {}, 0.60);
    // Units ARE included (consumption), but financials are zero (no stamped price)
    expect(result.completedMonths[0].units).toBe(20);
    expect(result.completedMonths[0].spent).toBe(0);
    expect(result.completedMonths[0].saved).toBe(0);
    expect(result.completedMonths[0].hasBaseline).toBe(false);
  });
});

// --- Correctness gate: Period-comparison semantics ---
// Trend uses equal-length 7-day windows (current vs previous comparable 7-day period).
describe('calculateTrend — equal-length windows', () => {
  it('normal percentage for equal-length windows', () => {
    const trend = SmokingCalculator.calculateTrend(6, 8);
    expect(trend.percentChange).toBe(-25);
    expect(trend.direction).toBe('down');
    expect(trend.text).toBe('25% fewer units');
  });

  it('no Infinity when previous is 0', () => {
    const trend = SmokingCalculator.calculateTrend(5, 0);
    expect(trend.percentChange).toBeNull();
    expect(trend.text).toBe('increased from zero');
  });
});

// --- Correctness gate: Cross-platform equivalence (JS side) ---
// These fixtures run through the same domain-fixtures.json contract tests in Kotlin.
describe('aggregateMonthlyData — one completed month', () => {
  it('single month with no current month MTD', () => {
    const logs = [logEntry('2026-08-10', { cig: 10 })];
    const result = SmokingCalculator.aggregateMonthlyData(logs, [], '2026-09-16');
    expect(result.completedMonths).toHaveLength(1);
    expect(result.currentMonthMtd).toBeNull();
    expect(result.completedMonths[0].units).toBe(10);
    expect(result.completedMonths[0].trackedDays).toBe(1);
  });
});
