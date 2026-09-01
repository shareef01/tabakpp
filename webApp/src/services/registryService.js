import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, onSnapshot, orderBy, writeBatch, limit, serverTimestamp,
  runTransaction, deleteField, startAfter
} from 'firebase/firestore';
import { db } from '../firebase';
import { SmokingCalculator } from '../utils/smokingCalculator';
import { sanitizeTrackerName } from '../utils/security';

/** Doc id always wins over any payload `id` field (Android parity). */
const withDocId = (d) => ({ ...d.data(), id: d.id });

/** Settings keys mirrored from Android `updateProfileSettings` — never counters/aggregates. */
const PROFILE_SETTINGS_KEYS = new Set([
  'name', 'accent', 'widgetSize', 'purchaseType', 'unitPrice', 'unitsPerPack',
  'pouchPrice', 'estimatedYield', 'dayStartHour', 'avatar'
]);

/** Legacy web-only economics keys — strip on every settings write. */
const LEGACY_ECO_KEYS = ['ecoMode', 'retailPrice', 'retailQty', 'ryoPrice', 'ryoYield'];

const normalizeCounts = (counts) => Object.fromEntries(
  Object.entries(counts || {})
    .map(([key, value]) => [String(key), Number(value)])
    .filter(([key, value]) =>
      /^[A-Za-z0-9_-]{1,64}$/.test(key)
      && Number.isFinite(value)
      && value >= 0
      && value <= 10_000
    )
    .slice(0, 50)
);

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * Coerce a tracker config into the bounds firestore.rules enforces, mirroring
 * Android RegistryViewModel.addTracker/updateTracker. Without this, an
 * out-of-range limit or price surfaces to the user as "Save blocked by security
 * rules" instead of being quietly clamped like it is on mobile.
 */
const sanitizeConfigPayload = (data = {}) => {
  const out = { ...data };
  if ('name' in out) out.name = sanitizeTrackerName(out.name);
  if ('limit' in out) out.limit = Math.round(clampNumber(out.limit, 0, 10_000, 20));
  if ('order' in out) out.order = Math.round(clampNumber(out.order, 0, 1_000, 0));
  if ('pricePerUnit' in out && out.pricePerUnit !== null) {
    out.pricePerUnit = clampNumber(out.pricePerUnit, 0, 1_000, 0.5);
  }
  return out;
};

/** Absolute lifetime contribution of a counts map (Android RegistryMutations.contribution). */
const contributionFrom = (counts, configs, price) => {
  const fin = SmokingCalculator.calculateDayFinancials(counts || {}, configs, price);
  return {
    saved: fin.saved,
    wasted: fin.wasted,
    smokingUnits: SmokingCalculator.sumSmokingUnits(counts || {}, configs),
  };
};

/**
 * Prefer a stamped aggregateCredit; fall back to live configs for legacy logs
 * (Android RegistryMutations.resolveContribution).
 */
const resolveContribution = (storedCredit, counts, configs, price) => {
  if (
    storedCredit
    && Number.isFinite(storedCredit.saved)
    && Number.isFinite(storedCredit.wasted)
    && Number.isFinite(storedCredit.smokingUnits)
  ) {
    return {
      saved: storedCredit.saved,
      wasted: storedCredit.wasted,
      smokingUnits: storedCredit.smokingUnits,
    };
  }
  return contributionFrom(counts, configs, price);
};

/** Preserve counts for trackers deleted since the log was written (Kotlin parity). */
const mergeHistoricalEditCounts = (incoming, previous, liveConfigIds) => {
  const live = new Set(liveConfigIds);
  const merged = { ...incoming };
  Object.entries(previous || {}).forEach(([id, value]) => {
    if (!live.has(id)) merged[id] = value;
  });
  return merged;
};

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
    return setDoc(ref, {
      ...sanitizeConfigPayload(data),
      id: ref.id,
      createdAt: serverTimestamp(),
    });
  },

  updateProtocol: async (uid, pid, data) => {
    return updateDoc(doc(db, 'users', uid, 'configs', pid), {
      ...sanitizeConfigPayload(data),
      updatedAt: serverTimestamp(),
    });
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
    const configRef = doc(db, 'users', uid, 'configs', counterId);

    return runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("USER_NOT_FOUND");
      const configSnap = await transaction.get(configRef);
      if (!configSnap.exists()) throw new Error("CONFIG_NOT_FOUND");

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
    const configIds = await listConfigIds(uid);

    return runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const logSnap = await transaction.get(logRef);
      const configs = await loadConfigsInTransaction(transaction, uid, configIds);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const activeCounts = profile.activeCounts || {};

      if (!SmokingCalculator.hasOpenSession(activeCounts)) {
        throw new Error("NOTHING_TO_ARCHIVE");
      }

      const existingCounts = logSnap.exists() ? (logSnap.data().counts || {}) : null;
      const existingCredit = logSnap.exists() ? logSnap.data().aggregateCredit : null;
      const mergedCounts = SmokingCalculator.mergeCounts(existingCounts, activeCounts);

      const previousCredit = existingCounts
        ? resolveContribution(existingCredit, existingCounts, configs, price)
        : { saved: 0, wasted: 0, smokingUnits: 0 };
      const mergedCredit = contributionFrom(mergedCounts, configs, price);

      const logEntry = {
        id: `${date}_DAY`,
        logDate: date,
        counts: mergedCounts,
        isArchive: true,
        origin: "DAY_RESET",
        aggregateCredit: mergedCredit,
        finalizedAt: serverTimestamp()
      };

      transaction.set(logRef, logEntry);
      transaction.update(userRef, {
        activeCounts: {},
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) - previousCredit.saved + mergedCredit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) - previousCredit.wasted + mergedCredit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - previousCredit.smokingUnits + mergedCredit.smokingUnits
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
    const configIds = await listConfigIds(uid);

    return runTransaction(db, async (transaction) => {
      const logSnap = await transaction.get(logRef);
      if (!logSnap.exists()) throw new Error("LOG_NOT_FOUND");
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await loadConfigsInTransaction(transaction, uid, configIds);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const oldLog = logSnap.data();
      const oldCounts = oldLog.counts || {};
      const mergedCounts = mergeHistoricalEditCounts(normalized, oldCounts, configIds);
      const oldCredit = resolveContribution(oldLog.aggregateCredit, oldCounts, configs, price);
      const newCredit = contributionFrom(mergedCounts, configs, price);

      transaction.update(logRef, { counts: mergedCounts, aggregateCredit: newCredit });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) - oldCredit.saved + newCredit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) - oldCredit.wasted + newCredit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - oldCredit.smokingUnits + newCredit.smokingUnits
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
    const configIds = await listConfigIds(uid);

    return runTransaction(db, async (transaction) => {
      const logSnap = await transaction.get(logRef);
      if (!logSnap.exists()) return;
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await loadConfigsInTransaction(transaction, uid, configIds);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const logData = logSnap.data();
      const credit = resolveContribution(logData.aggregateCredit, logData.counts || {}, configs, price);

      transaction.delete(logRef);
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) - credit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) - credit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - credit.smokingUnits
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
    const normalizedCounts = normalizeCounts(log.counts || {});
    const configIds = await listConfigIds(uid);

    return runTransaction(db, async (transaction) => {
      const existing = await transaction.get(logRef);
      if (existing.exists()) return; // already restored — avoid double-credit

      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await loadConfigsInTransaction(transaction, uid, configIds);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const credit = resolveContribution(log.aggregateCredit, normalizedCounts, configs, price);

      const { id, ...rest } = log;
      transaction.set(logRef, { ...rest, id, counts: normalizedCounts, aggregateCredit: credit });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) + credit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) + credit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + credit.smokingUnits
      });
    });
  },

  /**
   * Manual backfill entry (Android parity with createManualEntry).
   * Credits lifetime aggregates inside the same transaction as the log write.
   */
  createManualEntry: async (uid, date, counts, unitPrice = 0.5, trackingDay = null) => {
    if (!uid || !date) throw new Error("INVALID_PAYLOAD");
    // Full calendar validation, not just the shape — firestore.rules only checks
    // the YYYY-MM-DD pattern, so a regex-only guard here would let 2026-02-31
    // reach Firestore. Android uses LocalDate.parse for the same reason.
    if (!SmokingCalculator.isValidDate(date)) throw new Error("INVALID_DATE");
    // Backfill cannot run forward. Rules cannot express "not after today", so
    // this is the last enforcement point before the write (Android guards in
    // RegistryViewModel.createManualEntry for the same reason).
    if (!SmokingCalculator.isBackfillDateAllowed(date, trackingDay)) {
      throw new Error("FUTURE_DATE");
    }

    const userRef = doc(db, 'users', uid);
    const normalized = normalizeCounts(counts);
    const now = Date.now();
    const entropy = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const logId = `${date}_M${now}_${entropy}`;
    const logRef = doc(db, 'users', uid, 'logs', logId);
    const configIds = await listConfigIds(uid);

    return runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await loadConfigsInTransaction(transaction, uid, configIds);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const credit = contributionFrom(normalized, configs, price);

      transaction.set(logRef, {
        id: logId,
        logDate: date,
        counts: normalized,
        isManual: true,
        origin: 'MANUAL_ENTRY',
        aggregateCredit: credit,
        clientTimestamp: serverTimestamp()
      });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) + credit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) + credit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + credit.smokingUnits
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
 * List config ids ahead of a transaction.
 *
 * The web client SDK's `Transaction.get` accepts a DocumentReference ONLY —
 * there is no query overload (that exists in the Admin SDK). Passing a Query
 * throws `TypeError: Cannot read properties of undefined (reading 'path')`
 * because the SDK reaches for `ref._key`. So ids are listed here, outside the
 * transaction, and each document is read transactionally by reference in
 * loadConfigsInTransaction. Mirrors Android
 * FirebaseRegistryRepository.listConfigIds + Transaction.loadConfigs.
 */
async function listConfigIds(uid) {
  const snap = await getDocs(
    query(collection(db, 'users', uid, 'configs'), orderBy('order', 'asc'))
  );
  return snap.docs.map((d) => d.id);
}

/**
 * Re-read each config by reference inside the transaction, so config contents
 * (price, limit, type) used for the financial math are transactionally
 * consistent with the profile and log reads. A config created after
 * listConfigIds is not included — same window Android accepts.
 */
async function loadConfigsInTransaction(transaction, uid, configIds) {
  const out = [];
  for (const id of configIds) {
    const snap = await transaction.get(doc(db, 'users', uid, 'configs', id));
    if (snap.exists()) out.push({ ...snap.data(), id });
  }
  return out;
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
