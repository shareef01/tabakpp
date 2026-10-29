import React from 'react';
import { cn } from '../../utils/utils';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { Card } from '../Common';
import { Target, Zap, Activity, Wallet, Award, TrendingUp, Sun, Loader2 } from 'lucide-react';

// Approximate advance width of a glyph in the display face, in em. Used to pick
// a font size that lets a value fit its tile instead of clipping or wrapping
// to three lines.
const GLYPH_EM = 0.62;

// Font size for a tile value, scaled to the tile's own width (cqi) so the same
// value fits a narrow phone column and a wide desktop one. Single tokens
// ("13", "3,85 €", "Apprentice") stay on one line at display size; sentences
// ("Within today's targets") use a smaller ramp and may balance onto two lines.
// A currency amount ("3,85 €") is a single token, not a sentence.
const isSentence = (text) => text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length > 1;

const valueFontSize = (value) => {
  const text = String(value ?? '').trim();
  if (isSentence(text)) {
    const words = text.split(/\s+/);
    const longest = Math.max(...words.map((w) => w.length));
    const fit = Math.min(100 / (longest * GLYPH_EM), 200 / (text.length * GLYPH_EM));
    return `clamp(0.95rem, min(10cqi, ${fit.toFixed(2)}cqi), 1.6rem)`;
  }
  const fit = 100 / (Math.max(text.length, 4) * GLYPH_EM);
  return `clamp(1.25rem, min(24cqi, ${fit.toFixed(2)}cqi), 2.35rem)`;
};

const MetricColumn = ({ icon: Icon, label, value, sub, accent, warning, success, className, title, isPrimary = false }) => {
  const sentence = isSentence(String(value ?? '').trim());
  return (
    <div
      title={title}
      className={cn(
        "@container min-w-0 flex flex-col items-center justify-center gap-1 px-3 py-3.5 md:px-4 md:py-4.5 bg-bg-card text-center transition-colors duration-200 group/metric",
        isPrimary && "bg-bg-card/90",
        className
      )}
    >
      <div className="flex items-center gap-1.5 max-w-full">
        <Icon
          size={isPrimary ? 14 : 12}
          className={cn(
            'shrink-0',
            accent ? 'text-accent' : warning ? 'text-amber-400' : success ? 'text-emerald-400' : 'text-neutral-400'
          )}
          strokeWidth={2.5}
          aria-hidden="true"
        />
        <span className={cn(
          "font-bold uppercase tracking-wider text-neutral-400 whitespace-nowrap truncate",
          isPrimary ? "text-[11px]" : "text-[10px]"
        )}>
          {label}
        </span>
      </div>

      <span
        style={{ fontSize: isPrimary ? valueFontSize(value) : `clamp(1.1rem, 16cqi, 1.8rem)` }}
        className={cn(
          'max-w-full font-black tracking-tight tabular-nums',
          sentence ? 'leading-tight text-balance break-words' : 'leading-none whitespace-nowrap',
          accent ? 'text-accent' : warning ? 'text-amber-300' : success ? 'text-emerald-400' : 'text-white'
        )}
      >
        {value}
      </span>

      {sub && (
        <span className={cn(
          "font-semibold text-neutral-400/90 leading-none truncate max-w-full",
          isPrimary ? "text-[11px] uppercase tracking-wider" : "text-[10px]"
        )}>
          {sub}
        </span>
      )}
    </div>
  );
};

/**
 * MetricBanner — status strip with End Day as an integrated footer action.
 *
 * Information Hierarchy:
 * Tier 1 (Primary Tracking):
 * - Recorded Today: how much was recorded today
 * - Remaining: how much remains against daily target
 * - Today's Goal: whether within, at, or above target
 * - Spent Today: financial cost recorded today
 *
 * Tier 2 (Supporting Consistency):
 * - Goal Streak: consecutive days within target
 * - Log Streak: consecutive days with logged activity
 * - Engagement: consistency XP & tier
 * - Daily Use: percentage quota utilization
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
      goalText = gs.overTrackers === 1 ? '1 tracker above target' : `${gs.overTrackers} trackers above target`;
    } else if (gs.status === 'at' || gs.status === 'under') {
      goalText = "Within today's targets";
    }
  }

  const remainingUnits = Math.max(0, (m.limit || 0) - (m.count || 0));

  return (
    <Card className="overflow-hidden bg-bg-card p-0 border border-white/[0.08]" noPadding>
      {/* SECTION HEADER: Live Status & Quota */}
      <div className="flex items-center justify-between px-4 md:px-6 py-2.5 bg-white/[0.02] border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider">
            Today's Overview
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-[11px] font-bold tabular-nums',
            isOver ? 'text-danger' : quotaWarning ? 'text-amber-400' : 'text-neutral-300'
          )}>
            {m.count || 0} / {m.limit || 0} units
          </span>
          <span className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded-sm ring-1 ring-inset',
            isOver ? 'bg-rose-500/10 text-rose-400 ring-rose-500/20' : isAtLimit ? 'bg-amber-500/10 text-amber-300 ring-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
          )}>
            {quotaPct}% quota
          </span>
        </div>
      </div>

      {/* TIER 1: PRIMARY TRACKING METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.06]">
        <MetricColumn
          icon={Target}
          label="Remaining"
          value={remainingUnits}
          sub="Units"
          accent
          isPrimary
          className="order-1 md:order-1"
        />
        <MetricColumn
          icon={Target}
          label="TODAY'S GOAL"
          value={goalText}
          accent={m.goalStatus?.status === 'over'}
          warning={m.goalStatus?.status === 'at'}
          success={m.goalStatus?.status === 'under'}
          className="order-3 col-span-2 md:order-2 md:col-span-2"
          isPrimary
          title={
            m.goalStatus
              ? m.goalStatus.status === 'over'
                ? `${m.goalStatus.overTrackers} tracker(s) above target`
                : "Within today's targets"
              : 'No trackers with targets'
          }
        />
        <MetricColumn
          icon={Wallet}
          label="Spent Today"
          value={m.todayAvailable === false || m.todayUnresolved?.spent ? '—' : SmokingCalculator.formatCurrency(m.spentToday || 0)}
          sub={m.todayAvailable === false ? 'Unavailable' : m.todayUnresolved?.spent ? 'Unresolved' : 'Cost'}
          warning={m.todayAvailable !== false && !m.todayUnresolved?.spent && (m.spentToday || 0) > 0}
          isPrimary
          className="order-2 md:order-3"
        />
      </div>

      {/* TIER 2: SECONDARY BEHAVIORAL CONSISTENCY METRICS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.04] border-t border-white/[0.06]">
        <MetricColumn
          icon={Zap}
          label="Goal Streak"
          value={`${m.streak || 0}`}
          sub={m.streak === 1 ? 'Day' : 'Days'}
          title="Consecutive days within target — a different measure from days tracked"
        />
        <MetricColumn
          icon={TrendingUp}
          label="Log Streak"
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
        />
      </div>

      {/* VISUAL QUOTA PROGRESS BAR */}
      <div className="flex items-center gap-3 px-4 md:px-5 py-2.5 bg-black/30 border-t border-white/[0.04]">
        <span className={cn(
          'shrink-0 text-[11px] font-bold tabular-nums',
          isOver ? 'text-danger' : quotaWarning ? 'text-amber-400' : 'text-neutral-400'
        )}>
          {quotaPct}%
        </span>
        <div
          className="h-1.5 flex-1 rounded-full bg-white/[0.08] overflow-hidden"
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

      {/* CLOSE TRACKING DAY FOOTER ACTION */}
      {m.hasOpenSession && (
        <button
          type="button"
          onClick={onEndDay}
          disabled={isEnding}
          aria-label="Close tracking day"
          className="group w-full h-12 flex items-center justify-center gap-2.5 border-t border-white/[0.08] bg-white/[0.02] hover:bg-amber-500/[0.08] hover:border-amber-500/20 transition-all duration-200 disabled:opacity-40 outline-hidden focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          {isEnding ? (
            <Loader2 className="animate-spin text-amber-400" size={16} />
          ) : (
            <Sun className="text-amber-400 group-hover:rotate-45 transition-transform duration-500" size={16} />
          )}
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-300 group-hover:text-amber-200 transition-colors">
            {isEnding ? 'Closing session…' : 'Close tracking day'}
          </span>
          <span className="hidden sm:inline text-[11px] text-neutral-400 font-normal">
            (saves milestone · you can keep logging)
          </span>
        </button>
      )}
    </Card>
  );
});
