import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProtocolFormOverlay } from './ProtocolFormOverlay';

vi.mock('../../hooks/useKeyboardInset', () => ({
  useKeyboardInset: () => 0,
}));

describe('ProtocolFormOverlay accessibility', () => {
  // Regression: these were <span> labels with no htmlFor, so a screen reader
  // announced both fields as an unnamed edit box.
  it('associates a real label with every field', () => {
    render(<ProtocolFormOverlay isOpen onClose={vi.fn()} onApply={vi.fn()} title="Create Counter" />);
    expect(screen.getByLabelText(/counter name/i)).toBeTruthy();
    expect(screen.getByLabelText(/daily quota/i)).toBeTruthy();
    expect(screen.getByLabelText(/unit price/i)).toBeTruthy();
  });
});

describe('ProtocolFormOverlay', () => {
  it('shows inline validation for blank counter names', async () => {
    const onApply = vi.fn();
    render(
      <ProtocolFormOverlay
        isOpen
        onClose={vi.fn()}
        onApply={onApply}
        title="Create Counter"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /save|create|deploy|apply/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a counter name/i);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('exposes dialog semantics and close control', () => {
    render(
      <ProtocolFormOverlay
        isOpen
        onClose={vi.fn()}
        onApply={vi.fn()}
        title="Create Counter"
      />
    );

    expect(screen.getByRole('dialog', { name: /create counter/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close counter form/i })).toBeInTheDocument();
  });

  it('offers cigarette, RYO, and custom only', () => {
    render(
      <ProtocolFormOverlay
        isOpen
        onClose={vi.fn()}
        onApply={vi.fn()}
        title="Create Counter"
      />
    );

    expect(screen.getByText('Cigarette')).toBeInTheDocument();
    expect(screen.getByText('RYO')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.queryByText('Joint')).not.toBeInTheDocument();
  });

  it('preserves a deliberate zero daily quota on save', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <ProtocolFormOverlay
        isOpen
        onClose={vi.fn()}
        onApply={onApply}
        title="Create Counter"
        initialData={{ name: 'Abstain', limit: 0 }}
      />
    );

    fireEvent.change(screen.getByLabelText(/daily quota/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save counter/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ limit: 0 }));
  });
});
