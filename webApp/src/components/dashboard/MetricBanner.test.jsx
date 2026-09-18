import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricBanner } from './MetricBanner';

const makeMetrics = (overrides = {}) => ({
  count: 7,
  limit: 20,
  streak: 8,
  trackingStreak: 12,
  spentToday: 4.51,
  budgetLeftToday: 0.0,
  saved: 0,
  savedLifetime: 0,
  progress: 0.35,
  lifeLost: 0,
  recovered: 0,
  hasOpenSession: true,
  ...overrides,
});

describe('MetricBanner tracking streak', () => {
  it('renders both goal streak and tracking streak', () => {
    render(<MetricBanner m={makeMetrics({ streak: 8, trackingStreak: 12 })} onEndDay={vi.fn()} />);
    expect(screen.getByText('Goal Streak')).toBeTruthy();
    expect(screen.getByText('Tracking')).toBeTruthy();
    expect(screen.getByTitle(/Consecutive days within target/)).toBeTruthy();
    expect(screen.getByTitle(/Consecutive days you recorded activity/)).toBeTruthy();
  });

  it('goal=0, tracking>0 shows both values distinctly', () => {
    render(<MetricBanner m={makeMetrics({ streak: 0, trackingStreak: 9 })} onEndDay={vi.fn()} />);
    expect(screen.getAllByText('0')[0]).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
  });

  it('uses singular "Day" for tracking streak of 1', () => {
    render(<MetricBanner m={makeMetrics({ trackingStreak: 1 })} onEndDay={vi.fn()} />);
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getAllByText('Day').length).toBeGreaterThanOrEqual(1);
  });

  it('renders long values without overflow', () => {
    render(<MetricBanner m={makeMetrics({ streak: 365, trackingStreak: 730 })} onEndDay={vi.fn()} />);
    expect(screen.getByText('365')).toBeTruthy();
    expect(screen.getByText('730')).toBeTruthy();
  });
});
