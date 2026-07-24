/**
 * SmokingCalculator — domain math ported 1:1 from the Kotlin
 * SmokingCalculator (shared/src/commonMain/kotlin/com/tabakpp/app/domain/).
 * Both clients read and write the same Firestore documents, so any change
 * here must be mirrored in the Kotlin implementation and vice versa.
 */

const DAY_START_HOUR_DEFAULT = 6;
const SMOKING_TYPES = ['CIGARETTE', 'RYO_ROLL', 'JOINT_KING'];

// Date-only arithmetic done entirely in UTC space so the viewer's timezone
// can never shift a YYYY-MM-DD string by a day.
const shiftDate = (dateStr, deltaDays) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().split('T')[0];
};

const isDayArchiveLog = (log) => log?.origin === 'DAY_RESET' || (log?.id || '').endsWith('_DAY');

const mergeCounts = (base, extra) => {
  const out = { ...(base || {}) };
  Object.entries(extra || {}).forEach(([id, v]) => {
    out[id] = (out[id] || 0) + Math.max(0, v || 0);
  });
  return out;
};

// Day archives merged with same-date manual entries — an archive must not
// shadow manual entries added afterwards. Matches the Kotlin implementation.
const aggregateLoggedCounts = (logs) => {
  const archives = {};
  const others = {};
  (logs || []).forEach((log) => {
    if (!log?.logDate) return;
    if (isDayArchiveLog(log)) {
      archives[log.logDate] = log.counts || {};
    } else {
      const day = others[log.logDate] || (others[log.logDate] = {});
      Object.entries(log.counts || {}).forEach(([id, v]) => {
        day[id] = (day[id] || 0) + Math.max(0, v || 0);
      });
    }
  });
  const out = {};
  new Set([...Object.keys(archives), ...Object.keys(others)]).forEach((date) => {
    out[date] = mergeCounts(archives[date], others[date] || {});
  });
  return out;
};

export const SmokingCalculator = {
  mergeCounts,
  aggregateLoggedCounts,

  /**
   * Tracking day in the device's local timezone with the user's day-start
   * hour, matching mobile's getTrackingDate + TimeZone.currentSystemDefault().
   * A 2 AM session belongs to yesterday's tracking day (night-owl mode).
   */
  getTrackingDate: (now = new Date(), dayStartHour = DAY_START_HOUR_DEFAULT) => {
    const d = new Date(now);
    if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  },

  hasOpenSession: (activeCounts) =>
    Object.values(activeCounts || {}).some((v) => (v || 0) > 0),

  getTotalCount: (counts, configs) =>
    (configs || [])
      .filter((c) => c.isPrimaryTracked !== false)
      .reduce((sum, c) => sum + Math.max(0, (counts || {})[c.id] || 0), 0),

  getTotalLimit: (configs) =>
    (configs || [])
      .filter((c) => c.isPrimaryTracked !== false)
      .reduce((sum, c) => sum + Math.max(0, c.limit || 0), 0),

  calculateDayFinancials: (counts, configs, defaultPrice = 0.5) => {
    let wasted = 0;
    let saved = 0;
    (configs || []).forEach((c) => {
      if (c.isFinanciallyTracked === false) return;
      const count = Math.max(0, (counts || {})[c.id] || 0);
      const limit = Math.max(0, c.limit || 0);
      const price = c.pricePerUnit === undefined || c.pricePerUnit === null
        ? defaultPrice
        : c.pricePerUnit;
      wasted += count * price;
      saved += Math.max(0, limit - count) * price;
    });
    return { wasted, saved };
  },

  /**
   * Streak: consecutive days where EVERY streak config stayed within its own
   * limit (per-config, not pooled — Android parity). Counts today's live
   * session merged with anything already logged for the tracking day.
   */
  calculateStreak: (logs, configs, activeCounts, trackingDay) => {
    const all = configs || [];
    const smoking = all.filter((c) => SMOKING_TYPES.includes(c.type));
    const streakConfigs = smoking.length > 0
      ? smoking
      : all.filter((c) => c.isPrimaryTracked !== false);
    if (streakConfigs.length === 0 || !trackingDay) return 0;

    const logged = aggregateLoggedCounts(logs);
    const loggedDates = Object.keys(logged).sort().reverse();
    const yesterday = shiftDate(trackingDay, -1);
    const mostRecent = loggedDates[0];
    const sessionOpen = SmokingCalculator.hasOpenSession(activeCounts);

    if (loggedDates.length === 0 && !sessionOpen) return 0;
    if (mostRecent && mostRecent < yesterday && !sessionOpen) return 0;

    let streak = 0;
    let cursor = trackingDay;
    for (let i = 0; i < 366; i++) {
      const dayCounts = cursor === trackingDay
        ? mergeCounts(logged[cursor], activeCounts || {})
        : logged[cursor];
      if (cursor !== trackingDay && !dayCounts) break;
      const withinLimits = streakConfigs.every(
        (c) => Math.max(0, (dayCounts || {})[c.id] || 0) <= Math.max(0, c.limit || 0)
      );
      if (!withinLimits) break;
      streak++;
      cursor = shiftDate(cursor, -1);
    }
    return streak;
  },

  calculateXP: (logs, streak) => {
    // Count distinct tracking days so multiple manual entries on the same day
    // can't inflate rank. Fall back to log count when logDate is absent (e.g.
    // legacy/test fixtures) to preserve prior behavior.
    const uniqueDays = new Set((logs || []).map((l) => l?.logDate).filter(Boolean)).size;
    const totalDays = uniqueDays || (logs?.length || 0);
    return totalDays * 10 + streak * 15;
  },

  getRank: (xp) => {
    if (xp < 500) return 'Apprentice';
    if (xp < 5000) return 'Scout';
    if (xp < 10000) return 'Veteran';
    if (xp < 20000) return 'Master';
    return 'Legend';
  },

  isValidDate: (dateStr) => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  },

  /** Round in cent space — Kotlin formatCurrency parity (de-DE style). */
  formatCurrency: (amount) => {
    const totalCents = Math.round((amount || 0) * 100);
    const sign = totalCents < 0 ? '-' : '';
    const cents = Math.abs(totalCents);
    return `${sign}${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')} €`;
  },

  formatLifeMinutes: (mins) => {
    const n = Math.max(0, Math.floor(mins || 0));
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h <= 0) return `${m}m`;
    return `${h}h ${m}m`;
  },

  sumSmokingUnits: (counts, configs) => {
    const smokingIds = new Set(
      (configs || []).filter((c) => SMOKING_TYPES.includes(c.type)).map((c) => c.id)
    );
    if (smokingIds.size === 0) return 0;
    return Object.entries(counts || {}).reduce((sum, [id, v]) => (
      smokingIds.has(id) ? sum + Math.max(0, v || 0) : sum
    ), 0);
  },

  sumSmokingUnitsFromLogs: (logs, configs) => {
    const logged = aggregateLoggedCounts(logs);
    return Object.values(logged).reduce(
      (sum, dayCounts) => sum + SmokingCalculator.sumSmokingUnits(dayCounts, configs),
      0
    );
  },

  calculateLifeLostMinutes: (logs, configs, activeCounts, lifetimeSmokingUnits = null) => {
    const smokingIds = new Set(
      (configs || []).filter((c) => SMOKING_TYPES.includes(c.type)).map((c) => c.id)
    );
    if (smokingIds.size === 0) return 0;

    let total = lifetimeSmokingUnits != null
      ? Math.max(0, lifetimeSmokingUnits)
      : (() => {
          let fromLogs = 0;
          const logged = aggregateLoggedCounts(logs);
          Object.values(logged).forEach((dayCounts) => {
            smokingIds.forEach((id) => {
              fromLogs += Math.max(0, dayCounts[id] || 0);
            });
          });
          return fromLogs;
        })();

    Object.entries(activeCounts || {}).forEach(([id, v]) => {
      if (smokingIds.has(id)) total += Math.max(0, v || 0);
    });
    return Math.floor(total * 11);
  },

  calculateRecoveryMinutes: (logs, configs, activeCounts, trackingDay) => {
    const smokingConfigs = (configs || []).filter((c) => SMOKING_TYPES.includes(c.type));
    if (smokingConfigs.length === 0) return 0;

    const logged = aggregateLoggedCounts(logs);
    let recovered = 0;

    Object.entries(logged).forEach(([date, counts]) => {
      if (date === trackingDay) return;
      smokingConfigs.forEach((c) => {
        const count = Math.max(0, counts[c.id] || 0);
        const limit = Math.max(0, c.limit || 0);
        recovered += Math.max(0, limit - count) * 11;
      });
    });

    smokingConfigs.forEach((c) => {
      const count = Math.max(0, (activeCounts || {})[c.id] || 0);
      const limit = Math.max(0, c.limit || 0);
      recovered += Math.max(0, limit - count) * 11;
    });

    return Math.floor(recovered);
  },

  /**
   * Global metrics — Android getGlobalMetrics parity.
   * Prefer lifetimeAggregates.saved when present (authoritative from transactions).
   */
  getGlobalMetrics: (logs, configs, activeCounts, trackingDay, userPrice = 0.5, lifetimeAggregates = null) => {
    const primaryConfigs = (configs || []).filter((c) => c.isPrimaryTracked !== false);
    const sessionCounts = activeCounts || {};
    const logged = aggregateLoggedCounts(logs);

    const count = primaryConfigs.reduce(
      (sum, c) => sum + Math.max(0, sessionCounts[c.id] || 0),
      0
    );
    const limit = primaryConfigs.reduce(
      (sum, c) => sum + Math.max(0, c.limit || 0),
      0
    );

    let streak = 0;
    try {
      streak = SmokingCalculator.calculateStreak(logs, configs, activeCounts, trackingDay);
    } catch { /* keep 0 */ }

    let savedLifetime = 0;
    Object.values(logged).forEach((dayCounts) => {
      savedLifetime += SmokingCalculator.calculateDayFinancials(dayCounts, configs, userPrice).saved;
    });
    if (lifetimeAggregates != null && lifetimeAggregates.saved != null) {
      savedLifetime = lifetimeAggregates.saved;
    }

    const sessionFin = SmokingCalculator.calculateDayFinancials(sessionCounts, configs, userPrice);
    let lifeLost = 0;
    let recovered = 0;
    try {
      const archivedUnits = lifetimeAggregates != null
        ? (lifetimeAggregates.smokingUnits ?? 0)
        : null;
      lifeLost = SmokingCalculator.calculateLifeLostMinutes(logs, configs, activeCounts, archivedUnits);
      recovered = SmokingCalculator.calculateRecoveryMinutes(logs, configs, activeCounts, trackingDay);
    } catch { /* keep 0 */ }

    return {
      count: Math.floor(count),
      limit,
      streak,
      spentToday: sessionFin.wasted,
      budgetLeftToday: sessionFin.saved,
      saved: sessionFin.saved,
      savedLifetime,
      progress: limit > 0 ? count / limit : 0,
      lifeLost,
      recovered,
      activeCounts: sessionCounts,
      hasOpenSession: SmokingCalculator.hasOpenSession(sessionCounts)
    };
  },
};
