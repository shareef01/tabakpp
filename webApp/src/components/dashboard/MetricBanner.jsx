import React from 'react';
import { cn } from '../../utils/utils';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { Card } from '../Common';
import { Target, Zap, Activity, Wallet, Sun, Loader2 } from 'lucide-react';

const MetricColumn = ({ icon: Icon, label, value, sub, accent, warning }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-3 py-5 md:px-5 md:py-6 transition-colors duration-300 group/metric">
    <div className="flex items-center gap-1.5">
      <Icon
        size={13}
        className={cn(accent ? 'text-accent' : warning ? 'text-amber-400' : 'text-neutral-500')}
        strokeWidth={2.75}
      />
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400">
        {label}
      </span>
    </div>

    <span className={cn(
      'text-2xl md:text-3xl lg:text-[2.35rem] font-black tracking-tighter tabular-nums leading-none',
      accent ? 'text-accent' : warning ? 'text-amber-300' : 'text-white'
    )}>
      {value}
    </span>

    {sub && (
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400">
        {sub}
      </span>
    )}
  </div>
);

/**
 * MetricBanner — status strip with End Day as an integrated footer action.
 */
export const MetricBanner = React.memo(({ m, onEndDay, isEnding }) => {
  const progress = Math.min(1, Math.max(0, m.progress || 0));
  const isOver = (m.count || 0) > (m.limit || 0) && (m.limit || 0) > 0;
  const quotaPct = Math.round(progress * 100);

  return (
    <Card className="overflow-hidden bg-bg-card p-0" noPadding>
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-white/[0.05]">
        <MetricColumn
          icon={Target}
          label="Remaining"
          value={Math.max(0, (m.limit || 0) - (m.count || 0))}
          sub="Units"
          accent
        />
        <MetricColumn
          icon={Wallet}
          label="Spent Today"
          value={SmokingCalculator.formatCurrency(m.spentToday || 0)}
          sub="Resources"
          warning={(m.spentToday || 0) > 0}
        />
        <MetricColumn
          icon={Zap}
          label="Streak"
          value={`${m.streak || 0}`}
          sub={m.streak === 1 ? 'Day' : 'Days'}
        />
        <MetricColumn
          icon={Activity}
          label="Daily Quota"
          value={`${quotaPct}%`}
          sub={isOver ? 'Over Limit' : 'Load'}
          warning={isOver || progress >= 0.8}
        />
      </div>

      <div className="px-4 md:px-5 pb-3">
        <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700 ease-out',
              isOver ? 'bg-danger' : progress >= 0.8 ? 'bg-amber-400' : 'bg-accent'
            )}
            style={{ width: `${Math.min(100, quotaPct)}%` }}
          />
        </div>
      </div>

      {m.hasOpenSession && (
        <button
          type="button"
          onClick={onEndDay}
          disabled={isEnding}
          aria-label="End tracking day"
          className="group w-full h-12 flex items-center justify-center gap-2.5 border-t border-amber-500/15 bg-amber-500/[0.05] hover:bg-amber-500/[0.09] transition-colors duration-300 disabled:opacity-40"
        >
          {isEnding ? (
            <Loader2 className="animate-spin text-amber-400" size={16} />
          ) : (
            <Sun className="text-amber-400 group-hover:rotate-90 transition-transform duration-700" size={16} />
          )}
          <span className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/85">
            {isEnding ? 'Archiving…' : 'End Tracking Day'}
          </span>
        </button>
      )}
    </Card>
  );
});
