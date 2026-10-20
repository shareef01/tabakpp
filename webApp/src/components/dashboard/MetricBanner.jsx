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

const MetricColumn = ({ icon: Icon, label, value, sub, accent, warning, success, className, title }) => {
  const sentence = isSentence(String(value ?? '').trim());
  return (
  <div title={title} className={cn("@container min-w-0 flex flex-col items-center justify-center gap-1.5 px-3 py-4 md:px-4 md:py-5 bg-bg-card text-center transition-colors duration-300 group/metric", className)}>
    <div className="flex items-center gap-1.5">
      <Icon
        size={13}
        className={cn(accent ? 'text-accent' : warning ? 'text-amber-400' : 'text-neutral-400')}
        strokeWidth={2.75}
      />
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400 whitespace-nowrap">
        {label}
      </span>
    </div>

    <span
      style={{ fontSize: valueFontSize(value) }}
      className={cn(
        'max-w-full font-black tracking-tighter tabular-nums',
        sentence ? 'leading-tight text-balance break-words' : 'leading-none whitespace-nowrap',
        accent ? 'text-accent' : warning ? 'text-amber-300' : success ? 'text-emerald-400' : 'text-white'
      )}
    >
      {value}
    </span>

    {sub && (
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400">
        {sub}
      </span>
    )}
  </div>
  );
};

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
  // Tracker-count semantics: "N tracker(s) above target" not pooled deltas.
  // "Within today's targets" covers both "all at" and "mixed at+under" states.
  const gs = m.goalStatus;
  let goalText = 'No target';
  if (gs) {
    if (gs.status === 'over') {
      goalText = gs.overTrackers === 1 ? '1 tracker above target' : `${gs.overTrackers} trackers above target`;
    } else if (gs.status === 'at' || gs.status === 'under') {
      goalText = "Within today's targets";
    }
  }

  return (
    <Card className="overflow-hidden bg-bg-card p-0" noPadding>
      {/*
        Two columns on phones (Daily Use moves to the bar below); four on
        tablet and up, where the goal sentence spans two columns so the seven
        tiles fill two even rows. The 1px gap over a tinted background draws
        the dividers without stray borders on wrapped rows.
      */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.05]">
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
          success={m.goalStatus?.status === 'under'}
          className="md:col-span-2"
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
          className="hidden md:flex"
        />
      </div>

      <div className="flex items-center gap-3 px-4 md:px-5 py-2.5">
        <span className={cn(
          'shrink-0 text-[10px] font-black uppercase tracking-[0.14em] tabular-nums md:hidden',
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
