import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightsScreen } from './InsightsScreen';
import { SmokingCalculator } from '../../utils/smokingCalculator';

// Mock recharts ResponsiveContainer for JSDOM
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div style={{ width: 400, height: 300 }}>{children}</div>,
  };
});

const TODAY = '2026-09-15';
const day = (date, n) => ({ date, counts: { cig: n }, trackerSnapshots: {}, status: 'closed' });

describe('SmokingCalculator.recentWindowTrend (audit N-08)', () => {
  it('compares the 7 calendar days before today with the 7 before those', () => {
    // Current window 09-08..09-14 averages 4; previous window 09-01..09-07 averages 8.
    const dayDocs = [day('2026-09-14', 4), day('2026-09-10', 4), day('2026-09-07', 8), day('2026-09-01', 8)];
    const result = SmokingCalculator.recentWindowTrend([], dayDocs, TODAY, 7);
    expect(result.currentAvg).toBe(4);
    expect(result.previousAvg).toBe(8);
    expect(result.trend.text).toBe('50% fewer units');
  });

  it("excludes today's partial day", () => {
    const dayDocs = [day(TODAY, 1), day('2026-09-14', 6), day('2026-09-05', 6)];
    const result = SmokingCalculator.recentWindowTrend([], dayDocs, TODAY, 7);
    expect(result.currentAvg).toBe(6);
    expect(result.trend.text).toBe('unchanged');
  });

  it('treats untracked days as missing, not zero, and needs data in both windows', () => {
    // Only the current window has data: no comparison.
    expect(SmokingCalculator.recentWindowTrend([], [day('2026-09-14', 5)], TODAY, 7)).toBeNull();
    // Two tracked days far apart used to be compared as "the last 7 tracked days".
    expect(SmokingCalculator.recentWindowTrend([], [day('2026-09-14', 5), day('2026-06-01', 50)], TODAY, 7)).toBeNull();
  });
});

describe('InsightsScreen (audit N-08/N-09)', () => {
  const m = { activeCounts: {} };

  it('shows "more data needed" instead of a trend when the previous window is empty', () => {
    render(<InsightsScreen logs={[]} dayDocs={[day('2026-09-14', 5)]} m={m} today={TODAY} />);
    expect(screen.getByText('More tracking data is needed for a comparison.')).toBeTruthy();
  });

  it('has no dead "Usage trend" toggle', () => {
    render(<InsightsScreen logs={[]} dayDocs={[day('2026-09-14', 5)]} m={m} today={TODAY} />);
    expect(screen.queryByRole('button', { name: 'Usage trend' })).toBeNull();
  });

  it('charts complete months oldest to newest', () => {
    const dayDocs = [day('2026-06-10', 1), day('2026-07-10', 2), day('2026-08-10', 3), day('2026-09-10', 4)];
    render(<InsightsScreen logs={[]} dayDocs={dayDocs} m={m} today={TODAY} />);
    const summary = screen.getByText(/^Monthly consumption chart:/).textContent;
    expect(summary.indexOf('June 2026')).toBeLessThan(summary.indexOf('July 2026'));
    expect(summary.indexOf('July 2026')).toBeLessThan(summary.indexOf('August 2026'));
  });
});
