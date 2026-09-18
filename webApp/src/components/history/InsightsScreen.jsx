import React, { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, PiggyBank, Calendar, BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { UI, Card } from '../Common';
import { cn } from '../../utils/utils';
import { formatDateDisplay } from '../../utils/formatters';

const HISTORY_SUBVIEWS = [
  { key: 'velocity', label: 'Usage trend', title: 'Usage trend' },
  { key: 'insights', label: 'Insights', title: 'History insights' },
];

const RECENT_PERIOD_DAYS = 7;

const MonthTrendTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.[0]) return null;
  const entry = payload[0].payload;
  return (
    <div className="px-3.5 py-2.5 rounded-xl bg-[#0c0c0e] border border-white/[0.08] shadow-[0_16px_40px_rgba(0,0,0,0.75)]">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-400">
        {entry.monthLabel}
      </p>
      <p className="mt-1 text-lg font-black tabular-nums text-white leading-none">
        {entry.units}
        <span className="ml-1.5 text-[11px] font-bold uppercase tracking-widest text-neutral-400">units</span>
      </p>
      <p className="mt-1 text-[11px] text-neutral-400">
        {entry.trackedDays} {entry.trackedDays === 1 ? 'day' : 'days'} tracked
      </p>
      {entry.hasBaseline && (
        <p className="mt-0.5 text-[11px] text-accent">
          {SmokingCalculator.formatCurrency(entry.baselineSaved)} saved vs baseline
        </p>
      )}
    </div>
  );
};

const TrendBadge = ({ trend }) => {
  if (!trend) return null;
  const isGood = trend.direction === 'down' || trend.direction === 'to_zero' || trend.direction === 'unchanged';
  const Icon = trend.direction === 'down' || trend.direction === 'to_zero'
    ? TrendingDown
    : trend.direction === 'up' || trend.direction === 'from_zero'
      ? TrendingUp
      : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider',
        isGood ? 'text-accent bg-accent/10 ring-accent/20' : 'text-rose-400/90 bg-rose-500/10 ring-rose-500/20'
      )}
      aria-label={trend.direction === 'down' || trend.direction === 'to_zero'
        ? `Consumption decreased: ${trend.text}`
        : trend.direction === 'up' || trend.direction === 'from_zero'
          ? `Consumption increased: ${trend.text}`
          : `Consumption ${trend.text}`}
    >
      <Icon size={11} strokeWidth={2.5} />
      {trend.text}
    </span>
  );
};

/**
 * InsightsScreen — a subview within History.
 *
 * Shows:
 * 1. Recent trend: 7-day average vs previous comparable 7-day average
 * 2. Monthly history: complete months with units, tracked-day average, baseline savings
 * 3. Current month MTD: clearly labeled, no raw % vs complete month
 *
 * Domain logic: SmokingCalculator.aggregateMonthlyData / calculateTrend (shared JS/Kotlin).
 */
export const InsightsScreen = React.memo(({
  logs = [], dayDocs = [], configs = [], m, today, unitPrice = 0.5
}) => {
  const [subView, setSubView] = useState('insights');

  const insightData = useMemo(
    () => SmokingCalculator.aggregateMonthlyData(
      logs, dayDocs, today, m.activeCounts || {}, unitPrice, 6
    ),
    [logs, dayDocs, today, m.activeCounts, unitPrice]
  );

  // Recent trend: last 7 tracked days vs previous 7
  const recentTrend = useMemo(() => {
    const merged = SmokingCalculator.mergeDayDocsIntoLogged(
      SmokingCalculator.aggregateLoggedCounts(logs), dayDocs
    );
    const trackedDates = Object.keys(merged).sort().reverse();
    if (trackedDates.length < 2) {
      return { currentAvg: null, previousAvg: null, trend: null, label: 'More tracking data is needed for a comparison.' };
    }

    // Get last 7 tracked days (current period) and previous 7 (before that)
    const currentPeriod = trackedDates.slice(0, RECENT_PERIOD_DAYS);
    const previousPeriod = trackedDates.slice(RECENT_PERIOD_DAYS, RECENT_PERIOD_DAYS * 2);

    const currentAvg = currentPeriod.reduce((sum, date) =>
      sum + Object.values(merged[date] || {}).reduce((s, v) => s + Math.max(0, v || 0), 0), 0) / currentPeriod.length;
    const previousAvg = previousPeriod.length > 0
      ? previousPeriod.reduce((sum, date) =>
        sum + Object.values(merged[date] || {}).reduce((s, v) => s + Math.max(0, v || 0), 0), 0) / previousPeriod.length
      : null;

    if (previousAvg == null) {
      return {
        currentAvg,
        previousAvg: null,
        trend: null,
        label: 'More tracking data is needed for a comparison.',
      };
    }

    const trend = SmokingCalculator.calculateTrend(currentAvg, previousAvg);
    return { currentAvg, previousAvg, trend, label: trend.text };
  }, [logs, dayDocs, today]);

  // Chart data for monthly consumption
  const monthlyChartData = useMemo(() => {
    return insightData.completedMonths.map((month) => ({
      monthKey: month.month,
      monthLabel: month.label,
      units: month.units,
      trackedDays: month.trackedDays,
      avgUnitsPerTrackedDay: month.avgUnitsPerTrackedDay,
      hasBaseline: month.hasBaseline,
      baselineSaved: month.baselineSaved,
      isCurrentMonth: month.isCurrentMonth,
    }));
  }, [insightData.completedMonths]);

  const hasAnyHistory = (logs || []).length > 0 || (dayDocs || []).length > 0;

  if (!hasAnyHistory) {
    return (
      <div className="space-y-5 md:space-y-7">
        <div className="flex items-end justify-between gap-4 mb-3 md:mb-4">
          <div className="flex flex-col gap-1 min-w-0">
            <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Insights</span>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-none">
              History insights
            </h2>
          </div>
        </div>
        <Card className="p-8 bg-bg-card">
          <div className="flex flex-col items-center gap-4 text-center">
            <BarChart3 size={48} strokeWidth={1} className="text-neutral-600" />
            <h3 className="text-lg font-black text-white">No insights yet</h3>
            <p className="text-sm text-neutral-500 max-w-sm">
              Insights become more useful as you build history. Your consumption,
              spending, and reduction data will appear here as it accumulates.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 md:space-y-7">
      {/* Header with sub-view selector */}
      <div className="flex items-end justify-between gap-4 mb-3 md:mb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Insights</span>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-none">
            History insights
          </h2>
        </div>
        <div
          role="group"
          aria-label="History sub-view"
          className="inline-flex p-1 rounded-full bg-white/[0.03] border border-white/[0.06] gap-0.5"
        >
          {HISTORY_SUBVIEWS.map((view) => {
            const selected = subView === view.key;
            return (
              <button
                key={view.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setSubView(view.key)}
                className={cn(
                  'h-10 min-w-[2.75rem] px-4 rounded-full text-[10px] font-black uppercase tracking-[0.14em] transition-all duration-200 touch-manipulation',
                  selected
                    ? 'bg-white text-black shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'
                )}
              >
                {view.label}
              </button>
            );
          })}
        </div>
      </div>

      {subView === 'velocity' ? (
        // Existing velocity chart would go here (rendered by HistoryScreen)
        <Card className="p-5 md:p-8 overflow-hidden bg-bg-card">
          <p className="text-neutral-500 text-sm">
            Usage trend is on the main History view. Switch to Insights for monthly summaries.
          </p>
        </Card>
      ) : (
        <div className="space-y-5 md:space-y-7">
          {/* Recent trend card */}
          <Card className="p-5 md:p-6 bg-bg-card">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <div className="flex flex-col gap-1 min-w-0">
                <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Recent trend</span>
                <h3 className="text-xl font-black tracking-tight text-white leading-none">
                  Last {RECENT_PERIOD_DAYS} days
                </h3>
              </div>
              <TrendBadge trend={recentTrend.trend} />
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed mb-4">
              {recentTrend.label}
            </p>

            {recentTrend.currentAvg != null && (
              <div className="flex items-baseline gap-4 text-sm">
                <span className="text-neutral-400">Current avg:</span>
                <span className="font-black text-white tabular-nums">
                  {recentTrend.currentAvg.toFixed(1)} units/day
                </span>
                {recentTrend.previousAvg != null && (
                  <>
                    <span className="text-neutral-600">·</span>
                    <span className="text-neutral-400">Previous avg:</span>
                    <span className="font-black text-white tabular-nums">
                      {recentTrend.previousAvg.toFixed(1)} units/day
                    </span>
                  </>
                )}
              </div>
            )}
          </Card>

          {/* Current month MTD */}
          {insightData.currentMonthMtd && (
            <Card className="p-5 md:p-6 bg-bg-card">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Month to date</span>
                  <h3 className="text-xl font-black tracking-tight text-white leading-none">
                    {insightData.currentMonthMtd.label}
                  </h3>
                </div>
                {insightData.currentMonthMtd.hasBaseline && (
                  <span className="text-[10px] font-black uppercase tracking-wider text-accent">
                    Baseline active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Units</span>
                  <span className="text-2xl font-black tabular-nums text-white">{insightData.currentMonthMtd.units}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Tracked days</span>
                  <span className="text-2xl font-black tabular-nums text-white">{insightData.currentMonthMtd.trackedDays}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Avg/day</span>
                  <span className="text-2xl font-black tabular-nums text-white">
                    {insightData.currentMonthMtd.avgUnitsPerTrackedDay.toFixed(1)}
                  </span>
                </div>
                {insightData.currentMonthMtd.hasBaseline && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">Saved</span>
                    <span className="text-2xl font-black tabular-nums text-accent">
                      {SmokingCalculator.formatCurrency(insightData.currentMonthMtd.baselineSaved)}
                    </span>
                  </div>
                )}
              </div>

              <p className="mt-4 text-[11px] text-neutral-500">
                Month to date — not directly comparable to previous full months.
              </p>
            </Card>
          )}

          {/* Monthly history chart */}
          {monthlyChartData.length > 0 && (
            <Card className="p-5 md:p-8 overflow-hidden bg-bg-card">
              <div className="flex items-end justify-between gap-4 mb-4">
                <div className="flex flex-col gap-1 min-w-0">
                  <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Monthly history</span>
                  <h3 className="text-xl md:text-2xl font-black tracking-tight text-white leading-none">
                    Consumption over time
                  </h3>
                </div>
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">
                  Units
                </span>
              </div>

              <div className="h-40 md:h-52 w-full -mx-1">
                <p className="sr-only">
                  Monthly consumption chart: {monthlyChartData.map((d) => `${d.monthLabel}: ${d.units} units`).join('; ')}
                </p>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="insightBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.15} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis
                      dataKey="monthLabel"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#737373', fontSize: 10, fontWeight: 800 }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={36}
                      tick={{ fill: '#525252', fontSize: 9, fontWeight: 700 }}
                      allowDecimals={false}
                      domain={[0, (max) => Math.max(4, Math.ceil((max || 0) * 1.15))]}
                    />
                    <Tooltip
                      cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1, strokeDasharray: '4 4' }}
                      content={<MonthTrendTooltip />}
                    />
                    <Bar
                      type="monotone"
                      dataKey="units"
                      fill="url(#insightBar)"
                      radius={[4, 4, 0, 0]}
                      animationDuration={400}
                      animationEasing="ease-out"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Month detail list */}
              <div className="mt-4 space-y-2">
                {insightData.completedMonths.map((month) => (
                  <div
                    key={month.month}
                    className="flex items-center justify-between gap-3 py-2 border-b border-white/[0.03] last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar size={14} className="text-neutral-500" />
                      <span className="font-black text-white text-sm tabular-nums">{month.label}</span>
                      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-neutral-500">
                        {month.trackedDays} {month.trackedDays === 1 ? 'day' : 'days'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <span className="text-lg font-black text-white tabular-nums">{month.units}</span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">units</span>
                      {month.hasBaseline && (
                        <span className="text-sm font-black text-accent tabular-nums">
                          {SmokingCalculator.formatCurrency(month.baselineSaved)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {monthlyChartData.length === 0 && insightData.currentMonthMtd && (
            <Card className="p-6 bg-bg-card">
              <p className="text-[11px] text-neutral-500">
                Only the current month is in progress. Complete months will appear here as tracking continues.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
});
