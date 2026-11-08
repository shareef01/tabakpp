/**
 * Trusted server-side financial domain for the Option-B ledger.
 *
 * This is the AUTHORITATIVE implementation for persisted Option-B credit —
 * clients never decide the stored value.
 *
 * `computeDayCredit` is a direct port of the client formula
 * (`webApp/src/utils/smokingCalculator.js` and the Kotlin `SmokingCalculator`);
 * `financial.test.js` runs it against the same `shared-tests/domain-fixtures.json`
 * `dayCredit` cases the Web and Kotlin contract suites assert, so the three
 * cannot drift apart on the per-day formula.
 *
 * `calculateDailyFinancials` is deliberately NOT a port: it extends the
 * clients' (still unwired) version with the historical-safety rules below —
 * unresolved components, live config only for the current date, stored ledger
 * snapshots — so it is covered by its own tests in `financial.test.js`, not by
 * cross-platform fixtures.
 */

export const SMOKING_TYPES = ['CIGARETTE', 'RYO_ROLL', 'JOINT_KING'];

export const isArchiveLog = (log) => log?.origin === 'DAY_RESET' || (log?.id || '').endsWith('_DAY');

export const roundMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const parts = String(abs).split('e');
  const shifted = Number(parts[0] + 'e' + (parts[1] ? Number(parts[1]) + 2 : '2'));
  const rounded = Math.round(shifted + 1e-12);
  if (rounded === 0) return 0;
  const roundedParts = String(rounded).split('e');
  const result = Number(roundedParts[0] + 'e' + (roundedParts[1] ? Number(roundedParts[1]) - 2 : '-2'));
  return sign * result;
};

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
    if (snap?.isFinanciallyTracked !== false && Number.isFinite(Number(price))) {
      wasted += count * Number(price);
      saved += Math.max(0, target - count) * Number(price);
      if (snap?.baseline != null) {
        baselineSaved += Math.max(0, snap.baseline - count) * Number(price);
      }
    }
    if (SMOKING_TYPES.includes(snap?.type)) smokingUnits += count;
  });
  return {
    wasted: roundMoney(wasted),
    saved: roundMoney(saved),
    smokingUnits: Math.round(smokingUnits),
    baselineSaved: roundMoney(baselineSaved),
  };
};

/**
 * Reconstruct a tracker's historical {target,baseline,unitPrice} from a log
 * stamp. Validity comes from the stamp RECORDING a component (including an
 * explicit 0), NOT from positive savings — a valid zero-savings historical
 * stamp (target == consumption) must stay reconstructible. A component the
 * stamp does not record is `null` (UNKNOWN), never an invented value.
 *
 * FIX 2: Immutable per-tracker snapshots stored on the log (`trackerSnapshots`)
 * are preferred directly. For legacy logs without snapshots, unit price is derived
 * ONLY if the log has a single active tracker. Multi-tracker logs without per-tracker
 * snapshots return null to prevent duplicate spending or manufactured unit prices.
 */
export const deriveSnapshotFromLog = (log, trackerId, fallbackType) => {
  const count = (log?.counts || {})[trackerId] || 0;
  if (count <= 0) return null;

  // 1. Prefer persisted per-tracker snapshot on the log (FIX 2)
  const snap = log?.trackerSnapshots?.[trackerId];
  if (snap && (snap.unitPrice != null || snap.target != null || snap.baseline != null)) {
    const price = snap.unitPrice == null ? null : Number(snap.unitPrice);
    const target = snap.target == null ? null : Math.max(0, Math.round(Number(snap.target)));
    const baseline = snap.baseline == null ? null : Math.max(0, Math.round(Number(snap.baseline)));
    return {
      type: snap.type || fallbackType || 'CIGARETTE',
      target,
      baseline,
      unitPrice: price,
      isFinanciallyTracked: snap.isFinanciallyTracked !== false,
      isPrimaryTracked: snap.isPrimaryTracked === true,
      __derived: false,
      __fromLogSnapshot: true,
      __hasTarget: target != null,
      __hasBaseline: baseline != null,
    };
  }

  // 2. Legacy fallback from aggregateCredit
  const c = log?.aggregateCredit;
  if (!c) return null;

  // If there are multiple active trackers in this log and no per-tracker snapshot,
  // we CANNOT derive individual tracker prices by dividing total wasted by count.
  const activeEntries = Object.entries(log?.counts || {}).filter(([_, v]) => Number(v) > 0);
  if (activeEntries.length > 1) {
    return null; // Irrecoverable without snapshot: keep unresolved rather than fabricating
  }

  const price = Number.isFinite(Number(c.wasted)) ? Number(c.wasted) / count : null;
  if (price == null || price <= 0 || !Number.isFinite(price)) return null;

  // A POSITIVE recorded allowance reconstructs a target. A bare `saved: 0`
  // cannot (target == count is indistinguishable from "no allowance recorded"),
  // so a zero-savings stamp alone stays UNRESOLVED — only a dated snapshot can
  // verify a legitimate zero-savings day.
  const hasTarget = c.saved != null && Number(c.saved) > 0;
  const hasBaseline = c.baselineSaved != null && Number(c.baselineSaved) > 0;
  return {
    type: fallbackType || 'CIGARETTE',
    target: hasTarget && price > 0 ? Math.max(0, Math.round(count + Number(c.saved) / price)) : null,
    baseline: hasBaseline && price > 0 ? Math.max(0, Math.round(count + Number(c.baselineSaved) / price)) : null,
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

/**
 * The dated stamp the trusted writer persists for a tracker (day doc / log).
 * A tracker with no own price uses the profile default — the same resolution
 * both clients stamp (web `buildTrackerSnapshot`, Kotlin `buildTrackerSnapshot`).
 * Stamping `null` instead made `calculateDailyFinancials` treat the price as
 * UNKNOWN, so every tap on such a tracker earned no money, frozen at close.
 */
export const stampFromConfig = (cfg, defaultUnitPrice) => ({
  type: cfg?.type,
  target: num(cfg?.limit),
  baseline: cfg?.baseline ?? null,
  unitPrice: cfg?.pricePerUnit ?? defaultUnitPrice,
  isFinanciallyTracked: cfg?.isFinanciallyTracked !== false,
  isPrimaryTracked: cfg?.isPrimaryTracked === true,
});

/**
 * The own credit a MANUAL_UPDATE stores on the edited log. A past-date edit may
 * only re-price from the log's own stamps: the old aggregateCredit describes the
 * OLD counts, and keeping it beside new counts made an unstamped legacy log
 * derive price = oldWasted / newCount and report that wrong spend as resolved.
 * Without a priced stamp for every edited tracker the money becomes UNKNOWN,
 * exactly like a MANUAL_CREATE backfill. `saved` stays 0: the allowance is
 * day-level and credited once by calculateDailyFinancials.
 */
export const manualUpdateCredit = (counts, logSnapshots, isCurrent, defaultUnitPrice) => {
  const stamped = isCurrent || Object.keys(counts || {}).every((id) => {
    const s = (logSnapshots || {})[id];
    return s != null && (s.unitPrice != null || s.isFinanciallyTracked === false);
  });
  const own = stamped
    ? computeDayCredit(counts, logSnapshots, defaultUnitPrice)
    : { wasted: 0, smokingUnits: computeDayCredit(counts, {}, defaultUnitPrice).smokingUnits, baselineSaved: 0 };
  return {
    credit: { saved: 0, wasted: own.wasted, smokingUnits: own.smokingUnits, baselineSaved: 0 },
    unresolvedEconomics: !stamped,
  };
};

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
  const date = dayDoc?.date || logsForDate?.[0]?.logDate || null;
  const isCurrent = !!(opts.currentTrackingDate && date === opts.currentTrackingDate);
  const effectiveLogs = (logsForDate || []).filter((l) => !(dayDoc && isArchiveLog(l)));

  const rawLedgerSnaps = opts.ledgerSnapshots || {};
  const daySnaps = dayDoc?.trackerSnapshots || {};
  const isOpenDay = !dayDoc || dayDoc.status === 'open' || (isCurrent && dayDoc.status !== 'closed');
  const ledgerSnaps = isOpenDay
    ? Object.fromEntries(
        Object.entries(rawLedgerSnaps).filter(([id]) =>
          Boolean(daySnaps[id])
          || Number(dayDoc?.counts?.[id] || 0) > 0
          || effectiveLogs.some((l) => Number(l.counts?.[id] || 0) > 0)
        )
      )
    : rawLedgerSnaps;
  const snapshots = { ...ledgerSnaps, ...daySnaps };
  let ambiguous = false;
  const conflicting = [];
  const missingConfig = new Set();

  effectiveLogs.forEach((log) => {
    Object.entries(log.counts || {}).forEach(([id, v]) => {
      counts[id] = Math.max(0, (counts[id] || 0) + Math.max(0, v || 0));
    });
  });

  const hasLogConsumption = effectiveLogs.some((l) => Object.values(l.counts || {}).some((v) => Number(v) > 0));
  const hasDayEvidence = !!dayDoc && (
    dayDoc.status === 'closed'
    || dayDoc.foldedIntoLifetime === true
    || Object.keys(dayDoc.counts || {}).length > 0
    || Object.keys(dayDoc.trackerSnapshots || {}).length > 0
  );
  const eligible = hasDayEvidence || hasLogConsumption;

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
        const samePrice = Math.abs(Number(existing.unitPrice ?? defaultUnitPrice) - Number(derived.unitPrice ?? defaultUnitPrice)) < 1e-4;
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
    if (missingConfig.size > 0) {
      for (const id of missingConfig) {
        if ((counts[id] || 0) > 0) {
          unresolved.spent = true;
          unresolved.saved = true;
          unresolved.smokingUnits = true;
        }
      }
    }
    Object.entries(snapshots).forEach(([id, snap]) => {
      const count = Math.max(0, counts[id] || 0);
      const isRelevantFinancialSnapshot = count > 0 || Number(snap?.target || 0) > 0 || Number(snap?.baseline || 0) > 0;
      const pOk = priceKnown(snap);
      const tOk = targetKnown(snap);
      const bOk = baselineKnown(snap);
      const price = Number(snap?.unitPrice);
      if (snap?.isFinanciallyTracked !== false && isRelevantFinancialSnapshot) {
        if (pOk) wasted += count * price; else if (count > 0) unresolved.spent = true;
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
    ? {
        wasted: roundMoney(wasted),
        saved: roundMoney(saved),
        smokingUnits: Math.round(smokingUnits),
        baselineSaved: roundMoney(baselineSaved),
      }
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
 * Validate and merge a HISTORICAL_DAY_UPDATE payload against the closed day's
 * known historical snapshots.
 *
 * - Ignores zero-count entries for trackers absent from both existing day counts
 *   and known historical snapshots.
 * - Drops zero-count entries from the persisted day counts map (so Firestore
 *   map replacement removes zeroed keys cleanly while frozen snapshots retain
 *   the tracker's daily target allowance).
 * - Validates relevant financial snapshots (trackers present in before/after
 *   counts or snapshots with positive target/baseline), rejecting edits that
 *   require unavailable historical pricing with `HISTORICAL_PRICE_UNAVAILABLE`
 *   instead of silently resetting historical savings to zero.
 */
export const resolveHistoricalDayEdit = (day, incomingCounts, ledgerSnapshots = {}, maxCount = 10_000, maxDayTrackers = 50) => {
  const prevCounts = day?.counts || {};
  const knownSnapshots = { ...(ledgerSnapshots || {}), ...(day?.trackerSnapshots || {}) };
  const merged = { ...prevCounts };
  for (const [k, v] of Object.entries(incomingCounts || {})) {
    if (v > 0 || Object.hasOwn(prevCounts, k) || Object.hasOwn(knownSnapshots, k)) {
      merged[k] = v;
    }
  }
  for (const [k, v] of Object.entries(merged)) {
    if (v === 0) delete merged[k];
    else if (!Number.isInteger(v) || v < 0 || v > maxCount) {
      throw new Error('INVALID_COUNT');
    }
  }
  if (Object.keys(merged).length > maxDayTrackers) {
    throw new Error('TOO_MANY_TRACKERS');
  }
  const hasValidPrice = (s) => s?.unitPrice != null && Number.isFinite(Number(s.unitPrice));
  const touchedOrActiveIds = new Set([
    ...Object.keys(merged),
    ...Object.keys(prevCounts),
  ]);
  if (
    Object.keys(knownSnapshots).length === 0
    || [...touchedOrActiveIds].some((id) => !knownSnapshots[id])
    || Object.entries(knownSnapshots).some(([id, s]) => (
      s?.isFinanciallyTracked !== false
      && (touchedOrActiveIds.has(id) || Number(s?.target || 0) > 0 || Number(s?.baseline || 0) > 0)
      && !hasValidPrice(s)
    ))
  ) {
    throw new Error('HISTORICAL_PRICE_UNAVAILABLE');
  }
  return merged;
};

/**
 * Migration planner (Phase 8) — pure. For every date that has records, compares
 * the already-credited LEGACY contribution (day stamp + Σ log stamps) to the
 * canonical Option-B day credit across all FOUR financial aggregate fields
 * (saved, wasted, baselineSaved, smokingUnits) and classifies the date:
 *   D — already correct (no delta)
 *   A — reconstructible difference (migrate idempotently)
 *   B — ambiguous stamps (needs a human interpretation decision)
 *   C — non-reconstructible (missing config) — preserved, never invented
 * The lifetime correction for an A date is `canonical - legacy` (NET replacement).
 */
export const migrationPlan = (dates, configs = [], defaultUnitPrice = 0.5) => {
  const out = [];
  for (const { date, day, logs } of dates) {
    const legacyLogs = (logs || []).filter((l) => !(day && isArchiveLog(l)));
    const fin = calculateDailyFinancials(day, legacyLogs, configs, defaultUnitPrice);
    const legacySaved = num(day?.aggregateCredit?.saved) + legacyLogs.reduce((a, l) => a + num(l?.aggregateCredit?.saved), 0);
    const legacyWasted = num(day?.aggregateCredit?.wasted) + legacyLogs.reduce((a, l) => a + num(l?.aggregateCredit?.wasted), 0);
    const legacyBaselineSaved = num(day?.aggregateCredit?.baselineSaved) + legacyLogs.reduce((a, l) => a + num(l?.aggregateCredit?.baselineSaved), 0);
    const legacySmokingUnits = num(day?.aggregateCredit?.smokingUnits) + legacyLogs.reduce((a, l) => a + num(l?.aggregateCredit?.smokingUnits), 0);

    const deltaSaved = roundMoney(fin.canonicalCredit.saved - legacySaved);
    const deltaWasted = roundMoney(fin.canonicalCredit.wasted - legacyWasted);
    const deltaBaselineSaved = roundMoney(fin.canonicalCredit.baselineSaved - legacyBaselineSaved);
    const deltaSmokingUnits = Math.round(fin.canonicalCredit.smokingUnits - legacySmokingUnits);

    const u = fin.unresolved || {};
    let category;
    if (fin.missingConfig.length > 0 && Object.keys(fin.snapshots).length === 0) category = 'C';
    else if (fin.ambiguous || u.saved || u.spent || u.baselineSaved || u.smokingUnits) category = 'B';
    else if (
      Math.abs(deltaSaved) < 1e-4
      && Math.abs(deltaWasted) < 1e-4
      && Math.abs(deltaBaselineSaved) < 1e-4
      && Math.abs(deltaSmokingUnits) === 0
    ) category = 'D';
    else category = 'A';
    out.push({
      date,
      category,
      legacySaved: roundMoney(legacySaved),
      legacyWasted: roundMoney(legacyWasted),
      legacyBaselineSaved: roundMoney(legacyBaselineSaved),
      legacySmokingUnits: Math.round(legacySmokingUnits),
      canonicalSaved: fin.canonicalCredit.saved,
      canonicalWasted: fin.canonicalCredit.wasted,
      canonicalBaselineSaved: fin.canonicalCredit.baselineSaved,
      canonicalSmokingUnits: fin.canonicalCredit.smokingUnits,
      deltaSaved,
      deltaWasted,
      deltaBaselineSaved,
      deltaSmokingUnits,
      fin,
    });
  }
  return out;
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

