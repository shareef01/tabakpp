import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryScreen } from './HistoryScreen';

// Mock recharts ResponsiveContainer for JSDOM
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div style={{ width: 400, height: 300 }}>{children}</div>,
  };
});

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

describe('HistoryScreen — Option B Canonical History integration (P0 Concern A)', () => {
  it('renders canonical ledger values and ignores conflicting legacy aggregateCredit on dayDocs/logs', () => {
    // Legacy day doc claims 999 € spent, 888 € saved, 777 € baseline saved
    const dayDocs = [{
      date: TODAY,
      counts: { cig: 6 },
      trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE' } },
      status: 'closed',
      aggregateCredit: { wasted: 999, saved: 888, baselineSaved: 777, smokingUnits: 999 },
    }];

    // Canonical ledger states true amounts: 6 € spent, 4 € saved, 9 € baseline saved
    const ledgers = [{
      date: TODAY,
      canonicalCredit: { wasted: 6, saved: 4, baselineSaved: 9, smokingUnits: 6 },
      foldedIntoLifetime: true,
      eligible: true,
    }];

    // Metrics projected from the canonical ledger
    const canonicalMetrics = {
      financialSource: 'OPTION_B_CANONICAL_SOURCE',
      todayAvailable: true,
      todayUnresolved: null,
      financialComplete: true,
      spentToday: 6,
      saved: 4,
      baselineSavedLifetime: 9,
      hasBaseline: true,
      streak: 3,
      recovered: 30,
      lifeLost: 66,
      count: 6,
      limit: 10,
      activeCounts: {},
      savedLifetime: 4,
    };

    const { container } = render(
      <HistoryScreen
        logs={[]}
        dayDocs={dayDocs}
        configs={[CIG]}
        m={canonicalMetrics}
        onEdit={vi.fn()}
        onAddEntry={vi.fn()}
        userId="u1"
        today={TODAY}
        unitPrice={1}
        onDeleteLog={vi.fn()}
        onRestoreLog={vi.fn()}
        ledgers={ledgers}
      />
    );

    // Canonical values are displayed
    expect(screen.getByText('6,00 €')).toBeTruthy();
    expect(screen.getByText('9,00 €')).toBeTruthy();

    // Conflicting legacy values must NEVER appear
    expect(container.textContent).not.toContain('999,00 €');
    expect(container.textContent).not.toContain('888,00 €');
    expect(container.textContent).not.toContain('777,00 €');
  });

  it('correctly indicates missing canonical ledger data as unavailable ("—" and "Unavailable") instead of €0.00', () => {
    // When canonical ledger is missing in Option B:
    const missingMetrics = {
      financialSource: 'MISSING_CANONICAL_LEDGER',
      todayAvailable: false,
      todayUnresolved: null,
      spentToday: null,
      saved: null,
      baselineSavedLifetime: 0,
      hasBaseline: true,
      streak: 0,
      recovered: 0,
      lifeLost: 0,
      count: 5,
      limit: 10,
      activeCounts: {},
      savedLifetime: 0,
    };

    render(
      <HistoryScreen
        logs={[]}
        dayDocs={[{ date: TODAY, counts: { cig: 5 } }]}
        configs={[CIG]}
        m={missingMetrics}
        onEdit={vi.fn()}
        onAddEntry={vi.fn()}
        userId="u1"
        today={TODAY}
        unitPrice={1}
        onDeleteLog={vi.fn()}
        onRestoreLog={vi.fn()}
        ledgers={[]}
      />
    );

    // Spent Today should show "—" and "Unavailable", NEVER "0,00 €"
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });

  it('correctly indicates unresolved components as "—" and "Unresolved"', () => {
    const unresolvedMetrics = {
      financialSource: 'OPTION_B_CANONICAL_SOURCE',
      todayAvailable: true,
      todayUnresolved: { spent: true },
      spentToday: 0,
      saved: 4,
      baselineSavedLifetime: 9,
      hasBaseline: true,
      streak: 0,
      recovered: 0,
      lifeLost: 0,
      count: 6,
      limit: 10,
      activeCounts: {},
      savedLifetime: 4,
    };

    render(
      <HistoryScreen
        logs={[]}
        dayDocs={[{ date: TODAY, counts: { cig: 6 } }]}
        configs={[CIG]}
        m={unresolvedMetrics}
        onEdit={vi.fn()}
        onAddEntry={vi.fn()}
        userId="u1"
        today={TODAY}
        unitPrice={1}
        onDeleteLog={vi.fn()}
        onRestoreLog={vi.fn()}
      />
    );

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Unresolved')).toBeTruthy();
  });

  it('correctly indicates truncated or incomplete financial windows as partial', () => {
    const partialMetrics = {
      financialSource: 'OPTION_B_CANONICAL_SOURCE',
      todayAvailable: true,
      todayUnresolved: null,
      financialComplete: false, // Window truncated (>400 days)
      spentToday: 6,
      saved: 4,
      baselineSavedLifetime: 9,
      hasBaseline: true,
      streak: 0,
      recovered: 0,
      lifeLost: 0,
      count: 6,
      limit: 10,
      activeCounts: {},
      savedLifetime: 4,
    };

    render(
      <HistoryScreen
        logs={[]}
        dayDocs={[{ date: TODAY, counts: { cig: 6 } }]}
        configs={[CIG]}
        m={partialMetrics}
        onEdit={vi.fn()}
        onAddEntry={vi.fn()}
        userId="u1"
        today={TODAY}
        unitPrice={1}
        onDeleteLog={vi.fn()}
        onRestoreLog={vi.fn()}
      />
    );

    expect(screen.getByText('Partial · vs. baseline')).toBeTruthy();
  });

  it('passes canonical ledgers to InsightsScreen so monthly aggregations use canonicalCredit over day.aggregateCredit', () => {
    const dayDocs = [{
      date: '2026-06-15',
      counts: { cig: 5 },
      trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE' } },
      status: 'closed',
      aggregateCredit: { wasted: 999, saved: 888, baselineSaved: 777, smokingUnits: 999 },
    }];

    const ledgers = [{
      date: '2026-06-15',
      canonicalCredit: { wasted: 5, saved: 5, baselineSaved: 10, smokingUnits: 5 },
      foldedIntoLifetime: true,
      eligible: true,
    }];

    const metrics = {
      financialSource: 'OPTION_B_CANONICAL_SOURCE',
      todayAvailable: true,
      financialComplete: true,
      spentToday: 0,
      saved: 0,
      baselineSavedLifetime: 10,
      hasBaseline: true,
      streak: 0,
      recovered: 0,
      lifeLost: 0,
      count: 0,
      limit: 10,
      activeCounts: {},
      savedLifetime: 5,
    };

    const { container } = render(
      <HistoryScreen
        logs={[]}
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
        ledgers={ledgers}
      />
    );

    // Switch to Insights subview
    const insightsTab = screen.getByRole('button', { name: 'Insights' });
    fireEvent.click(insightsTab);

    // Monthly baseline savings should show canonical 10,00 €, NEVER legacy 777,00 €
    expect(screen.getByText('10,00 €')).toBeTruthy();
    expect(container.textContent).not.toContain('777,00 €');
    expect(container.textContent).not.toContain('888,00 €');
    expect(container.textContent).not.toContain('999,00 €');
  });
});
