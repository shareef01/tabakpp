import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManualEntryOverlay } from './ManualEntryOverlay';

vi.mock('../../hooks/useKeyboardInset', () => ({
  useKeyboardInset: () => 0,
}));

const CONFIGS = [{ id: 'cig', name: 'Cigarettes', type: 'CIGARETTE', limit: 10 }];

const renderOverlay = (onSave) => render(
  <ManualEntryOverlay
    configs={CONFIGS}
    initialDate="2026-07-01"
    maxDate="2026-07-01"
    onClose={vi.fn()}
    onSave={onSave}
  />
);

describe('ManualEntryOverlay', () => {
  it('shows the specific tracker-cap reason when the save is rejected', async () => {
    const onClose = vi.fn();
    render(
      <ManualEntryOverlay
        configs={CONFIGS}
        initialDate="2026-07-01"
        maxDate="2026-07-01"
        onClose={onClose}
        onSave={vi.fn().mockRejectedValue(new Error('TRACKER_LIMIT'))}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/up to 8 trackers/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the generic network fallback for an unmapped failure', async () => {
    renderOverlay(vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' })));

    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
  });

  it('explains a tracker deleted while the form was open', async () => {
    renderOverlay(vi.fn().mockRejectedValue(new Error('INVALID_TRACKER')));

    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/tracker no longer exists/i);
  });
});
