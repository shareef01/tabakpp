import React from 'react';
import { cn } from '../../utils/utils';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { Card } from '../Common';
import { Target, Zap, Activity, Wallet, Award, TrendingUp, Sun, Loader2 } from 'lucide-react';

const MetricColumn = ({ icon: Icon, label, value, sub, accent, warning, className, title }) => (
  <div title={title} className={cn("flex flex-col items-center justify-center gap-1.5 px-3 py-4 md:px-5 md:py-5 transition-colors duration-300 group/metric", className)}>
    <div className="flex items-center gap-1.5">
      <Icon
        size={13}
        className={cn(accent ? 'text-accent' : warning ? 'text-amber-400' : 'text-neutral-400')}
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
 *
 * Quota status uses the same zero-target-safe three-state logic as
 * TrackerCard (items 4/5): a target of 0 never renders as a meaningless 0%,
 * and "at" is a distinct (amber) state from "over" (red) rather than both
 * being lumped into one "over limit" flag.
 */
export const MetricBanner = React.memo(({ m, onEndDay, isEnding }) => {
  const { status, aboveTarget } = SmokingCalculator.getLimitStatus(m.count || 0, m.limit || 0);
  const isOver = status === 'over';
  const isAtLimit = status === 'at';
  const progress = (m.limit || 0) > 0 ? Math.min(1, (m.count || 0) / m.limit) : (status === 'under' ? 0 : 1);
  const quotaPct = Math.round(progress * 100);
  const quotaSub = isOver ? `${aboveTarget} over target` : isAtLimit ? 'At target' : 'Usage';
  const quotaWarning = isOver || isAtLimit || progress >= 0.8;

  // Today's aggregate goal state — per-tracker worst state, neutral copy (item 5).
  const gs = m.goalStatus;
  let goalText = 'No target';
  if (gs) {
    if (gs.status === 'over') {
      goalText = gs.overTrackers === 1 ? '1 above target' : `${gs.overTrackers} above target`;
    } else if (gs.status === 'at') {
      goalText = 'At target';
    } else {
      const below = Math.round(gs.belowTarget);
      goalText = below === 1 ? '1 below target' : `${below} below target`;
    }
  }

  return (
    <Card className="overflow-hidden bg-bg-card p-0" noPadding>
      <div className="grid grid-cols-2 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-white/[0.05]">
        <MetricColumn
          icon={Target}
          label="Remaining"
          value={Math.max(0, (m.limit || 0) - (m.count || 0))}
          sub="Units"
          accent
        />
        <MetricColumn
          icon={Target}
          label="TODAY'S GOAL"
          value={goalText}
          accent={m.goalStatus?.status === 'over'}
          warning={m.goalStatus?.status === 'at'}
          title={
            m.goalStatus
              ? m.goalStatus.status === 'over'
                ? `${m.goalStatus.overTrackers} tracker(s) above target`
                : m.goalStatus.status === 'at'
                ? 'All trackers at target'
                : `${Math.round(m.goalStatus.belowTarget)} below target`
              : 'No trackers with targets'
          }
        />
        <MetricColumn
          icon={Wallet}
          label="Spent Today"
          value={SmokingCalculator.formatCurrency(m.spentToday || 0)}
          sub="Cost"
          warning={(m.spentToday || 0) > 0}
        />
        <MetricColumn
          icon={Zap}
          label="Goal Streak"
          value={`${m.streak || 0}`}
          sub={m.streak === 1 ? 'Day' : 'Days'}
          title="Consecutive days within target — a different measure from days tracked"
        />
        <MetricColumn
          icon={TrendingUp}
          label="Tracking"
          value={`${m.trackingStreak || 0}`}
          sub={m.trackingStreak === 1 ? 'Day' : 'Days'}
          title="Consecutive days you recorded activity — consistency, not goal success"
        />
        <MetricColumn
          icon={Award}
          label="Engagement"
          value={m.rank || 'Apprentice'}
          sub={`${m.xp || 0} XP`}
          title="Reflects tracking consistency, not a medical or reduction outcome"
        />
        <MetricColumn
          icon={Activity}
          label="Daily Use"
          value={`${quotaPct}%`}
          sub={quotaSub}
          warning={quotaWarning}
          className="hidden lg:flex lg:flex-col"
        />
      </div>

      <div className="flex items-center gap-3 px-4 md:px-5 py-2.5">
        <span className={cn(
          'shrink-0 text-[10px] font-black uppercase tracking-[0.14em] tabular-nums lg:hidden',
          isOver ? 'text-danger' : quotaWarning ? 'text-amber-400' : 'text-neutral-400'
        )}>
          {quotaPct}%
        </span>
        <div
          className="h-1 flex-1 rounded-full bg-white/[0.06] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, quotaPct)}
          aria-label="Daily use"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700 ease-out',
              isOver ? 'bg-danger' : quotaWarning ? 'bg-amber-400' : 'bg-accent'
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
          aria-label="Close tracking day"
          className="group w-full h-11 flex items-center justify-center gap-2.5 border-t border-amber-500/15 bg-amber-500/[0.05] hover:bg-amber-500/[0.09] transition-colors duration-300 disabled:opacity-40"
        >
          {isEnding ? (
            <Loader2 className="animate-spin text-amber-400" size={16} />
          ) : (
            <Sun className="text-amber-400 group-hover:rotate-90 transition-transform duration-700" size={16} />
          )}
          <span className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/85">
            {isEnding ? 'Closing…' : 'Close Tracking Day'}
          </span>
        </button>
      )}
    </Card>
  );
});
