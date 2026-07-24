import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDialogA11y } from './useDialogA11y';

describe('useDialogA11y', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    document.body.innerHTML = '<button id="trigger">Open</button>';
  });

  afterEach(() => {
    document.body.style.overflow = '';
    document.body.innerHTML = '';
  });

  it('locks body scroll while open and restores on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useDialogA11y(true, onClose));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape when enabled', () => {
    const onClose = vi.fn();
    renderHook(() => useDialogA11y(true, onClose));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when disabled', () => {
    const onClose = vi.fn();
    renderHook(() => useDialogA11y(true, onClose, { disabled: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
