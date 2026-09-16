import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SmokingCalculator } from './smokingCalculator';

/**
 * Cross-platform domain contract fixtures (item 11) — see
 * shared-tests/README.md. The Kotlin twin of this file is
 * DomainContractFixturesTest.kt; both run the exact same
 * shared-tests/domain-fixtures.json, so semantic drift between the two
 * platforms' hand-mirrored SmokingCalculator ports fails CI on both sides.
 */
const { fixtures } = JSON.parse(readFileSync('../shared-tests/domain-fixtures.json', 'utf8'));

const runFixture = (op, input) => {
  switch (op) {
    case 'trackingDate': {
      const [y, m, d, hh, mm, ss] = input.localDateTime;
      // Local wall-clock fields, no timezone conversion — see shared-tests/README.md.
      const now = new Date(y, m - 1, d, hh, mm, ss);
      return SmokingCalculator.getTrackingDate(now, input.dayStartHour);
    }
    case 'limitStatus':
      return SmokingCalculator.getLimitStatus(input.actual, input.target);
    case 'reduction':
      return SmokingCalculator.getReduction(input.actual, input.baseline);
    case 'baselineSavings':
      return SmokingCalculator.calculateBaselineSavings(input.counts, input.configs, input.defaultPrice);
    case 'dayCredit':
      return SmokingCalculator.computeDayCredit(input.counts, input.trackerSnapshots, input.defaultUnitPrice);
    case 'formatCurrency':
      return SmokingCalculator.formatCurrency(input.amount);
    case 'backfillAllowed':
      return SmokingCalculator.isBackfillDateAllowed(input.date, input.trackingDay);
    case 'monthlyInsights': {
      const result = SmokingCalculator.aggregateMonthlyData(
        input.logs || [],
        (input.dayDocs || []).map((d) => ({
          date: d.date,
          counts: d.counts || {},
          trackerSnapshots: d.trackerSnapshots || {},
          aggregateCredit: d.aggregateCredit || null,
          status: d.status || 'closed',
        })),
        input.trackingDay,
        input.activeCounts || {},
        input.defaultUnitPrice,
        input.monthsToInclude
      );
      // Serialize for comparison — avgUnitsPerTrackedDay as number
      return {
        months: result.months.map((m) => ({
          month: m.month, label: m.label, units: m.units, trackedDays: m.trackedDays,
          avgUnitsPerTrackedDay: m.avgUnitsPerTrackedDay,
          spent: m.spent, saved: m.saved, baselineSaved: m.baselineSaved,
          hasBaseline: m.hasBaseline, isCurrentMonth: m.isCurrentMonth, isComplete: m.isComplete,
        })),
        currentMonthMtd: result.currentMonthMtd ? {
          month: result.currentMonthMtd.month, label: result.currentMonthMtd.label,
          units: result.currentMonthMtd.units, trackedDays: result.currentMonthMtd.trackedDays,
          avgUnitsPerTrackedDay: result.currentMonthMtd.avgUnitsPerTrackedDay,
          spent: result.currentMonthMtd.spent, saved: result.currentMonthMtd.saved,
          baselineSaved: result.currentMonthMtd.baselineSaved,
          hasBaseline: result.currentMonthMtd.hasBaseline,
          isCurrentMonth: result.currentMonthMtd.isCurrentMonth,
          isComplete: result.currentMonthMtd.isComplete,
        } : null,
      };
    }
    case 'trendComparison':
      return SmokingCalculator.calculateTrend(input.currentAvg, input.previousAvg);
    default:
      throw new Error(`Unknown fixture op: ${op}`);
  }
};

describe('cross-platform domain contract fixtures', () => {
  fixtures.forEach(({ case: name, op, input, expected }) => {
    it(`[${op}] ${name}`, () => {
      expect(runFixture(op, input)).toEqual(expected);
    });
  });
});
