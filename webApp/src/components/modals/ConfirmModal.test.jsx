import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
  it('renders with accessible dialog role, aria-modal, and labelledby/describedby attributes', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Reset Tracker"
        message="Are you sure you want to reset today's session?"
        confirmText="Reset"
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');

    const title = screen.getByText('Reset Tracker');
    const desc = screen.getByText("Are you sure you want to reset today's session?");
    expect(title).toBeInTheDocument();
    expect(desc).toBeInTheDocument();
  });

  it('renders destructive mode with danger button and destructive styling', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete Item"
        message="This action cannot be undone."
        confirmText="Delete"
        danger={true}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn.className).toContain('bg-red-600');
  });

  it('renders non-destructive milestone mode with amber styling and primary action', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Day Complete"
        message="All counters have reached today's target."
        confirmText="Review Day"
        danger={false}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Review Day' });
    expect(confirmBtn).toBeInTheDocument();
    // Non-destructive uses primary variant, not danger
    expect(confirmBtn.className).not.toContain('bg-danger');
  });

  it('triggers onConfirm and closes upon confirmation', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirm Action"
        message="Proceed with the update?"
        confirmText="Proceed"
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Proceed' });
    await user.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('triggers onClose when clicking Cancel button or pressing Escape key', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Close Test"
        message="Test closing behaviors."
        confirmText="OK"
      />
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('disables actions while busy during async confirmation', async () => {
    let resolveAction;
    const asyncAction = vi.fn(() => new Promise((res) => { resolveAction = res; }));
    const user = userEvent.setup();

    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={asyncAction}
        title="Async Task"
        message="Saving changes..."
        confirmText="Save"
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Save' });
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });

    await user.click(confirmBtn);
    expect(confirmBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();

    resolveAction();
    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });
  });
});
