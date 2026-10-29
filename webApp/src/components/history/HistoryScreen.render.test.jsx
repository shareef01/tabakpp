import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryScreen } from './HistoryScreen';

// jsdom does not implement matchMedia; recharts/a11y helpers may call it.
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

const TODAY = '2026-07-20';
const CIG = { id: 'cig', name: 'Cigarette', type: 'CIGARETTE', limit: 10, pricePerUnit: 1, baseline: 15, order: 0 };
const metrics = {
  spentToday: 6,
  baselineSavedLifetime: 9,
  hasBaseline: true,
  streak: 0,
  recovered: 0,
  lifeLost: 0,
  count: 6,
  limit: 10,
  activeCounts: {},
  saved: 4,
  savedLifetime: 4,
};

const logs = [
  { id: 'A', logDate: TODAY, counts: { cig: 2 }, origin: 'MANUAL_ENTRY' },
  { id: 'B', logDate: TODAY, counts: { cig: 1 }, origin: 'MANUAL_ENTRY' },
];
const dayDocs = [{
  date: TODAY,
  counts: { cig: 3 },
  trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE' } },
  status: 'open',
}];

const renderHistory = (over = {}) => render(
  <HistoryScreen
    logs={logs}
    dayDocs={dayDocs}
    configs={[CIG]}
    m={metrics}
    onEdit={vi.fn()}
    onAddEntry={vi.fn()}
    userId="u1"
    today={TODAY}
    unitPrice={1}
    onDeleteLog={vi.fn()}
    onRestoreLog={vi.fn()}
    {...over}
  />
);

describe('HistoryScreen — canonical financial rendering (Task B)', () => {
  it('renders the canonical money values (Spent 6,00 €, Saved 9,00 €)', () => {
    renderHistory();
    expect(screen.getByText('6,00 €')).toBeTruthy();
    expect(screen.getByText('9,00 €')).toBeTruthy();
  });

  it('renders the canonical money once and never surfaces the ledger as an event row', () => {
    const { container } = renderHistory();
    expect(screen.getAllByText('6,00 €').length).toBe(1); // not repeated per manual log
    expect(container.textContent).not.toContain('dailyFinancials');
    expect(container.textContent).not.toContain('null');
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('HistoryScreen — session log paging', () => {
  const manyLogs = Array.from({ length: 25 }, (_, i) => ({
    id: `L${i}`,
    logDate: `2026-06-${String(i + 1).padStart(2, '0')}`,
    counts: { cig: 1 },
    origin: 'MANUAL_ENTRY',
  }));

  it('shows 20 entries in the page flow, then reveals the rest on demand', () => {
    renderHistory({ logs: manyLogs, dayDocs: [] });
    expect(screen.getAllByRole('button', { name: /^Edit entry for/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getAllByRole('button', { name: /^Edit entry for/ })).toHaveLength(25);
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });
});
