import React, { useState, useMemo, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, Wallet, Edit2, Trash2, Plus, PiggyBank, HeartPulse } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { RegistryService } from '../../services/registryService';
import { SmokingCalculator } from '../../utils/smokingCalculator';
import { UI, Card } from '../Common';
import { cn } from '../../utils/utils';
import { formatDateDisplay } from '../../utils/formatters';
import { mapFirestoreError } from '../../utils/errorHandlers';
import { UndoToast, UNDO_TOAST_MS } from '../feedback/UndoToast';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const VELOCITY_PERIODS = [
  { days: 7, label: '7D', title: 'Last 7 days' },
  { days: 14, label: '14D', title: 'Last 14 days' },
  { days: 30, label: '30D', title: 'Last 30 days' },
  { days: 90, label: '90D', title: 'Last 90 days' },
];

/** Weekday label from YYYY-MM-DD without timezone shift. */
const weekdayFromDateStr = (dateStr) => {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '---';
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

/** Shift a YYYY-MM-DD calendar date by `delta` days in UTC. */
const shiftDateStr = (dateStr, delta) => {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const axisLabelForPeriod = (dateStr, days) => {
  if (days <= 7) return weekdayFromDateStr(dateStr);
  const [, m, d] = (dateStr || '').split('-').map(Number);
  if (!m || !d) return '---';
  if (days <= 14) return String(d);
  return `${d}/${m}`;
};

const sumCounts = (counts = {}) =>
  Object.values(counts).reduce((a, b) => a + Math.max(0, b || 0), 0);

const VelocityTooltip = ({ active, payload }) => {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <div className="px-3.5 py-2.5 rounded-xl bg-[#0c0c0e] border border-white/[0.08] shadow-[0_16px_40px_rgba(0,0,0,0.75)]">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-400">
        {point.isNow ? 'Live session' : (point.dateLabel || point.name)}
      </p>
      <p className="mt-1 text-lg font-black tabular-nums text-white leading-none">
        {point.val}
        <span className="ml-1.5 text-[11px] font-bold uppercase tracking-widest text-neutral-400">units</span>
      </p>
    </div>
  );
};

const originMeta = (origin) => {
  if (origin === 'DAY_RESET') return { label: 'Archived', tone: 'text-neutral-400 bg-white/[0.04] ring-white/[0.06]' };
  if (origin === 'MANUAL_ENTRY') return { label: 'Manual', tone: 'text-accent bg-accent/10 ring-accent/20' };
  return { label: 'Entry', tone: 'text-neutral-400 bg-white/[0.04] ring-white/[0.06]' };
};

const STAT_TONES = {
  neutral: 'text-neutral-500 group-hover:text-neutral-300',
  accent: 'text-accent',
  rose: 'text-rose-400/90',
};

const StatTile = ({ icon: Icon, value, label, hint, tone = 'neutral' }) => (
  <div className="group relative flex flex-col justify-between gap-4 min-h-[7.25rem] p-4 md:p-5 rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] transition-colors duration-300 hover:bg-white/[0.035] hover:ring-white/[0.1]">
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-400 leading-none pt-0.5">
        {label}
      </span>
      <Icon
        size={15}
        strokeWidth={2.25}
        className={cn('shrink-0 transition-colors duration-300', STAT_TONES[tone] || STAT_TONES.neutral)}
      />
    </div>
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-2xl md:text-[1.75rem] font-black tracking-tighter text-white tabular-nums leading-none truncate">
        {value}
      </span>
      {hint && (
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500 leading-none truncate">
          {hint}
        </span>
      )}
    </div>
  </div>
);

export const HistoryScreen = React.memo(({
  logs, m, onEdit, onAddEntry, userId, today, unitPrice = 0.5,
  onDeleteLog, onRestoreLog, historyIsTruncated = false
}) => {
  const [undo, setUndo] = useState(null); // { log, key } after successful purge
  const [hiddenLogIds, setHiddenLogIds] = useState(() => new Set());
  const [actionError, setActionError] = useState(null);
  const [velocityDays, setVelocityDays] = useState(7);

  const velocityPeriod = VELOCITY_PERIODS.find((p) => p.days === velocityDays) || VELOCITY_PERIODS[0];

  const handleDelete = async (snapshot) => {
    if (!snapshot || !userId) return;
    setHiddenLogIds((ids) => new Set(ids).add(snapshot.id));
    setActionError(null);
    try {
      if (onDeleteLog) await onDeleteLog(snapshot.id);
      else await RegistryService.deleteLog(userId, snapshot.id, unitPrice);
      setUndo({ log: snapshot, key: `${snapshot.id}-${Date.now()}` });
    } catch (err) {
      console.error(err);
      setHiddenLogIds((ids) => {
        const next = new Set(ids);
        next.delete(snapshot.id);
        return next;
      });
      setActionError(mapFirestoreError(err, 'Could not delete entry.'));
    }
  };

  const handleUndo = useCallback(async () => {
    if (!undo?.log || !userId) return;
    const log = undo.log;
    const key = undo.key;
    setUndo(null);
    setActionError(null);
    try {
      if (onRestoreLog) await onRestoreLog(log);
      else await RegistryService.restoreLog(userId, log, unitPrice);
      setHiddenLogIds((ids) => {
        const next = new Set(ids);
        next.delete(log.id);
        return next;
      });
    } catch (err) {
      console.error(err);
      setActionError(mapFirestoreError(err, 'Could not restore entry.'));
      setUndo({ log, key: key || `${log.id}-retry` });
      throw err;
    }
  }, [undo, userId, unitPrice, onRestoreLog]);

  // Aggregate by date (archives + manual entries) — Android chart parity.
  const chartData = useMemo(() => {
    const logged = SmokingCalculator.aggregateLoggedCounts(logs);
    const days = velocityPeriod.days;
    const historical = [];

    for (let i = days - 1; i >= 1; i -= 1) {
      const date = shiftDateStr(today, -i);
      historical.push({
        name: axisLabelForPeriod(date, days),
        date,
        dateLabel: formatDateDisplay(date),
        val: sumCounts(logged[date]),
        isNow: false,
      });
    }

    return [
      ...historical,
      {
        name: 'NOW',
        date: today,
        dateLabel: 'Today',
        val: m.count || 0,
        isNow: true,
      },
    ];
  }, [logs, m.count, today, velocityPeriod.days]);

  const velocityStats = useMemo(() => {
    const prior = chartData.filter((p) => !p.isNow);
    const nowVal = chartData[chartData.length - 1]?.val ?? 0;
    const prevVal = prior.length ? prior[prior.length - 1].val : null;
    const peak = chartData.reduce((max, p) => Math.max(max, p.val || 0), 0);
    const delta = prevVal == null ? null : nowVal - prevVal;
    return { nowVal, prevVal, peak, delta };
  }, [chartData]);
  const visibleLogs = useMemo(() => (logs ?? []).filter((log) => !hiddenLogIds.has(log.id)), [logs, hiddenLogIds]);

  const TrendIcon = velocityStats.delta == null || velocityStats.delta === 0
    ? Minus
    : velocityStats.delta > 0
      ? TrendingUp
      : TrendingDown;

  return (
    <div className="space-y-6 md:space-y-8 pb-28"
    >
      {/* Top: Daily Velocity Chart */}
      <Card className="p-5 md:p-8 overflow-hidden bg-bg-card">
        <div className="flex items-end justify-between gap-4 md:gap-6 mb-4 md:mb-5">
          <div className="flex flex-col gap-1 min-w-0">
            <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Usage velocity</span>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-none">
              {velocityPeriod.title}
            </h2>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-400">Now</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl md:text-4xl font-black tabular-nums text-white leading-none">
                {velocityStats.nowVal}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider",
                  velocityStats.delta == null || velocityStats.delta === 0
                    ? "text-neutral-500"
                    : velocityStats.delta > 0
                      ? "text-rose-400"
                      : "text-accent"
                )}
              >
                <TrendIcon size={12} strokeWidth={2.75} />
                {velocityStats.delta == null
                  ? '—'
                  : `${velocityStats.delta > 0 ? '+' : ''}${velocityStats.delta}`}
              </span>
            </div>
          </div>
        </div>

        <div
          role="group"
          aria-label="Velocity period"
          className="mb-5 md:mb-6 inline-flex p-1 rounded-full bg-white/[0.03] border border-white/[0.06] gap-0.5"
        >
          {VELOCITY_PERIODS.map((period) => {
            const selected = period.days === velocityDays;
            return (
              <button
                key={period.days}
                type="button"
                aria-pressed={selected}
                onClick={() => setVelocityDays(period.days)}
                className={cn(
                  'h-11 min-w-[2.75rem] px-3 rounded-full text-[10px] font-black tracking-[0.14em] transition-all duration-200 touch-manipulation',
                  selected
                    ? 'bg-white text-black shadow-sm'
                    : 'text-neutral-500 hover:text-white hover:bg-white/[0.04]'
                )}
              >
                {period.label}
              </button>
            );
          })}
        </div>

        <div className="h-48 md:h-56 w-full -mx-1">
          <p className="sr-only">
            {velocityPeriod.title}: today {velocityStats.nowVal} units, peak {velocityStats.peak} units.
            Data: {chartData.map((point) => `${point.dateLabel}: ${point.val}`).join('; ')}.
          </p>
          {chartData.every((p) => (p.val || 0) === 0) ? (
            <div className="h-full flex items-center justify-center rounded-2xl border border-dashed border-white/[0.06]">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-neutral-400">
                No velocity yet — log a session
              </span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart key={velocityPeriod.days} data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="velocityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                    <stop offset="70%" stopColor="var(--accent)" stopOpacity={0.04} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#737373', fontSize: velocityPeriod.days > 30 ? 8 : 10, fontWeight: 800 }}
                  dy={10}
                  interval={velocityPeriod.days <= 7 ? 0 : velocityPeriod.days <= 14 ? 1 : 'preserveStartEnd'}
                  minTickGap={velocityPeriod.days > 30 ? 12 : 4}
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
                  content={<VelocityTooltip />}
                />
                <Area
                  type="monotone"
                  dataKey="val"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  fill="url(#velocityFill)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#0a0a0c', fill: '#fff' }}
                  dot={(props) => {
                    const { cx, cy, payload, index } = props;
                    if (cx == null || cy == null) return null;
                    const isNow = payload?.isNow;
                    return (
                      <circle
                        key={`dot-${index}`}
                        cx={cx}
                        cy={cy}
                        r={isNow ? 5 : 3.5}
                        fill={isNow ? '#fff' : 'var(--accent)'}
                        stroke="#0a0a0c"
                        strokeWidth={isNow ? 2.5 : 2}
                      />
                    );
                  }}
                  animationDuration={typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {velocityStats.peak > 0 && (
          <div className="mt-4 pt-4 border-t border-white/[0.05] flex items-center justify-between gap-4">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-neutral-400">
              Peak in window
            </span>
            <span className="text-[11px] font-black uppercase tracking-widest text-neutral-300 tabular-nums">
              {velocityStats.peak} units
            </span>
          </div>
        )}
      </Card>

      {historyIsTruncated && (
        <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-4 py-3 text-[11px] font-bold text-amber-200">
          Showing the most recent 1,200 entries. Trend and streak views exclude older entries; lifetime totals remain authoritative.
        </div>
      )}

      {/* Bottom: 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 md:gap-6 items-start">
        {/* Left: Secondary Stats */}
        <section className="lg:col-span-4 space-y-3" aria-label="At a glance">
          <div className="flex items-baseline justify-between gap-3 px-0.5">
            <span className={cn(UI.LABEL, 'mb-0 ml-0')}>At a glance</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
              Live
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile
              icon={TrendingUp}
              value={m.streak || 0}
              label="Streak"
              hint="Active days"
              tone="accent"
            />
            <StatTile
              icon={Wallet}
              value={SmokingCalculator.formatCurrency(m.spentToday ?? 0)}
              label="Spent"
              hint="Today"
              tone="rose"
            />
            <StatTile
              icon={PiggyBank}
              value={SmokingCalculator.formatCurrency(m.savedLifetime ?? 0)}
              label="Saved"
              hint="Lifetime"
              tone="accent"
            />
            <StatTile
              icon={HeartPulse}
              value={SmokingCalculator.formatLifeMinutes(m.recovered ?? 0)}
              label="Recovered"
              hint={`Lost ${SmokingCalculator.formatLifeMinutes(m.lifeLost ?? 0)}`}
              tone="neutral"
            />
          </div>
        </section>

        {/* Right: Session history */}
        <Card className="lg:col-span-8 p-4 md:p-6 bg-bg-card">
          <div className="flex items-end justify-between gap-4 mb-5">
            <div className="flex flex-col gap-1 min-w-0">
              <span className={cn(UI.LABEL, 'mb-0 ml-0')}>Session log</span>
              <h3 className="text-xl font-black tracking-tight text-white leading-none">
                {visibleLogs.length} {visibleLogs.length === 1 ? 'entry' : 'entries'}
              </h3>
            </div>
            {onAddEntry && (
              <button
                type="button"
                onClick={onAddEntry}
                className="inline-flex items-center gap-2 h-10 px-3.5 rounded-full bg-accent text-black text-[10px] font-black uppercase tracking-widest shadow-md hover:brightness-110 active:scale-95 transition-all"
                title="Add manual entry"
              >
                <Plus size={15} strokeWidth={3} />
                Add
              </button>
            )}
          </div>

          <div className="divide-y divide-white/[0.05] rounded-2xl ring-1 ring-inset ring-white/[0.06] overflow-hidden max-h-[min(28rem,60vh)] overflow-y-auto custom-scrollbar">
            {visibleLogs.length > 0 ? visibleLogs.map((log) => {
              const units = Object.values(log.counts ?? {}).reduce((a, b) => a + (b || 0), 0);
              const isToday = log.logDate === today;
              const origin = originMeta(log.origin);
              return (
                <div
                  key={log.id}
                  className={cn(
                    "flex items-center gap-3 px-3.5 py-3 md:px-4 group transition-colors duration-200",
                    isToday ? "bg-accent/[0.04]" : "bg-transparent hover:bg-white/[0.025]"
                  )}
                >
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-black text-white tracking-tight truncate">
                        {isToday ? 'Today' : formatDateDisplay(log.logDate)}
                      </span>
                      <span className={cn(
                        "shrink-0 inline-flex items-center px-1.5 h-5 rounded-md text-[10px] font-black uppercase tracking-[0.12em] ring-1 ring-inset",
                        origin.tone
                      )}>
                        {origin.label}
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      {isToday ? 'Open day' : 'Logged session'}
                    </span>
                  </div>

                  <div className="flex flex-col items-end gap-0.5 shrink-0 mr-1">
                    <span className="text-lg font-black tabular-nums text-white leading-none">{units}</span>
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-neutral-400">units</span>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => onEdit(log)}
                      aria-label="Edit entry"
                      className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.07] transition-all active:scale-90 touch-manipulation"
                    >
                      <Edit2 size={15} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(log)}
                      aria-label="Delete entry"
                      className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-lg text-neutral-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all active:scale-90 touch-manipulation"
                    >
                      <Trash2 size={15} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              );
            }) : (
              <div className="py-14 px-6 text-center">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400">No sessions yet</p>
                <p className="mt-2 text-xs text-neutral-500">
                  End a tracking day or add a manual entry.
                </p>
                {onAddEntry && (
                  <button
                    type="button"
                    onClick={onAddEntry}
                    className="mt-5 inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/[0.06] text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/[0.1] transition-colors"
                  >
                    <Plus size={14} strokeWidth={3} />
                    Add entry
                  </button>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {actionError && (
        <div className="fixed top-24 left-1/2 z-[4000] -translate-x-1/2 flex items-center gap-4 px-5 py-3 rounded-2xl bg-red-950/90 border border-red-500/30 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
          <span className="text-[11px] font-black uppercase tracking-[0.16em] text-red-300">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss history error"
            className="text-[11px] font-black uppercase tracking-widest text-white/80 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <UndoToast
        open={!!undo}
        toastKey={undo?.key || 'history-undo'}
        message="Entry deleted"
        detail={undo?.log?.logDate ? formatDateDisplay(undo.log.logDate) : 'You can restore it'}
        duration={UNDO_TOAST_MS}
        onUndo={handleUndo}
        onDismiss={() => setUndo(null)}
      />
    </div>
  );
});
