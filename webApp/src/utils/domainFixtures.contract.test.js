import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SmokingCalculator } from './smokingCalculator';
import { buildJson, buildCsv } from './ExportBuilder';

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
      const defaultUnitPrice = input.defaultUnitPrice ?? 0.5;
      const monthsToInclude = input.monthsToInclude ?? 6;
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
        defaultUnitPrice,
        monthsToInclude
      );
      const completed = result.completedMonths || [];
      const current = result.currentMonthMtd;
      const firstCompleted = completed[0];
      return {
        units: firstCompleted ? firstCompleted.units : (current ? current.units : 0),
        trackedDays: firstCompleted ? firstCompleted.trackedDays : (current ? current.trackedDays : 0),
        avgUnitsPerTrackedDay: firstCompleted ? firstCompleted.avgUnitsPerTrackedDay : (current ? current.avgUnitsPerTrackedDay : 0),
        spent: firstCompleted ? firstCompleted.spent : (current ? current.spent : 0),
        saved: firstCompleted ? firstCompleted.saved : (current ? current.saved : 0),
        baselineSaved: firstCompleted ? firstCompleted.baselineSaved : (current ? current.baselineSaved : 0),
        hasBaseline: firstCompleted ? firstCompleted.hasBaseline : (current ? current.hasBaseline : false),
        completedCount: completed.length,
        currentMonthMtd: current != null,
        currentMonthUnits: current ? current.units : null,
        completedMonth: firstCompleted ? firstCompleted.month : null,
        currentMonth: current ? current.month : null,
      };
    }
    case 'trendComparison':
      return SmokingCalculator.calculateTrend(input.currentAvg, input.previousAvg);
    case 'export': {
      const data = {
        configs: input.configs || [],
        days: (input.days || []).map(d => ({
          ...d,
          date: d.date,
        })),
        logs: input.logs || [],
        profile: input.profile || null,
        profileMeta: input.profileMeta || null,
      };
      const defaultConfigPrice = 0.5;
      const snapshot = {
        configs: data.configs,
        days: data.days,
        logs: data.logs,
        profile: data.profile ? { uid: null, displayName: data.profile.name, createdAt: null } : null,
        profileMeta: data.profileMeta,
      };
      const json = buildJson(snapshot);
      const jsonEl = JSON.parse(json);
      const csv = buildCsv(snapshot, defaultConfigPrice);
      const lines = csv.replace(/\n$/, '').split('\n');
      return { jsonEl, csv, lines, configs: data.configs, days: input.days || [], logs: input.logs || [] };
    }
    default:
      throw new Error(`Unknown fixture op: ${op}`);
  }
};

describe('cross-platform domain contract fixtures', () => {
  fixtures.forEach(({ case: name, op, input, expected }) => {
    it(`[${op}] ${name}`, () => {
      const actual = runFixture(op, input);
      if (op === 'export') {
        const exp = expected;
        exp.exportVersion !== undefined && expect(actual.jsonEl.exportVersion).toBe(exp.exportVersion);
        exp.configsCount !== undefined && expect(actual.configs.length).toBe(exp.configsCount);
        exp.daysCount !== undefined && expect(actual.days.length).toBe(exp.daysCount);
        exp.logsCount !== undefined && expect(actual.logs.length).toBe(exp.logsCount);
        exp.hasProfile !== undefined && expect(actual.jsonEl.profile !== null).toBe(exp.hasProfile);
        exp.hasProfileMeta !== undefined && expect(actual.jsonEl.profileMeta !== null).toBe(exp.hasProfileMeta);
        exp.csvHeader !== undefined && expect(actual.lines[0]).toBe(exp.csvHeader);
        exp.dayRow0 !== undefined && expect(actual.lines[1]).toBe(exp.dayRow0);
        exp.logRow0 !== undefined && expect(actual.lines[1]).toBe(exp.logRow0);
        exp.csvRows !== undefined && expect(actual.lines.length).toBe(exp.csvRows);
        if (exp.dayDates) {
          const actualDates = actual.days.slice().sort((a, b) => a.date.localeCompare(b.date)).map(d => d.date);
          expect(actualDates).toEqual(exp.dayDates);
        }
      } else if (op === 'monthlyInsights' && typeof expected === 'object' && expected !== null) {
        // monthlyInsights fixtures selectively assert fields — only check
        // the fields present in expected
        const filteredActual = Object.keys(expected).reduce((acc, key) => {
          acc[key] = actual[key];
          return acc;
        }, {});
        expect(filteredActual).toEqual(expected);
      } else {
        expect(actual).toEqual(expected);
      }
    });
  });
});
