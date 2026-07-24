import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus } from 'lucide-react';
import { cn } from '../../utils/utils';
import { CigaretteGauge } from '../gauges/Gauges';
import { UI } from '../Common';

/** Fire on pointer down for zero click-delay; ignore non-primary mouse buttons. */
const bindTap = (handler) => (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  handler?.();
};

/**
 * TrackerCard — compact vertical rhythm; cigarette gauge untouched.
 */
export const TrackerCard = React.memo(({ config, count = 0, onInc, onDec, index, globalSize = 'MEDIUM' }) => {
  const limit = config?.limit ?? 1;
  const remaining = Math.max(0, limit - count);
  const isLimitReached = count >= limit;
  const isOver = count > limit;
  const progress = limit > 0 ? Math.min(1, count / limit) : 0;
  const isLarge = globalSize === 'LARGE';
  const isSmall = globalSize === 'SMALL';

  const pad = isSmall ? 'p-4' : isLarge ? 'p-5 md:p-6' : 'p-4 md:p-5';
  const countClass = isSmall
    ? 'text-4xl'
    : isLarge
      ? 'text-6xl md:text-7xl'
      : 'text-5xl md:text-6xl';
  const btnClass = isSmall
    ? 'w-11 h-11'
    : isLarge
      ? 'w-14 h-14 md:w-16 md:h-16'
      : 'w-12 h-12 md:w-14 md:h-14';
  const iconPx = isSmall ? 18 : isLarge ? 24 : 20;

  const handleInc = useCallback(bindTap(() => onInc(config?.id)), [onInc, config?.id]);
  const handleDec = useCallback(bindTap(() => onDec(config?.id)), [onDec, config?.id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        UI.CARD,
        'relative flex flex-col group overflow-hidden select-none',
        pad,
        isLimitReached ? 'bg-red-950/10 border-red-500/25' : 'bg-bg-card border-white/[0.06] hover:border-white/[0.1]'
      )}
    >
      <div className="flex flex-col gap-3 w-full">
        {/* Header */}
        <div className="w-full flex items-center justify-between gap-2">
          <span className="text-[11px] md:text-xs font-black uppercase tracking-[0.16em] text-white/85 truncate">
            {config?.name || 'Registry'}
          </span>
          <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
            {limit}/day
          </span>
        </div>

        {/* Cigarette — design/animation unchanged */}
        <div className="w-full flex justify-center">
          <div className="w-full max-w-[220px]">
            <CigaretteGauge
              count={count}
              limit={limit}
              type={config?.type}
              isLarge={false}
              isLimitReached={isLimitReached}
            />
          </div>
        </div>

        {/* Count flanked by equal controls */}
        <div className="w-full flex items-center justify-center gap-4 md:gap-5 pt-0.5">
          <button
            type="button"
            onPointerDown={handleDec}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onDec?.(config?.id);
              }
            }}
            aria-label={`Decrease ${config?.name || 'counter'}`}
            className={cn(
              'rounded-full flex items-center justify-center transition-transform duration-75 active:scale-90 border aspect-square shrink-0 touch-manipulation',
              btnClass,
              isLimitReached
                ? 'bg-white/5 border-white/10 text-red-400'
                : 'bg-white/[0.04] border-white/[0.08] text-neutral-300 hover:text-white hover:bg-white/[0.08]'
            )}
          >
            <Minus size={iconPx} strokeWidth={3} />
          </button>

          <div className="flex flex-col items-center justify-center px-1 min-w-[4.5rem] md:min-w-[5.5rem] gap-1.5">
            <span
              className={cn(
                'font-black tabular-nums leading-none tracking-tighter transition-colors duration-150',
                countClass,
                isLimitReached ? 'text-danger' : 'text-white'
              )}
            >
              {count}
            </span>
            <div className="flex items-center gap-2 h-3">
              <span className={cn(
                'text-[11px] font-black uppercase tracking-[0.14em] leading-none',
                isOver ? 'text-danger' : isLimitReached ? 'text-amber-400/90' : 'text-neutral-400'
              )}>
                {isOver ? `${count - limit} over` : `${remaining} left`}
              </span>
              <div className="w-10 h-[2px] rounded-full bg-white/[0.08] overflow-hidden shrink-0">
                <div
                  className={cn('h-full rounded-full transition-all duration-200', isLimitReached ? 'bg-danger' : 'bg-accent')}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onPointerDown={handleInc}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onInc?.(config?.id);
              }
            }}
            aria-label={`Increase ${config?.name || 'counter'}`}
            className={cn(
              'rounded-full flex items-center justify-center transition-transform duration-75 active:scale-95 text-black shadow-lg aspect-square shrink-0 touch-manipulation',
              btnClass,
              isLimitReached
                ? 'bg-danger text-white shadow-danger/25'
                : 'bg-accent shadow-accent/20'
            )}
          >
            <Plus size={iconPx} strokeWidth={3.5} />
          </button>
        </div>
      </div>
    </motion.div>
  );
});
