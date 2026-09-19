import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Loader2 } from 'lucide-react';
import { cn } from '../../utils/utils';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { CigaretteGauge } from '../gauges/Gauges';
import { UI } from '../Common';

/**
 * Three-state visual language for limit status (item 5). "At target" and
 * "over target" must never look identical — amber (already this app's
 * "approaching/at capacity" color, see MetricBanner's 80%-quota warning) is
 * reserved for exactly-at, red/danger only for genuinely over.
 */
const TONE = {
  under: {
    card: 'bg-bg-card border-white/[0.06] hover:border-white/[0.1]',
    count: 'text-white',
    label: 'text-neutral-400',
    bar: 'bg-accent',
    dec: 'bg-white/[0.04] border-white/[0.08] text-neutral-300 hover:text-white hover:bg-white/[0.08]',
    inc: 'bg-accent shadow-[0_6px_16px_-4px_rgba(var(--accent-rgb),0.35)]',
  },
  at: {
    card: 'bg-amber-950/10 border-amber-500/25',
    count: 'text-amber-300',
    label: 'text-amber-400/90',
    bar: 'bg-amber-400',
    dec: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    inc: 'bg-amber-500 text-black shadow-[0_6px_16px_-4px_rgba(245,158,11,0.4)]',
  },
  over: {
    card: 'bg-red-950/10 border-red-500/25',
    count: 'text-danger',
    label: 'text-danger',
    bar: 'bg-danger',
    dec: 'bg-white/5 border-white/10 text-red-400',
    inc: 'bg-danger text-white shadow-[0_6px_16px_-4px_rgba(255,17,17,0.45)]',
  },
};

/**
 * TrackerCard — count-first composition; gauge scales with density.
 *
 * Tap handling is plain `onClick` (item 9). This used to also bind
 * `onPointerDown` for a perceived latency win, firing the increment before
 * the browser could tell a tap from the start of a scroll or drag — a real
 * risk of accidental increments on a touch device, for a speedup that
 * `touch-manipulation` (below) already makes unnecessary: it removes the
 * legacy double-tap-zoom delay, so plain `click` fires immediately on touch
 * with no perceptible lag. `<button onClick>` keeps keyboard (Enter/Space)
 * and assistive-tech activation (Switch Access, screen readers dispatch a
 * synthetic `click`) working exactly as before, with less code.
 */
export const TrackerCard = React.memo(({ config, count = 0, onInc, onDec, index, globalSize = 'MEDIUM', isPending = false }) => {
  const limit = Math.max(0, config?.limit ?? 1);
  const baseline = config?.baseline;
  const { status, aboveTarget, belowTarget } = SmokingCalculator.getLimitStatus(count, limit);
  // A target of 0 has no meaningful percentage denominator (item 4) — show
  // an empty bar while still on target, a full one once over.
  const progress = limit > 0 ? Math.min(1, count / limit) : (status === 'under' ? 0 : 1);
  const reduction = SmokingCalculator.getReduction(count, baseline);
  const density = UI.DENSITY[globalSize] || UI.DENSITY.MEDIUM;
  const tone = TONE[status] || TONE.under;

  const incAction = useCallback(() => onInc?.(config?.id), [onInc, config?.id]);
  const decAction = useCallback(() => onDec?.(config?.id), [onDec, config?.id]);

  const statusLabel = status === 'over' ? `${aboveTarget} above target` : status === 'at' ? 'Limit reached' : `${belowTarget} left`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      className={cn(UI.CARD, 'relative flex flex-col group overflow-hidden select-none', density.pad, tone.card)}
    >
      {/*
        Counting is the app's main action, so the result has to be spoken.
        The visible number alone is silent to a screen reader — the user taps
        and hears nothing until they navigate back to it manually.
      */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {`${config?.name || 'Counter'}: ${count} of ${limit}, ${statusLabel}`}
      </span>

      <div className={cn('flex flex-col w-full', density.stack)}>
        <div className="w-full flex items-center justify-between gap-2">
          <span className="text-[11px] md:text-xs font-black uppercase tracking-[0.16em] text-white/85 truncate">
            {config?.name || 'Tracker'}
          </span>
          <div className="shrink-0 flex items-center gap-1">
            {isPending && (
              <Loader2 size={12} className="animate-spin text-accent" strokeWidth={2.5} aria-label="Syncing…" />
            )}
            <span className="text-[10px] md:text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
              {limit}/day
            </span>
          </div>
        </div>

        <div className="w-full flex justify-center">
          <div className={cn('w-full', density.gaugeMax)}>
            <CigaretteGauge
              count={count}
              limit={limit}
              type={config?.type}
              size={density.gauge}
              isLimitReached={status !== 'under'}
            />
          </div>
        </div>

        <div className={cn('w-full flex items-center justify-center', density.controlGap)}>
          <button
            type="button"
            onClick={decAction}
            aria-label={`Decrease ${config?.name || 'counter'}`}
            className={cn(
              'rounded-full flex items-center justify-center transition-transform duration-75 active:scale-90 border box-border aspect-square shrink-0 touch-manipulation',
              density.btn,
              tone.dec
            )}
          >
            <Minus size={density.icon} strokeWidth={3} />
          </button>

          <div className="flex flex-col items-center justify-center px-0.5 min-w-[4.25rem] md:min-w-[5rem] gap-1">
            <span className={cn('font-black tabular-nums leading-none tracking-tighter transition-colors duration-150', density.count, tone.count)}>
              {count}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn('text-[10px] md:text-[11px] font-black uppercase tracking-[0.14em] leading-none', tone.label)}>
                {statusLabel}
              </span>
              <div className="w-8 md:w-10 h-[2px] rounded-full bg-white/[0.08] overflow-hidden shrink-0">
                <div
                  className={cn('h-full rounded-full transition-all duration-200', tone.bar)}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
            {reduction && (
              <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-accent/80 leading-none">
                {reduction.avoided} under baseline
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={incAction}
            aria-label={`Increase ${config?.name || 'counter'}`}
            className={cn(
              'rounded-full flex items-center justify-center transition-transform duration-75 active:scale-95 box-border aspect-square shrink-0 touch-manipulation',
              density.btn,
              tone.inc,
              status === 'under' ? 'text-black' : status === 'at' ? 'text-black' : 'text-white'
            )}
          >
            <Plus size={density.icon} strokeWidth={3.5} />
          </button>
        </div>
      </div>
    </motion.div>
  );
});
