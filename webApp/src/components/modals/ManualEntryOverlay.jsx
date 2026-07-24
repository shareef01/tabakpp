import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Minus, Database } from 'lucide-react';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { UI, Button, Input } from '../Common';
import { cn } from '../../utils/utils';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { useDialogA11y } from '../../hooks/useDialogA11y';

/**
 * Manual historical backfill — Android ManualEntryForm parity.
 */
export const ManualEntryOverlay = ({ configs, initialDate = '', onClose, onSave }) => {
  const keyboardInset = useKeyboardInset();
  const [date, setDate] = useState(initialDate);
  const [counts, setCounts] = useState(() =>
    Object.fromEntries((configs || []).map((c) => [c.id, 0]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogA11y(true, onClose, { disabled: saving });

  const isDateValid = SmokingCalculator.isValidDate(date);

  const adjust = (id, delta) => {
    setCounts((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta)
    }));
  };

  const handleApply = async () => {
    if (!isDateValid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(date, counts);
      onClose();
    } catch (e) {
      console.error('[SYS] Manual entry failed', e);
      setError('Could not log entry. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-end sm:items-center justify-center p-0 sm:p-6 isolate">
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={cn(UI.CARD, "custom-scrollbar w-full max-w-[500px] p-8 lg:p-12 shadow-[0_0_80px_rgba(0,0,0,0.9)] relative overflow-hidden z-[5001] bg-[#111111] max-h-[min(92dvh,92vh)] overflow-y-auto rounded-b-none sm:rounded-card")}
        style={{ paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${Math.max(keyboardInset, 24)}px)` }}
        role="dialog"
        aria-modal="true"
        aria-label="Historical entry"
      >
        <div className="flex justify-between items-center mb-10">
          <div className="space-y-1">
            <h3 className={UI.LABEL}>Historical Entry</h3>
            <span className="text-2xl font-black tracking-tighter uppercase text-white block leading-none">
              Backfill Log
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close historical entry form" className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-neutral-500 hover:text-white transition-all">
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <div className="mb-8">
          <Input
            label="Deployment Timestamp"
            type="date"
            value={date}
            onChange={setDate}
            isDark
            autoComplete="off"
            enterKeyHint="done"
          />
          {date && !isDateValid && (
            <span className="mt-2 ml-1 block text-[11px] font-black uppercase tracking-widest text-rose-500">
              Invalid date — use YYYY-MM-DD
            </span>
          )}
        </div>

        <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
          {(configs || []).map((c) => (
            <div key={c.id} className="flex items-center justify-between p-5 bg-black/40 border border-white/5 rounded-2xl hover:border-white/10 transition-colors">
              <span className="text-xs font-bold text-white uppercase tracking-wider">{c.name}</span>
              <div className="flex items-center gap-4 bg-black/60 p-1.5 rounded-xl border border-white/5 shadow-inner">
                <button
                  type="button"
                  onClick={() => adjust(c.id, -1)}
                  aria-label={`Decrease ${c.name}`}
                  className="min-w-11 min-h-11 w-11 h-11 rounded-lg bg-neutral-900/50 flex items-center justify-center text-neutral-500 hover:text-white transition-all active:scale-90 touch-manipulation"
                >
                  <Minus size={16} strokeWidth={3} />
                </button>
                <span className="text-xl font-black tabular-nums text-white w-10 text-center">
                  {counts[c.id] || 0}
                </span>
                <button
                  type="button"
                  onClick={() => adjust(c.id, 1)}
                  aria-label={`Increase ${c.name}`}
                  className="min-w-11 min-h-11 w-11 h-11 rounded-lg bg-accent text-black flex items-center justify-center transition-all active:scale-90 touch-manipulation"
                >
                  <Plus size={16} strokeWidth={4} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 space-y-4">
          {error ? (
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-400 text-center leading-relaxed">
              {error}
            </p>
          ) : null}
          <Button
            onClick={handleApply}
            disabled={!isDateValid || saving}
            className="w-full h-18 text-[11px]"
          >
            <Database size={16} className="mr-3" strokeWidth={3} />
            {saving ? 'Logging…' : 'Log Entry'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
