import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { Button, Card } from '../Common';
import { cn } from '../../utils/utils';
import { useDialogA11y } from '../../hooks/useDialogA11y';

/**
 * Obsidian Confirm Modal
 * Highest priority Z-index and backdrop blur to override native behaviors.
 */
export const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", danger = true }) => {
  const [busy, setBusy] = React.useState(false);
  const titleId = React.useId();
  const descId = React.useId();
  const dialogRef = useDialogA11y(isOpen, onClose, { disabled: busy });

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.resolve(onConfirm?.());
      onClose?.();
    } catch (e) {
      // Keep the modal open so the user can retry; the parent's error banner
      // (e.g. registryError from useRegistry) surfaces the failure.
      console.error('[ConfirmModal] onConfirm failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-8 isolate">
          {/* Obsidian Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { if (!busy) onClose(); }}
            className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
          />

          {/* Modal Architecture */}
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', damping: 30, stiffness: 450 }}
            className="custom-scrollbar relative w-full max-w-[400px] z-[10000] max-h-[min(92dvh,92vh)] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-0"
          >
            <Card className={cn("p-10 border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.9)] overflow-hidden bg-[#111111]", danger && "bg-red-950/20")}>
              <div className="flex flex-col items-center text-center space-y-8">
                <div className={cn(
                  "flex items-center justify-center p-5 rounded-[28px] shadow-inner border",
                  danger ? 'bg-danger/10 text-danger border-danger/20' : 'bg-accent/10 text-accent border-accent/20'
                )}>
                  <AlertCircle size={40} strokeWidth={2.5} />
                </div>

                <div className="space-y-3">
                  <h3 id={titleId} className="text-2xl font-black uppercase tracking-tight text-white leading-none">
                    {title}
                  </h3>
                  <p id={descId} className="px-4 text-xs font-bold uppercase tracking-[0.16em] text-neutral-400 leading-relaxed">
                    {message}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 w-full pt-4">
                  <Button variant="secondary" onClick={onClose} disabled={busy} className="h-14 text-xs border-white/5 shadow-none">
                    Cancel
                  </Button>
                  <Button
                    variant={danger ? 'danger' : 'primary'}
                    onClick={handleConfirm}
                    disabled={busy}
                    className="h-14 text-xs shadow-lg"
                  >
                    {confirmText}
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
