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
