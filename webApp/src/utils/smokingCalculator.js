/**
 * SmokingCalculator — domain math ported 1:1 from the Kotlin
 * SmokingCalculator (shared/src/commonMain/kotlin/com/tabakpp/app/domain/).
 * Both clients read and write the same Firestore documents, so any change
 * here must be mirrored in the Kotlin implementation and vice versa.
 *
 * Cross-platform contract fixtures for the functions below live in
 * shared-tests/domain-fixtures.json and are run by both
 * `npm run test:contract` (this file) and the Kotlin
 * DomainContractFixturesTest — see shared-tests/README.md.
 */

const DAY_START_HOUR_DEFAULT = 6;
const SMOKING_TYPES = ['CIGARETTE', 'RYO_ROLL', 'JOINT_KING'];

/**
 * Population-level minutes-of-life-expectancy estimate per smoking unit.
 * Sourced loosely from UK ASH / "11 minutes per cigarette" life-expectancy
 * literature — a COHORT AVERAGE, not a measurement of any individual. Never
 * present figures derived from this constant as a personal medical fact (and
 * MetricBanner's "population estimate" labeling).
 */
const LIFE_MINUTES_PER_UNIT = 11;

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

/**
 * Overlay `days/{date}` documents (the dated daily-document model — see
 * registryService.js) onto counts already aggregated from the legacy `logs`
 * collection. A given calendar date is produced by exactly one of the two
 * collections in practice (the day-doc model only starts writing from the
 * date this schema shipped forward), so this is a safe additive merge rather
 * than a precedence question.
 */
const mergeDayDocsIntoLogged = (logged, dayDocs) => {
  const out = { ...(logged || {}) };
  (dayDocs || []).forEach((d) => {
    if (!d?.date) return;
    out[d.date] = mergeCounts(out[d.date], d.counts || {});
  });
  return out;
};

/** `{ [date]: trackerSnapshots }` for every day-doc that has one. */
const snapshotsByDate = (dayDocs) => {
  const out = {};
  (dayDocs || []).forEach((d) => {
    if (d?.date && d.trackerSnapshots) out[d.date] = d.trackerSnapshots;
  });
  return out;
};

/**
 * Effective historical target for a tracker on a given day.
 *
 * Prefers the target stamped in that day's trackerSnapshots (item 2 —
 * historical config, immune to later edits of the live tracker). Falls back
 * to the tracker's current live limit ONLY when no snapshot exists for that
 * day/tracker — i.e. legacy data written before this schema, or a tracker
 * that was never touched that day. This fallback is a documented, explicit
 * choice and is never silently different
 * from what the UI shows: legacy days are the only ones affected, and they
 * carry no other historical-config record either.
 */
const effectiveTarget = (snapshotsForDate, config) => {
  const snap = snapshotsForDate?.[config.id];
  if (snap && Number.isFinite(snap.target)) return Math.max(0, snap.target);
  return Math.max(0, config.limit || 0);
};

/**
 * Financial/unit contribution of a `days/{date}` document computed ENTIRELY
 * from its own stamped `trackerSnapshots` — never from live tracker configs.
 * This is what makes a day doc historically self-contained (item 2): once
 * written, its meaning cannot be changed by editing, repricing, renaming, or
 * deleting the live tracker afterward. Used to (re)stamp `aggregateCredit`
 * whenever a day's counts change, on both the live (open, today) path and
 * historical edits.
 */
const computeDayCredit = (counts, trackerSnapshots, defaultUnitPrice = 0.5) => {
  let wasted = 0;
  let saved = 0;
  let smokingUnits = 0;
  let baselineSaved = 0;
  Object.entries(trackerSnapshots || {}).forEach(([id, snap]) => {
    const count = Math.max(0, (counts || {})[id] || 0);
    const target = Math.max(0, snap?.target || 0);
    const price = snap?.unitPrice == null ? defaultUnitPrice : snap.unitPrice;
    if (snap?.isFinanciallyTracked !== false) {
      wasted += count * price;
      saved += Math.max(0, target - count) * price;
      if (snap?.baseline != null) {
        baselineSaved += Math.max(0, snap.baseline - count) * price;
      }
    }
    if (SMOKING_TYPES.includes(snap?.type)) smokingUnits += count;
  });
  return { wasted, saved, smokingUnits, baselineSaved };
};

export const SmokingCalculator = {
  mergeCounts,
  aggregateLoggedCounts,
  mergeDayDocsIntoLogged,
  snapshotsByDate,
  computeDayCredit,
  LIFE_MINUTES_PER_UNIT,

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
   * Immutable-config-safe snapshot of a tracker, stamped onto a `days/{date}`
   * document (or a `logs` entry) whenever that day's counts change (item 2).
   * A historical day interprets its own counts using this stamp, never the
   * tracker's *current* settings — so editing today's price/target can never
   * rewrite whether an old day was a success or what it cost.
   */
  buildTrackerSnapshot: (config) => ({
    name: config?.name || '',
    type: config?.type || 'CIGARETTE',
    target: Math.max(0, Math.floor(config?.limit || 0)),
    baseline: config?.baseline == null || !Number.isFinite(Number(config.baseline))
      ? null
      : Math.max(0, Number(config.baseline)),
    unitPrice: config?.pricePerUnit == null ? null : Number(config.pricePerUnit),
    isFinanciallyTracked: config?.isFinanciallyTracked !== false,
    isPrimaryTracked: config?.isPrimaryTracked !== false,
  }),

  /**
   * Zero-target-safe goal status (item 4/5). A target of 0 is a legitimate
   * goal ("none today"), not a meaningless denominator — so this never
   * expresses status as a percentage of target. Three states only:
   *   under  — actual < target
   *   at     — actual == target ("limit reached", not "over")
   *   over   — actual > target ("N above target")
   */
  /**
   * Zero-target-safe goal status (item 4/5). A target of 0 is a legitimate
   * goal ("none today"), not a meaningless denominator — so this never
   * expresses status as a percentage of target. Three states only:
   *   under  — actual < target
   *   at     — actual == target ("limit reached", not "over")
   *   over   — actual > target ("N above target")
   */
  getLimitStatus: (actual, target) => {
    const a = Math.max(0, actual || 0);
    const t = Math.max(0, target || 0);
    const diff = a - t;
    return {
      status: diff > 0 ? 'over' : diff === 0 ? 'at' : 'under',
      aboveTarget: Math.max(0, diff),
      belowTarget: Math.max(0, -diff),
    };
  },

  /**
   * Aggregate daily goal status across multiple trackers — per-tracker, never
   * pooled (item 7). Each participating tracker is evaluated individually via
   * getLimitStatus, then the worst state is selected: "over" dominates
   * "at" dominates "under".
   *
   * Uses the same smoking-first / isPrimaryTracked fallback as calculateStreak.
   * Returns null when there are no participating trackers (no meaningful
   * target), so the UI can defer to empty-state behavior (item 20).
   */
  getGoalStatus: (counts, configs) => {
    const all = configs || [];
    const smoking = all.filter((c) => SMOKING_TYPES.includes(c.type));
    const goalConfigs = smoking.length > 0 ? smoking : all.filter((c) => c.isPrimaryTracked !== false);
    if (goalConfigs.length === 0) return null;
    let overCount = 0;
    let atCount = 0;
    let underCount = 0;
    let totalAbove = 0;
    let totalBelow = 0;
    goalConfigs.forEach((c) => {
      const ls = SmokingCalculator.getLimitStatus(
        Math.max(0, (counts || {})[c.id] || 0),
        Math.max(0, c.limit || 0)
      );
      totalAbove += ls.aboveTarget;
      totalBelow += ls.belowTarget;
      if (ls.status === 'over') overCount++;
      else if (ls.status === 'at') atCount++;
      else underCount++;
    });
    const status = overCount > 0 ? 'over' : atCount > 0 ? 'at' : 'under';
    return { status, aboveTarget: totalAbove, belowTarget: totalBelow, overTrackers: overCount, atTrackers: atCount, underTrackers: underCount, totalTrackers: goalConfigs.length };
  },
  /**
   * Reduction vs. a user-set baseline (item 3) — deliberately independent of
   * `target`. Returns null when no baseline is set so callers can render the
   * documented fallback ("Set a baseline to calculate reduction.") instead of
   * a fabricated or misleading number.
   */
  getReduction: (actual, baseline) => {
    if (baseline == null || !Number.isFinite(Number(baseline))) return null;
    const a = Math.max(0, actual || 0);
    const b = Math.max(0, Number(baseline));
    const avoided = Math.max(0, b - a);
    const percent = b > 0 ? avoided / b : null; // baseline of 0 has no meaningful % reduction
    return { baseline: b, actual: a, avoided, percent };
  },

  /**
   * Money saved strictly from baseline vs. actual (item 3) — NEVER from
   * target vs. actual. Target adherence and savings are different concepts:
   * a user can be "on target" (actual <= target) while still smoking more or
   * less than their baseline, and vice versa. Trackers without a baseline
   * contribute nothing and are reported via `hasBaseline` so the UI can show
   * an honest fallback instead of a partial/misleading total.
   */
  calculateBaselineSavings: (counts, configs, defaultPrice = 0.5) => {
    let moneySaved = 0;
    let unitsAvoided = 0;
    let hasBaseline = false;
    (configs || []).forEach((c) => {
      const baseline = c.baseline;
      if (baseline == null || !Number.isFinite(Number(baseline))) return;
      hasBaseline = true;
      const count = Math.max(0, (counts || {})[c.id] || 0);
      const avoided = Math.max(0, Number(baseline) - count);
      unitsAvoided += avoided;
      if (c.isFinanciallyTracked === false) return;
      const price = c.pricePerUnit == null ? defaultPrice : c.pricePerUnit;
      moneySaved += avoided * price;
    });
    return { moneySaved, unitsAvoided, hasBaseline };
  },

  /**
   * Streak: consecutive days where EVERY streak config stayed within its own
   * TARGET for that day (per-config, not pooled — Android parity). Counts
   * today's live session merged with anything already logged for the
   * tracking day.
   *
   * `dayDocs` (optional, default []) supplies `days/{date}` documents from
   * the dated-daily-document model. When a day has a stamped trackerSnapshot
   * for a config, its target is read from that snapshot rather than the
   * config's current live limit (item 2) — so raising or lowering today's
   * target can never retroactively flip whether an old day kept the streak
   * alive. Days without a snapshot (legacy `logs`-only data) fall back to the
   * live limit, which matches the pre-existing behavior exactly.
   */
  calculateStreak: (logs, configs, activeCounts, trackingDay, dayDocs = []) => {
    const all = configs || [];
    const smoking = all.filter((c) => SMOKING_TYPES.includes(c.type));
    const streakConfigs = smoking.length > 0
      ? smoking
      : all.filter((c) => c.isPrimaryTracked !== false);
    if (streakConfigs.length === 0 || !trackingDay) return 0;

    const logged = mergeDayDocsIntoLogged(aggregateLoggedCounts(logs), dayDocs);
    const snapshots = snapshotsByDate(dayDocs);
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
      const snapshotsForDay = snapshots[cursor];
      const withinLimits = streakConfigs.every((c) => {
        const target = effectiveTarget(snapshotsForDay, c);
        return Math.max(0, (dayCounts || {})[c.id] || 0) <= target;
      });
      if (!withinLimits) break;
      streak++;
      cursor = shiftDate(cursor, -1);
    }
    return streak;
  },

  /**
   * Tracking streak (item 7): consecutive days with ANY logged activity,
   * regardless of whether the day stayed within target. Deliberately
   * separate from `calculateStreak` (the goal streak) so "I tracked
   * consistently" and "I stayed on target" never collapse into one number —
   * logging faithfully is not the same accomplishment as hitting a goal.
   *
   * A day qualifies based on PRESENCE of a record (a day-doc, a log entry,
   * or a non-empty activeCounts map), not on positive sum. This correctly
   * distinguishes "tracked zero" (user interacted or explicitly logged 0)
   * from "untracked/missing" (no record at all) — a day with a zero-count
   * dayDoc or a zero-count manual entry still counts as tracked.
   */
  calculateTrackingStreak: (logs, activeCounts, trackingDay, dayDocs = []) => {
    if (!trackingDay) return 0;
    const logged = mergeDayDocsIntoLogged(aggregateLoggedCounts(logs), dayDocs);
    const loggedDates = Object.keys(logged).sort().reverse();
    const hasTodayEvidence = Object.prototype.hasOwnProperty.call(logged, trackingDay) || Object.keys(activeCounts || {}).length > 0;
    if (loggedDates.length === 0 && !hasTodayEvidence) return 0;
    const yesterday = shiftDate(trackingDay, -1);
    const mostRecent = loggedDates[0];
    if (mostRecent && mostRecent < yesterday && !hasTodayEvidence) return 0;

    let streak = 0
    let cursor = trackingDay
    for (let i = 0; i < 366; i++) {
      const hasEntry = cursor === trackingDay
        ? Object.prototype.hasOwnProperty.call(logged, cursor) || Object.keys(activeCounts || {}).length > 0
        : Object.prototype.hasOwnProperty.call(logged, cursor);
      if (!hasEntry) break;
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

  /**
   * Backfill is for days that have happened. A future-dated log is not just
   * meaningless — it also silently revives a dead streak: calculateStreak bails
   * early only when the most recent logged date is older than yesterday, and a
   * date in the future is not, so an otherwise-inactive user reads as streak 1.
   *
   * Both arguments are YYYY-MM-DD, so the comparison is plain lexicographic
   * ordering. Kept here rather than in the form so the service layer and both
   * clients apply the identical rule.
   */
  isBackfillDateAllowed: (dateStr, trackingDay) => {
    if (!SmokingCalculator.isValidDate(dateStr)) return false;
    if (!trackingDay) return true;
    return dateStr <= trackingDay;
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

  /**
   * Format a non-negative delta for UI display — integer values without a
   * trailing ".0", fractional values with minimal representation (1.0 -> "1",
   * 2.5 -> "2.5", 2.25 -> "2.25"). Cross-platform parity with the Kotlin port.
   */
  formatGoalDelta: (value) => {
    const v = Math.max(0, value || 0);
    const floorVal = Math.floor(v);
    if (v === floorVal) return String(floorVal);
    // Trim trailing zeros: 2.50 -> "2.5", 2.250 -> "2.25"
    let s = String(v);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s;
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

  /**
   * Population-level life-expectancy estimate (item 6) — NOT a personalized
   * medical measurement. Built from LIFE_MINUTES_PER_UNIT, a cohort average.
   * Always surface this in the UI with population-estimate labeling; never
   * imply it is a precise fact about the individual user.
   */
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
    return Math.floor(total * LIFE_MINUTES_PER_UNIT);
  },

  /**
   * Population-level "time recovered" estimate (item 6) — same caveat as
   * calculateLifeLostMinutes. This measures target adherence (units under
   * target * minutes/unit), NOT reduction vs. baseline; it is intentionally
   * a different number from `getReduction`/`calculateBaselineSavings`.
   */
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
        recovered += Math.max(0, limit - count) * LIFE_MINUTES_PER_UNIT;
      });
    });

    smokingConfigs.forEach((c) => {
      const count = Math.max(0, (activeCounts || {})[c.id] || 0);
      const limit = Math.max(0, c.limit || 0);
      recovered += Math.max(0, limit - count) * LIFE_MINUTES_PER_UNIT;
    });

    return Math.floor(recovered);
  },

  /**
   * Global metrics — Android getGlobalMetrics parity.
   * Prefer lifetimeAggregates.saved when present (authoritative from transactions).
   *
   * `dayDocs` (optional, default []) is threaded through to calculateStreak
   * for snapshot-aware historical target checks (item 2). It does not affect
   * any other field's math, so omitting it reproduces the exact prior output
   * for callers/tests that only know about `logs`.
   */
  getGlobalMetrics: (logs, configs, activeCounts, trackingDay, userPrice = 0.5, lifetimeAggregates = null, dayDocs = []) => {
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
    let trackingStreak = 0;
    try {
      streak = SmokingCalculator.calculateStreak(logs, configs, activeCounts, trackingDay, dayDocs);
      trackingStreak = SmokingCalculator.calculateTrackingStreak(logs, activeCounts, trackingDay, dayDocs);
    } catch { /* keep 0 */ }
    const goalStatus = SmokingCalculator.getGoalStatus(sessionCounts, configs);

    let savedLifetime = 0;
    Object.values(logged).forEach((dayCounts) => {
      savedLifetime += SmokingCalculator.calculateDayFinancials(dayCounts, configs, userPrice).saved;
    });
    if (lifetimeAggregates != null && lifetimeAggregates.saved != null) {
      savedLifetime = lifetimeAggregates.saved;
    }

    // Baseline-derived savings/reduction (item 3) — always computed from
    // baseline vs. actual, never from target vs. actual. Lifetime baseline
    // savings prefer the maintained rollup (folded in when a day closes);
    // today's still-open contribution is added live from current configs,
    // mirroring how spentToday/budgetLeftToday already layer session-on-top
    // -of-lifetime.
    const sessionBaseline = SmokingCalculator.calculateBaselineSavings(sessionCounts, configs, userPrice);
    const baselineSavedLifetime = (lifetimeAggregates?.baselineSaved || 0) + sessionBaseline.moneySaved;
    const hasAnyBaseline = sessionBaseline.hasBaseline || (configs || []).some((c) => c.baseline != null);

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
      trackingStreak,
      spentToday: sessionFin.wasted,
      budgetLeftToday: sessionFin.saved,
      saved: sessionFin.saved,
      savedLifetime,
      hasBaseline: hasAnyBaseline,
      baselineSavedToday: sessionBaseline.moneySaved,
      baselineUnitsAvoidedToday: sessionBaseline.unitsAvoided,
      baselineSavedLifetime,
      progress: limit > 0 ? count / limit : 0,
      lifeLost,
      recovered,
      goalStatus,
      activeCounts: sessionCounts,
      hasOpenSession: SmokingCalculator.hasOpenSession(sessionCounts)
    };
  },

  /**
   * Aggregate daily tracking data into monthly summaries for historical insights.
   *
   * Uses the canonical merge semantics: `aggregateLoggedCounts(logs)` merges legacy
   * log archives + manual entries per date, then `mergeDayDocsIntoLogged` additively
   * overlays `days/{date}` documents — identical to `buildVelocitySeries` and
   * `calculateStreak`. In production, each date is written by exactly one source
   * (the day-doc schema ships forward from the migration point), so overlap is
   * a no-op. Where both exist, the merge is additive — the established domain
   * behavior, not an Insights-specific choice.
   *
   * Historical economics use each day's stamped `trackerSnapshots` via
   * `computeDayCredit` — NEVER current configs. See regression test "historical
   * snapshots with old prices."
   *
   * Missing-day semantics: only dates present in the merged set count as "tracked
   * days." Untracked calendar days are excluded from the denominator (tracked-day
   * average), not treated as zero.
   *
   * @param {Array} logs - legacy LogEntry[] (archives, manual entries)
   * @param {Array} dayDocs - List<DayDocument> with { date, counts, trackerSnapshots, aggregateCredit }
   * @param {string} trackingDay - today's YYYY-MM-DD
   * @param {object} activeCounts - { [trackerId]: count } for the still-open session
   * @param {number} defaultUnitPrice - fallback price for legacy data without snapshots
   * @param {number} monthsToInclude - how many complete recent months + current MTD to include
   * @returns {{ months: Array<{ month: string, label: string, units: number, trackedDays: number, avgUnitsPerTrackedDay: number, spent: number, saved: number, baselineSaved: number, hasBaseline: boolean, isCurrentMonth: boolean }>, currentMonthMtd: object }}
   */
  aggregateMonthlyData: (logs, dayDocs = [], trackingDay, activeCounts = {}, defaultUnitPrice = 0.5, monthsToInclude = 6) => {
    const merged = SmokingCalculator.mergeDayDocsIntoLogged(
      SmokingCalculator.aggregateLoggedCounts(logs), dayDocs
    );

    // Build per-day records: { date, units, spent, saved, baselineSaved, hasBaseline }
    // For dayDocs with trackerSnapshots, use computeDayCredit for historical economics.
    // For legacy logs without dayDocs, fall back to aggregateLoggedCounts data.
    const snapshotsByDate = {};
    (dayDocs || []).forEach((d) => {
      if (d.date && d.trackerSnapshots) snapshotsByDate[d.date] = d.trackerSnapshots;
    });

    const dayCreditByDate = {};
    (dayDocs || []).forEach((d) => {
      if (d.date && d.aggregateCredit) {
        dayCreditByDate[d.date] = d.aggregateCredit;
      }
    });

    const dayRecords = {};
    Object.entries(merged).forEach(([date, counts]) => {
      let isToday = date === trackingDay;
      let dayCounts = counts || {};

      // If today is still open, merge active counts
      if (isToday) {
        dayCounts = SmokingCalculator.mergeCounts(dayCounts, activeCounts || {});
      }

      const units = Object.values(dayCounts).reduce((sum, v) => sum + Math.max(0, v || 0), 0);

      // Compute financials: prefer stamped dayDoc.aggregateCredit, then computeDayCredit from snapshots,
      // then fall back to zero (legacy logs without economics).
      let spent = 0, saved = 0, baselineSaved = 0, hasBaseline = false;
      if (dayCreditByDate[date]) {
        const credit = dayCreditByDate[date];
        spent = credit.wasted || 0;
        saved = credit.saved || 0;
        baselineSaved = credit.baselineSaved || 0;
        hasBaseline = baselineSaved > 0;
      } else if (snapshotsByDate[date]) {
        const credit = SmokingCalculator.computeDayCredit(dayCounts, snapshotsByDate[date], defaultUnitPrice);
        spent = credit.wasted || 0;
        saved = credit.saved || 0;
        baselineSaved = credit.baselineSaved || 0;
        hasBaseline = baselineSaved > 0;
      }

      dayRecords[date] = { units, spent, saved, baselineSaved, hasBaseline };
    });

    // Group by calendar month (YYYY-MM)
    const monthsMap = {};
    Object.entries(dayRecords).forEach(([date, record]) => {
      const monthKey = date.substring(0, 7); // "YYYY-MM"
      if (!monthsMap[monthKey]) {
        monthsMap[monthKey] = { month: monthKey, days: [] };
      }
      monthsMap[monthKey].days.push({ date, ...record });
    });

    // Get today's month key for current month detection
    const todayMonthKey = trackingDay ? trackingDay.substring(0, 7) : null;

    // Sort months descending (newest first)
    const sortedMonths = Object.keys(monthsMap).sort().reverse();

    // Build month summaries
    const months = sortedMonths.map((monthKey) => {
      const monthData = monthsMap[monthKey];
      const isCurrentMonth = monthKey === todayMonthKey;
      const trackedDays = monthData.days.length;
      const totalUnits = monthData.days.reduce((sum, d) => sum + d.units, 0);
      const totalSpent = monthData.days.reduce((sum, d) => sum + d.spent, 0);
      const totalSaved = monthData.days.reduce((sum, d) => sum + d.saved, 0);
      const totalBaselineSaved = monthData.days.reduce((sum, d) => sum + d.baselineSaved, 0);
      const hasBaseline = monthData.days.some((d) => d.hasBaseline);

      return {
        month: monthKey,
        label: SmokingCalculator.formatMonthLabel(monthKey),
        units: totalUnits,
        trackedDays,
        avgUnitsPerTrackedDay: trackedDays > 0 ? totalUnits / trackedDays : 0,
        spent: totalSpent,
        saved: totalSaved,
        baselineSaved: totalBaselineSaved,
        hasBaseline,
        isCurrentMonth,
        // Only complete months have MTD data
        isComplete: !isCurrentMonth,
      };
    });

    // Sort: current month (MTD) first, then complete months descending
    const currentMonthMtd = months.find((m) => m.isCurrentMonth) || null;
    const completedMonths = months.filter((m) => !m.isCurrentMonth);

    // Limit to monthsToInclude complete months (plus current MTD)
    const trimmedCompleted = completedMonths.slice(0, monthsToInclude);

    return {
      months: currentMonthMtd
        ? [currentMonthMtd, ...trimmedCompleted]
        : trimmedCompleted,
      currentMonthMtd,
      completedMonths: trimmedCompleted,
    };
  },

  /** Format a YYYY-MM string like "2026-09" into "September 2026". */
  formatMonthLabel: (monthKey) => {
    if (!monthKey || monthKey.length < 7) return monthKey;
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    const monthName = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    return `${monthName} ${y}`;
  },

  /**
   * Compare two period averages. Returns a trend object with safe zero-denominator handling.
   *
   * @param {number} currentAvg - average for the current period
   * @param {number} previousAvg - average for the comparable previous period
   * @returns {{ current: number, previous: number, delta: number, percentChange: number|null, direction: 'down'|'up'|'unchanged'|'from_zero'|'to_zero', text: string }}
   */
  calculateTrend: (currentAvg, previousAvg) => {
    const current = Math.max(0, currentAvg || 0);
    const previous = Math.max(0, previousAvg || 0);

    if (previous > 0 && current > 0) {
      const pct = ((current - previous) / previous) * 100;
      const direction = pct < 0 ? 'down' : pct > 0 ? 'up' : 'unchanged';
      const absPct = Math.abs(pct);
      const text = pct < 0
        ? `${absPct.toFixed(0)}% fewer units`
        : pct > 0
          ? `${absPct.toFixed(0)}% more units`
          : 'unchanged';
      return { current, previous, delta: current - previous, percentChange: pct, direction, text };
    }

    if (previous === 0 && current === 0) {
      return { current, previous, delta: 0, percentChange: 0, direction: 'unchanged', text: 'unchanged' };
    }

    if (previous === 0 && current > 0) {
      return { current, previous, delta: current, percentChange: null, direction: 'from_zero', text: 'increased from zero' };
    }

    // previous > 0, current === 0
    return { current, previous, delta: -previous, percentChange: -100, direction: 'to_zero', text: '100% fewer units' };
  },
};
