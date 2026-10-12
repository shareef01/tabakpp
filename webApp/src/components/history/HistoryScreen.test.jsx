import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildVelocitySeries, HistoryScreen } from './HistoryScreen';

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

    it('keeps today visible from a still-open dayDoc, merged with the live session', () => {
      const dayDocs = [{ date: TODAY, counts: { cig: 5 } }];
      const series = buildVelocitySeries([], TODAY, 7, { cig: 2 }, dayDocs);
      expect(last(series).val).toBe(7);
    });

    it('is backward compatible when dayDocs is omitted (existing callers)', () => {
      const series = buildVelocitySeries([], TODAY, 7, {});
      expect(series).toHaveLength(7);
    });
  });
});

// --- M-02 pagination regression: exact document cursor on the first page ---
vi.mock('../../services/registryService', () => ({
  RegistryService: {
    fetchOlderLogs: vi.fn(),
    deleteLog: vi.fn().mockResolvedValue(undefined),
    restoreLog: vi.fn().mockResolvedValue(undefined),
  },
}));
import { RegistryService } from '../../services/registryService';

// The live window ends with two logs on the SAME date (2026-06-03) — the
// split-boundary-group case where a date-only cursor would re-enter the
// middle of the group and duplicate rows.
const liveLogs = [
  { id: 'L01', logDate: '2026-06-04', counts: { cig: 2 }, origin: 'AUTO' },
  { id: 'L02', logDate: '2026-06-03', counts: { cig: 3 }, origin: 'AUTO' },
  { id: 'L03', logDate: '2026-06-03', counts: { cig: 1 }, origin: 'AUTO' },
];
const baseMetrics = {
  activeCounts: {}, streak: 3, spentToday: 1.5, hasBaseline: true,
  baselineSavedLifetime: 10, recovered: 100, lifeLost: 50,
};
const renderScreen = () => render(
  <HistoryScreen
    logs={liveLogs}
    dayDocs={[]}
    configs={[]}
    m={baseMetrics}
    onEdit={vi.fn()}
    onAddEntry={vi.fn()}
    userId="user-1"
    today="2026-06-04"
    unitPrice={0.5}
    onDeleteLog={vi.fn()}
    onRestoreLog={vi.fn()}
    historyIsTruncated
  />
);

describe('HistoryScreen pagination (M-02)', () => {
  beforeEach(() => {
    RegistryService.fetchOlderLogs.mockReset();
  });

  it('first Load-older request uses the live window last document id as an exact cursor', async () => {
    RegistryService.fetchOlderLogs.mockResolvedValue({
      items: [{ id: 'L04', logDate: '2026-06-02', counts: { cig: 2 }, origin: 'AUTO' }],
      hasMore: false, nextCursor: '2026-06-02', nextCursorDocId: 'L04',
    });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /load older/i }));

    await waitFor(() => {
      expect(RegistryService.fetchOlderLogs).toHaveBeenCalledWith('user-1', {
        cursorLogId: 'L03', // exact doc cursor: last row of the live window
        cursorLogDate: '2026-06-03',
      });
    });
    // Forward progress: single page + hasMore=false => exhausted, button gone.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument();
    });
  });

  it('pages forward with the returned document cursor and never re-requests the first page', async () => {
    RegistryService.fetchOlderLogs
      .mockResolvedValueOnce({
        items: [{ id: 'L04', logDate: '2026-06-02', counts: { cig: 2 }, origin: 'AUTO' }],
        hasMore: true, nextCursor: '2026-06-02', nextCursorDocId: 'L04',
      })
      .mockResolvedValueOnce({
        // Second page re-delivers L04 (defensive: the dedupe guard must hold)
        items: [
          { id: 'L04', logDate: '2026-06-02', counts: { cig: 2 }, origin: 'AUTO' },
          { id: 'L05', logDate: '2026-06-01', counts: { cig: 1 }, origin: 'AUTO' },
        ],
        hasMore: false, nextCursor: '2026-06-01', nextCursorDocId: 'L05',
      });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /load older/i }));
    await waitFor(() => expect(RegistryService.fetchOlderLogs).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /load older/i }));
    await waitFor(() => expect(RegistryService.fetchOlderLogs).toHaveBeenCalledTimes(2));
    expect(RegistryService.fetchOlderLogs).toHaveBeenLastCalledWith('user-1', {
      cursorLogId: 'L04', // second request resumes from page 1's last doc
      cursorLogDate: '2026-06-02',
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument();
    });
  });
});
