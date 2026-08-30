import React, { useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus } from 'lucide-react';
import { cn } from '../../utils/utils';
import { CigaretteGauge } from '../gauges/Gauges';
import { UI } from '../Common';

/** Ignore a real tap's trailing click for this long (ms). */
const CLICK_SUPPRESS_MS = 700;

/**
 * Fire on pointer down for zero click-delay, but keep a real `onClick` too.
 *
 * Screen readers, Switch Access and Voice Control activate a button by
 * dispatching a synthetic `click` — they never produce a `pointerdown`. With a
 * pointer-only binding the button was focusable and correctly labelled but did
 * nothing when activated, making the app's primary action unusable with
 * assistive tech. The timestamp guard stops a genuine tap counting twice, since
 * cancelling `pointerdown` suppresses compatibility mouse events but not `click`.
 */
const useTapHandlers = (handler) => {
  const lastPointerAt = useRef(0);
  return useMemo(() => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      lastPointerAt.current = Date.now();
      e.preventDefault();
      handler?.();
    },
    onClick: () => {
      if (Date.now() - lastPointerAt.current < CLICK_SUPPRESS_MS) return;
      handler?.();
    },
  }), [handler]);
};

/**
 * TrackerCard — count-first composition; gauge scales with density.
 */
export const TrackerCard = React.memo(({ config, count = 0, onInc, onDec, index, globalSize = 'MEDIUM' }) => {
  const limit = config?.limit ?? 1;
  const remaining = Math.max(0, limit - count);
  const isLimitReached = count >= limit && limit > 0;
  const isOver = count > limit && limit > 0;
  const progress = limit > 0 ? Math.min(1, count / limit) : 0;
  const density = UI.DENSITY[globalSize] || UI.DENSITY.MEDIUM;

  const incAction = useCallback(() => onInc?.(config?.id), [onInc, config?.id]);
  const decAction = useCallback(() => onDec?.(config?.id), [onDec, config?.id]);
  const incHandlers = useTapHandlers(incAction);
  const decHandlers = useTapHandlers(decAction);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        UI.CARD,
        'relative flex flex-col group overflow-hidden select-none',
        density.pad,
        isLimitReached ? 'bg-red-950/10 border-red-500/25' : 'bg-bg-card border-white/[0.06] hover:border-white/[0.1]'
      )}
    >
      {/*
        Counting is the app's main action, so the result has to be spoken.
        The visible number alone is silent to a screen reader — the user taps
        and hears nothing until they navigate back to it manually.
      */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {`${config?.name || 'Counter'}: ${count} of ${limit}, ${
          isOver ? `${count - limit} over limit` : `${remaining} left`
        }`}
      </span>

      <div className={cn('flex flex-col w-full', density.stack)}>
        <div className="w-full flex items-center justify-between gap-2">
          <span className="text-[11px] md:text-xs font-black uppercase tracking-[0.16em] text-white/85 truncate">
            {config?.name || 'Registry'}
          </span>
          <span className="shrink-0 text-[10px] md:text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
            {limit}/day
          </span>
        </div>

        <div className="w-full flex justify-center">
          <div className={cn('w-full', density.gaugeMax)}>
            <CigaretteGauge
              count={count}
              limit={limit}
              type={config?.type}
              size={density.gauge}
              isLimitReached={isLimitReached}
            />
          </div>
        </div>

        <div className={cn('w-full flex items-center justify-center', density.controlGap)}>
          <button
            type="button"
            {...decHandlers}
            aria-label={`Decrease ${config?.name || 'counter'}`}
            className={cn(
              'rounded-full flex items-center justify-center transition-transform duration-75 active:scale-90 border box-border aspect-square shrink-0 touch-manipulation',
              density.btn,
              isLimitReached
                ? 'bg-white/5 border-white/10 text-red-400'
                : 'bg-white/[0.04] border-white/[0.08] text-neutral-300 hover:text-white hover:bg-white/[0.08]'
            )}
          >
            <Minus size={density.icon} strokeWidth={3} />
          </button>

          <div className="flex flex-col items-center justify-center px-0.5 min-w-[4.25rem] md:min-w-[5rem] gap-1">
            <span
              className={cn(
                'font-black tabular-nums leading-none tracking-tighter transition-colors duration-150',
                density.count,
                isLimitReached ? 'text-danger' : 'text-white'
              )}
            >
              {count}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'text-[10px] md:text-[11px] font-black uppercase tracking-[0.14em] leading-none',
                isOver ? 'text-danger' : isLimitReached ? 'text-amber-400/90' : 'text-neutral-400'
              )}>
                {isOver ? `${count - limit} over` : `${remaining} left`}
              </span>
              <div className="w-8 md:w-10 h-[2px] rounded-full bg-white/[0.08] overflow-hidden shrink-0">
                <div
                  className={cn('h-full rounded-full transition-all duration-200', isLimitReached ? 'bg-danger' : 'bg-accent')}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            {...incHandlers}
            aria-label={`Increase ${config?.name || 'counter'}`}
            className={cn(
              'rounded-full flex items-center justify-center transition-transform duration-75 active:scale-95 text-black box-border aspect-square shrink-0 touch-manipulation',
              density.btn,
              isLimitReached
                ? 'bg-danger text-white shadow-[0_6px_16px_-4px_rgba(255,17,17,0.45)]'
                : 'bg-accent shadow-[0_6px_16px_-4px_rgba(var(--accent-rgb),0.35)]'
            )}
          >
            <Plus size={density.icon} strokeWidth={3.5} />
          </button>
        </div>
      </div>
    </motion.div>
  );
});
