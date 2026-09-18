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

  it('renders daily goal status — under target', () => {
    const m = makeMetrics({
      count: 7, limit: 10,
      goalStatus: { status: 'under', belowTarget: 3, aboveTarget: 0, overTrackers: 0, atTrackers: 0, underTrackers: 1, totalTrackers: 1 },
    });
    render(<MetricBanner m={m} onEndDay={vi.fn()} />);
    expect(screen.getByText("TODAY'S GOAL")).toBeTruthy();
    expect(screen.getByText("Within today's targets")).toBeTruthy();
  });

  it('renders daily goal status — at target', () => {
    const m = makeMetrics({
      count: 10, limit: 10,
      goalStatus: { status: 'at', belowTarget: 0, aboveTarget: 0, overTrackers: 0, atTrackers: 1, underTrackers: 0, totalTrackers: 1 },
    });
    render(<MetricBanner m={m} onEndDay={vi.fn()} />);
    // "Within today's targets" appears in the goal column AND the daily-use sub-label
    expect(screen.getAllByText("Within today's targets").length).toBeGreaterThanOrEqual(1);
  });

  it('renders daily goal status — over target', () => {
    const m = makeMetrics({
      count: 12, limit: 10,
      goalStatus: { status: 'over', belowTarget: 0, aboveTarget: 2, overTrackers: 1, atTrackers: 0, underTrackers: 0, totalTrackers: 1 },
    });
    render(<MetricBanner m={m} onEndDay={vi.fn()} />);
    expect(screen.getByText('1 tracker above target')).toBeTruthy();
  });

  it('renders daily goal status — multiple trackers over', () => {
    const m = makeMetrics({
      count: 12, limit: 10,
      goalStatus: { status: 'over', belowTarget: 0, aboveTarget: 5, overTrackers: 3, atTrackers: 0, underTrackers: 0, totalTrackers: 3 },
    });
    render(<MetricBanner m={m} onEndDay={vi.fn()} />);
    expect(screen.getByText('3 trackers above target')).toBeTruthy();
  });

  it('renders no-target fallback when goalStatus is null', () => {
    render(<MetricBanner m={makeMetrics({ goalStatus: null })} onEndDay={vi.fn()} />);
    expect(screen.getByText('No target')).toBeTruthy();
  });
});
