/**
 * DailyLedger — OPTION B canonical per-date financial ledger (see
 * docs/financial-semantics.md §16–§19).
 *
 * Each public operation is ONE Firestore transaction that atomically writes:
 *   1. the SOURCE consumption document (logs/{id} or days/{date}),
 *   2. the canonical day-level ledger (dailyFinancials/{date}),
 *   3. `lifetimeAggregates` on the profile when the date is already folded,
 *   4. an idempotency RECEIPT (financialOperations/{operationId}).
 * …or none of them. The financial delta is derived from the actual source
 * transition — never from a caller-supplied delta.
 *
 * REQUEST IDEMPOTENCY (not transaction retries): a stable `operationId` is
 * generated once per logical user action and reused across retries. The receipt
 * is read inside the transaction; a matching receipt returns the prior result
 * (no second delta), and a *different* payload under the same id is rejected.
 * Operation identity is completely separate from Firestore's internal retries.
 *
 * STATUS: reference/integration module. Activation is gated by
 * `OPTION_B_LEDGER_ENABLED` (default false) — see `isLedgerEnabled`. Live
 * behaviour is unchanged while disabled.
 */
import {
  doc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { SmokingCalculator } from '../utils/smokingCalculator';

export const LEDGER_SCHEMA_VERSION = 2;

/**
 * Local activation gate. OPTION B is NOT activated for production accounts; a
 * build/test may set VITE_OPTION_B_LEDGER=1 to exercise the ledger locally.
 * This is a LOCAL development switch — it is not a security boundary.
 */
export const isLedgerEnabled = () => String(import.meta?.env?.VITE_OPTION_B_LEDGER || '') === '1';

const ZERO = { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 };

const creditOf = (c) => ({
  saved: Number(c?.saved || 0),
  wasted: Number(c?.wasted || 0),
  smokingUnits: Number(c?.smokingUnits || 0),
  baselineSaved: Number(c?.baselineSaved || 0),
});

/** Apply a consumption delta to a counts map, dropping non-positive keys. */
const applyDelta = (base, delta) => {
  const out = { ...(base || {}) };
  Object.entries(delta || {}).forEach(([id, dv]) => {
    const next = (out[id] || 0) + Number(dv || 0);
    if (next > 0) out[id] = next;
    else delete out[id];
  });
  return out;
};

/** Stable canonical JSON of an operation's semantic payload (sorted keys). */
const fingerprintOf = (value) => {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = norm(v[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value));
};

/** Per-log financial stamp: consumption-only (day-level `saved` lives on the ledger). */
const logStamp = (counts, snapshots, defaultUnitPrice) => {
  const c = SmokingCalculator.computeDayCredit(counts, snapshots, defaultUnitPrice);
  return { saved: 0, wasted: creditOf(c).wasted, smokingUnits: creditOf(c).smokingUnits, baselineSaved: 0 };
};

/** Recompute the date's canonical counts + credit from an old ledger snapshot. */
const derive = (ledgerData, deltaCounts, extraSnapshots, defaultUnitPrice) => {
  const oldCounts = { ...(ledgerData?.countsByTracker || {}) };
  const newCounts = applyDelta(oldCounts, deltaCounts);
  const snapshots = { ...(ledgerData?.snapshots || {}), ...(extraSnapshots || {}) };
  const oldCredit = creditOf(ledgerData?.canonicalCredit || ZERO);
  const newCredit = creditOf(SmokingCalculator.computeDayCredit(newCounts, snapshots, defaultUnitPrice));
  const folded = ledgerData?.foldedIntoLifetime === true;
  return { oldCounts, newCounts, snapshots, oldCredit, newCredit, folded };
};

const writeLedger = (transaction, ledgerRef, existed, payload) => {
  if (existed) transaction.set(ledgerRef, payload);
  else transaction.set(ledgerRef, { ...payload, createdAt: serverTimestamp() });
};

const lifetimeDeltaFields = (profile, oldCredit, newCredit) => {
  const cur = creditOf(profile?.lifetimeAggregates || ZERO);
  return {
    'lifetimeAggregates.saved': cur.saved - oldCredit.saved + newCredit.saved,
    'lifetimeAggregates.wasted': cur.wasted - oldCredit.wasted + newCredit.wasted,
    'lifetimeAggregates.smokingUnits': cur.smokingUnits - oldCredit.smokingUnits + newCredit.smokingUnits,
    'lifetimeAggregates.baselineSaved': cur.baselineSaved - oldCredit.baselineSaved + newCredit.baselineSaved,
  };
};

const ledgerPayload = (date, d, ambiguous, missingConfig) => ({
  date,
  countsByTracker: d.newCounts,
  snapshots: d.snapshots,
  canonicalCredit: d.newCredit,
  ledgerSchemaVersion: LEDGER_SCHEMA_VERSION,
  ambiguous,
  missingConfig,
  foldedIntoLifetime: d.folded,
  updatedAt: serverTimestamp(),
});

export const DailyLedger = {
  /** True when the local Option-B ledger is enabled (default false). */
  isEnabled: isLedgerEnabled,

  /**
   * Create a manual log AND fold its consumption into the date's ledger, in ONE
   * transaction. `operationId` makes the action request-idempotent. `logId`
   * should be derived deterministically from the operation for stable identity.
   */
  createManualLog: async (uid, { logId, date, counts, snapshots = {}, defaultUnitPrice = 0.5, operationId }) => {
    if (!uid || !logId || !date || !operationId) throw new Error('INVALID_REF');
    if (!SmokingCalculator.isValidDate(date)) throw new Error('INVALID_DATE');
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    const logRef = doc(db, 'users', uid, 'logs', logId);
    const receiptRef = doc(db, 'users', uid, 'financialOperations', operationId);
    const fp = fingerprintOf({ op: 'createManualLog', date, logId, counts });

    return runTransaction(db, async (transaction) => {
      const receiptSnap = await transaction.get(receiptRef);
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      const logSnap = await transaction.get(logRef);

      if (receiptSnap.exists()) {
        const r = receiptSnap.data();
        if (r.payloadFingerprint !== fp) throw new Error('OPERATION_CONFLICT');
        return { applied: false, canonicalCredit: r.result?.canonicalCredit };
      }
      if (logSnap.exists()) throw new Error('LOG_EXISTS');

      const d = derive(ledgerSnap.exists() ? ledgerSnap.data() : null, counts, snapshots, defaultUnitPrice);
      const profile = userSnap.exists() ? userSnap.data() : {};

      transaction.set(logRef, {
        id: logId, logDate: date, counts, isManual: true, origin: 'MANUAL_ENTRY',
        aggregateCredit: logStamp(counts, snapshots, defaultUnitPrice),
        clientTimestamp: serverTimestamp(),
      });
      writeLedger(transaction, ledgerRef, ledgerSnap.exists(), ledgerPayload(date, d, false, []));
      if (d.folded && userSnap.exists()) {
        transaction.update(userRef, lifetimeDeltaFields(profile, d.oldCredit, d.newCredit));
      }
      transaction.set(receiptRef, {
        operationId, operationType: 'createManualLog', sourceDocumentPath: logRef.path,
        trackingDate: date, payloadFingerprint: fp, resultStatus: 'OK',
        result: { canonicalCredit: d.newCredit }, createdAt: serverTimestamp(),
      });
      return { applied: true, canonicalCredit: d.newCredit };
    });
  },

  /** Edit a manual log's counts; the ledger receives the exact source delta. */
  updateManualLog: async (uid, { logId, date, counts, snapshots = {}, defaultUnitPrice = 0.5, operationId }) => {
    if (!uid || !logId || !date || !operationId) throw new Error('INVALID_REF');
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    const logRef = doc(db, 'users', uid, 'logs', logId);
    const receiptRef = doc(db, 'users', uid, 'financialOperations', operationId);
    const fp = fingerprintOf({ op: 'updateManualLog', date, logId, counts });

    return runTransaction(db, async (transaction) => {
      const receiptSnap = await transaction.get(receiptRef);
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      const logSnap = await transaction.get(logRef);
      if (receiptSnap.exists()) {
        const r = receiptSnap.data();
        if (r.payloadFingerprint !== fp) throw new Error('OPERATION_CONFLICT');
        return { applied: false, canonicalCredit: r.result?.canonicalCredit };
      }
      if (!logSnap.exists()) throw new Error('LOG_NOT_FOUND');

      const oldLogCounts = logSnap.data().counts || {};
      const delta = {};
      new Set([...Object.keys(oldLogCounts), ...Object.keys(counts || {})]).forEach((id) => {
        delta[id] = Number((counts || {})[id] || 0) - Number(oldLogCounts[id] || 0);
      });
      const d = derive(ledgerSnap.exists() ? ledgerSnap.data() : null, delta, snapshots, defaultUnitPrice);
      const profile = userSnap.exists() ? userSnap.data() : {};

      transaction.update(logRef, { counts, aggregateCredit: logStamp(counts, d.snapshots, defaultUnitPrice) });
      writeLedger(transaction, ledgerRef, ledgerSnap.exists(), ledgerPayload(date, d, false, []));
      if (d.folded && userSnap.exists()) {
        transaction.update(userRef, lifetimeDeltaFields(profile, d.oldCredit, d.newCredit));
      }
      transaction.set(receiptRef, {
        operationId, operationType: 'updateManualLog', sourceDocumentPath: logRef.path,
        trackingDate: date, payloadFingerprint: fp, resultStatus: 'OK',
        result: { canonicalCredit: d.newCredit }, createdAt: serverTimestamp(),
      });
      return { applied: true, canonicalCredit: d.newCredit };
    });
  },

  /** Delete a manual log; reverses exactly the consumption it represented. */
  deleteManualLog: async (uid, { logId, date, defaultUnitPrice = 0.5, operationId }) => {
    if (!uid || !logId || !date || !operationId) throw new Error('INVALID_REF');
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    const logRef = doc(db, 'users', uid, 'logs', logId);
    const receiptRef = doc(db, 'users', uid, 'financialOperations', operationId);
    const fp = fingerprintOf({ op: 'deleteManualLog', date, logId });

    return runTransaction(db, async (transaction) => {
      const receiptSnap = await transaction.get(receiptRef);
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      const logSnap = await transaction.get(logRef);
      if (receiptSnap.exists()) {
        const r = receiptSnap.data();
        if (r.payloadFingerprint !== fp) throw new Error('OPERATION_CONFLICT');
        return { applied: false, canonicalCredit: r.result?.canonicalCredit };
      }
      if (!logSnap.exists()) return { applied: false, canonicalCredit: null }; // already gone

      const oldLogCounts = logSnap.data().counts || {};
      const delta = {};
      Object.entries(oldLogCounts).forEach(([id, v]) => { delta[id] = -Number(v || 0); });
      const d = derive(ledgerSnap.exists() ? ledgerSnap.data() : null, delta, {}, defaultUnitPrice);
      const profile = userSnap.exists() ? userSnap.data() : {};

      transaction.delete(logRef);
      writeLedger(transaction, ledgerRef, ledgerSnap.exists(), ledgerPayload(date, d, false, []));
      if (d.folded && userSnap.exists()) {
        transaction.update(userRef, lifetimeDeltaFields(profile, d.oldCredit, d.newCredit));
      }
      transaction.set(receiptRef, {
        operationId, operationType: 'deleteManualLog', sourceDocumentPath: logRef.path,
        trackingDate: date, payloadFingerprint: fp, resultStatus: 'OK',
        result: { canonicalCredit: d.newCredit }, createdAt: serverTimestamp(),
      });
      return { applied: true, canonicalCredit: d.newCredit };
    });
  },

  /** Restore a deleted manual log; idempotent (a present log is a no-op). */
  restoreManualLog: async (uid, { log, defaultUnitPrice = 0.5, operationId }) => {
    if (!uid || !log?.id || !operationId) throw new Error('INVALID_REF');
    const date = log.logDate;
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    const logRef = doc(db, 'users', uid, 'logs', log.id);
    const receiptRef = doc(db, 'users', uid, 'financialOperations', operationId);
    const counts = log.counts || {};
    const fp = fingerprintOf({ op: 'restoreManualLog', date, logId: log.id, counts });

    return runTransaction(db, async (transaction) => {
      const receiptSnap = await transaction.get(receiptRef);
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      const logSnap = await transaction.get(logRef);
      if (receiptSnap.exists()) {
        const r = receiptSnap.data();
        if (r.payloadFingerprint !== fp) throw new Error('OPERATION_CONFLICT');
        return { applied: false, canonicalCredit: r.result?.canonicalCredit };
      }
      if (logSnap.exists()) return { applied: false, canonicalCredit: null }; // already restored

      const d = derive(ledgerSnap.exists() ? ledgerSnap.data() : null, counts, {}, defaultUnitPrice);
      const profile = userSnap.exists() ? userSnap.data() : {};
      const { id, ...rest } = log;

      transaction.set(logRef, {
        ...rest, id, counts, aggregateCredit: logStamp(counts, d.snapshots, defaultUnitPrice),
        clientTimestamp: serverTimestamp(),
      });
      writeLedger(transaction, ledgerRef, ledgerSnap.exists(), ledgerPayload(date, d, false, []));
      if (d.folded && userSnap.exists()) {
        transaction.update(userRef, lifetimeDeltaFields(profile, d.oldCredit, d.newCredit));
      }
      transaction.set(receiptRef, {
        operationId, operationType: 'restoreManualLog', sourceDocumentPath: logRef.path,
        trackingDate: date, payloadFingerprint: fp, resultStatus: 'OK',
        result: { canonicalCredit: d.newCredit }, createdAt: serverTimestamp(),
      });
      return { applied: true, canonicalCredit: d.newCredit };
    });
  },

  /** Counter tap: writes the day doc AND the date's ledger in one transaction. */
  adjustCounter: async (uid, { date, trackerId, delta, snapshots = {}, defaultUnitPrice = 0.5, operationId }) => {
    if (!uid || !trackerId || !date || !operationId) throw new Error('INVALID_REF');
    if (!SmokingCalculator.isValidDate(date)) throw new Error('INVALID_TRACKING_DATE');
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    const dayRef = doc(db, 'users', uid, 'days', date);
    const receiptRef = doc(db, 'users', uid, 'financialOperations', operationId);
    const fp = fingerprintOf({ op: 'adjustCounter', date, trackerId, delta });

    return runTransaction(db, async (transaction) => {
      const receiptSnap = await transaction.get(receiptRef);
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      const daySnap = await transaction.get(dayRef);
      if (receiptSnap.exists()) {
        const r = receiptSnap.data();
        if (r.payloadFingerprint !== fp) throw new Error('OPERATION_CONFLICT');
        return { applied: false, canonicalCredit: r.result?.canonicalCredit };
      }
      const day = daySnap.exists() ? daySnap.data() : null;
      if (day?.status === 'closed') throw new Error('DAY_CLOSED');

      const dayCounts = { ...(day?.counts || {}) };
      dayCounts[trackerId] = Math.max(0, (dayCounts[trackerId] || 0) + Number(delta || 0));
      if (dayCounts[trackerId] <= 0) delete dayCounts[trackerId];
      const daySnapshots = { ...(day?.trackerSnapshots || {}), ...(snapshots || {}) };

      const d = derive(ledgerSnap.exists() ? ledgerSnap.data() : null, { [trackerId]: delta }, snapshots, defaultUnitPrice);
      const profile = userSnap.exists() ? userSnap.data() : {};

      const dayPayload = { date, counts: dayCounts, trackerSnapshots: daySnapshots, status: 'open', updatedAt: serverTimestamp() };
      if (daySnap.exists()) transaction.update(dayRef, dayPayload);
      else transaction.set(dayRef, { ...dayPayload, createdAt: serverTimestamp() });
      writeLedger(transaction, ledgerRef, ledgerSnap.exists(), ledgerPayload(date, d, false, []));
      if (d.folded && userSnap.exists()) {
        transaction.update(userRef, lifetimeDeltaFields(profile, d.oldCredit, d.newCredit));
      }
      transaction.set(receiptRef, {
        operationId, operationType: 'adjustCounter', sourceDocumentPath: dayRef.path,
        trackingDate: date, payloadFingerprint: fp, resultStatus: 'OK',
        result: { canonicalCredit: d.newCredit }, createdAt: serverTimestamp(),
      });
      return { applied: true, canonicalCredit: d.newCredit };
    });
  },

  /**
   * Idempotent initial-ledger seed for a date: replaces the date's already-folded
   * LEGACY lifetime contribution (`legacyFolded`) with the Option-B canonical
   * credit, applying the NET correction once. `migratedAt`/`ledgerSchemaVersion`
   * mark the date; re-running is a no-op (no second correction).
   */
  seedLedgerFromLegacy: async (uid, { date, legacyFolded, counts, snapshots = {}, defaultUnitPrice = 0.5, markFolded = true }) => {
    if (!uid || !date) throw new Error('INVALID_REF');
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);

    return runTransaction(db, async (transaction) => {
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return { applied: false };
      if (ledgerSnap.exists() && ledgerSnap.data().migratedFromLegacy === true) {
        return { applied: false, canonicalCredit: creditOf(ledgerSnap.data().canonicalCredit) };
      }

      const newCounts = { ...(counts || {}) };
      const credit = creditOf(SmokingCalculator.computeDayCredit(newCounts, snapshots, defaultUnitPrice));
      const profile = userSnap.data();
      const legacy = creditOf(legacyFolded || ZERO);
      // Net correction: remove the legacy contribution, add the canonical one.
      const cur = creditOf(profile.lifetimeAggregates || ZERO);
      transaction.update(userRef, {
        'lifetimeAggregates.saved': cur.saved - legacy.saved + credit.saved,
        'lifetimeAggregates.wasted': cur.wasted - legacy.wasted + credit.wasted,
        'lifetimeAggregates.smokingUnits': cur.smokingUnits - legacy.smokingUnits + credit.smokingUnits,
        'lifetimeAggregates.baselineSaved': cur.baselineSaved - legacy.baselineSaved + credit.baselineSaved,
      });
      const payload = {
        date, countsByTracker: newCounts, snapshots, canonicalCredit: credit,
        ledgerSchemaVersion: LEDGER_SCHEMA_VERSION, ambiguous: false, missingConfig: [],
        foldedIntoLifetime: Boolean(markFolded), migratedFromLegacy: true, updatedAt: serverTimestamp(),
      };
      if (ledgerSnap.exists()) transaction.set(ledgerRef, payload);
      else transaction.set(ledgerRef, { ...payload, createdAt: serverTimestamp() });
      return { applied: true, canonicalCredit: credit };
    });
  },

  /**
   * Fold a date's canonical credit into lifetimeAggregates. Idempotent via the
   * one-way `foldedIntoLifetime` flag.
   */
  foldIntoLifetime: async (uid, date) => {
    if (!uid || !date) throw new Error('INVALID_REF');
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    return runTransaction(db, async (transaction) => {
      const ledgerSnap = await transaction.get(ledgerRef);
      if (!ledgerSnap.exists()) throw new Error('NOTHING_TO_ARCHIVE');
      const ledger = ledgerSnap.data();
      if (ledger.foldedIntoLifetime) return;
      const userSnap = await transaction.get(userRef);
      const cur = creditOf((userSnap.exists() ? userSnap.data().lifetimeAggregates : null) || ZERO);
      const credit = creditOf(ledger.canonicalCredit);
      transaction.update(ledgerRef, { foldedIntoLifetime: true, updatedAt: serverTimestamp() });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': cur.saved + credit.saved,
        'lifetimeAggregates.wasted': cur.wasted + credit.wasted,
        'lifetimeAggregates.smokingUnits': cur.smokingUnits + credit.smokingUnits,
        'lifetimeAggregates.baselineSaved': cur.baselineSaved + credit.baselineSaved,
      });
    });
  },

  /** Low-level ledger-only delta (internal primitive; used by tests). */
  recordConsumption: async (uid, date, deltaCounts, { snapshots = {}, defaultUnitPrice = 0.5, ambiguous = false, missingConfig = [] } = {}) => {
    const userRef = doc(db, 'users', uid);
    const ledgerRef = doc(db, 'users', uid, 'dailyFinancials', date);
    return runTransaction(db, async (transaction) => {
      const ledgerSnap = await transaction.get(ledgerRef);
      const userSnap = await transaction.get(userRef);
      const existing = ledgerSnap.exists() ? ledgerSnap.data() : null;
      const d = derive(existing, deltaCounts, snapshots, defaultUnitPrice);
      const profile = userSnap.exists() ? userSnap.data() : {};
      writeLedger(transaction, ledgerRef, ledgerSnap.exists(), ledgerPayload(date, d, ambiguous, missingConfig));
      if (d.folded && userSnap.exists()) {
        transaction.update(userRef, lifetimeDeltaFields(profile, d.oldCredit, d.newCredit));
      }
      return { counts: d.newCounts, canonicalCredit: d.newCredit };
    });
  },

  /** Delete a date's ledger (account wipe / explicit erase only). */
  deleteLedger: (uid, date) =>
    runTransaction(db, async (transaction) => {
      transaction.delete(doc(db, 'users', uid, 'dailyFinancials', date));
    }),
};
