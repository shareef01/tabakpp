import {
  collection, doc, setDoc, updateDoc, getDoc, getDocs,
  query, onSnapshot, orderBy, where, writeBatch, limit, serverTimestamp,
  runTransaction, deleteField, startAfter, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { SmokingCalculator } from '../utils/smokingCalculator';
import { sanitizeTrackerName } from '../utils/security';

/** Doc id always wins over any payload `id` field (Android parity). */
const withDocId = (d) => ({ ...d.data(), id: d.id });
const timestampMillis = (value) => value?.toMillis?.() ?? ((value?.seconds ?? 0) * 1000 + (value?.nanoseconds ?? 0) / 1000000);

/**
 * Settings keys mirrored from Android `updateProfileSettings` — never counters/
 * aggregates. `avatar` moved to `users/{uid}/meta/profile` (item 12) — see
 * `updateAvatar` — so it is deliberately absent here.
 */
const PROFILE_SETTINGS_KEYS = new Set([
  'name', 'accent', 'widgetSize', 'purchaseType', 'unitPrice', 'unitsPerPack',
  'pouchPrice', 'estimatedYield', 'dayStartHour'
]);

/** Legacy web-only economics keys — strip on every settings write. */
const LEGACY_ECO_KEYS = ['ecoMode', 'retailPrice', 'retailQty', 'ryoPrice', 'ryoYield'];

/** Schema version marking the dated-daily-document migration. */
const CURRENT_SCHEMA_VERSION = 2;

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
  // Baseline (item 3): explicit null means "not set" — never silently invent one.
  if ('baseline' in out) {
    out.baseline = (out.baseline === null || out.baseline === undefined || out.baseline === '')
      ? null
      : Math.round(clampNumber(out.baseline, 0, 10_000, 0));
  }
  return out;
};

/** Absolute lifetime contribution of a counts map (legacy `logs` path only). */
const contributionFrom = (counts, configs, price) => {
  const fin = SmokingCalculator.calculateDayFinancials(counts || {}, configs, price);
  return {
    saved: fin.saved,
    wasted: fin.wasted,
    smokingUnits: SmokingCalculator.sumSmokingUnits(counts || {}, configs),
    baselineSaved: 0,
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
      baselineSaved: storedCredit.baselineSaved ?? 0,
    };
  }
  return contributionFrom(counts, configs, price);
};

/** Preserve counts for trackers deleted since the log was written (Kotlin parity). */
const mergeHistoricalEditCounts = (incoming, previous, liveConfigIds, historicalIds = []) => {
  const live = new Set(liveConfigIds);
  const editable = new Set(historicalIds);
  const merged = { ...incoming };
  Object.entries(previous || {}).forEach(([id, value]) => {
    if (!live.has(id) && (!editable.has(id) || !Object.hasOwn(incoming, id))) merged[id] = value;
  });
  return merged;
};

const newClaimId = () => globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));

const emptyAggregates = () => ({ saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 });

const countsEqual = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .every((id) => (a[id] ?? 0) === (b[id] ?? 0));

// Old null-price snapshots cannot safely be reconstructed from today's price.
// No-op edits preserve their credit; changed edits must explicitly fail.
const requireHistoricalPrices = (counts, snapshots) => {
  if (Object.keys(snapshots).length === 0 || Object.keys(counts).some((id) => !snapshots[id])
    || Object.values(snapshots).some((s) => s.isFinanciallyTracked !== false && s.unitPrice == null)) {
    throw new Error('HISTORICAL_PRICE_UNAVAILABLE');
  }
};

// A closed day is never reopened or restamped. Preserve stranded legacy
// consumption as independently visible records with explicitly unknown money.
// A separate permanent marker survives a user deleting the recovered row
// before claim cleanup; each small transaction is independently resumable.
const applyLegacyClaim = async (uid, claim, configById) => {
  const userRef = doc(db, 'users', uid);
  const dayRef = doc(db, 'users', uid, 'days', claim.date);
  const ids = Object.keys(claim.counts).sort();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const marker = doc(db, 'users', uid, 'meta', `legacy_${claim.date}_${claim.id}_${i}`);
    const log = doc(db, 'users', uid, 'logs', `${claim.date}_LEGACY_${claim.id}_${i}`);
    await runTransaction(db, async (tx) => {
      if ((await tx.get(marker)).exists()) return;
      const daySnap = await tx.get(dayRef);
      const day = daySnap.exists() ? daySnap.data() : null;
      const previousSnapshots = day?.trackerSnapshots || {};
      if (day?.status !== 'closed'
        && (day?.counts?.[id] || 0) + claim.counts[id] <= 10000
        && (Object.hasOwn(previousSnapshots, id) || Object.keys(previousSnapshots).length < 8)) {
        const counts = { ...(day?.counts || {}), [id]: (day?.counts?.[id] || 0) + claim.counts[id] };
        const trackerSnapshots = { ...previousSnapshots, [id]: previousSnapshots[id] || SmokingCalculator.buildTrackerSnapshot(
          configById[id] || { name: 'Removed tracker', type: 'SIMPLE', isFinanciallyTracked: false }, claim.price) };
        const payload = { date: claim.date, counts, trackerSnapshots, updatedTrackerId: id,
          aggregateCredit: SmokingCalculator.computeDayCredit(counts, trackerSnapshots),
          status: 'open', updatedAt: serverTimestamp() };
        if (day) tx.update(dayRef, payload);
        else tx.set(dayRef, { ...payload, createdAt: serverTimestamp() });
        tx.set(marker, { date: claim.date, applied: true });
        return;
      }
      const existing = await tx.get(log);
      const user = await tx.get(userRef);
      if (existing.exists()) throw new Error('LEGACY_RECOVERY_CONFLICT');
      const counts = { [id]: claim.counts[id] };
      const trackerSnapshots = { [id]: SmokingCalculator.buildTrackerSnapshot({
        ...(configById[id] || { name: 'Removed tracker', type: 'SIMPLE' }),
        limit: 0, baseline: null, pricePerUnit: 0, isFinanciallyTracked: false,
      }, 0) };
      const credit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots);
      tx.set(log, { logDate: claim.date, counts, trackerSnapshots, aggregateCredit: credit,
        origin: 'LEGACY_RECOVERY', economicStatus: 'UNKNOWN', clientTimestamp: serverTimestamp() });
      tx.set(marker, { date: claim.date, applied: true });
      tx.update(userRef, { 'lifetimeAggregates.smokingUnits':
        (user.data()?.lifetimeAggregates?.smokingUnits || 0) + credit.smokingUnits });
    });
  }
};

/**
 * RegistryService (Model Layer)
 * Hardened for Cross-Platform Parity and Atomic Integrity.
 *
 * ## Data model
 *
 * `users/{uid}/days/{YYYY-MM-DD}` is the dated daily-document model (item 1):
 * every count always belongs to an explicit tracking date decided AT WRITE
 * TIME by the caller (`getTrackingDate(now, dayStartHour)`), never to a
 * mutable "current session" bucket that can outlive the day it started on.
 * There is nothing to "roll over" — a day's doc is written under its own
 * date from the first tap and simply stops changing once the tracking date
 * moves on. "Close day" only marks the day complete and folds its stamped
 * credit into `lifetimeAggregates`; it is never what decides which date a
 * count belongs to.
 *
 * `users/{uid}/logs/{logId}` is the pre-existing ledger, kept for backward
 * compatibility: legacy day archives (`{date}_DAY`, no longer created by
 * updated clients) and manual backfill entries (still created here).
 *
 * `users/{uid}` no longer carries `activeCounts` for updated clients (item
 * 12) — see `migrateLegacyActiveCounts`. `avatar` moved to
 * `users/{uid}/meta/profile` — see `updateAvatar`.
 */
export const RegistryService = {
  getHistoricalDay: async (uid, date) => {
    const snap = await getDoc(doc(db, 'users', uid, 'days', date));
    return snap.exists() ? { ...snap.data(), date } : null;
  },
  getHistoricalLog: async (uid, id) => {
    const snap = await getDoc(doc(db, 'users', uid, 'logs', id));
    return snap.exists() ? { ...snap.data(), id } : null;
  },

  // --- CONFIGURATIONS ---

  subscribeToConfigs: (uid, onSuccess, onError) => {
    if (!uid) return () => {};
    const q = query(
      collection(db, 'users', uid, 'configs'),
      orderBy('order', 'asc')
    );
    return onSnapshot(q, { includeMetadataChanges: true }, (s) => {
      onSuccess(s.docs.map(withDocId), s.metadata);
    }, onError);
  },

  addProtocol: async (uid, data) => {
    if ((await getConfigsOnce(uid)).length >= 8) throw new Error('TRACKER_LIMIT');
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

  /**
   * `trackingDate` (optional) additionally strips this tracker out of TODAY's
   * still-open day doc, mirroring the old activeCounts cleanup, WITHOUT ever
   * touching a closed/historical day — deleting a tracker must not make past
   * records uninterpretable (item 2); its trackerSnapshot there is untouched.
   */
  deleteProtocol: async (uid, pid, trackingDate) => {
    const userRef = doc(db, 'users', uid);
    const configRef = doc(db, 'users', uid, 'configs', pid);
    const dayRef = trackingDate ? doc(db, 'users', uid, 'days', trackingDate) : null;
    return runTransaction(db, async (transaction) => {
      // Legacy cleanup for accounts an old (pre-days-model) Android build may
      // still be writing to — harmless no-op once activeCounts is gone.
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists()) {
        const legacyCounts = { ...(userSnap.data().activeCounts || {}) };
        if (Object.prototype.hasOwnProperty.call(legacyCounts, pid)) {
          delete legacyCounts[pid];
          transaction.update(userRef, { activeCounts: legacyCounts });
        }
      }
      if (dayRef) {
        const daySnap = await transaction.get(dayRef);
        if (daySnap.exists() && daySnap.data().status !== 'closed') {
          const day = daySnap.data();
          if (Object.prototype.hasOwnProperty.call(day.counts || {}, pid)) {
            const counts = { ...day.counts };
            delete counts[pid];
            const trackerSnapshots = { ...(day.trackerSnapshots || {}) };
            delete trackerSnapshots[pid];
            const aggregateCredit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots);
            transaction.update(dayRef, { counts, trackerSnapshots, aggregateCredit, updatedAt: serverTimestamp() });
          }
        }
      }
      transaction.delete(configRef);
    });
  },

  reorderConfigs: async (uid, c1, c2) => {
    return runTransaction(db, async (transaction) => {
      const ref1 = doc(db, 'users', uid, 'configs', c1.id);
      const ref2 = doc(db, 'users', uid, 'configs', c2.id);
      const snap1 = await transaction.get(ref1);
      const snap2 = await transaction.get(ref2);
      if (!snap1.exists() || !snap2.exists()) return;
      const o1 = snap1.data().order;
      const o2 = snap2.data().order;
      transaction.update(ref1, { order: o2 });
      transaction.update(ref2, { order: o1 });
    });
  },

  // --- PROFILE BOOTSTRAP ---

  /**
   * Creates a default user doc transactionally only when missing — never overwrites
   * existing counters/aggregates even under concurrent sign-ins (M-05 fix).
   * New accounts are created directly on the current schema.
   */
  ensureUserDocument: async (uid, { name = '', accent = '#FF5F5F' } = {}) => {
    if (!uid) throw new Error('INVALID_REF');
    const ref = doc(db, 'users', uid);
    return runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (snap.exists()) return;
      transaction.set(ref, {
        name: name || '',
        accent: accent || '#FF5F5F',
        widgetSize: 'MEDIUM',
        purchaseType: 'PACK',
        unitPrice: 0.5,
        pouchPrice: 0,
        estimatedYield: 0,
        dayStartHour: 6,
        lifetimeAggregates: emptyAggregates(),
        smokingUnitsMigrated: true,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
    });
  },

  /**
   * Settings-only write path (Android `updateProfileSettings` parity).
   * Never touches counters/aggregates. Strips unknown keys and deletes legacy
   * web eco fields (and any lingering legacy `activeCounts`/`avatar`) so
   * hardened rules stay satisfied and old fields drain off the doc over time.
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
   * Concurrency-safe (H-02 fix): guards against concurrent log mutations while scanning
   * outside the transaction, retrying if source totals shifted before commit.
   */
  migrateSmokingUnitsIfNeeded: async (uid) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const leaseId = newClaimId();
    const leaseUntil = Timestamp.fromMillis(Date.now() + 120000);
    const acquired = await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(userRef);
      if (!snapshot.exists()) return false;
      const profile = snapshot.data();
      if (profile.smokingUnitsMigrated || profile.deleting) return false;
      if (timestampMillis(profile.smokingMigrationLeaseUntil) > Date.now()) return false;
      tx.update(userRef, { smokingMigrationLeaseId: leaseId, smokingMigrationLeaseUntil: leaseUntil });
      return true;
    });
    if (!acquired) return;
    const configs = await getConfigsOnce(uid);
    const logs = await getAllLogs(uid);
    const days = await getAllDays(uid);
    const units = SmokingCalculator.sumSmokingUnitsFromLogs(logs, configs)
      + days.filter((day) => day.foldedIntoLifetime).reduce((sum, day) => sum
        + (day.aggregateCredit?.smokingUnits ?? SmokingCalculator.sumSmokingUnits(day.counts, configs)), 0);
    await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(userRef);
      if (!snapshot.exists()) return;
      const profile = snapshot.data();
      if (profile.deleting || profile.smokingMigrationLeaseId !== leaseId) return;
      if (timestampMillis(profile.smokingMigrationLeaseUntil) <= Date.now()) throw new Error('MIGRATION_LEASE_EXPIRED');
      tx.update(userRef, {
        'lifetimeAggregates.smokingUnits': units, smokingUnitsMigrated: true,
        smokingMigrationLeaseId: deleteField(), smokingMigrationLeaseUntil: deleteField(),
      });
    });
  },
  /** Claim legacy counts under protocol 3, apply permanent per-tracker markers,
   * recover closed/overflow targets with unknown money, then atomically release
   * the profile fence and stamp completion. Each transaction may safely retry. */
  migrateLegacyActiveCounts: async (uid) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const clearClaim = { migratingLegacyCounts: deleteField(), migratingLegacyDate: deleteField(),
      migratingLegacyId: deleteField(), migratingLegacyVersion: deleteField(), migratingLegacyUnitPrice: deleteField() };
    let claim = null;
    await runTransaction(db, async (tx) => {
      claim = null; // A retried callback must not retain a superseded claim.
      const snap = await tx.get(userRef);
      if (!snap.exists()) return;
      const profile = snap.data();
      const pending = normalizeCounts(profile.migratingLegacyCounts || {});
      if (profile.migratingLegacyDate && Object.values(pending).some((v) => v > 0)) {
        // An old atomic migration may have committed before claim cleanup.
        if (!profile.migratingLegacyId) {
          const day = await tx.get(doc(db, 'users', uid, 'days', profile.migratingLegacyDate));
          if (day.exists() && day.data().legacyMigrationApplied) {
            tx.update(userRef, clearClaim);
            return;
          }
        }
        const id = profile.migratingLegacyId || newClaimId();
        const price = profile.migratingLegacyUnitPrice ?? profile.unitPrice ?? 0.5;
        tx.update(userRef, { migratingLegacyId: id, migratingLegacyVersion: 3, migratingLegacyUnitPrice: price });
        claim = { counts: pending, date: profile.migratingLegacyDate, id, price };
        return;
      }
      const legacy = normalizeCounts(profile.activeCounts || {});
      if (!Object.values(legacy).some((v) => v > 0)) {
        if ((profile.schemaVersion || 0) < CURRENT_SCHEMA_VERSION || profile.migratingLegacyVersion) {
          tx.update(userRef, { ...clearClaim, schemaVersion: CURRENT_SCHEMA_VERSION, activeCounts: deleteField() });
        }
        return;
      }
      const date = SmokingCalculator.getTrackingDate(new Date(), profile.dayStartHour ?? 6);
      const id = newClaimId();
      const price = profile.unitPrice ?? 0.5;
      tx.update(userRef, { schemaVersion: CURRENT_SCHEMA_VERSION, activeCounts: deleteField(),
        migratingLegacyCounts: legacy, migratingLegacyDate: date, migratingLegacyId: id,
        migratingLegacyVersion: 3, migratingLegacyUnitPrice: price });
      claim = { counts: legacy, date, id, price };
    });
    if (!claim) return;
    const configById = Object.fromEntries((await getConfigsOnce(uid)).map((c) => [c.id, c]));
    await applyLegacyClaim(uid, claim, configById);
    // Clear the fence and stamp completion atomically, so an old in-flight
    // transaction must retry and observe completion rather than re-add counts.
    await runTransaction(db, async (tx) => {
      const user = await tx.get(userRef);
      const dayRef = doc(db, 'users', uid, 'days', claim.date);
      const day = await tx.get(dayRef);
      if (user.data()?.migratingLegacyId !== claim.id) return;
      tx.update(userRef, clearClaim);
      if (day.exists() && day.data().status !== 'closed') tx.update(dayRef, { legacyMigrationApplied: true });
    });
  },
  /**
   * One-shot, best-effort migration of the legacy root-level `avatar` field
   * into `users/{uid}/meta/profile` (item 12 — decouples large, rarely-
   * changing avatar payloads from the profile doc entirely). Not
   * transactional across the two documents: on a rare concurrent-device race
   * the avatar may be copied twice (harmless — same bytes) but is never lost.
   */
  migrateAvatarToProfileMeta: async (uid) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const avatar = snap.data().avatar;
    if (avatar == null) return;
    const metaRef = doc(db, 'users', uid, 'meta', 'profile');
    try {
      const metaSnap = await getDoc(metaRef);
      if (!metaSnap.exists() || metaSnap.data().avatar == null) {
        await setDoc(metaRef, { avatar, updatedAt: serverTimestamp() }, { merge: true });
      }
      await updateDoc(userRef, { avatar: deleteField() }).catch(() => { /* already gone */ });
    } catch (err) {
      console.warn('[SYS] Avatar migration to meta/profile skipped:', err);
    }
  },

  // --- PROFILE EXTRA (avatar; item 12 hot/profile split) ---

  subscribeToProfileExtra: (uid, onSuccess, onError) => {
    if (!uid) return () => {};
    return onSnapshot(doc(db, 'users', uid, 'meta', 'profile'), (s) => {
      onSuccess(s.exists() ? s.data() : { avatar: null });
    }, onError);
  },

  updateAvatar: async (uid, avatar) => {
    if (!uid) throw new Error('INVALID_REF');
    await setDoc(doc(db, 'users', uid, 'meta', 'profile'), {
      avatar: avatar ?? null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    // Best-effort: drain the legacy field so old profile snapshot listeners
    // stop re-transmitting it. Not required for correctness.
    try { await updateDoc(doc(db, 'users', uid), { avatar: deleteField() }); } catch { /* already gone */ }
  },

  // --- DATED DAILY DOCUMENTS (item 1 — P0 rollover fix) ---

  subscribeToDay: (uid, date, onSuccess, onError) => {
    if (!uid || !date) return () => {};
    return onSnapshot(doc(db, 'users', uid, 'days', date), (s) => {
      onSuccess(s.exists() ? { ...s.data(), date: s.id } : null);
    }, onError);
  },

  /** Bounded window (comfortably covers the 366-day streak lookback) for chart/streak use. */
  subscribeToDays: (uid, onSuccess, onError, maxDays = 400) => {
    if (!uid) return () => {};
    const q = query(
      collection(db, 'users', uid, 'days'),
      orderBy('date', 'desc'),
      limit(maxDays)
    );
    return onSnapshot(q, (s) => {
      onSuccess(s.docs.map((d) => ({ ...d.data(), date: d.id })));
    }, onError);
  },

  /**
   * ATOMIC COUNTER ADJUSTMENT — the core P0 fix.
   *
   * `trackingDate` is computed by the caller AT CALL TIME from wall-clock now
   * + dayStartHour, and is where this write always lands — there is no
   * separate "current session" bucket that can carry counts across a
   * rollover boundary, regardless of whether the app was open at the exact
   * rollover moment, whether a 30s timer fired, or whether "End day" was ever
   * pressed. Refreshes that tracker's historical snapshot on every write,
   * which is correct specifically because the target day IS still today: the
   * live config *is* today's config-in-progress.
   *
   * `defaultUnitPrice` (the profile's fallback price) is supplied by the
   * caller rather than re-read here, so this transaction never has to touch
   * `users/{uid}` — keeping the hottest write path in the app fully
   * decoupled from the profile document (item 12).
   */
  adjustCounter: async (uid, counterId, delta, trackingDate, defaultUnitPrice = 0.5) => {
    if (!uid || !counterId) throw new Error('INVALID_REF');
    if (!trackingDate || !SmokingCalculator.isValidDate(trackingDate)) {
      throw new Error('INVALID_TRACKING_DATE');
    }
    const configRef = doc(db, 'users', uid, 'configs', counterId);
    const dayRef = doc(db, 'users', uid, 'days', trackingDate);

    return runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);
      if (!configSnap.exists()) throw new Error('CONFIG_NOT_FOUND');
      const config = { ...configSnap.data(), id: counterId };

      const daySnap = await transaction.get(dayRef);
      const existing = daySnap.exists() ? daySnap.data() : null;
      if (existing?.status === 'closed') throw new Error('DAY_CLOSED');
      if (!Object.hasOwn(existing?.trackerSnapshots || {}, counterId)
        && Object.keys(existing?.trackerSnapshots || {}).length >= 8) throw new Error('TRACKER_LIMIT');

      const counts = { ...(existing?.counts || {}) };
      counts[counterId] = Math.max(0, (counts[counterId] || 0) + delta);
      const trackerSnapshots = {
        ...(existing?.trackerSnapshots || {}),
        [counterId]: SmokingCalculator.buildTrackerSnapshot(config, defaultUnitPrice),
      };
      const aggregateCredit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots, defaultUnitPrice);

      const payload = {
        date: trackingDate,
        counts,
        trackerSnapshots,
        aggregateCredit,
        status: 'open',
        updatedAt: serverTimestamp(),
        updatedTrackerId: counterId,
      };
      if (existing) transaction.update(dayRef, payload);
      else transaction.set(dayRef, { ...payload, createdAt: serverTimestamp() });
    });
  },

  /**
   * Close a tracking day: marks it complete and folds its stamped credit
   * into `lifetimeAggregates`. Purely a UX/rollup affordance — it is NEVER
   * what assigns counts to a date (that already happened, at write time, in
   * `adjustCounter`). Idempotent: a day already folded just gets the
   * cosmetic `status: 'closed'` flip without re-crediting.
   */
  closeDay: async (uid, date, allowEmpty = false) => {
    if (!uid || !date) throw new Error('INVALID_PAYLOAD');
    const userRef = doc(db, 'users', uid);
    const dayRef = doc(db, 'users', uid, 'days', date);

    return runTransaction(db, async (transaction) => {
      const daySnap = await transaction.get(dayRef);
      if (!daySnap.exists()) throw new Error('NOTHING_TO_ARCHIVE');
      const day = daySnap.data();
      if (!allowEmpty && !SmokingCalculator.hasOpenSession(day.counts)) throw new Error('NOTHING_TO_ARCHIVE');

      if (day.foldedIntoLifetime) {
        if (day.status !== 'closed') transaction.update(dayRef, { status: 'closed', closedAt: serverTimestamp() });
        return;
      }

      const userSnap = await transaction.get(userRef);
      const profile = userSnap.exists() ? userSnap.data() : {};
      const current = profile.lifetimeAggregates || emptyAggregates();
      const credit = day.aggregateCredit || emptyAggregates();

      transaction.update(dayRef, { status: 'closed', foldedIntoLifetime: true, closedAt: serverTimestamp() });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (current.saved || 0) + (credit.saved || 0),
        'lifetimeAggregates.wasted': (current.wasted || 0) + (credit.wasted || 0),
        'lifetimeAggregates.smokingUnits': (current.smokingUnits || 0) + (credit.smokingUnits || 0),
        'lifetimeAggregates.baselineSaved': (current.baselineSaved || 0) + (credit.baselineSaved || 0),
      });
    });
  },

  /**
   * Fold any day that is still marked `open` but is no longer the current
   * tracking date (item 1 — correctness must not depend on the app being
   * open at rollover or on "End day" ever being pressed). Safe to call on
   * every app start / tracking-date change; best-effort per day so one
   * failure does not block the rest.
   */
  reconcileStaleDays: async (uid, currentTrackingDate) => {
    if (!uid || !currentTrackingDate) return;
    const q = query(
      collection(db, 'users', uid, 'days'),
      where('status', '==', 'open'),
      limit(30)
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (e) {
      console.warn('[REGISTRY] reconcileStaleDays query failed', e);
      return;
    }
    const stale = snap.docs.filter((d) => (d.data().date || d.id) < currentTrackingDate);
    for (const d of stale) {
      try {
        // Sequential is intentional: bounded (<=30), best-effort, one failure
        // must not abort the rest.
        await RegistryService.closeDay(uid, d.id, true);
      } catch (e) {
        console.warn('[REGISTRY] reconcile failed for', d.id, e);
      }
    }
  },

  /**
   * Edit a closed historical day's counts (History screen). Never adds or
   * changes a `trackerSnapshots` entry — a historical day's stamped
   * config is immutable (item 2); a tracker with no snapshot for that day
   * contributes 0 to its financials rather than borrowing today's price, a
   * documented, non-fabricating fallback.
   */
  updateHistoricalDay: async (uid, date, counts) => {
    if (!uid || !date) throw new Error('INVALID_REF');
    const userRef = doc(db, 'users', uid);
    const dayRef = doc(db, 'users', uid, 'days', date);
    const normalized = normalizeCounts(counts);

    return runTransaction(db, async (transaction) => {
      const daySnap = await transaction.get(dayRef);
      if (!daySnap.exists()) throw new Error('DAY_NOT_FOUND');
      const day = daySnap.data();
      const mergedCounts = { ...(day.counts || {}), ...normalized };
      if (countsEqual(mergedCounts, day.counts || {})) return;
      requireHistoricalPrices(mergedCounts, day.trackerSnapshots || {});
      const newCredit = SmokingCalculator.computeDayCredit(mergedCounts, day.trackerSnapshots || {});

      if (day.foldedIntoLifetime) {
        const oldCredit = day.aggregateCredit || emptyAggregates();
        const userSnap = await transaction.get(userRef);
        if (userSnap.exists()) {
          const current = userSnap.data().lifetimeAggregates || emptyAggregates();
          transaction.update(userRef, {
            'lifetimeAggregates.saved': (current.saved || 0) - (oldCredit.saved || 0) + newCredit.saved,
            'lifetimeAggregates.wasted': (current.wasted || 0) - (oldCredit.wasted || 0) + newCredit.wasted,
            'lifetimeAggregates.smokingUnits': (current.smokingUnits || 0) - (oldCredit.smokingUnits || 0) + newCredit.smokingUnits,
            'lifetimeAggregates.baselineSaved': (current.baselineSaved || 0) - (oldCredit.baselineSaved || 0) + (newCredit.baselineSaved || 0),
          });
        }
      }

      transaction.update(dayRef, { counts: mergedCounts, aggregateCredit: newCredit, updatedAt: serverTimestamp() });
    });
  },

  // --- LOGS (legacy ledger — manual backfill entries; kept for compatibility) ---

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
   * One-shot cursor page of logs older than the live subscription window.
   * Supports deterministic pagination (M-02 fix) via document snapshot cursor
   * `cursorLogId` or legacy date cursor.
   */
  fetchOlderLogs: async (uid, { cursorLogDate, cursorLogId, pageSize = 200 } = {}) => {
    if (!uid) return { items: [], hasMore: false };
    const ref = collection(db, 'users', uid, 'logs');
    let q = query(ref, orderBy('logDate', 'desc'), orderBy('__name__', 'desc'), limit(pageSize));
    if (cursorLogId && cursorLogDate) {
      q = query(q, startAfter(cursorLogDate, cursorLogId));
    } else if (cursorLogId) {
      const cursorSnap = await getDoc(doc(db, 'users', uid, 'logs', cursorLogId));
      if (cursorSnap.exists()) {
        q = query(q, startAfter(cursorSnap));
      }
    } else if (cursorLogDate) {
      const cursorDocs = await getDocs(
        query(collection(db, 'users', uid, 'logs'), orderBy('logDate', 'desc'), where('logDate', '==', cursorLogDate), limit(1))
      );
      if (!cursorDocs.empty) {
        q = query(collection(db, 'users', uid, 'logs'), orderBy('logDate', 'desc'), startAfter(cursorDocs.docs[0]), limit(pageSize));
      }
    }
    const snap = await getDocs(q);
    const items = snap.docs.map(withDocId);
    const lastItem = items.length ? items[items.length - 1] : null;
    return {
      items,
      hasMore: items.length === pageSize,
      nextCursor: lastItem ? lastItem.logDate : null,
      nextCursorDocId: lastItem ? lastItem.id : null,
    };
  },

  fetchOlderDays: async (uid, { cursorDate, pageSize = 200 } = {}) => {
    if (!uid) return { items: [], hasMore: false, nextCursor: null };
    let q = query(collection(db, 'users', uid, 'days'), orderBy('date', 'desc'), limit(pageSize));
    if (cursorDate) q = query(q, startAfter(cursorDate));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => ({ ...d.data(), date: d.id }));
    return { items, hasMore: items.length === pageSize, nextCursor: items.at(-1)?.date ?? null };
  },

  /**
   * Edit a historical log's counts, adjusting lifetime aggregates by the
   * financial delta (Android parity with updateHistoricalLog). Legacy
   * `logs` path — see `updateHistoricalDay` for the dated-document
   * equivalent.
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
      const historicalIds = Object.keys(oldLog.trackerSnapshots || {});
      const mergedCounts = mergeHistoricalEditCounts(normalized, oldCounts, configIds, historicalIds);
      if (countsEqual(mergedCounts, oldCounts)) return;
      requireHistoricalPrices(mergedCounts, oldLog.trackerSnapshots || {});
      const oldCredit = resolveContribution(oldLog.aggregateCredit
        || SmokingCalculator.computeDayCredit(oldCounts, oldLog.trackerSnapshots), oldCounts, configs, price);
      const newCredit = SmokingCalculator.computeDayCredit(mergedCounts, oldLog.trackerSnapshots);

      transaction.update(logRef, { counts: mergedCounts, aggregateCredit: newCredit });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) - oldCredit.saved + newCredit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) - oldCredit.wasted + newCredit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - oldCredit.smokingUnits + newCredit.smokingUnits,
        'lifetimeAggregates.baselineSaved': (profile.lifetimeAggregates?.baselineSaved || 0) - (oldCredit.baselineSaved || 0) + (newCredit.baselineSaved || 0)
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
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) - credit.smokingUnits,
        'lifetimeAggregates.baselineSaved': (profile.lifetimeAggregates?.baselineSaved || 0) - (credit.baselineSaved || 0)
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
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + credit.smokingUnits,
        'lifetimeAggregates.baselineSaved': (profile.lifetimeAggregates?.baselineSaved || 0) + (credit.baselineSaved || 0)
      });
    });
  },

  /**
   * Manual backfill entry (Android parity with createManualEntry).
   * Credits lifetime aggregates inside the same transaction as the log write.
   * Kept on the legacy `logs` ledger regardless of whether the target date
   * already has a `days/{date}` doc, so multiple backfills for one date keep
   * their own editable/undoable rows in History (unchanged UX).
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
    const entropy = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    const logId = `${date}_M${now}_${entropy}`;
    const logRef = doc(db, 'users', uid, 'logs', logId);
    const configIds = await listConfigIds(uid);
    if (configIds.length > 8) throw new Error('TRACKER_LIMIT');
    if (Object.entries(normalized).some(([id, value]) => value > 0 && !configIds.includes(id))) {
      throw new Error('INVALID_TRACKER');
    }

    return runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) return;
      const configs = await loadConfigsInTransaction(transaction, uid, configIds);

      const profile = userSnap.data();
      const price = profile.unitPrice ?? unitPrice;
      const trackerSnapshots = Object.fromEntries(configs
        .map((c) => [c.id, SmokingCalculator.buildTrackerSnapshot(c, price)]));
      const credit = SmokingCalculator.computeDayCredit(normalized, trackerSnapshots);

      transaction.set(logRef, {
        id: logId,
        logDate: date,
        counts: normalized,
        isManual: true,
        origin: 'MANUAL_ENTRY',
        aggregateCredit: credit,
        trackerSnapshots,
        clientTimestamp: serverTimestamp()
      });
      transaction.update(userRef, {
        'lifetimeAggregates.saved': (profile.lifetimeAggregates?.saved || 0) + credit.saved,
        'lifetimeAggregates.wasted': (profile.lifetimeAggregates?.wasted || 0) + credit.wasted,
        'lifetimeAggregates.smokingUnits': (profile.lifetimeAggregates?.smokingUnits || 0) + credit.smokingUnits,
        'lifetimeAggregates.baselineSaved': (profile.lifetimeAggregates?.baselineSaved || 0) + (credit.baselineSaved || 0)
      });
    });
  },

  /**
   * Spark-safe account wipe: delete configs + logs + days + meta in batches,
   * then user doc. Caller must reauthenticate and Auth.deleteUser afterward.
   */
  deleteAllUserData: async (uid) => {
    if (!uid) throw new Error('INVALID_REF');
    const userRef = doc(db, 'users', uid);
    await runTransaction(db, async (tx) => {
      const profile = await tx.get(userRef);
      if (profile.exists()) tx.update(userRef, { deleting: true });
      else tx.set(userRef, { deleting: true });
    });
    await deleteCollectionDocs(uid, 'configs');
    await deleteCollectionDocs(uid, 'logs');
    await deleteCollectionDocs(uid, 'days');
    await deleteCollectionDocs(uid, 'meta');
    // Retain a minimal UID-keyed tombstone: old Auth tokens cannot recreate data.
    // An Auth failure can retry the same fenced deletion safely.
    await setDoc(userRef, { deleting: true });
  },

  /**
   * Complete, unbounded read of all user data for export (spec item 1).
   * Uses full-paginated reads, NOT the bounded live-query collections
   * (limit(1200) for logs, limit(400) for days). Strictly read-only.
   */
  readCompleteExportSnapshot: async (uid) => {
    if (!uid) throw new Error('INVALID_REF');

    // Profile (single doc)
    const profileSnap = await getDoc(doc(db, 'users', uid));
    const profile = profileSnap.exists() ? profileSnap.data() : null;

    // Profile meta / avatar (single doc under meta/profile)
    const metaSnap = await getDoc(doc(db, 'users', uid, 'meta', 'profile'));
    const profileMeta = metaSnap.exists()
      ? { avatar: metaSnap.data().avatar || null }
      : { avatar: null };

    // Configs (full read — user will never have 10k+ trackers)
    const configs = await getConfigsOnce(uid);

    // Days (paginated — covers full history, not the bounded 400-day window)
    const days = await getAllDays(uid);

    // Logs (paginated — covers full history, not the bounded 1200-log window)
    const logs = await getAllLogs(uid);

    return {
      exportVersion: 1,
      generatedAt: new Date().toISOString(),
      application: { name: 'Tabakpp' },
      profile,
      profileMeta,
      configs,
      days,
      logs,
    };
  },
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

/**
 * Paginated collection wipe for Spark (no Admin recursive delete).
 */
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

/**
 * Paginated read of every day document for export (spec item 1).
 * Mirrors getAllLogs — unbounded, not the live-query limit(400) window.
 */
async function getAllDays(uid, pageSize = 400) {
  const out = [];
  let lastDoc = null;
  while (true) {
    let base = query(
      collection(db, 'users', uid, 'days'),
      orderBy('date', 'desc'),
      limit(pageSize)
    );
    if (lastDoc) base = query(base, startAfter(lastDoc));
    const snap = await getDocs(base);
    if (snap.empty) break;
    snap.docs.forEach((d) => out.push(withDocId(d)));
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }
  return out;
}
