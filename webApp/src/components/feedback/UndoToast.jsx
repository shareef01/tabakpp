import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Undo2, Loader2 } from 'lucide-react';
import { cn } from '../../utils/utils';

export const UNDO_TOAST_MS = 5000;

/**
 * Bottom undo snackbar — countdown strip, message + detail, dedicated Undo CTA.
 * Remount via `toastKey` when the actionable event refreshes so the timer resets.
 */
export const UndoToast = ({
  open,
  toastKey,
  message,
  detail,
  undoLabel = 'Undo',
  duration = UNDO_TOAST_MS,
  onUndo,
  onDismiss,
  className,
}) => {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      return undefined;
    }
    const id = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(id);
  }, [open, toastKey, duration, onDismiss]);

  const handleUndo = useCallback(async () => {
    if (busy || !onUndo) return;
    setBusy(true);
    try {
      await onUndo();
    } catch {
      setBusy(false);
    }
  }, [busy, onUndo]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key={toastKey || 'undo-toast'}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className={cn(
            'fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-1/2 z-[4000] -translate-x-1/2',
            'w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl',
            'bg-[#121214]/95 border border-white/[0.1] shadow-[0_24px_60px_rgba(0,0,0,0.75)]',
            'backdrop-blur-xl ring-1 ring-white/[0.04]',
            className
          )}
        >
          {/* Countdown */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-white/[0.06]">
            <motion.div
              key={`bar-${toastKey}`}
              className="h-full origin-left bg-accent"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: duration / 1000, ease: 'linear' }}
            />
          </div>

          <div className="flex items-center gap-3 px-3.5 py-3 pt-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 ring-1 ring-inset ring-accent/25">
              <Undo2 size={16} className="text-accent" strokeWidth={2.75} aria-hidden />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold tracking-tight text-white leading-snug truncate">
                {message}
              </p>
              {detail ? (
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 truncate">
                  {detail}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={handleUndo}
              disabled={busy}
              className={cn(
                'shrink-0 h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.18em]',
                'bg-white text-black hover:bg-neutral-100 active:scale-95',
                'transition-all duration-150 touch-manipulation',
                'disabled:opacity-50 disabled:pointer-events-none',
                'inline-flex items-center justify-center gap-1.5 min-w-[4.5rem]'
              )}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" strokeWidth={2.5} aria-hidden />
              ) : (
                undoLabel
              )}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
