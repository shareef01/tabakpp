import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Shared modal contract: lock document scroll, close on Escape, trap focus,
 * and restore focus to the control that opened the dialog.
 */
export const useDialogA11y = (isOpen, onClose, { disabled = false } = {}) => {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarGap > 0) document.body.style.paddingRight = `${scrollbarGap}px`;

    const focusInitial = () => {
      const dialog = dialogRef.current;
      const target = dialog?.querySelector('[data-autofocus], input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (target || dialog)?.focus?.();
    };
    const frame = window.requestAnimationFrame(focusInitial);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !disabled) {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      const items = [...(dialog?.querySelectorAll(FOCUSABLE) || [])];
      if (!items.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      previousFocus?.focus?.();
    };
  }, [isOpen, disabled]);

  return dialogRef;
};
