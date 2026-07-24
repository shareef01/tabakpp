import { SmokingCalculator } from '../utils/smokingCalculator';

// Seeded demo state for the screenshot build — a plausible established user,
// two trackers comfortably under their daily limits, and a week of archived
// days for the usage chart. Dates are computed relative to "now" so the chart
// always shows recent activity whenever the shots are regenerated.

const config = (id, name, type, limit, price, order) => ({
  id, name, limit, order, type, pricePerUnit: price,
  isFinanciallyTracked: true, isPrimaryTracked: true,
});

const configs = [
  config('cig', 'Cigarettes', 'CIGARETTE', 20, 0.55, 0),
  config('ryo', 'Roll-ups', 'RYO_ROLL', 8, 0.22, 1),
];

const activeCounts = { cig: 7, ryo: 3 };

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return SmokingCalculator.getTrackingDate(d, 6);
};

const archive = (date, counts) => ({
  id: `${date}_DAY`, logDate: date, counts, isArchive: true, origin: 'DAY_RESET',
});

const logs = [
  archive(daysAgo(1), { cig: 17, ryo: 5 }),
  archive(daysAgo(2), { cig: 9, ryo: 3 }),
  archive(daysAgo(3), { cig: 19, ryo: 6 }),
  archive(daysAgo(4), { cig: 7, ryo: 2 }),
  archive(daysAgo(5), { cig: 13, ryo: 4 }),
  archive(daysAgo(6), { cig: 15, ryo: 5 }),
  archive(daysAgo(7), { cig: 8, ryo: 3 }),
];

const lifetimeAggregates = { saved: 384.2, wasted: 1250.0, smokingUnits: 4200 };

const demoAccent = () => {
  if (typeof window === 'undefined') return '#10B981';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('accent');
    if (fromQuery && /^#[0-9A-Fa-f]{6}$/.test(fromQuery)) return fromQuery;
  } catch { /* ignore */ }
  if (typeof window.__DEMO_ACCENT__ === 'string' && /^#[0-9A-Fa-f]{6}$/.test(window.__DEMO_ACCENT__)) {
    return window.__DEMO_ACCENT__;
  }
  return '#10B981';
};

const noop = () => {};
const asyncNoop = () => Promise.resolve();

export const useRegistry = () => {
  const today = SmokingCalculator.getTrackingDate(new Date(), 6);
  const base = SmokingCalculator.getGlobalMetrics(logs, configs, activeCounts, today, 0.55, lifetimeAggregates);
  const xp = SmokingCalculator.calculateXP(logs, base.streak);
  const metrics = { ...base, budgetLeft: base.budgetLeftToday, rank: SmokingCalculator.getRank(xp) };
  const profileSettings = {
    accent: demoAccent(),
    widgetSize: 'MEDIUM',
    avatar: null,
    unitPrice: 0.55,
    dayStartHour: 6,
  };

  return {
    configs, logs, metrics, loading: false, isEndingDay: false, isOnline: true, profileSettings,
    increment: noop, decrement: noop, endDay: asyncNoop, updateHistoricalLog: asyncNoop,
    deleteLog: asyncNoop, restoreLog: asyncNoop, createManualEntry: asyncNoop,
    reorder: noop, addProtocol: asyncNoop, updateProtocol: asyncNoop, deleteProtocol: asyncNoop,
  };
};
