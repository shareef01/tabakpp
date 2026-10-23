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
  calculateDailyFinancials, computeDayCredit, fingerprintOf, applyDelta, isArchiveLog, migrationPlan, roundMoney,
  stampFromConfig,
} from './financial.js';
import {
  MAX_COUNT, MAX_DAY_TRACKERS, counterGraceTrackingDate, requireCounterDate, requireId,
  requireRecentLogin, requireTrackingDate, resolveCurrentTrackingDate, resolveUserTrackingDate, isValidIanaTimeZone,
  sanitizeCounts, sanitizeHistoricalCounts,
} from './validation.js';

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

const resolveUnitPrice = (profileSnap, fallback = 0.5) => {
  const p = profileSnap?.get ? profileSnap.get('unitPrice') : profileSnap?.unitPrice;
  return Number.isFinite(Number(p)) && Number(p) >= 0 ? Number(p) : fallback;
};

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
        saved: roundMoney(num(cur.saved) - num(oldCredit.saved) + num(newCredit.saved)),
        wasted: roundMoney(num(cur.wasted) - num(oldCredit.wasted) + num(newCredit.wasted)),
        smokingUnits: Math.round(num(cur.smokingUnits) - num(oldCredit.smokingUnits) + num(newCredit.smokingUnits)),
        baselineSaved: roundMoney(num(cur.baselineSaved) - num(oldCredit.baselineSaved) + num(newCredit.baselineSaved)),
      },
    }, { merge: true });
  }
}

export const executeFinancialOperation = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required.');

  const data = request.data || {};
  const type = data.type;
  const operationId = requireId(data.operationId, 'operationId required');
  if (EXPLICITLY_BLOCKED.has(type)) {
    throw new HttpsError('unimplemented', `${type} is not yet served by the trusted boundary.`);
  }
  if (!SUPPORTED.has(type)) throw new HttpsError('invalid-argument', 'Unsupported operation type.');

  const userRef = db.collection('users').doc(uid);
  // AUD-016: trusted receipts live in their OWN namespace. The client-writable
  // `financialOperations` collection holds the LEGACY client-gateway receipts
  // (rules allowlist: createManualLog/…/adjustCounter) — a forged document there
  // must never be able to satisfy the callable's idempotency check or smuggle a
  // client-authored `result` back as a trusted response. Only the Admin SDK can
  // write `trustedOperations` (rules deny clients unconditionally).
  const receiptRef = userRef.collection('trustedOperations').doc(operationId);
  const fp = fingerprintOf({
    type,
    date: data.date,
    trackerId: data.trackerId,
    logId: data.logId,
    counts: data.counts,
    delta: data.delta,
    allowUnresolved: data.allowUnresolved === true,
  });

  return db.runTransaction(async (t) => {
    // The profile is read INSIDE the transaction: lifetimeAggregates are
    // written back as absolute values below, so a read outside it let two
    // concurrent folded-date operations overwrite each other's delta.
    // financialMode is authoritative from the server; NEVER from the payload.
    //
    // AUD-016: the mode guard runs BEFORE the receipt lookup, so ONLY an
    // OPTION_B account can ever receive a successful trusted response —
    // including an idempotent replay. A receipt that does not exist yet for a
    // LEGACY/MIGRATING account can never make the callable return early.
    const profileSnap = await t.get(userRef);
    if (!profileSnap.exists) throw new HttpsError('failed-precondition', 'NO_PROFILE');
    const mode = profileSnap.get('financialMode') || 'LEGACY';
    if (mode !== 'OPTION_B') {
      throw new HttpsError('failed-precondition', `Account is not OPTION_B (financialMode=${mode}).`);
    }

    const receiptSnap = await t.get(receiptRef);
    if (receiptSnap.exists) {
      if (receiptSnap.get('payloadFingerprint') !== fp) {
        throw new HttpsError('already-exists', 'OPERATION_CONFLICT');
      }
      return { applied: false, result: receiptSnap.get('result') || null };
    }

    // Resolve user's tracking date and timezone authoritatively from server time + account/request timezone
    const now = new Date();
    const { trackingDate: currentTrackingDate, timeZone: resolvedZone, shouldPersist } = resolveUserTrackingDate({
      now,
      profileTimeZone: profileSnap.get('timeZone'),
      requestTimeZone: data.timeZone,
      claimedDate: data.currentTrackingDate,
      dayStartHour: profileSnap.get('dayStartHour'),
    });
    // The date a boundary-racing counter tap may still target (see requireCounterDate).
    const graceTrackingDate = counterGraceTrackingDate(now, resolvedZone, profileSnap.get('dayStartHour'));


    let date;
    if (type === 'TRACKER_DELETE') {
      // TRACKER_DELETE deletes the config and drops counts from the CURRENT open tracking day.
      // Callers cannot supply an old historical date to mutate past records or leave today dangling.
      if (data.date) {
        date = requireTrackingDate(data.date);
        if (date !== currentTrackingDate) {
          throw new HttpsError('failed-precondition', 'TRACKER_DELETE_MUST_TARGET_CURRENT_DATE');
        }
      } else {
        date = currentTrackingDate;
      }
    } else {
      date = requireTrackingDate(data.date);
    }
    if (type === 'COUNTER_INCREMENT' || type === 'COUNTER_DECREMENT') {
      requireCounterDate(date, currentTrackingDate, graceTrackingDate);
    }
    // Closing is for today (End day) or a stale past day; a later date has no
    // finished consumption to fold.
    if ((type === 'DAY_CLOSE' || type === 'ZERO_COUNT_DAY_CLOSE') && date > currentTrackingDate) {
      throw new HttpsError('failed-precondition', 'DAY_CLOSE_FUTURE_DATE');
    }

    const { daySnap, day, logs, ledger, configs, ledgerSnap } = await readDateState(t, userRef, date);
    const ledgerRef = userRef.collection('dailyFinancials').doc(date);
    const folded = ledger?.foldedIntoLifetime === true;

    // Fallback price comes from the profile, never the payload (FIX 14: handle 0 correctly).
    const defaultUnitPrice = resolveUnitPrice(profileSnap);

    // Attach the current profile aggregates for folded lifetime adjustments.
    const curAgg = profileSnap.get('lifetimeAggregates') || ZERO;
    const ledgerWithAgg = ledger ? { ...ledger, __profileAgg: curAgg } : null;

    const isCurrent = (date === currentTrackingDate);

    // The day state AFTER the staged source mutation. Eligibility and the
    // canonical credit must be derived from this, never from the pre-write
    // snapshot: a COUNTER_INCREMENT on a brand-new date writes the day doc, and
    // deriving eligibility from the stale (absent) day made the op look
    // ineligible, so the ledger was never written (day-only mutation).
    let effectiveDay = day;

    // --- Source mutation (per op type) -------------------------------------
    let effectiveLogs = logs;
    if (type === 'COUNTER_INCREMENT' || type === 'COUNTER_DECREMENT') {
      const trackerId = requireId(data.trackerId, 'trackerId required', 64);
      const delta = type === 'COUNTER_INCREMENT' ? 1 : -1;
      if (day?.status === 'closed') throw new HttpsError('failed-precondition', 'DAY_CLOSED');
      const cfg = configs.find((c) => c.id === trackerId);
      if (!cfg) throw new HttpsError('failed-precondition', 'CONFIG_NOT_FOUND');
      const newCounts = applyDelta(day?.counts || {}, { [trackerId]: delta });
      if ((newCounts[trackerId] || 0) > MAX_COUNT) throw new HttpsError('failed-precondition', 'COUNT_LIMIT');
      if (Object.keys(newCounts).length > MAX_DAY_TRACKERS) throw new HttpsError('invalid-argument', 'TOO_MANY_TRACKERS');
      const trackerSnapshots = {
        ...(day?.trackerSnapshots || {}),
        [trackerId]: stampFromConfig(cfg, defaultUnitPrice),
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
      const logId = requireId(data.logId, 'logId required');
      const counts = sanitizeCounts(data.counts);
      const logRef = userRef.collection('logs').doc(logId);
      // Item 1: Prevent cross-date collisions and concurrent duplicate creations atomically.
      // Reading logRef directly in transaction guarantees optimistic concurrency locking.
      const existingLogSnap = await t.get(logRef);
      if (existingLogSnap.exists || logs.some((l) => l.id === logId)) {
        throw new HttpsError('already-exists', 'LOG_EXISTS');
      }
      // FIX 2 & FIX 3: Store immutable per-tracker snapshots on the log for the current tracking date.
      // Historical backfills (date !== currentTrackingDate) do NOT stamp live configs as historical facts (Task A).
      const logSnapshots = isCurrent ? snapshotsForCounts(counts, configs, defaultUnitPrice) : {};
      const own = isCurrent
        ? computeDayCredit(counts, logSnapshots, defaultUnitPrice)
        : { wasted: 0, saved: 0, smokingUnits: computeDayCredit(counts, {}, defaultUnitPrice).smokingUnits, baselineSaved: 0 };
      const logData = {
        id: logId,
        logDate: date,
        counts,
        trackerSnapshots: logSnapshots,
        isManual: true,
        origin: 'MANUAL_ENTRY',
        ...(isCurrent ? {} : { unresolvedEconomics: true }),
        aggregateCredit: {
          saved: 0,
          wasted: own.wasted,
          smokingUnits: own.smokingUnits,
          baselineSaved: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      t.set(logRef, logData);
      effectiveLogs = [...logs, logData];
    } else if (type === 'MANUAL_UPDATE') {
      const logId = requireId(data.logId, 'logId required');
      const counts = sanitizeCounts(data.counts);
      const logRef = userRef.collection('logs').doc(logId);
      const existingLogSnap = await t.get(logRef);
      if (!existingLogSnap.exists) throw new HttpsError('not-found', 'LOG_NOT_FOUND');
      const target = existingLogSnap.data();
      if (target.logDate !== date) throw new HttpsError('failed-precondition', 'LOG_DATE_MISMATCH');
      // FIX 2 & FIX 3: Preserve original snapshots where known; update effectiveLogs with latest credit
      const existingSnapshots = target.trackerSnapshots || {};
      const newSnapshots = isCurrent ? snapshotsForCounts(counts, configs, defaultUnitPrice) : {};
      const logSnapshots = {};
      Object.keys(counts).forEach((id) => {
        if (existingSnapshots[id]) {
          logSnapshots[id] = existingSnapshots[id];
        } else if (isCurrent && newSnapshots[id]) {
          logSnapshots[id] = newSnapshots[id];
        }
      });
      const own = isCurrent
        ? computeDayCredit(counts, logSnapshots, defaultUnitPrice)
        : (target.aggregateCredit || { wasted: 0, saved: 0, smokingUnits: computeDayCredit(counts, {}, defaultUnitPrice).smokingUnits, baselineSaved: 0 });
      const updatedLogData = {
        ...target,
        counts,
        trackerSnapshots: logSnapshots,
        aggregateCredit: {
          saved: 0,
          wasted: own.wasted,
          smokingUnits: own.smokingUnits,
          baselineSaved: 0,
        },
        updatedAt: new Date(),
      };
      t.set(logRef, updatedLogData, { merge: true });
      effectiveLogs = logs.map((l) => (l.id === logId ? updatedLogData : l));
    } else if (type === 'MANUAL_DELETE') {
      const logId = requireId(data.logId, 'logId required');
      const logRef = userRef.collection('logs').doc(logId);
      const existingLogSnap = await t.get(logRef);
      if (!existingLogSnap.exists) throw new HttpsError('not-found', 'LOG_NOT_FOUND');
      const target = existingLogSnap.data();
      if (target.logDate !== date) throw new HttpsError('failed-precondition', 'LOG_DATE_MISMATCH');
      // Item 2: Server-controlled immutable restoration evidence.
      // Save the full verified server record before deletion so undo/restore
      // cannot be hijacked with client-forged snapshots or economics.
      t.set(userRef.collection('trustedDeletedLogs').doc(logId), {
        ...target,
        deletedAt: new Date(),
        deletedOperationId: operationId,
      });
      t.delete(logRef);
      effectiveLogs = logs.filter((l) => l.id !== logId);
    } else if (type === 'MANUAL_RESTORE') {
      const logId = requireId(data.logId, 'logId required');
      const logRef = userRef.collection('logs').doc(logId);
      const existingLogSnap = await t.get(logRef);
      if (existingLogSnap.exists) {
        throw new HttpsError('already-exists', 'LOG_ALREADY_ACTIVE');
      }

      // Review Item 2: Separate verified server-authoritative restore from unsupported restore.
      // Server-controlled immutable restoration evidence is strictly REQUIRED.
      const evidenceRef = userRef.collection('trustedDeletedLogs').doc(logId);
      const evidenceSnap = await t.get(evidenceRef);
      if (!evidenceSnap.exists) {
        // Records without server tombstones lack trustworthy server-side provenance.
        // They CANNOT be restored as verified historical records.
        // Explicit new historical entries must be created via MANUAL_CREATE.
        throw new HttpsError('not-found', 'NO_RESTORATION_EVIDENCE');
      }

      // Scenario A: Verified server-authoritative restore
      const serverEvidence = evidenceSnap.data();
      if (serverEvidence.logDate !== date) {
        throw new HttpsError('failed-precondition', 'RESTORATION_DATE_MISMATCH');
      }
      // Verify client-submitted counts (if supplied) match server evidence; reject tampering
      if (data.counts && typeof data.counts === 'object') {
        const clientCounts = sanitizeCounts(data.counts);
        const evidenceCounts = serverEvidence.counts || {};
        const sameCountKeys = Object.keys(clientCounts).length === Object.keys(evidenceCounts).length &&
          Object.keys(clientCounts).every((k) => clientCounts[k] === evidenceCounts[k]);
        if (!sameCountKeys) {
          throw new HttpsError('invalid-argument', 'RESTORATION_TAMPERED');
        }
      }
      const counts = serverEvidence.counts || {};
      const logSnapshots = serverEvidence.trackerSnapshots || {};
      const own = serverEvidence.aggregateCredit || (isCurrent ? computeDayCredit(counts, logSnapshots, defaultUnitPrice) : { wasted: 0, saved: 0, smokingUnits: computeDayCredit(counts, {}, defaultUnitPrice).smokingUnits, baselineSaved: 0 });

      const restoredLogData = {
        id: logId,
        logDate: date,
        counts,
        trackerSnapshots: logSnapshots,
        isManual: true,
        origin: 'MANUAL_ENTRY',
        aggregateCredit: serverEvidence.aggregateCredit || (own ? {
          saved: 0,
          wasted: own.wasted,
          smokingUnits: own.smokingUnits,
          baselineSaved: 0,
        } : null),
        createdAt: serverEvidence.createdAt || new Date(),
        updatedAt: new Date(),
        restorationMode: 'VERIFIED',
      };
      t.delete(evidenceRef);
      t.set(logRef, restoredLogData);
      effectiveLogs = [...logs.filter((l) => l.id !== logId), restoredLogData];
    } else if (type === 'HISTORICAL_DAY_UPDATE') {
      // Edit a historical day's counter counts. `trackerSnapshots` are immutable
      // (item 2): the canonical credit is recomputed from the FROZEN stamped
      // config, never from today's settings. Mirrors the LEGACY
      // `updateHistoricalDay` — merge counts, recompute credit, and (below) apply
      // the ledger's old→new canonicalCredit delta to lifetime.
      if (!day) throw new HttpsError('not-found', 'DAY_NOT_FOUND');
      const incoming = sanitizeHistoricalCounts(data.counts);
      const merged = { ...(day.counts || {}), ...incoming };
      // FIX 12: Harmonize with Firestore rules constraints (validDayCountMap / MAX_DAY_TRACKERS)
      for (const [k, v] of Object.entries(merged)) {
        if (v === 0) delete merged[k];
        else if (!Number.isInteger(v) || v < 0 || v > MAX_COUNT) {
          throw new HttpsError('invalid-argument', 'INVALID_COUNT');
        }
      }
      if (Object.keys(merged).length > MAX_DAY_TRACKERS) {
        throw new HttpsError('invalid-argument', 'TOO_MANY_TRACKERS');
      }
      t.set(userRef.collection('days').doc(date), { counts: merged, updatedAt: new Date() }, { merge: true });
      effectiveDay = { ...day, counts: merged };
    } else if (type === 'TRACKER_DELETE') {
      // Delete a tracker config; drop it from the CURRENT open day's counts +
      // stamped snapshot. Closed/historical days keep their frozen state (LEGACY
      // parity); manual logs for the tracker are preserved (history).
      const trackerId = requireId(data.trackerId, 'trackerId required', 64);
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
    const effectiveConfigs = (type === 'TRACKER_DELETE')
      ? configs.filter((c) => c.id !== data.trackerId)
      : configs;
    const fin = calculateDailyFinancials(
      effectiveDay,
      effectiveLogs.filter((l) => !(effectiveDay && isArchiveLog(l))),
      effectiveConfigs,
      defaultUnitPrice,
      { currentTrackingDate, ledgerSnapshots: ledger?.snapshots || {} }
    );
    const ledgerExistsAfter = ledgerSnap.exists;

    if (type === 'DAY_CLOSE' || type === 'ZERO_COUNT_DAY_CLOSE') {
      // FIX 1: Strict Count Ownership Model.
      // `days/{date}.counts` represents ONLY consumption owned by the day document.
      // Manual log counts remain owned by their logs.
      // `dailyFinancials/{date}.countsByTracker` holds the canonical combined total.
      const dayCounts = effectiveDay?.counts || {};
      t.set(userRef.collection('days').doc(date), {
        date,
        counts: dayCounts,
        trackerSnapshots: effectiveDay?.trackerSnapshots || fin.snapshots,
        status: 'closed',
        foldedIntoLifetime: true,
        closedAt: new Date(),
        updatedAt: new Date(),
      }, { merge: true });
      // Fold once: lifetime must always equal the sum of the folded ledgers'
      // canonicalCredit. An unfolded date adds its whole credit; an already
      // folded one (a repeat close, or a date the migration folded while it
      // was still open) moves by old→new only. Overwriting the ledger without
      // that delta used to leave lifetime and ledger disagreeing.
      const alreadyFolded = folded ? (ledger.canonicalCredit || ZERO) : ZERO;
      const cur = curAgg;
      t.set(ledgerRef, {
        date,
        countsByTracker: fin.counts,
        snapshots: fin.snapshots,
        canonicalCredit: fin.canonicalCredit,
        ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
        ambiguous: !!fin.ambiguous,
        conflicting: fin.conflicting || [],
        unresolvedComponents: fin.unresolved || { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
        missingConfig: fin.missingConfig || [],
        eligible: fin.eligible,
        foldedIntoLifetime: true,
        migratedFromLegacy: ledger?.migratedFromLegacy === true,
        updatedAt: new Date(),
        ...(ledgerExistsAfter ? {} : { createdAt: new Date() }),
      });
      const credit = fin.canonicalCredit;
      t.set(userRef, {
        lifetimeAggregates: {
          saved: roundMoney(num(cur.saved) - num(alreadyFolded.saved) + num(credit.saved)),
          wasted: roundMoney(num(cur.wasted) - num(alreadyFolded.wasted) + num(credit.wasted)),
          smokingUnits: Math.round(num(cur.smokingUnits) - num(alreadyFolded.smokingUnits) + num(credit.smokingUnits)),
          baselineSaved: roundMoney(num(cur.baselineSaved) - num(alreadyFolded.baselineSaved) + num(credit.baselineSaved)),
        },
      }, { merge: true });
    } else if (!fin.eligible) {
      // The date has no remaining tracking evidence → it earns no allowance.
      // Remove any prior ledger credit and reverse its folded lifetime delta.
      if (ledgerExistsAfter) {
        t.delete(ledgerRef);
        if (folded) {
          const old = ledger.canonicalCredit || ZERO;
          t.set(userRef, {
            lifetimeAggregates: {
              saved: roundMoney(num(curAgg.saved) - num(old.saved)),
              wasted: roundMoney(num(curAgg.wasted) - num(old.wasted)),
              smokingUnits: Math.round(num(curAgg.smokingUnits) - num(old.smokingUnits)),
              baselineSaved: roundMoney(num(curAgg.baselineSaved) - num(old.baselineSaved)),
            },
          }, { merge: true });
        }
      }
    } else {
      writeLedgerAndLifetime(t, userRef, ledgerRef, ledgerExistsAfter, ledgerWithAgg, fin, folded);
    }

    if (shouldPersist && resolvedZone) {
      t.set(userRef, { timeZone: resolvedZone }, { merge: true });
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

/**
 * Price/target stamps for a manual log come from the server-read tracker
 * configs only — a client-supplied snapshot would let the payload choose the
 * price that a backfilled date's canonical credit is derived from. The
 * fallback price is the profile's, never the payload's.
 */
function snapshotsForCounts(counts, configs, defaultUnitPrice) {
  const out = {};
  Object.keys(counts || {}).forEach((id) => {
    const cfg = configs.find((c) => c.id === id);
    if (cfg) out[id] = stampFromConfig(cfg, defaultUnitPrice);
  });
  return out;
}

/** Load every dated record for an account and classify it (A/B/C/D). */
async function planMigration(userRef, defaultUnitPrice) {
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
  const summary = plan.map((p) => ({
    date: p.date, category: p.category,
    legacySaved: p.legacySaved, legacyWasted: p.legacyWasted,
    legacyBaselineSaved: p.legacyBaselineSaved, legacySmokingUnits: p.legacySmokingUnits,
    canonicalSaved: p.canonicalSaved, canonicalWasted: p.canonicalWasted,
    canonicalBaselineSaved: p.canonicalBaselineSaved, canonicalSmokingUnits: p.canonicalSmokingUnits,
    deltaSaved: p.deltaSaved, deltaWasted: p.deltaWasted,
    deltaBaselineSaved: p.deltaBaselineSaved, deltaSmokingUnits: p.deltaSmokingUnits,
  }));
  const unresolved = summary.filter((s) => s.category === 'B' || s.category === 'C');
  return { plan, summary, unresolved };
}

/** Set financialMode to `to` only if it is currently one of `from`; returns the mode it ends in. */
async function transitionMode(userRef, from, to) {
  return db.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    const current = snap.get('financialMode') || 'LEGACY';
    if (!from.includes(current)) return current;
    t.set(userRef, { financialMode: to, updatedAt: new Date() }, { merge: true });
    return to;
  });
}

/**
 * Trusted account cutover coordinator (Phase 8). Only an authorized operator
 * (custom claim `admin === true`) may invoke it; it defaults to a DRY RUN.
 *
 * All-or-nothing at the account level: an account is only ever frozen
 * (MIGRATING) when every date is cleanly migratable, and it leaves this call
 * as LEGACY or OPTION_B — never parked in MIGRATING, where neither the client
 * (rules lock) nor executeFinancialOperation (OPTION_B only) can write.
 *  1. Already OPTION_B → no-op.
 *  2. Any unresolved B/C date → not started; the account stays LEGACY and the
 *     dates are returned for an operator decision.
 *  3. Freeze (LEGACY → MIGRATING), then re-classify from the FROZEN data: a
 *     client write that landed before the freeze can still have produced a B/C
 *     date. If so, nothing has been applied yet, so roll back to LEGACY.
 *  4. Materialize canonical ledger for eligible dates (Categories A and D).
 *     FIX 6: Category D dates (already correct in legacy totals) must also have
 *     their canonical ledger materialized with foldedIntoLifetime: true.
 *     FIX 7: Category A dates reconcile all four metrics: saved, wasted, baselineSaved, smokingUnits.
 * A multi-date migration as a whole is still NOT globally atomic (see
 * docs/financial-semantics.md §24): an interrupted run is left MIGRATING and
 * resumes on the next call.
 */
export const migrateAccount = onCall(async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Migration requires an authorized operator.');
  }
  const uid = requireId(request.data?.targetUid, 'targetUid required');
  const dryRun = request.data?.dryRun !== false; // DRY RUN unless explicitly false
  const userRef = db.collection('users').doc(uid);
  const profileSnap = await userRef.get();
  if (!profileSnap.exists) throw new HttpsError('not-found', 'NO_PROFILE');
  const mode = profileSnap.get('financialMode') || 'LEGACY';
  const defaultUnitPrice = resolveUnitPrice(profileSnap);

  if (mode === 'OPTION_B') {
    return { dryRun, currentMode: 'OPTION_B', alreadyMigrated: true };
  }

  const pre = await planMigration(userRef, defaultUnitPrice);
  if (dryRun) {
    return { dryRun: true, currentMode: mode, summary: pre.summary, unresolved: pre.unresolved,
      canCutOver: pre.unresolved.length === 0 };
  }

  // 2. Never freeze an account that cannot cut over. (An account already
  //    MIGRATING is an interrupted run: fall through and let step 3 decide.)
  if (mode === 'LEGACY' && pre.unresolved.length > 0) {
    return { dryRun: false, currentMode: 'LEGACY', started: false, unresolved: pre.unresolved,
      summary: pre.summary, note: 'Not started: unresolved B/C dates need an operator decision.' };
  }

  // 3. Freeze — rules then reject all client financial writes. Conditional, so
  //    a concurrent worker that already cut over is never downgraded.
  const frozen = await transitionMode(userRef, ['LEGACY', 'MIGRATING'], 'MIGRATING');
  if (frozen === 'OPTION_B') return { dryRun: false, currentMode: 'OPTION_B', alreadyMigrated: true };

  const { plan, summary, unresolved } = await planMigration(userRef, defaultUnitPrice);
  if (unresolved.length > 0) {
    // Safe to roll back only while no date's delta has been applied. This run
    // has applied none; a marker can only come from an earlier run.
    const applied = await userRef.collection('dailyFinancials')
      .where('migratedFromLegacy', '==', true).limit(1).get();
    if (!applied.empty) {
      throw new HttpsError('failed-precondition', 'PARTIAL_MIGRATION_UNRESOLVED', {
        unresolved,
        note: 'An earlier run already migrated some dates and unresolved B/C dates exist; rolling back would corrupt lifetime totals. Resolve the dates, then rerun.',
      });
    }
    const now = await transitionMode(userRef, ['MIGRATING'], 'LEGACY');
    return { dryRun: false, currentMode: now, started: false, rolledBack: true, unresolved, summary,
      note: 'Rolled back to LEGACY: unresolved B/C dates appeared after the freeze.' };
  }

  // 4. Materialize canonical ledger for eligible dates (Categories A and D).
  // FIX 6: Category D dates (already correct in legacy totals) must also have
  // their canonical ledger materialized with foldedIntoLifetime: true.
  // FIX 7: Category A dates reconcile all four metrics: saved, wasted, baselineSaved, smokingUnits.
  let migrated = 0;
  for (const p of plan) {
    if (p.category !== 'A' && p.category !== 'D') continue;
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
        foldedIntoLifetime: true, migratedFromLegacy: true,
        eligible: p.fin.eligible !== false,
        unresolvedComponents: p.fin.unresolved || { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
        conflicting: p.fin.conflicting || [],
        updatedAt: new Date(),
        ...(existing.exists ? {} : { createdAt: new Date() }),
      }, { merge: true });

      if (p.category === 'A') {
        t.set(userRef, {
          lifetimeAggregates: {
            saved: roundMoney(num(cur.saved) + num(p.deltaSaved)),
            wasted: roundMoney(num(cur.wasted) + num(p.deltaWasted)),
            smokingUnits: Math.round(num(cur.smokingUnits) + num(p.deltaSmokingUnits)),
            baselineSaved: roundMoney(num(cur.baselineSaved) + num(p.deltaBaselineSaved)),
          },
          updatedAt: new Date(),
        }, { merge: true });
      }
      return true;
    });
    if (applied) migrated += 1;
  }

  const final = await transitionMode(userRef, ['MIGRATING'], 'OPTION_B');
  return { dryRun: false, currentMode: final, migrated, summary };
});

/**
 * Trusted account-data deletion. A MIGRATING/OPTION_B account cannot wipe
 * itself from the client: the rules deny its financial deletes (and the
 * profile delete) by design. This deletes the CALLER's entire `users/{uid}`
 * tree — profile and every subcollection — with the Admin SDK.
 *
 * - The uid comes only from verified auth; there is no target parameter.
 * - Requires a recent sign-in (requireRecentLogin): both clients reauthenticate
 *   immediately before deleting, and this keeps a leaked ID token alone from
 *   wiping an account.
 * - The Auth user is NOT deleted here; the client still does that afterwards
 *   (same partial-failure handling as the client-side wipe).
 * - Serves any financial mode, but clients only route locked accounts here;
 *   LEGACY keeps the client-side wipe, which works without Cloud Functions.
 *
 * Partial-Failure & Retry Semantics:
 * db.recursiveDelete is not a single atomic transaction; Firestore executes
 * bulk deletion across batched chunks. In case of transient network timeout or
 * partial failure, some documents may remain. The operation is fully idempotent:
 * clients may safely retry deleteAccountData until completion.
 */
export const deleteAccountData = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required.');
  requireRecentLogin(request.auth.token);
  const userRef = db.collection('users').doc(uid);
  // Fence first, as the client wipes do (#83): once `deleting` is set the rules
  // reject every client write, so another signed-in device cannot add
  // configs/meta mid-wipe or recreate a LEGACY profile while it is gone.
  // Deleting the profile itself first left exactly that window open.
  await userRef.set({ deleting: true }, { merge: true });
  for (const sub of await userRef.listCollections()) {
    await db.recursiveDelete(sub);
  }
  // Same minimal tombstone the client-side LEGACY wipe leaves: without it a
  // stale ID token could recreate a fresh LEGACY profile and data after the
  // wipe. Overwriting (not merging) drops every other profile field.
  await userRef.set({ deleting: true });
  return { deleted: true };
});
