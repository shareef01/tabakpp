import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Minus, Database } from 'lucide-react';
import { UI, Button } from '../Common';
import { cn } from '../../utils/utils';
import { formatDateDisplay } from '../../utils/formatters';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { useDialogA11y } from '../../hooks/useDialogA11y';

export const EditOverlay = ({ log, configs, onClose, onSave }) => {
  const keyboardInset = useKeyboardInset();
  const [counts, setCounts] = useState(log.counts || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogA11y(true, onClose, { disabled: saving });

  const handleApply = async () => {
    if (!log?.id || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(log.id, counts);
      onClose();
    } catch (e) {
      console.error('[SYS] History override failed', e);
      setError('Could not save overrides. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const adjust = (id, delta) => {
    setCounts(prev => ({
      ...prev,
      [id]: Math.max(0, (prev[id] || 0) + delta)
    }));
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-end sm:items-center justify-center p-0 sm:p-6 isolate">
      {/* Backdrop */}
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
        className={cn(UI.CARD, "custom-scrollbar w-full max-w-[500px] p-8 lg:p-12 shadow-[0_0_80px_rgba(0,0,0,0.9)] relative overflow-hidden overflow-y-auto max-h-[min(92dvh,92vh)] z-[5001] bg-[#111111] rounded-b-none sm:rounded-card")}
        style={{ paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${Math.max(keyboardInset, 24)}px)` }}
        role="dialog"
        aria-modal="true"
        aria-label="History override"
      >
        <div className="flex justify-between items-center mb-10">
          <div className="space-y-1">
            <h3 className={UI.LABEL}>History Override</h3>
            <span className="text-2xl font-black tracking-tighter uppercase text-white block leading-none">
              {formatDateDisplay(log.logDate)}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close history editor" className="min-w-11 min-h-11 w-11 h-11 rounded-2xl bg-white/5 flex items-center justify-center text-neutral-500 hover:text-white transition-all touch-manipulation">
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <div className="space-y-4 max-h-[min(40vh,40dvh)] overflow-y-auto pr-2 custom-scrollbar">
          {configs.map(c => (
            <div key={c.id} className="flex items-center justify-between p-5 bg-black/40 border border-white/5 rounded-2xl hover:border-white/10 transition-colors">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-white uppercase tracking-wider">{c.name}</span>
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Protocol {c.id.slice(0,4)}</span>
              </div>
              <div className="flex items-center gap-3 bg-black/60 p-1.5 rounded-xl border border-white/5 shadow-inner">
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
            disabled={saving}
            className="w-full h-18 text-[11px]"
          >
            <Database size={16} className="mr-3" strokeWidth={3} />
            {saving ? 'Committing…' : 'Commit Overrides'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
