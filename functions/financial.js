/**
 * Trusted server-side financial domain for the Option-B ledger.
 *
 * This is a faithful port of the canonical client calculation
 * (`webApp/src/utils/smokingCalculator.js`): `computeDayCredit` +
 * `calculateDailyFinancials`. It is the AUTHORITATIVE implementation for
 * persisted Option-B credit — clients never decide the stored value.
 *
 * A cross-platform contract test (`webApp/src/services/financialParity.test.js`)
 * asserts this agrees with the Web calculator over shared fixtures, so Web and
 * the backend cannot drift into two interpretations. (Kotlin parity is covered
 * by shared fixtures in `shared-tests/`.)
 */

export const SMOKING_TYPES = ['CIGARETTE', 'RYO_ROLL', 'JOINT_KING'];

export const isArchiveLog = (log) => log?.origin === 'DAY_RESET' || (log?.id || '').endsWith('_DAY');

/**
 * Day-level canonical credit: one target/baseline allowance per tracker/date.
 *  - wasted        = Σ count × price          (actual consumption cost)
 *  - saved         = Σ max(0, target − count) × price   (allowance ONCE)
 *  - baselineSaved = Σ max(0, baseline − count) × price (allowance ONCE)
 *  - smokingUnits  = Σ count for smoking-type trackers
 */
export const computeDayCredit = (counts, trackerSnapshots, defaultUnitPrice = 0.5) => {
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

/**
 * Reconstruct a tracker's historical {target,baseline,unitPrice} from a log
 * stamp. Validity comes from the stamp RECORDING a component (including an
 * explicit 0), NOT from positive savings — a valid zero-savings historical
 * stamp (target == consumption) must stay reconstructible. A component the
 * stamp does not record is `null` (UNKNOWN), never an invented value.
 */
export const deriveSnapshotFromLog = (log, trackerId, fallbackType) => {
  const count = (log?.counts || {})[trackerId] || 0;
  const c = log?.aggregateCredit;
  if (!c || count <= 0) return null;
  const price = Number.isFinite(Number(c.wasted)) ? Number(c.wasted) / count : null;
  if (price == null || !(price > 0)) return null;
  // A POSITIVE recorded allowance reconstructs a target. A bare `saved: 0`
  // cannot (target == count is indistinguishable from "no allowance recorded"),
  // so a zero-savings stamp alone stays UNRESOLVED — only a dated snapshot can
  // verify a legitimate zero-savings day.
  const hasTarget = c.saved != null && Number(c.saved) > 0;
  const hasBaseline = c.baselineSaved != null && Number(c.baselineSaved) > 0;
  return {
    type: fallbackType || 'CIGARETTE',
    target: hasTarget ? Math.max(0, Math.round(count + Number(c.saved) / price)) : null,
    baseline: hasBaseline ? Math.max(0, Math.round(count + Number(c.baselineSaved) / price)) : null,
    unitPrice: price,
    isFinanciallyTracked: true,
    isPrimaryTracked: true,
    __derived: true,
    __hasTarget: hasTarget,
    __hasBaseline: hasBaseline,
  };
};

/** Build a tracker snapshot from a live tracker config. */
export const snapshotFromConfig = (cfg) => ({
  type: cfg?.type,
  target: Math.max(0, Number(cfg?.limit) || 0),
  baseline: cfg?.baseline == null ? null : Math.max(0, Number(cfg.baseline) || 0),
  unitPrice: cfg?.pricePerUnit == null ? null : Number(cfg.pricePerUnit),
  isFinanciallyTracked: cfg?.isFinanciallyTracked !== false,
  isPrimaryTracked: cfg?.isPrimaryTracked === true,
  __fromConfig: true,
  __hasTarget: cfg?.limit != null,
  __hasBaseline: cfg?.baseline != null,
});

const ZERO_CREDIT = { wasted: 0, saved: 0, smokingUnits: 0, baselineSaved: 0 };

/**
 * Canonical per-date aggregator — combines ONE tracking date's consumption
 * (day document + its manual logs) and computes the day-level credit ONCE.
 *
 * HISTORICAL SAFETY (Tasks A/B/C): a date's money is only credited from
 * components that are historically KNOWN. A component that cannot be
 * reconstructed is left UNRESOLVED (excluded from `canonicalCredit`, reported
 * in `unresolved`) — never estimated from the current config. Snapshot sources
 * in priority order:
 *   1. the date's stored snapshots (ledger + day-doc — dated historical truth);
 *   2. a log-derived historical stamp (component-wise: a stamp may give a price
 *      but no target);
 *   3. for the CURRENT tracking date only, the live tracker config;
 *   4. otherwise the component is UNKNOWN (`unresolved`/`missingConfig`).
 * Conflicting stamps for one tracker/date set `ambiguous` + `conflicting`.
 */
export const calculateDailyFinancials = (dayDoc, logsForDate = [], configs = [], defaultUnitPrice = 0.5, opts = {}) => {
  const typeById = Object.fromEntries((configs || []).map((c) => [c.id, c.type]));
  const counts = { ...(dayDoc?.counts || {}) };
  const ledgerSnaps = opts.ledgerSnapshots || {};
  const daySnaps = dayDoc?.trackerSnapshots || {};
  const snapshots = { ...ledgerSnaps, ...daySnaps };
  let ambiguous = false;
  const conflicting = [];
  const missingConfig = new Set();

  const effectiveLogs = (logsForDate || []).filter((l) => !(dayDoc && isArchiveLog(l)));
  effectiveLogs.forEach((log) => {
    Object.entries(log.counts || {}).forEach(([id, v]) => {
      counts[id] = Math.max(0, (counts[id] || 0) + Math.max(0, v || 0));
    });
  });

  const hasLogConsumption = effectiveLogs.some((l) => Object.values(l.counts || {}).some((v) => Number(v) > 0));
  const eligible = !!dayDoc || hasLogConsumption;

  const date = dayDoc?.date || logsForDate?.[0]?.logDate || null;
  const isCurrent = !!(opts.currentTrackingDate && date === opts.currentTrackingDate);
  const stored = (id) => !!(ledgerSnaps[id] || daySnaps[id]);

  // Historical log stamps — skipped for the current day (its live config rules).
  if (!isCurrent) {
    effectiveLogs.forEach((log) => {
      Object.keys(log.counts || {}).forEach((id) => {
        if ((log.counts || {})[id] <= 0) return;
        const derived = deriveSnapshotFromLog(log, id, typeById[id]);
        if (!derived) return;
        if (stored(id)) return;                 // dated truth wins; its logs are consumption-only
        const existing = snapshots[id];
        if (!existing) { snapshots[id] = derived; return; }
        if (existing.__fromConfig) { snapshots[id] = derived; return; } // historical stamp beats live config
        // Two historical log stamps disagree about the same tracker/date.
        const sameTarget = Math.round(Number(existing.target) || 0) === Math.round(Number(derived.target) || 0);
        const samePrice = Number(existing.unitPrice ?? defaultUnitPrice) === Number(derived.unitPrice ?? defaultUnitPrice);
        if (!sameTarget || !samePrice) {
          ambiguous = true;
          if (!conflicting.includes(id)) conflicting.push(id);
        }
      });
    });
  }

  Object.keys(counts).forEach((id) => {
    if (stored(id)) return;                       // 1. stored dated truth
    const cfg = (configs || []).find((c) => c.id === id);
    if (snapshots[id]) {                          // 2. historical stamp
      // For the CURRENT day, fill a missing target/baseline from the live config.
      if (isCurrent && cfg) snapshots[id] = snapshotFromConfig(cfg);
      return;
    }
    if (cfg) { snapshots[id] = snapshotFromConfig(cfg); if (!isCurrent) ambiguous = true; return; }
    missingConfig.add(id);
  });

  // Per-component knowledge gates. `__fromConfig` values are only KNOWN for the
  // current tracking date; historical dates must rely on stored/stamped values.
  const priceKnown = (s) => {
    if (!s || s.unitPrice == null || !Number.isFinite(Number(s.unitPrice))) return s?.__fromConfig ? false : false;
    return s.__fromConfig ? isCurrent : true;
  };
  const targetKnown = (s) => {
    if (!s) return false;
    if (s.__fromConfig) return isCurrent && s.__hasTarget !== false;
    if (s.__derived) return s.__hasTarget === true;
    return s.target != null;
  };
  const baselineKnown = (s) => {
    if (!s) return false;
    if (s.__fromConfig) return isCurrent;
    if (s.__derived) return s.__hasBaseline === true;
    return true; // a stored snapshot with no baseline legitimately has none
  };
  // A tracker's SMOKING classification is historical only when it comes from a
  // dated stored snapshot — a log stamp's type is the current config fallback,
  // and a live config is only valid for the current day.
  const typeKnown = (s) => {
    if (!s) return false;
    if (s.__fromConfig) return isCurrent;
    if (s.__derived) return false;
    return s.type != null;
  };

  const unresolved = { spent: false, saved: false, baselineSaved: false, smokingUnits: false };
  let wasted = 0; let saved = 0; let smokingUnits = 0; let baselineSaved = 0;
  if (eligible) {
    Object.entries(snapshots).forEach(([id, snap]) => {
      const count = Math.max(0, counts[id] || 0);
      const pOk = priceKnown(snap);
      const tOk = targetKnown(snap);
      const bOk = baselineKnown(snap);
      const price = Number(snap?.unitPrice);
      if (snap?.isFinanciallyTracked !== false) {
        if (pOk) wasted += count * price; else unresolved.spent = true;
        if (pOk && tOk) saved += Math.max(0, Number(snap.target) - count) * price; else unresolved.saved = true;
        if (snap?.baseline != null && pOk) baselineSaved += Math.max(0, Number(snap.baseline) - count) * price;
        else if (!bOk) unresolved.baselineSaved = true;
      }
      if (typeKnown(snap)) {
        if (SMOKING_TYPES.includes(snap?.type)) smokingUnits += count;
      } else if (count > 0) {
        unresolved.smokingUnits = true; // unproven historical classification
      }
    });
  }

  // Provenance: a live-config snapshot for a PAST date is an estimate, not dated
  // truth — never persist it as if it were historical fact.
  const persistedSnapshots = { ...snapshots };
  if (!isCurrent) {
    Object.keys(persistedSnapshots).forEach((id) => {
      if (persistedSnapshots[id]?.__fromConfig) delete persistedSnapshots[id];
    });
  }

  const credit = eligible
    ? { wasted, saved, smokingUnits, baselineSaved }
    : { ...ZERO_CREDIT };
  return {
    date,
    counts,
    snapshots: persistedSnapshots,
    eligible,
    spent: credit.wasted,
    saved: credit.saved,
    baselineSaved: credit.baselineSaved,
    smokingUnits: credit.smokingUnits,
    canonicalCredit: credit,
    ambiguous,
    conflicting,
    unresolved: eligible ? unresolved : { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
    missingConfig: [...missingConfig],
  };
};

/** Stable payload fingerprint (sorted canonical JSON) for idempotency receipts. */
export const fingerprintOf = (obj) => {
  const stable = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stable);
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = stable(v[k]); return acc; }, {});
  };
  return JSON.stringify(stable(obj));
};

/** Apply an element-wise count delta, clamping at zero and dropping empties. */
export const applyDelta = (base, delta) => {
  const out = { ...(base || {}) };
  Object.entries(delta || {}).forEach(([id, v]) => {
    const next = Math.max(0, (out[id] || 0) + Number(v || 0));
    if (next > 0) out[id] = next; else delete out[id];
  });
  return out;
};

/**
 * Migration planner (Phase 8) — pure. For every date that has records, compares
 * the already-credited LEGACY contribution (day stamp + Σ log stamps) to the
 * canonical Option-B day credit and classifies the date:
 *   D — already correct (no delta)
 *   A — reconstructible difference (migrate idempotently)
 *   B — ambiguous stamps (needs a human interpretation decision)
 *   C — non-reconstructible (missing config) — preserved, never invented
 * The lifetime correction for an A date is `canonicalSaved - legacySaved`
 * (a NET replacement: never an addition).
 */
export const migrationPlan = (dates, configs = [], defaultUnitPrice = 0.5) => {
  const out = [];
  for (const { date, day, logs } of dates) {
    const legacyLogs = (logs || []).filter((l) => !(day && isArchiveLog(l)));
    const fin = calculateDailyFinancials(day, legacyLogs, configs, defaultUnitPrice);
    const legacySaved = num(day?.aggregateCredit?.saved) + legacyLogs.reduce((a, l) => a + num(l?.aggregateCredit?.saved), 0);
    const legacyWasted = num(day?.aggregateCredit?.wasted) + legacyLogs.reduce((a, l) => a + num(l?.aggregateCredit?.wasted), 0);
    const deltaSaved = fin.canonicalCredit.saved - legacySaved;
    const deltaWasted = fin.canonicalCredit.wasted - legacyWasted;
    const u = fin.unresolved || {};
    let category;
    if (fin.missingConfig.length > 0 && Object.keys(fin.snapshots).length === 0) category = 'C';
    else if (fin.ambiguous || u.saved || u.spent) category = 'B';
    else if (Math.abs(deltaSaved) < 1e-9 && Math.abs(deltaWasted) < 1e-9) category = 'D';
    else category = 'A';
    out.push({ date, category, legacySaved, canonicalSaved: fin.canonicalCredit.saved, deltaSaved, deltaWasted, fin });
  }
  return out;
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

