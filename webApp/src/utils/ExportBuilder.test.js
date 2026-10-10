import { describe, it, expect } from 'vitest';
import { buildJson, buildCsv } from './ExportBuilder';

describe('ExportBuilder.buildJson', () => {
  it('produces deterministic field order — configs sorted by order then id', () => {
    const snapshot = {
      exportVersion: 1,
      application: { name: 'Tabakpp' },
      profile: { name: 'Test User', unitPrice: 0.5, unitsPerPack: 20 },
      profileMeta: { avatar: 'https://example.com/avatar.jpg' },
      configs: [
        { id: 'c', name: 'Cigars', type: 'smoking', pricePerUnit: 5.0, limit: 5, order: 2, isFinanciallyTracked: true, baseline: 5 },
        { id: 'a', name: 'Cigarettes', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 },
        { id: 'b', name: 'Pipes', type: 'smoking', pricePerUnit: 2.0, limit: 3, order: 1, isFinanciallyTracked: false, baseline: null },
      ],
      days: [
        { date: '2026-09-14', status: 'closed', counts: { a: 2 } },
        { date: '2026-09-13', status: 'closed', counts: { a: 3 } },
      ],
      logs: [
        { id: 'log2', logDate: '2026-09-10', counts: { a: 1 }, origin: 'MANUAL_ENTRY' },
        { id: 'log1', logDate: '2026-09-05', counts: { a: 2 }, origin: 'MANUAL_ENTRY' },
      ],
    };

    const json = buildJson(snapshot, '2026-09-16T08:15:00Z');
    const doc = JSON.parse(json);

    // Top-level field order
    const topKeys = Object.keys(doc);
    expect(topKeys).toEqual([
      'exportVersion', 'generatedAt', 'application',
      'profile', 'profileMeta', 'configs', 'days', 'logs',
    ]);

    // Configs sorted by order, then id
    const configIds = doc.configs.map((c) => c.id);
    expect(configIds).toEqual(['a', 'b', 'c']);

    // Days sorted by date
    const dayDates = doc.days.map((d) => d.date);
    expect(dayDates).toEqual(['2026-09-13', '2026-09-14']);

    // Logs sorted by date then id
    const logIds = doc.logs.map((l) => l.id);
    expect(logIds).toEqual(['log1', 'log2']);

    // generatedAt override works
    expect(doc.generatedAt).toBe('2026-09-16T08:15:00Z');
  });

  it('handles empty collections gracefully', () => {
    const snapshot = {
      profile: null,
      profileMeta: null,
      configs: [],
      days: [],
      logs: [],
    };
    const json = buildJson(snapshot, '2026-09-16T08:15:00Z');
    const doc = JSON.parse(json);
    expect(doc.configs).toEqual([]);
    expect(doc.days).toEqual([]);
    expect(doc.logs).toEqual([]);
    expect(doc.profile).toBeNull();
    expect(doc.profileMeta).toBeNull();
  });
});

describe('ExportBuilder.buildCsv', () => {
  it('produces correct header and day rows with stamped economics', () => {
    const snapshot = {
      configs: [
        { id: 'cfg1', name: 'Cigarettes', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 },
      ],
      days: [
        {
          date: '2026-09-14',
          status: 'closed',
          counts: { cfg1: 5 },
          trackerSnapshots: {
            cfg1: { name: 'Cigarettes', target: 20, baseline: 20, unitPrice: 0.5, isFinanciallyTracked: true },
          },
        },
      ],
      logs: [],
    };

    const csv = buildCsv(snapshot, 0.5);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('date,source,tracker_id,tracker_name,count,target,baseline,unit_price,spent,saved,status');
    const dayRow = lines[1].split(',');
    expect(dayRow[0]).toBe('2026-09-14');
    expect(dayRow[1]).toBe('day');
    expect(dayRow[2]).toBe('cfg1');
    expect(dayRow[3]).toBe('Cigarettes');
    expect(dayRow[4]).toBe('5.0');
    expect(dayRow[5]).toBe('20');
    expect(dayRow[6]).toBe('20');
    expect(dayRow[7]).toBe('0.5');
    expect(dayRow[8]).toBe('2.5'); // 5 * 0.5
    expect(dayRow[9]).toBe('7.5'); // (20 - 5) * 0.5
    expect(dayRow[10]).toBe('closed');
  });

  it('produces correct log rows with null economics', () => {
    const snapshot = {
      configs: [
        { id: 'cfg1', name: 'Cigarettes', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 },
      ],
      days: [],
      logs: [
        { id: 'log1', logDate: '2026-09-10', counts: { cfg1: 3 }, origin: 'MANUAL_ENTRY' },
      ],
    };

    const csv = buildCsv(snapshot, 0.5);
    const lines = csv.split('\n');
    const logRow = lines[1].split(',');
    expect(logRow[0]).toBe('2026-09-10');
    expect(logRow[1]).toBe('manual_entry');
    expect(logRow[2]).toBe('cfg1');
    expect(logRow[3]).toBe('Cigarettes');
    expect(logRow[4]).toBe('3.0');
    expect(logRow[5]).toBe(''); // target
    expect(logRow[6]).toBe(''); // baseline
    expect(logRow[7]).toBe(''); // unit_price
    expect(logRow[8]).toBe(''); // spent
    expect(logRow[9]).toBe(''); // saved
    expect(logRow[10]).toBe(''); // status
  });

  it('flags legacy day archive logs correctly', () => {
    const snapshot = {
      configs: [{ id: 'cfg1', name: 'Cigarettes', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 }],
      days: [],
      logs: [
        { id: 'log_DAY', logDate: '2026-09-10', counts: { cfg1: 2 }, origin: 'DAY_RESET' },
      ],
    };

    const csv = buildCsv(snapshot, 0.5);
    const lines = csv.split('\n');
    const logRow = lines[1].split(',');
    expect(logRow[1]).toBe('legacy_day_archive');
  });

  it('neutralizes formula injection in tracker names (spec item 12)', () => {
    const snapshot = {
      configs: [{ id: 'cfg1', name: '=CMD()', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 }],
      days: [
        {
          date: '2026-09-14',
          status: 'closed',
          counts: { cfg1: 1 },
        },
      ],
      logs: [],
    };

    const csv = buildCsv(snapshot, 0.5);
    const lines = csv.split('\n');
    const row = lines[1].split(',');
    // =CMD() neutralized to '=CMD() per spec item 12
    expect(row[3]).toBe("'=CMD()");
  });

  it('neutralizes plus-prefix formula injection', () => {
    const snapshot = {
      configs: [{ id: 'cfg1', name: '+SUM(1,1)', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 }],
      days: [
        {
          date: '2026-09-14',
          status: 'closed',
          counts: { cfg1: 1 },
        },
      ],
      logs: [],
    };

    const csv = buildCsv(snapshot, 0.5);
    const lines = csv.split('\n');
    expect(lines[1]).toContain("'+SUM(1,1)");
  });

  it('neutralizes at-sign formula injection', () => {
    const snapshot = {
      configs: [{ id: 'cfg1', name: '@SUM(1,2)', type: 'smoking', pricePerUnit: 0.5, limit: 20, order: 0, isFinanciallyTracked: true, baseline: 15 }],
      days: [
        {
          date: '2026-09-14',
          status: 'closed',
          counts: { cfg1: 1 },
        },
      ],
      logs: [],
    };

    const csv = buildCsv(snapshot, 0.5);
    const lines = csv.split('\n');
    expect(lines[1]).toContain("'@SUM(1,2)");
  });
});

describe('ExportBuilder — canonical OPTION_B financials (Task A)', () => {
  const CIG = { id: 'cig', name: 'Cigarette', type: 'CIGARETTE', limit: 10, pricePerUnit: 1, order: 0, isFinanciallyTracked: true, baseline: 15 };
  const DATE = '2026-10-01';
  const ledger = (over = {}) => ({
    date: DATE,
    canonicalCredit: { wasted: 6, saved: 4, smokingUnits: 6, baselineSaved: 9 },
    unresolvedComponents: { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
    eligible: true, ambiguous: false, conflicting: [], foldedIntoLifetime: false,
    ...over,
  });
  const snapshot = (over = {}) => ({
    exportVersion: 1,
    application: { name: 'Tabakpp' },
    profile: { name: 'U', unitPrice: 1, lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 } },
    profileMeta: { avatar: null },
    configs: [CIG],
    days: [{ date: DATE, counts: { cig: 3 }, trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE' } }, status: 'open' }],
    logs: [
      { id: 'A', logDate: DATE, counts: { cig: 2 }, origin: 'MANUAL_ENTRY' },
      { id: 'B', logDate: DATE, counts: { cig: 1 }, origin: 'MANUAL_ENTRY' },
    ],
    financialMode: 'OPTION_B',
    ledgers: [ledger()],
    ...over,
  });

  it('JSON: the date-level canonical credit appears once, preserving 3 source records', () => {
    const doc = JSON.parse(buildJson(snapshot()));
    expect(doc.days).toHaveLength(1);
    expect(doc.logs).toHaveLength(2); // original manual records preserved
    expect(doc.financialMode).toBe('OPTION_B');
    expect(doc.dailyFinancials).toHaveLength(1);
    expect(doc.dailyFinancials[0]).toMatchObject({
      date: DATE, source: 'OPTION_B_CANONICAL_SOURCE', spent: 6, saved: 4, baselineSaved: 9, smokingUnits: 6,
    });
    expect(doc.financialSummary).toMatchObject({ spent: 6, saved: 4, baselineSaved: 9, smokingUnits: 6, complete: true });
  });

  it('CSV: activity rows unchanged + a companion daily_financial_summary section (credit once)', () => {
    const csv = buildCsv(snapshot(), 1);
    const lines = csv.split('\n');
    expect(lines.filter((l) => l.includes('manual_entry')).length).toBe(2);
    expect(lines.filter((l) => /^2026-10-01,day,/.test(l)).length).toBe(1);
    const i = lines.indexOf('# daily_financial_summary');
    expect(i).toBeGreaterThan(-1);
    const row = lines[i + 2];
    expect(row.startsWith(`${DATE},OPTION_B_CANONICAL_SOURCE,6.0,4.0,9.0,6.0`)).toBe(true);
    expect(lines.filter((l) => l === row).length).toBe(1); // not repeated per manual log
  });

  it('LEGACY: no canonical section is added (backward compatible)', () => {
    const doc = JSON.parse(buildJson(snapshot({ financialMode: 'LEGACY', ledgers: [] })));
    expect(doc.dailyFinancials).toBeUndefined();
    expect(buildCsv(snapshot({ financialMode: 'LEGACY', ledgers: [] }), 1)).not.toContain('daily_financial_summary');
  });

  it('missing ledger with source activity ⇒ unavailable (blank), NOT a fabricated zero', () => {
    const doc = JSON.parse(buildJson(snapshot({ ledgers: [] })));
    const d = doc.dailyFinancials.find((x) => x.date === DATE);
    expect(d.source).toBe('MISSING_CANONICAL_LEDGER');
    expect(d.spent).toBeNull();
    expect(d.saved).toBeNull();
    expect(doc.financialSummary.complete).toBe(false);
  });

  it('verified zero stays 0; unresolved savings stay flagged (never zero-as-known)', () => {
    const zeroDoc = JSON.parse(buildJson(snapshot({
      ledgers: [ledger({ canonicalCredit: { wasted: 0, saved: 0, smokingUnits: 0, baselineSaved: 0 } })],
    })));
    expect(zeroDoc.dailyFinancials[0].saved).toBe(0);

    const unDoc = JSON.parse(buildJson(snapshot({
      ledgers: [ledger({
        canonicalCredit: { wasted: 6, saved: 0, smokingUnits: 6, baselineSaved: 0 },
        unresolvedComponents: { spent: false, saved: true, baselineSaved: true, smokingUnits: false },
        ambiguous: true,
      })],
    })));
    expect(unDoc.dailyFinancials[0].saved).toBe(0);
    expect(unDoc.dailyFinancials[0].unresolvedComponents.saved).toBe(true);
    expect(unDoc.financialSummary.complete).toBe(false);
  });
});
