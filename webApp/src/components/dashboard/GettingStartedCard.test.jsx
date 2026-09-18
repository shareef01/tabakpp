import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GettingStartedCard } from './GettingStartedCard';

const makeState = (overrides = {}) => ({
  stage: 1,
  hasTracker: true,
  hasTrackingEvidence: false,
  hasHistory: false,
  hasCompletedDay: false,
  ...overrides,
});

describe('GettingStartedCard', () => {
  it('renders checklist for stage 1 (no evidence)', () => {
    render(<GettingStartedCard onboarding={makeState({ stage: 1, hasTracker: true })} />);
    expect(screen.getByText('GETTING STARTED')).toBeTruthy();
    expect(screen.getByText('Tracker created')).toBeTruthy();
    expect(screen.getByText('Daily target set')).toBeTruthy();
    expect(screen.getByText('Record your first activity')).toBeTruthy();
  });

  it('renders hint about target', () => {
    render(<GettingStartedCard onboarding={makeState()} />);
    expect(screen.getByText(/Your target is the daily level you want to stay at or below/)).toBeTruthy();
  });

  it('fires onDismiss when X clicked', () => {
    const onDismiss = vi.fn();
    render(<GettingStartedCard onboarding={makeState()} onDismiss={onDismiss} />);
    const dismissBtn = screen.getByLabelText('Dismiss getting started');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('returns null when tracking evidence exists', () => {
    const { container } = render(<GettingStartedCard onboarding={makeState({ hasTrackingEvidence: true })} />);
    expect(container.innerHTML).toBe('');
  });
});
