import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryScreen } from './HistoryScreen';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

const TODAY = '2026-03-10';
const CIG = { id: 'cig', name: 'Cigarette', type: 'CIGARETTE', limit: 10, pricePerUnit: 1, baseline: 15, order: 0 };
const metrics = {
  spentToday: 4,
  baselineSavedLifetime: 10,
  hasBaseline: true,
  streak: 2,
  recovered: 0,
  lifeLost: 0,
  count: 4,
  limit: 10,
  activeCounts: { cig: 4 },
  saved: 6,
  savedLifetime: 6,
};

const logs = [
  { id: 'L1', logDate: '2026-03-09', counts: { cig: 8 }, isArchive: true, origin: 'DAY_RESET' },
  { id: 'L2', logDate: '2026-03-08', counts: { cig: 6 }, isArchive: true, origin: 'DAY_RESET' },
];

const dayDocs = [
  {
    date: '2026-03-09',
    counts: { cig: 8 },
    trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE' } },
    status: 'closed',
  },
  {
    date: '2026-03-08',
    counts: { cig: 6 },
    trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE' } },
    status: 'closed',
  },
];

describe('HistoryScreen Accessible Chart Table', () => {
  it('toggles the data table view and manages aria-expanded state', async () => {
    const user = userEvent.setup();
    render(
      <HistoryScreen
        logs={logs}
        dayDocs={dayDocs}
        configs={[CIG]}
        m={metrics}
        onEdit={vi.fn()}
        onAddEntry={vi.fn()}
        userId="user-1"
        today={TODAY}
        unitPrice={1}
        onDeleteLog={vi.fn()}
        onRestoreLog={vi.fn()}
      />
    );

    const toggleBtn = screen.getByRole('button', { name: /view as table/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(toggleBtn).toHaveAttribute('aria-controls', 'usage-trend-table');

    // Initially table is not rendered
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // Click to open table
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(toggleBtn).toHaveTextContent('Hide data table');

    // Table is now present with caption and columns
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Check table headers
    expect(screen.getByRole('columnheader', { name: /date/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /units/i })).toBeInTheDocument();

    // Check data cells within table - Today (live) with 4 units, past days with units
    expect(screen.getByText('Today (live)')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // Header row + 7 day data rows
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(table.textContent).toContain('Today (live)');
    expect(table.textContent).toContain('4');
    expect(table.textContent).toContain('8');
    expect(table.textContent).toContain('6');

    // Click again to hide table
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(toggleBtn).toHaveTextContent('View as table');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a screen-reader summary paragraph describing trend, peak and data points', () => {
    render(
      <HistoryScreen
        logs={logs}
        dayDocs={dayDocs}
        configs={[CIG]}
        m={metrics}
        onEdit={vi.fn()}
        onAddEntry={vi.fn()}
        userId="user-1"
        today={TODAY}
        unitPrice={1}
        onDeleteLog={vi.fn()}
        onRestoreLog={vi.fn()}
      />
    );

    // Screen reader summary paragraph exists
    const srSummary = screen.getByText(/today 4 units/i);
    expect(srSummary).toBeInTheDocument();
    expect(srSummary.className).toContain('sr-only');
  });
});
