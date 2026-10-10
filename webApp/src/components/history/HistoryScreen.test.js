import { describe, it, expect } from 'vitest';
import { buildVelocitySeries } from './HistoryScreen';

const archive = (date, counts) => ({
  id: `${date}_DAY`, logDate: date, counts, isArchive: true, origin: 'DAY_RESET',
});
const manual = (date, counts, n = 1) => ({
  id: `${date}_M${n}`, logDate: date, counts, isManual: true, origin: 'MANUAL_ENTRY',
});

const TODAY = '2026-03-10';
const last = (series) => series[series.length - 1];

describe('buildVelocitySeries', () => {
  it('produces one point per day ending on the tracking day', () => {
    const series = buildVelocitySeries([], TODAY, 7, {});
    expect(series).toHaveLength(7);
    expect(series[0].date).toBe('2026-03-04');
    expect(last(series).date).toBe(TODAY);
    expect(last(series).isNow).toBe(true);
  });

  it('reads historical days from archived and manual logs', () => {
    const logs = [archive('2026-03-09', { cig: 12 }), manual('2026-03-08', { cig: 3 })];
    const series = buildVelocitySeries(logs, TODAY, 7, {});
    const byDate = Object.fromEntries(series.map((p) => [p.date, p.val]));
    expect(byDate['2026-03-09']).toBe(12);
    expect(byDate['2026-03-08']).toBe(3);
    expect(byDate['2026-03-07']).toBe(0);
  });

  it('counts the open session on the tracking day', () => {
    const series = buildVelocitySeries([], TODAY, 7, { cig: 5, ryo: 2 });
    expect(last(series).val).toBe(7);
  });

  // Regression: ending the day moves activeCounts into a `${date}_DAY` archive.
  // Reading only the live session made today's point collapse to 0 the instant
  // the day was archived, so a completed day looked like a day with no usage.
  it('keeps today visible after the day is archived', () => {
    const logs = [archive(TODAY, { cig: 14, ryo: 4 })];
    const series = buildVelocitySeries(logs, TODAY, 7, {});
    expect(last(series).val).toBe(18);
  });

  it('adds a post-archive session on top of the same-day archive', () => {
    const logs = [archive(TODAY, { cig: 14 })];
    const series = buildVelocitySeries(logs, TODAY, 7, { cig: 2 });
    expect(last(series).val).toBe(16);
  });

  it('merges a same-day manual entry with the archive', () => {
    const logs = [archive(TODAY, { cig: 10 }), manual(TODAY, { cig: 4 })];
    expect(last(buildVelocitySeries(logs, TODAY, 7, {})).val).toBe(14);
  });

  it('spans month boundaries without gaps or duplicates', () => {
    const series = buildVelocitySeries([], '2026-03-02', 7, {});
    expect(series.map((p) => p.date)).toEqual([
      '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27',
      '2026-02-28', '2026-03-01', '2026-03-02',
    ]);
  });

  it('handles the 90-day window and negative/missing counts safely', () => {
    const logs = [archive('2026-03-09', { cig: -5, ryo: 3 })];
    const series = buildVelocitySeries(logs, TODAY, 90, {});
    expect(series).toHaveLength(90);
    expect(series.find((p) => p.date === '2026-03-09').val).toBe(3);
  });

  describe('dayDocs (item 1 — dated daily-document model)', () => {
    it('reads a historical day from a dayDoc, same as a legacy archive', () => {
      const dayDocs = [{ date: '2026-03-09', counts: { cig: 12 } }];
      const series = buildVelocitySeries([], TODAY, 7, {}, dayDocs);
      expect(series.find((p) => p.date === '2026-03-09').val).toBe(12);
    });

    it('does NOT double-count today when a dayDoc and the live overlay overlap (AUD-001)', () => {
      const dayDocs = [{ date: TODAY, counts: { cig: 5 } }];
      // The overlay is built from `days/{today}` plus pending ops, so it already
      // contains the persisted 5 — the point must be 5, not 5 + 5.
      const series = buildVelocitySeries([], TODAY, 7, { cig: 5 }, dayDocs);
      expect(last(series).val).toBe(5);
    });

    it('reflects a pending overlay delta on today without doubling the persisted base', () => {
      const dayDocs = [{ date: TODAY, counts: { cig: 5 } }];
      expect(last(buildVelocitySeries([], TODAY, 7, { cig: 6 }, dayDocs)).val).toBe(6); // +1 pending
      expect(last(buildVelocitySeries([], TODAY, 7, { cig: 4 }, dayDocs)).val).toBe(4); // -1 pending
    });

    it('still adds a legacy/manual log dated today on top of the overlay', () => {
      const dayDocs = [{ date: TODAY, counts: { cig: 5 } }];
      const logs = [manual(TODAY, { cig: 2 })];
      expect(last(buildVelocitySeries(logs, TODAY, 7, { cig: 5 }, dayDocs)).val).toBe(7); // 5 + 2 manual
    });

    it('keeps today visible when the live overlay is empty but the day doc is known', () => {
      const dayDocs = [{ date: TODAY, counts: { cig: 5 } }];
      expect(last(buildVelocitySeries([], TODAY, 7, {}, dayDocs)).val).toBe(5);
    });

    it('is backward compatible when dayDocs is omitted (existing callers)', () => {
      const series = buildVelocitySeries([], TODAY, 7, {});
      expect(series).toHaveLength(7);
    });
  });
});
