import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Activity, Cigarette, Wind } from 'lucide-react';
import { Input, UI, Button } from '../Common';
import { cn } from '../../utils/utils';
import { sanitizeTrackerName, MAX_TRACKER_NAME } from '../../utils/security';
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
  // Baseline (item 3): optional reference consumption used only for
  // reduction/savings math — never conflated with the target above. Blank by
  // default ("just track for now"); onboarding is not blocked on it.
  const [hasBaseline, setHasBaseline] = useState(initialData?.baseline != null);
  const [baseline, setBaseline] = useState(
    initialData?.baseline != null ? String(initialData.baseline) : ''
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
    setHasBaseline(initialData?.baseline != null);
    setBaseline(initialData?.baseline != null ? String(initialData.baseline) : '');
    setError('');
  }, [isOpen, initialData]);

  const TYPES = SELECTABLE_TYPES;

  const handleSubmit = async (ev) => {
    ev?.preventDefault?.();
    const cleanName = sanitizeTrackerName(name);
    if (!cleanName) {
      setError('Enter a counter name.');
      return;
    }
    // `parseInt(x) || 20` turned a deliberate limit of 0 into 20, because 0 is
    // falsy. Fall back only when the field is genuinely unparseable.
    const parsedLimit = parseInt(limit, 10);
    const parsedPrice = parseFloat(String(pricePerUnit).replace(',', '.'));
    const parsedBaseline = hasBaseline ? parseInt(baseline, 10) : null;
    setSaving(true);
    setError('');
    try {
      await onApply({
        name: cleanName,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
        type,
        isPrimaryTracked: isPrimary,
        isFinanciallyTracked: isFinancial,
        pricePerUnit: Number.isFinite(parsedPrice) ? parsedPrice : 0.5,
        baseline: hasBaseline && Number.isFinite(parsedBaseline) ? parsedBaseline : null
      });
    } catch {
      setError('Could not save counter. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-5000 flex items-end sm:items-center justify-center p-0 sm:p-6 isolate">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => { if (!saving) onClose(); }}
        className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
      />

      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(UI.CARD, "custom-scrollbar w-full max-w-[500px] p-8 lg:p-12 shadow-[0_0_80px_rgba(0,0,0,0.9)] relative overflow-hidden overflow-y-auto max-h-[min(92dvh,92vh)] z-5001 bg-[#111111] rounded-b-none sm:rounded-card")}
        style={{ paddingBottom: `max(2rem, env(safe-area-inset-bottom), ${Math.max(keyboardInset, 24)}px)` }}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Registry'}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
      >
        <div className="flex justify-between items-center mb-8">
          <div className="space-y-1">
            <h3 className={cn(UI.LABEL, "mb-0 ml-0")}>Counter Details</h3>
            <span className="text-2xl font-black tracking-tight text-white block leading-none">{title}</span>
          </div>
          <button
            type="button"
            onClick={() => { if (!saving) onClose(); }}
            aria-label="Close counter form"
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-accent",
              saving && "opacity-50 pointer-events-none"
            )}
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <form className="space-y-7" onSubmit={handleSubmit}>
          <div>
            <Input
              label="Counter name"
              value={name}
              onChange={(value) => { setName(value); if (error) setError(''); }}
              isDark
              placeholder="e.g. Cigarettes"
              autoComplete="off"
              name="counter-name"
              maxLength={MAX_TRACKER_NAME}
              enterKeyHint="next"
              aria-invalid={!!error}
              aria-describedby={error ? 'counter-form-error' : undefined}
            />
            {error && <p id="counter-form-error" role="alert" className="mt-2 text-xs font-bold text-rose-400">{error}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="counter-limit" className={cn(UI.LABEL, "mb-0 ml-0")}>
              Daily quota (target)
            </label>
            <input
              id="counter-limit"
              type="number"
              min="0"
              max="10000"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className={UI.INPUT}
              inputMode="numeric"
              enterKeyHint="next"
            />
            <span className="text-[11px] text-neutral-400 font-normal ml-1">
              Maximum units you aim to stay under each day (0 = zero-target).
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <span id="counter-type-label" className={cn(UI.LABEL, "mb-0 ml-0")}>Counter Display Style</span>
            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-labelledby="counter-type-label">
              {TYPES.map(t => {
                const Icon = t.icon;
                const selected = type === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setType(t.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-3.5 rounded-2xl border text-xs font-bold transition-all outline-hidden",
                      "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                      selected
                        ? "bg-accent border-accent text-black shadow-lg scale-[1.02]"
                        : "bg-black/40 border-white/10 text-neutral-300 hover:border-white/20 hover:text-white"
                    )}
                  >
                    <Icon size={18} strokeWidth={selected ? 2.5 : 2} />
                    <span className="leading-none">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ADVANCED TRACKING OPTIONS */}
          <div className="pt-2 space-y-4">
            <span className={cn(UI.LABEL, "mb-0 ml-0")}>Advanced Options</span>

            {/* Baseline Reduction */}
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-4.5">
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-neutral-200">Track reduction vs baseline</span>
                  <span className="text-[11px] text-neutral-400 leading-snug">
                    Optional reference consumption from before you started cutting back.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={hasBaseline}
                  onChange={(e) => setHasBaseline(e.target.checked)}
                  aria-label="Set a baseline to track reduction"
                  className="h-5 w-5 shrink-0 accent-(--accent) rounded cursor-pointer"
                />
              </label>
              {hasBaseline && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.06]">
                  <label htmlFor="counter-baseline" className={cn(UI.LABEL, "mb-0 ml-0")}>Baseline (before cutback)</label>
                  <input
                    id="counter-baseline"
                    type="number"
                    min="0"
                    max="10000"
                    value={baseline}
                    onChange={(e) => setBaseline(e.target.value)}
                    placeholder="e.g. 20"
                    className={UI.INPUT}
                    inputMode="numeric"
                    enterKeyHint="next"
                  />
                </div>
              )}
            </div>

            {/* Streak & Cost settings */}
            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/40 p-4.5">
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-neutral-200">Include in goal streak</span>
                  <span className="text-[11px] text-neutral-400 leading-snug">
                    Counts toward your daily streak when kept within target.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-(--accent) rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between gap-4 cursor-pointer pt-3 border-t border-white/[0.06]">
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-neutral-200">Track cost for this counter</span>
                  <span className="text-[11px] text-neutral-400 leading-snug">
                    Calculate spend and savings based on cost per unit.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={isFinancial}
                  onChange={(e) => setIsFinancial(e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-(--accent) rounded cursor-pointer"
                />
              </label>

              {isFinancial && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.06]">
                  <label htmlFor="counter-price" className={cn(UI.LABEL, "mb-0 ml-0")}>Unit price (€)</label>
                  <input
                    id="counter-price"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1000"
                    value={pricePerUnit}
                    onChange={(e) => setPricePerUnit(e.target.value)}
                    className={UI.INPUT}
                    inputMode="decimal"
                    enterKeyHint="done"
                  />
                </div>
              )}
            </div>
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full h-15 text-xs font-bold uppercase tracking-wider mt-4"
          >
            {saving ? 'Saving…' : 'Save counter'}
          </Button>
        </form>
      </motion.div>
    </div>
  );
};
