/**
 * Trusted Option-B financial write boundary.
 *
 * `executeFinancialOperation` is a Firebase Callable that is the ONLY writer of
 * OPTION_B financial state. It derives the uid from verified auth, validates the
 * operation, reads the authoritative sources, recomputes the canonical day
 * credit with the shared server calculation, and persists source + ledger +
 * lifetime + idempotency receipt in ONE Admin transaction (Admin bypasses
 * rules; authorization + arithmetic are enforced here).
 *
 * LEGACY accounts keep their existing client writers; the Firestore rules deny
 * direct client writes for OPTION_B accounts (Phase 3).
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import {
  calculateDailyFinancials, computeDayCredit, fingerprintOf, applyDelta, isArchiveLog, migrationPlan,
} from './financial.js';

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const ZERO = { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 };
const LEDGER_SCHEMA_VERSION = 2;

const SUPPORTED = new Set([
  'COUNTER_INCREMENT', 'COUNTER_DECREMENT',
  'MANUAL_CREATE', 'MANUAL_UPDATE', 'MANUAL_DELETE', 'MANUAL_RESTORE',
  'DAY_CLOSE', 'ZERO_COUNT_DAY_CLOSE',
  'HISTORICAL_DAY_UPDATE', 'TRACKER_DELETE',
]);
const EXPLICITLY_BLOCKED = new Set(['STALE_DAY_RECONCILE']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The account's current tracking date, derived SERVER-side (day-start aware). */
function trackingDateNow(dayStartHour) {
  const d = new Date();
  if (d.getUTCHours() < (Number(dayStartHour) || 6)) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function requireString(v, code) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
    throw new HttpsError('invalid-argument', code);
  }
  return v;
}

/** Read the authoritative per-date state inside a transaction. */
async function readDateState(t, userRef, date) {
  const daySnap = await t.get(userRef.collection('days').doc(date));
  const logsSnap = await t.get(userRef.collection('logs').where('logDate', '==', date));
  const ledgerSnap = await t.get(userRef.collection('dailyFinancials').doc(date));
  const configsSnap = await t.get(userRef.collection('configs'));
  const day = daySnap.exists ? { ...daySnap.data(), date } : null;
  const logs = logsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const ledger = ledgerSnap.exists ? { ...ledgerSnap.data(), date } : null;
  const configs = configsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  return { daySnap, day, logs, ledger, configs, ledgerSnap };
}

/** Write the ledger + (when already folded) the lifetime delta, atomically. */
function writeLedgerAndLifetime(t, userRef, ledgerRef, ledgerExisted, existing, fin, folded) {
  const oldCredit = existing?.canonicalCredit || ZERO;
  const newCredit = fin.canonicalCredit;
  t.set(ledgerRef, {
    date: fin.date,
    countsByTracker: fin.counts,
    snapshots: fin.snapshots,
    canonicalCredit: newCredit,
    ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
    ambiguous: !!fin.ambiguous,
    conflicting: fin.conflicting || [],
    unresolvedComponents: fin.unresolved || { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
    missingConfig: fin.missingConfig || [],
    eligible: fin.eligible !== false,
    foldedIntoLifetime: folded,
    migratedFromLegacy: existing?.migratedFromLegacy === true,
    updatedAt: new Date(),
    ...(ledgerExisted ? {} : { createdAt: new Date() }),
  });
  if (folded) {
    const cur = existing?.__profileAgg || ZERO;
    t.set(userRef, {
      lifetimeAggregates: {
        saved: num(cur.saved) - num(oldCredit.saved) + num(newCredit.saved),
        wasted: num(cur.wasted) - num(oldCredit.wasted) + num(newCredit.wasted),
        smokingUnits: num(cur.smokingUnits) - num(oldCredit.smokingUnits) + num(newCredit.smokingUnits),
        baselineSaved: num(cur.baselineSaved) - num(oldCredit.baselineSaved) + num(newCredit.baselineSaved),
      },
    }, { merge: true });
  }
}

export const executeFinancialOperation = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required.');

  const data = request.data || {};
  const type = data.type;
  const operationId = requireString(data.operationId, 'operationId required');
  if (EXPLICITLY_BLOCKED.has(type)) {
    throw new HttpsError('unimplemented', `${type} is not yet served by the trusted boundary.`);
  }
  if (!SUPPORTED.has(type)) throw new HttpsError('invalid-argument', 'Unsupported operation type.');

  const userRef = db.collection('users').doc(uid);

  // financialMode is authoritative from the server; NEVER from the payload.
  const profileSnap = await userRef.get();
  if (!profileSnap.exists) throw new HttpsError('failed-precondition', 'NO_PROFILE');
  const mode = profileSnap.get('financialMode') || 'LEGACY';
  if (mode !== 'OPTION_B') {
    throw new HttpsError('failed-precondition', `Account is not OPTION_B (financialMode=${mode}).`);
  }

  const receiptRef = userRef.collection('financialOperations').doc(operationId);
  const fp = fingerprintOf({ type, date: data.date, trackerId: data.trackerId, logId: data.logId, counts: data.counts, delta: data.delta });

  return db.runTransaction(async (t) => {
    const receiptSnap = await t.get(receiptRef);
    if (receiptSnap.exists) {
      if (receiptSnap.get('payloadFingerprint') !== fp) {
        throw new HttpsError('already-exists', 'OPERATION_CONFLICT');
      }
      return { applied: false, result: receiptSnap.get('result') || null };
    }

    const date = requireString(data.date, 'date required');
    const { daySnap, day, logs, ledger, configs, ledgerSnap } = await readDateState(t, userRef, date);
    const ledgerRef = userRef.collection('dailyFinancials').doc(date);
    const folded = ledger?.foldedIntoLifetime === true;

    // Attach the current profile aggregates for folded lifetime adjustments.
    const curAgg = profileSnap.get('lifetimeAggregates') || ZERO;
    const ledgerWithAgg = ledger ? { ...ledger, __profileAgg: curAgg } : null;

    // The day state AFTER the staged source mutation. Eligibility and the
    // canonical credit must be derived from this, never from the pre-write
    // snapshot: a COUNTER_INCREMENT on a brand-new date writes the day doc, and
    // deriving eligibility from the stale (absent) day made the op look
    // ineligible, so the ledger was never written (day-only mutation).
    let effectiveDay = day;

    // --- Source mutation (per op type) -------------------------------------
    let effectiveLogs = logs;
    if (type === 'COUNTER_INCREMENT' || type === 'COUNTER_DECREMENT') {
      const trackerId = requireString(data.trackerId, 'trackerId required');
      const delta = type === 'COUNTER_INCREMENT' ? 1 : -1;
      if (day?.status === 'closed') throw new HttpsError('failed-precondition', 'DAY_CLOSED');
      const cfg = configs.find((c) => c.id === trackerId);
      if (!cfg) throw new HttpsError('failed-precondition', 'CONFIG_NOT_FOUND');
      const newCounts = applyDelta(day?.counts || {}, { [trackerId]: delta });
      const trackerSnapshots = {
        ...(day?.trackerSnapshots || {}),
        [trackerId]: snapshotFromConfig(cfg),
      };
      effectiveDay = { ...(day || {}), date, counts: newCounts, trackerSnapshots, status: 'open' };
      t.set(userRef.collection('days').doc(date), {
        date,
        counts: newCounts,
        trackerSnapshots,
        status: 'open',
        updatedAt: new Date(),
        ...(daySnap.exists ? {} : { createdAt: new Date(), foldedIntoLifetime: false, legacyMigrationApplied: false, aggregateCredit: ZERO }),
      }, { merge: true });
      // recompute the day source for the credit
    } else if (type === 'MANUAL_CREATE') {
      const logId = requireString(data.logId, 'logId required');
      const counts = sanitizeCounts(data.counts);
      if (logs.some((l) => l.id === logId)) throw new HttpsError('already-exists', 'LOG_EXISTS');
      const logRef = userRef.collection('logs').doc(logId);
      const own = computeDayCredit(counts, snapshotsForCounts(counts, configs, data.snapshots || {}));
      t.set(logRef, { id: logId, logDate: date, counts, isManual: true, origin: 'MANUAL_ENTRY',
        aggregateCredit: { saved: 0, wasted: own.wasted, smokingUnits: own.smokingUnits, baselineSaved: 0 } });
      effectiveLogs = [...logs, { id: logId, logDate: date, counts, origin: 'MANUAL_ENTRY' }];
    } else if (type === 'MANUAL_UPDATE') {
      const logId = requireString(data.logId, 'logId required');
      const counts = sanitizeCounts(data.counts);
      const target = logs.find((l) => l.id === logId);
      if (!target) throw new HttpsError('not-found', 'LOG_NOT_FOUND');
      const logRef = userRef.collection('logs').doc(logId);
      const own = computeDayCredit(counts, snapshotsForCounts(counts, configs, data.snapshots || {}));
      t.set(logRef, { counts, aggregateCredit: { saved: 0, wasted: own.wasted, smokingUnits: own.smokingUnits, baselineSaved: 0 } }, { merge: true });
      effectiveLogs = logs.map((l) => (l.id === logId ? { ...l, counts } : l));
    } else if (type === 'MANUAL_DELETE') {
      const logId = requireString(data.logId, 'logId required');
      const target = logs.find((l) => l.id === logId);
      if (target) t.delete(userRef.collection('logs').doc(logId));
      effectiveLogs = logs.filter((l) => l.id !== logId);
    } else if (type === 'MANUAL_RESTORE') {
      const logId = requireString(data.logId, 'logId required');
      if (!logs.some((l) => l.id === logId)) {
        const counts = sanitizeCounts(data.counts);
        const own = computeDayCredit(counts, snapshotsForCounts(counts, configs, data.snapshots || {}));
        t.set(userRef.collection('logs').doc(logId), { id: logId, logDate: date, counts, isManual: true, origin: 'MANUAL_ENTRY',
          aggregateCredit: { saved: 0, wasted: own.wasted, smokingUnits: own.smokingUnits, baselineSaved: 0 } });
        effectiveLogs = [...logs, { id: logId, logDate: date, counts, origin: 'MANUAL_ENTRY' }];
      }
    } else if (type === 'HISTORICAL_DAY_UPDATE') {
      // Edit a historical day's counter counts. `trackerSnapshots` are immutable
      // (item 2): the canonical credit is recomputed from the FROZEN stamped
      // config, never from today's settings. Mirrors the LEGACY
      // `updateHistoricalDay` — merge counts, recompute credit, and (below) apply
      // the ledger's old→new canonicalCredit delta to lifetime.
      if (!day) throw new HttpsError('not-found', 'DAY_NOT_FOUND');
      const merged = { ...(day.counts || {}), ...sanitizeHistoricalCounts(data.counts) };
      t.set(userRef.collection('days').doc(date), { counts: merged, updatedAt: new Date() }, { merge: true });
      effectiveDay = { ...day, counts: merged };
    } else if (type === 'TRACKER_DELETE') {
      // Delete a tracker config; drop it from the CURRENT open day's counts +
      // stamped snapshot. Closed/historical days keep their frozen state (LEGACY
      // parity); manual logs for the tracker are preserved (history).
      const trackerId = requireString(data.trackerId, 'trackerId required');
      t.delete(userRef.collection('configs').doc(trackerId));
      if (day && day.status !== 'closed') {
        const counts = { ...(day.counts || {}) };
        delete counts[trackerId];
        const trackerSnapshots = { ...(day.trackerSnapshots || {}) };
        delete trackerSnapshots[trackerId];
        t.set(userRef.collection('days').doc(date), { counts, trackerSnapshots, updatedAt: new Date() }, { merge: true });
        effectiveDay = { ...day, counts, trackerSnapshots };
      }
    } else if (type === 'DAY_CLOSE' || type === 'ZERO_COUNT_DAY_CLOSE') {
      if (!daySnap.exists && !ledgerSnap.exists && logs.length === 0) {
        throw new HttpsError('failed-precondition', 'NOTHING_TO_ARCHIVE');
      }
    }

    // --- Canonical credit (server-computed, authoritative) -----------------
    const currentTrackingDate = trackingDateNow(profileSnap.get('dayStartHour'));
    const fin = calculateDailyFinancials(effectiveDay, effectiveLogs.filter((l) => !(effectiveDay && isArchiveLog(l))), configs, num(data.defaultUnitPrice) || 0.5, { currentTrackingDate, ledgerSnapshots: ledger?.snapshots || {} });
    const ledgerExistsAfter = ledgerSnap.exists;

    if (type === 'DAY_CLOSE' || type === 'ZERO_COUNT_DAY_CLOSE') {
      t.set(userRef.collection('days').doc(date), {
        date, counts: fin.counts, trackerSnapshots: fin.snapshots,
        status: 'closed', foldedIntoLifetime: true, closedAt: new Date(), updatedAt: new Date(),
      }, { merge: true });
      // Fold once: use the ledger's existing credit if already folded, else the recomputed one.
      const creditToFold = folded ? (ledger.canonicalCredit || ZERO) : fin.canonicalCredit;
      const cur = curAgg;
      // write ledger first without a second lifetime delta, then apply fold
      t.set(ledgerRef, {
        date, countsByTracker: fin.counts, snapshots: fin.snapshots, canonicalCredit: fin.canonicalCredit,
        ledgerSchemaVersion: LEDGER_SCHEMA_VERSION, ambiguous: !!fin.ambiguous, conflicting: fin.conflicting || [],
        unresolvedComponents: fin.unresolved || { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
        missingConfig: fin.missingConfig || [],
        eligible: fin.eligible, foldedIntoLifetime: true, migratedFromLegacy: ledger?.migratedFromLegacy === true,
        updatedAt: new Date(), ...(ledgerExistsAfter ? {} : { createdAt: new Date() }),
      });
      if (!folded) {
        t.set(userRef, { lifetimeAggregates: {
          saved: num(cur.saved) + num(creditToFold.saved),
          wasted: num(cur.wasted) + num(creditToFold.wasted),
          smokingUnits: num(cur.smokingUnits) + num(creditToFold.smokingUnits),
          baselineSaved: num(cur.baselineSaved) + num(creditToFold.baselineSaved),
        } }, { merge: true });
      }
    } else if (!fin.eligible) {
      // The date has no remaining tracking evidence → it earns no allowance.
      // Remove any prior ledger credit and reverse its folded lifetime delta.
      if (ledgerExistsAfter) {
        t.delete(ledgerRef);
        if (folded) {
          const old = ledger.canonicalCredit || ZERO;
          t.set(userRef, { lifetimeAggregates: {
            saved: num(curAgg.saved) - num(old.saved),
            wasted: num(curAgg.wasted) - num(old.wasted),
            smokingUnits: num(curAgg.smokingUnits) - num(old.smokingUnits),
            baselineSaved: num(curAgg.baselineSaved) - num(old.baselineSaved),
          } }, { merge: true });
        }
      }
    } else {
      writeLedgerAndLifetime(t, userRef, ledgerRef, ledgerExistsAfter, ledgerWithAgg, fin, folded);
    }

    const result = { canonicalCredit: fin.canonicalCredit, counts: fin.counts };
    t.set(receiptRef, {
      operationId, operationType: type, trackingDate: date,
      sourceDocumentPath: `users/${uid}/dailyFinancials/${date}`,
      payloadFingerprint: fp, resultStatus: 'OK', result, createdAt: new Date(),
    });
    return { applied: true, result };
  });
});

function sanitizeCounts(counts) {
  const out = {};
  Object.entries(counts || {}).forEach(([id, v]) => {
    const n = Math.max(0, num(v));
    if (n > 0 && typeof id === 'string' && id.length <= 200) out[id] = n;
  });
  if (Object.keys(out).length > 25) throw new HttpsError('invalid-argument', 'TOO_MANY_TRACKERS');
  return out;
}

/** Historical-day edit counts: keep ZERO values (a zero clears that tracker's
 * counter) and validate keys/bounds, mirroring the Web `normalizeCounts`. */
function sanitizeHistoricalCounts(counts) {
  const out = {};
  Object.entries(counts || {}).forEach(([id, v]) => {
    const n = Math.max(0, num(v));
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && Number.isFinite(n) && n <= 10000) {
      out[id] = n;
    }
  });
  if (Object.keys(out).length > 50) throw new HttpsError('invalid-argument', 'TOO_MANY_TRACKERS');
  return out;
}

function snapshotFromConfig(cfg) {
  return {
    type: cfg.type, target: num(cfg.limit), baseline: cfg.baseline ?? null,
    unitPrice: cfg.pricePerUnit ?? null, isFinanciallyTracked: cfg.isFinanciallyTracked !== false,
    isPrimaryTracked: cfg.isPrimaryTracked === true,
  };
}

function snapshotsForCounts(counts, configs, provided) {
  const out = { ...(provided || {}) };
  Object.keys(counts || {}).forEach((id) => {
    if (out[id]) return;
    const cfg = configs.find((c) => c.id === id);
    if (cfg) out[id] = snapshotFromConfig(cfg);
  });
  return out;
}

/**
 * Trusted account cutover coordinator (Phase 8). Only an authorized operator
 * (custom claim `admin === true`) may invoke it; it defaults to a DRY RUN.
 * Real migration: freeze (MIGRATING) → classify A/B/C/D → replace each A date's
 * already-credited LEGACY contribution with the canonical credit (NET delta,
 * never additive) via the ledger's `migratedFromLegacy` marker → preserve B/C →
 * flip to OPTION_B. Per-date progress is durable, so a rerun resumes. Each DATE
 * is applied atomically (its ledger write and lifetime delta share one
 * transaction), so an interruption can never leave a migrated ledger whose delta
 * was never applied; a multi-date migration as a whole is still NOT globally
 * atomic (see docs/financial-semantics.md §24).
 */
export const migrateAccount = onCall(async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Migration requires an authorized operator.');
  }
  const uid = requireString(request.data?.targetUid, 'targetUid required');
  const dryRun = request.data?.dryRun !== false; // DRY RUN unless explicitly false
  const userRef = db.collection('users').doc(uid);
  const profileSnap = await userRef.get();
  if (!profileSnap.exists) throw new HttpsError('not-found', 'NO_PROFILE');
  const mode = profileSnap.get('financialMode') || 'LEGACY';
  const defaultUnitPrice = num(profileSnap.get('unitPrice')) || 0.5;

  const daysSnap = await userRef.collection('days').get();
  const logsSnap = await userRef.collection('logs').get();
  const configsSnap = await userRef.collection('configs').get();
  const configs = configsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const logsByDate = {};
  logsSnap.docs.forEach((d) => {
    const l = { ...d.data(), id: d.id };
    (logsByDate[l.logDate] ||= []).push(l);
  });
  const dates = daysSnap.docs.map((d) => ({ date: d.id, day: { ...d.data(), date: d.id }, logs: logsByDate[d.id] || [] }));
  Object.keys(logsByDate).forEach((date) => {
    if (!daysSnap.docs.some((d) => d.id === date)) dates.push({ date, day: null, logs: logsByDate[date] });
  });

  const plan = migrationPlan(dates, configs, defaultUnitPrice);
  const summary = plan.map((p) => ({ date: p.date, category: p.category, legacySaved: p.legacySaved, canonicalSaved: p.canonicalSaved, deltaSaved: p.deltaSaved }));
  if (dryRun) return { dryRun: true, currentMode: mode, summary };

  // 1. Freeze — rules then reject all client financial writes.
  await userRef.set({ financialMode: 'MIGRATING', updatedAt: new Date() }, { merge: true });

  // 2-3. Apply the NET replacement for each A date; keep B/C untouched.
  //
  // One transaction PER DATE: the ledger write and its lifetime delta commit
  // together. Previously the loop wrote every ledger and then applied one
  // combined `lifetimeAggregates` write afterwards, so an interruption in
  // between left a date marked `migratedFromLegacy` whose delta had never been
  // applied — and a rerun skips it by marker, silently losing the delta (the
  // account kept its LEGACY totals while the canonical ledger said otherwise).
  let migrated = 0; let preserved = 0;
  for (const p of plan) {
    if (p.category !== 'A') { if (p.category === 'B' || p.category === 'C') preserved += 1; continue; }
    const ledgerRef = userRef.collection('dailyFinancials').doc(p.date);
    const applied = await db.runTransaction(async (t) => {
      const existing = await t.get(ledgerRef);
      if (existing.exists && existing.get('migratedFromLegacy') === true) return false; // resume-safe
      const profile = await t.get(userRef);
      const cur = profile.get('lifetimeAggregates') || ZERO;
      t.set(ledgerRef, {
        date: p.date, countsByTracker: p.fin.counts, snapshots: p.fin.snapshots,
        canonicalCredit: p.fin.canonicalCredit, ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
        ambiguous: !!p.fin.ambiguous, missingConfig: p.fin.missingConfig || [],
        foldedIntoLifetime: true, migratedFromLegacy: true, updatedAt: new Date(),
        ...(existing.exists ? {} : { createdAt: new Date() }),
      }, { merge: true });
      t.set(userRef, {
        lifetimeAggregates: {
          ...cur,
          saved: num(cur.saved) + num(p.deltaSaved),
          wasted: num(cur.wasted) + num(p.deltaWasted),
        },
        updatedAt: new Date(),
      }, { merge: true });
      return true;
    });
    if (applied) migrated += 1;
  }

  // 4. Cut over only when nothing unresolved remains.
  const unresolved = summary.filter((s) => s.category === 'B' || s.category === 'C');
  if (unresolved.length > 0) {
    return { dryRun: false, currentMode: 'MIGRATING', migrated, preserved, unresolved, summary,
      note: 'Held in MIGRATING: unresolved B/C dates prevent a clean cutover.' };
  }
  await userRef.set({ financialMode: 'OPTION_B', updatedAt: new Date() }, { merge: true });
  return { dryRun: false, currentMode: 'OPTION_B', migrated, preserved, summary };
});
