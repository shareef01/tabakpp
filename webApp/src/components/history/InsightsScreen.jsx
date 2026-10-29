import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Calendar, BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { UI, Card } from '../Common';
import { cn } from '../../utils/utils';
import { niceAxis } from '../../utils/chartAxis';

const RECENT_PERIOD_DAYS = 7;

const MonthTrendTooltip = ({ active, payload }) => {
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
      {entry.unknownEconomics && <p className="text-[11px] text-neutral-400">Some historical money is unknown.</p>}
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
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider',
        // Fixed semantic colours, not the accent: a red accent would make a
        // reduction look like a warning.
        isGood ? 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20' : 'text-rose-400/90 bg-rose-500/10 ring-rose-500/20'
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
  logs = [], dayDocs = [], m, today, unitPrice = 0.5, _canonical = null, ledgers = []
}) => {
  const insightData = useMemo(
    () => SmokingCalculator.aggregateMonthlyData(
      logs, dayDocs, today, m.activeCounts || {}, unitPrice, 6, ledgers
    ),
    [logs, dayDocs, today, m.activeCounts, unitPrice, ledgers]
  );

  // Recent trend: the 7 calendar days before today vs the 7 before those
  // (today's partial day excluded; untracked days are not counted as zero).
  const recentTrend = useMemo(() => {
    const result = SmokingCalculator.recentWindowTrend(logs, dayDocs, today, RECENT_PERIOD_DAYS);
    if (!result) {
      return { currentAvg: null, previousAvg: null, trend: null, label: 'More tracking data is needed for a comparison.' };
    }
    return { ...result, label: result.trend.text };
  }, [logs, dayDocs, today]);

  // Chart data for monthly consumption. completedMonths is newest-first (the
  // detail list keeps that order); the chart reads oldest -> newest, left to right.
  const monthlyChartData = useMemo(() => {
    return [...insightData.completedMonths].reverse().map((month) => ({
      monthKey: month.month,
      monthLabel: month.label,
      units: month.units,
      trackedDays: month.trackedDays,
      avgUnitsPerTrackedDay: month.avgUnitsPerTrackedDay,
      hasBaseline: month.hasBaseline,
      unknownEconomics: month.unknownEconomics,
      baselineSaved: month.baselineSaved,
      isCurrentMonth: month.isCurrentMonth,
    }));
  }, [insightData.completedMonths]);
  const monthlyAxis = useMemo(
    () => niceAxis(Math.max(0, ...monthlyChartData.map((d) => d.units || 0))),
    [monthlyChartData]
  );

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
      <div className="flex items-end justify-between gap-4 mb-3 md:mb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Insights</span>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-none">
            History insights
          </h2>
        </div>
      </div>

        <div className="space-y-5 md:space-y-7">
          {/* Recent trend card */}
          <Card className="p-5 md:p-6 bg-bg-card">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <div className="flex flex-col gap-1 min-w-0">
                <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Recent trend</span>
                <h3 className="text-xl font-black tracking-tight text-white leading-none">
                  Last {RECENT_PERIOD_DAYS} days
                </h3>
                <span className="text-[11px] text-neutral-500">Before today, vs the {RECENT_PERIOD_DAYS} days before</span>
              </div>
              <TrendBadge trend={recentTrend.trend} />
            </div>

            {/* With a trend the badge already says it; the line is only for
                the no-comparison message. */}
            {!recentTrend.trend && (
              <p className="text-[11px] text-neutral-500 leading-relaxed mb-4">
                {recentTrend.label}
              </p>
            )}

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
                  {insightData.currentMonthMtd.unknownEconomics && <p className="text-xs text-neutral-400">Some historical money is unknown.</p>}
                </div>
                {insightData.currentMonthMtd.hasBaseline && (
                  <span className="text-[11px] font-black uppercase tracking-wider text-accent">
                    Baseline active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">Units</span>
                  <span className="text-2xl font-black tabular-nums text-white">{insightData.currentMonthMtd.units}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">Tracked days</span>
                  <span className="text-2xl font-black tabular-nums text-white">{insightData.currentMonthMtd.trackedDays}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">Avg/day</span>
                  <span className="text-2xl font-black tabular-nums text-white">
                    {insightData.currentMonthMtd.avgUnitsPerTrackedDay.toFixed(1)}
                  </span>
                </div>
                {insightData.currentMonthMtd.hasBaseline && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-500">Saved</span>
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
                  <BarChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                      tick={{ fill: '#A1A1AA', fontSize: 11, fontWeight: 700 }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#A1A1AA', fontSize: 10, fontWeight: 600 }}
                      allowDecimals={false}
                      {...monthlyAxis}
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
                      {month.unknownEconomics && <span className="text-xs text-neutral-400">Some historical money is unknown.</span>}
                      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-neutral-500">
                        {month.trackedDays} {month.trackedDays === 1 ? 'day' : 'days'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <span className="text-lg font-black text-white tabular-nums">{month.units}</span>
                      <span className="text-[11px] font-black uppercase tracking-widest text-neutral-500">units</span>
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
    </div>
  );
});
