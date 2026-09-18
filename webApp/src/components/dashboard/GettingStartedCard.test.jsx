import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GettingStartedCard } from './GettingStartedCard';

const makeState = (overrides = {}) => ({
  hasTracker: true,
  hasTrackingEvidence: false,
  ...overrides,
});

describe('GettingStartedCard', () => {
  it('renders when no tracking evidence exists', () => {
    render(<GettingStartedCard onboarding={makeState()} />);
    expect(screen.getByText('GETTING STARTED')).toBeInTheDocument();
    expect(screen.getByText('Tracker created')).toBeInTheDocument();
    expect(screen.getByText('Daily target set')).toBeInTheDocument();
    expect(screen.getByText('Record your first activity')).toBeInTheDocument();
  });

  it('returns null when tracking evidence exists', () => {
    const { container } = render(<GettingStartedCard onboarding={makeState({ hasTrackingEvidence: true })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders checklist items when hasTracker is false', () => {
    render(<GettingStartedCard onboarding={makeState({ hasTracker: false })} />);
    expect(screen.getByText('GETTING STARTED')).toBeInTheDocument();
    expect(screen.getByText('Tracker created')).toBeInTheDocument();
    expect(screen.getByText('Record your first activity')).toBeInTheDocument();
  });

  it('shows no dismiss button', () => {
    render(<GettingStartedCard onboarding={makeState()} />);
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
  });
});
