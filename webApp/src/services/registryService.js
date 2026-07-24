import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, onSnapshot, orderBy, writeBatch, limit, serverTimestamp,
  runTransaction, deleteField, startAfter
} from 'firebase/firestore';
import { db } from '../firebase';
import { SmokingCalculator } from '../utils/smokingCalculator';

/** Doc id always wins over any payload `id` field (Android parity). */
const withDocId = (d) => ({ ...d.data(), id: d.id });

/** Settings keys mirrored from Android `updateProfileSettings` — never counters/aggregates. */
const PROFILE_SETTINGS_KEYS = new Set([
  'name', 'accent', 'widgetSize', 'purchaseType', 'unitPrice',
  'pouchPrice', 'estimatedYield', 'dayStartHour', 'avatar'
]);

/** Legacy web-only economics keys — strip on every settings write. */
const LEGACY_ECO_KEYS = ['ecoMode', 'retailPrice', 'retailQty', 'ryoPrice', 'ryoYield'];

const normalizeCounts = (counts) => Object.fromEntries(
  Object.entries(counts || {})
    .map(([key, value]) => [key, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 10_000)
    .slice(0, 50)
);

/**
 * RegistryService (Model Layer)
 * Hardened for Cross-Platform Parity and Atomic Integrity.
 */
export const RegistryService = {

  // --- CONFIGURATIONS ---

  subscribeToConfigs: (uid, onSuccess, onError) => {
    if (!uid) return () => {};
    const q = query(
      collection(db, 'users', uid, 'configs'),
      orderBy('order', 'asc')
    );
    return onSnapshot(q, (s) => {
      onSuccess(s.docs.map(withDocId));
    }, onError);
  },

  addProtocol: async (uid, data) => {
    const ref = doc(collection(db, 'users', uid, 'configs'));
    return setDoc(ref, { ...data, id: ref.id, createdAt: serverTimestamp() });
  },

  updateProtocol: async (uid, pid, data) => {
    return updateDoc(doc(db, 'users', uid, 'configs', pid), { ...data, updatedAt: serverTimestamp() });
  },

  deleteProtocol: async (uid, pid) => {
    const userRef = doc(db, 'users', uid);
    const configRef = doc(db, 'users', uid, 'configs', pid);
    return runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists()) {
        const counts = { ...(userSnap.data().activeCounts || {}) };
        if (Object.prototype.hasOwnProperty.call(counts, pid)) {
          delete counts[pid];
          transaction.update(userRef, { activeCounts: counts });
        }
      }
      transaction.delete(configRef);
    });
  },

  reorderConfigs: async (uid, c1, c2) => {
    const b = writeBatch(db);
    b.update(doc(db, 'users', uid, 'configs', c1.id), { order: c2.order });
    b.update(doc(db, 'users', uid, 'configs', c2.id), { order: c1.order });
    return b.commit();
  },

  // --- PROFILE BOOTSTRAP ---

  /**
   * Creates a default user doc only when missing — never overwrites
   * activeCounts / lifetimeAggregates on an existing account.
   */
  ensureUserDocument: async (uid, { name = '', accent = '#FF5F5F' } = {}) => {
    if (!uid) throw new Error('INVALID_REF');
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      name: name || '',
      accent: accent || '#FF5F5F',
      widgetSize: 'MEDIUM',
      purchaseType: 'PACK',
      unitPrice: 0.5,
      pouchPrice: 0,
      estimatedYield: 0,
      dayStartHour: 6,
      activeCounts: {},
      lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0 },
      smokingUnitsMigrated: true
    });
  },

  /**
   * Settings-only write path (Android `updateProfileSettings` parity).
   * Never touches activeCounts / lifetimeAggregates. Strips unknown keys and
   * deletes legacy web eco fields so hardened rules stay satisfied.
   */
  updateProfileSettings: async (uid, patch = {}) => {
    if (!uid) throw new Error('INVALID_REF');
    const payload = {};
    for (const [key, value] of Object.entries(patch)) {
      if (PROFILE_SETTINGS_KEYS.has(key)) payload[key] = value;
    }
    for (const key of LEGACY_ECO_KEYS) {
      payload[key] = deleteField();
    }
    return updateDoc(doc(db, 'users', uid), payload);
  },

  /**
   * One-shot: compute smokingUnits from full log history if not yet migrated.
   * Keeps life-lost accurate beyond the live log subscription window.
   */
  migrateSmokingUnitsIfNeeded: async (uid) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists() || snap.data().smokingUnitsMigrated) return;

    const configs = await getConfigsOnce(uid);
    const logs = await getAllLogs(uid);
    const units = SmokingCalculator.sumSmokingUnitsFromLogs(logs, configs);

    await runTransaction(db, async (transaction) => {
      const live = await transaction.get(userRef);
      if (!live.exists() || live.data().smokingUnitsMigrated) return;
      transaction.update(userRef, {
        'lifetimeAggregates.smokingUnits': units,
        smokingUnitsMigrated: true
      });
    });
  },

  // --- LOGS & TRANSACTIONS ---

  subscribeToLogs: (uid, onSuccess, onError) => {
    if (!uid) return () => {};
    const q = query(
      collection(db, 'users', uid, 'logs'),
      orderBy('logDate', 'desc'),
      // Wide enough for streak (≤366 days) + manuals; life-lost uses smokingUnits aggregate.
      limit(1200)
    );
    return onSnapshot(q, (s) => {
      onSuccess(s.docs.map(withDocId));
    }, onError);
  },

  /**
   * ATOMIC COUNTER ADJUSTMENT (Android Parity)
   * Updates 'activeCounts' inside the User document.
   */
  adjustCounter: async (uid, counterId, delta) => {
    if (!uid || !counterId) throw new Error("INVALID_REF");
    const userRef = doc(db, 'users', uid);

    return runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("USER_NOT_FOUND");

      const profile = snap.data();
      const counts = { ...(profile.activeCounts || {}) };
      counts[counterId] = Math.max(0, (counts[counterId] || 0) + delta);

      transaction.update(userRef, { activeCounts: counts });
    });
  },

  /**
   * END TRACKING DAY (Android Parity)
   * A second end-day on the same tracking date merges into the existing
   * archive instead of replacing it; aggregates are credited by the delta
   * so archive counts and lifetime totals can never drift apart.
   */
  endDay: async (uid, date, unitPrice = 0.5) => {
    if (!uid || !date) throw new Error("INVALID_PAYLOAD");

    const userRef = doc(db, 'users', uid);
    const logRef = doc(db, 'users', uid, 'logs', `${date}_DAY`);

    return runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const logSnap = await transaction.get(logRef);
      const configs = await getConfigsInTransaction(transaction, uid);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const activeCounts = profile.activeCounts || {};

      if (!SmokingCalculator.hasOpenSession(activeCounts)) {
        throw new Error("NOTHING_TO_ARCHIVE");
      }

      const existingCounts = logSnap.exists() ? (logSnap.data().counts || {}) : null;
      const mergedCounts = SmokingCalculator.mergeCounts(existingCounts, activeCounts);

      const previousFin = existingCounts
        ? SmokingCalculator.calculateDayFinancials(existingCounts, configs, price)
        : { wasted: 0, saved: 0 };
      const mergedFin = SmokingCalculator.calculateDayFinancials(mergedCounts, configs, price);
      const previousUnits = existingCounts
        ? SmokingCalculator.sumSmokingUnits(existingCounts, configs)
        : 0;
      const mergedUnits = SmokingCalculator.sumSmokingUnits(mergedCounts, configs);

      const logEntry = {
        id: `${date}_DAY`,
        logDate: date,
        counts: mergedCounts,
        isArchive: true,
        origin: "DAY_RESET",
        finalizedAt: serverTimestamp()
      };

      transaction.set(logRef, logEntry);
      transaction.update(userRef, {
        activeCounts: {},
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) + mergedFin.saved - previousFin.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) + mergedFin.wasted - previousFin.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + mergedUnits - previousUnits
      });
    });
  },

  /**
   * Edit a historical log's counts, adjusting lifetime aggregates by the
   * financial delta (Android parity with updateHistoricalLog).
   */
  updateHistoricalLog: async (uid, logId, counts, unitPrice = 0.5) => {
    if (!uid || !logId) throw new Error("INVALID_REF");
    const userRef = doc(db, 'users', uid);
    const logRef = doc(db, 'users', uid, 'logs', logId);
    const normalized = normalizeCounts(counts);

    return runTransaction(db, async (transaction) => {
      const logSnap = await transaction.get(logRef);
      if (!logSnap.exists()) throw new Error("LOG_NOT_FOUND");
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await getConfigsInTransaction(transaction, uid);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const oldFin = SmokingCalculator.calculateDayFinancials(logSnap.data().counts || {}, configs, price);
      const newFin = SmokingCalculator.calculateDayFinancials(normalized, configs, price);
      const oldUnits = SmokingCalculator.sumSmokingUnits(logSnap.data().counts || {}, configs);
      const newUnits = SmokingCalculator.sumSmokingUnits(normalized, configs);

      transaction.update(logRef, { counts: normalized });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) - oldFin.saved + newFin.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) - oldFin.wasted + newFin.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - oldUnits + newUnits
      });
    });
  },

  /**
   * Delete a log, subtracting its financials from lifetime aggregates
   * (Android parity with deleteLog).
   */
  deleteLog: async (uid, logId, unitPrice = 0.5) => {
    if (!uid || !logId) throw new Error("INVALID_REF");
    const userRef = doc(db, 'users', uid);
    const logRef = doc(db, 'users', uid, 'logs', logId);

    return runTransaction(db, async (transaction) => {
      const logSnap = await transaction.get(logRef);
      if (!logSnap.exists()) return;
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await getConfigsInTransaction(transaction, uid);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const fin = SmokingCalculator.calculateDayFinancials(logSnap.data().counts || {}, configs, price);
      const units = SmokingCalculator.sumSmokingUnits(logSnap.data().counts || {}, configs);

      transaction.delete(logRef);
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) - fin.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) - fin.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - units
      });
    });
  },

  /**
   * Restore a previously deleted log and re-credit lifetime aggregates
   * (Android parity with restoreLog).
   */
  restoreLog: async (uid, log, unitPrice = 0.5) => {
    if (!uid || !log?.id) throw new Error("INVALID_REF");
    const userRef = doc(db, 'users', uid);
    const logRef = doc(db, 'users', uid, 'logs', log.id);

    return runTransaction(db, async (transaction) => {
      const existing = await transaction.get(logRef);
      if (existing.exists()) return; // already restored — avoid double-credit

      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await getConfigsInTransaction(transaction, uid);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const fin = SmokingCalculator.calculateDayFinancials(log.counts || {}, configs, price);
      const units = SmokingCalculator.sumSmokingUnits(log.counts || {}, configs);

      const { id, ...rest } = log;
      transaction.set(logRef, { ...rest, id });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) + fin.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) + fin.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + units
      });
    });
  },

  /**
   * Manual backfill entry (Android parity with createManualEntry).
   * Credits lifetime aggregates inside the same transaction as the log write.
   */
  createManualEntry: async (uid, date, counts, unitPrice = 0.5) => {
    if (!uid || !date) throw new Error("INVALID_PAYLOAD");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");

    const userRef = doc(db, 'users', uid);
    const normalized = normalizeCounts(counts);
    const now = Date.now();
    const entropy = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const logId = `${date}_M${now}_${entropy}`;
    const logRef = doc(db, 'users', uid, 'logs', logId);

    return runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await getConfigsInTransaction(transaction, uid);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const fin = SmokingCalculator.calculateDayFinancials(normalized, configs, price);
      const units = SmokingCalculator.sumSmokingUnits(normalized, configs);

      transaction.set(logRef, {
        id: logId,
        logDate: date,
        counts: normalized,
        isManual: true,
        origin: 'MANUAL_ENTRY',
        clientTimestamp: serverTimestamp()
      });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) + fin.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) + fin.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + units
      });
    });
  },

  /**
   * Spark-safe account wipe: delete configs + logs in batches, then user doc.
   * Caller must reauthenticate and Auth.deleteUser afterward.
   */
  deleteAllUserData: async (uid) => {
    if (!uid) throw new Error('INVALID_REF');
    await deleteCollectionDocs(uid, 'configs');
    await deleteCollectionDocs(uid, 'logs');
    await deleteDoc(doc(db, 'users', uid));
  }
};

async function getConfigsOnce(uid) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'configs'), orderBy('order', 'asc')));
  return snap.docs.map(withDocId);
}

/**
 * Page through every log for the one-shot smokingUnits migration. Pagination
 * avoids a single oversized getDocs (Firestore's 1MB response cap) on heavy
 * accounts while still reading the full history once.
 */
async function getAllLogs(uid, pageSize = 400) {
  const out = [];
  let lastDoc = null;
  while (true) {
    const base = query(
      collection(db, 'users', uid, 'logs'),
      orderBy('logDate', 'desc'),
      limit(pageSize)
    );
    const q = lastDoc ? query(base, startAfter(lastDoc)) : base;
    const snap = await getDocs(q);
    if (snap.empty) break;
    for (const d of snap.docs) out.push(withDocId(d));
    if (snap.size < pageSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/**
 * Read all configs inside the transaction via a query, so a config added
 * between a pre-transaction read and the commit is still included in the
 * financial math (closes the client-side TOCTOU window).
 */
async function getConfigsInTransaction(transaction, uid) {
  const snap = await transaction.get(
    query(collection(db, 'users', uid, 'configs'), orderBy('order', 'asc'))
  );
  return snap.docs.map(withDocId);
}

/** Paginated collection wipe for Spark (no Admin recursive delete). */
async function deleteCollectionDocs(uid, subcollection, pageSize = 400) {
  const colRef = collection(db, 'users', uid, subcollection);
  while (true) {
    const snap = await getDocs(query(colRef, limit(pageSize)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) break;
  }
}
