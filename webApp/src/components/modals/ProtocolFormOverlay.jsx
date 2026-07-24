import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Activity, Cigarette, Wind } from 'lucide-react';
import { Input, UI, Button } from '../Common';
import { cn } from '../../utils/utils';
import { sanitizeString } from '../../utils/security';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { useDialogA11y } from '../../hooks/useDialogA11y';

const SELECTABLE_TYPES = [
  { id: 'CIGARETTE', label: 'Cigarette', icon: Cigarette },
  { id: 'RYO_ROLL', label: 'RYO', icon: Wind },
  { id: 'SIMPLE', label: 'Custom', icon: Activity }
];

const normalizeType = (type) => (type === 'JOINT_KING' ? 'CIGARETTE' : (type || 'CIGARETTE'));

export const ProtocolFormOverlay = ({ isOpen, onClose, onApply, title, initialData }) => {
  const keyboardInset = useKeyboardInset();
  const [name, setName] = useState(initialData?.name || '');
  const [limit, setLimit] = useState(initialData?.limit ?? 20);
  const [type, setType] = useState(normalizeType(initialData?.type));
  const [isPrimary, setIsPrimary] = useState(initialData?.isPrimaryTracked ?? true);
  const [isFinancial, setIsFinancial] = useState(initialData?.isFinanciallyTracked ?? true);
  const [pricePerUnit, setPricePerUnit] = useState(
    initialData?.pricePerUnit != null ? String(initialData.pricePerUnit) : '0.5'
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogA11y(isOpen, onClose, { disabled: saving });

  useEffect(() => {
    if (!isOpen) return;
    setName(initialData?.name || '');
    setLimit(initialData?.limit ?? 20);
    setType(normalizeType(initialData?.type));
    setIsPrimary(initialData?.isPrimaryTracked ?? true);
    setIsFinancial(initialData?.isFinanciallyTracked ?? true);
    setPricePerUnit(initialData?.pricePerUnit != null ? String(initialData.pricePerUnit) : '0.5');
    setError('');
  }, [isOpen, initialData]);

  const TYPES = SELECTABLE_TYPES;

  const handleSubmit = async (ev) => {
    ev?.preventDefault?.();
    const cleanName = sanitizeString(name);
    if (!cleanName) {
      setError('Enter a counter name.');
      return;
    }
    const parsedPrice = parseFloat(String(pricePerUnit).replace(',', '.'));
    setSaving(true);
    setError('');
    try {
      await onApply({
        name: cleanName,
        limit: parseInt(limit, 10) || 20,
        type,
        isPrimaryTracked: isPrimary,
        isFinanciallyTracked: isFinancial,
        pricePerUnit: Number.isFinite(parsedPrice) ? parsedPrice : 0.5
      });
    } catch {
      setError('Could not save counter. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-end sm:items-center justify-center p-0 sm:p-6 isolate">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
      />

      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(UI.CARD, "custom-scrollbar w-full max-w-[500px] p-8 lg:p-12 shadow-[0_0_80px_rgba(0,0,0,0.9)] relative overflow-hidden overflow-y-auto max-h-[min(92dvh,92vh)] z-[5001] bg-[#111111] rounded-b-none sm:rounded-card")}
        style={{ paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${Math.max(keyboardInset, 24)}px)` }}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Registry'}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
      >
        <div className="flex justify-between items-center mb-10">
          <div className="space-y-1">
            <h3 className={UI.LABEL}>Registry</h3>
            <span className="text-2xl font-black tracking-tighter uppercase text-white block leading-none">{title}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close counter form" className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-neutral-500 hover:text-white transition-all">
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <form className="space-y-10" onSubmit={handleSubmit}>
          <div>
            <Input label="Counter name" value={name} onChange={(value) => { setName(value); if (error) setError(''); }} isDark placeholder="e.g. Cigarettes" autoComplete="off" name="counter-name" enterKeyHint="next" aria-invalid={!!error} aria-describedby={error ? 'counter-form-error' : undefined} />
            {error && <p id="counter-form-error" role="alert" className="mt-2 text-[10px] font-bold text-rose-400">{error}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <span className={UI.LABEL}>Daily Quota</span>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className={UI.INPUT}
              inputMode="numeric"
              enterKeyHint="next"
            />
          </div>

          <div className="flex flex-col gap-5">
            <span className={UI.LABEL}>Visualization Engine</span>
            <div className="grid grid-cols-2 gap-3">
              {TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={cn(
                      "flex items-center gap-3 p-4 rounded-2xl border text-xs font-bold uppercase tracking-widest transition-all",
                      type === t.id ? "bg-accent border-accent text-black shadow-xl scale-[1.02]" : "bg-black/40 border-white/5 text-neutral-500 hover:border-white/10"
                    )}
                  >
                    <Icon size={16} strokeWidth={type === t.id ? 3 : 2} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-white/5 bg-black/40 p-5">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-xs font-black uppercase tracking-widest text-neutral-300">Primary streak tracker</span>
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-xs font-black uppercase tracking-widest text-neutral-300">Cost tracking</span>
              <input
                type="checkbox"
                checked={isFinancial}
                onChange={(e) => setIsFinancial(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
            {isFinancial && (
              <div className="flex flex-col gap-2 pt-2">
                <span className={UI.LABEL}>Unit price (€)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                  className={UI.INPUT}
                  inputMode="decimal"
                  enterKeyHint="done"
                />
              </div>
            )}
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full h-18 text-[11px] mt-4"
          >
            {saving ? 'Saving…' : 'Save counter'}
          </Button>
        </form>
      </motion.div>
    </div>
  );
};
