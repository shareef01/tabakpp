import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, onSnapshot, orderBy, where, writeBatch, limit, serverTimestamp,
  runTransaction, deleteField, startAfter
} from 'firebase/firestore';
import { db } from '../firebase';
import { SmokingCalculator } from '../utils/smokingCalculator';
import { sanitizeTrackerName } from '../utils/security';

/** Doc id always wins over any payload `id` field (Android parity). */
const withDocId = (d) => ({ ...d.data(), id: d.id });

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

const emptyAggregates = () => ({ saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 });

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
  migrateSmokingUnitsIfNeeded: async (uid, maxRetries = 2) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const snap = await getDoc(userRef);
      if (!snap.exists() || snap.data().smokingUnitsMigrated) return;
      const initialAggs = snap.data().lifetimeAggregates || emptyAggregates();

      const configs = await getConfigsOnce(uid);
      const logs = await getAllLogs(uid);
      const units = SmokingCalculator.sumSmokingUnitsFromLogs(logs, configs);

      let retryNeeded = false;
      await runTransaction(db, async (transaction) => {
        const live = await transaction.get(userRef);
        if (!live.exists() || live.data().smokingUnitsMigrated) return;
        const liveData = live.data();
        const liveAggs = liveData.lifetimeAggregates || emptyAggregates();

        // Concurrency check: If lifetimeAggregates (saved/wasted/baselineSaved) shifted
        // while we scanned logs outside the transaction, a concurrent mutation happened.
        // We must not commit stale smokingUnits; abort and retry with fresh logs.
        if (
          Number(liveAggs.saved || 0) !== Number(initialAggs.saved || 0) ||
          Number(liveAggs.wasted || 0) !== Number(initialAggs.wasted || 0) ||
          Number(liveAggs.baselineSaved || 0) !== Number(initialAggs.baselineSaved || 0)
        ) {
          retryNeeded = true;
          return;
        }

        transaction.update(userRef, {
          lifetimeAggregates: {
            saved: Number(liveAggs.saved || 0),
            wasted: Number(liveAggs.wasted || 0),
            smokingUnits: units,
            baselineSaved: Number(liveAggs.baselineSaved || 0),
          },
          smokingUnitsMigrated: true
        });
      });

      if (!retryNeeded) break;
    }
  },

  /**
   * One-shot, idempotent migration of legacy `activeCounts` into the dated
   * daily-document model.
   *
   * Whatever is sitting in `activeCounts` at the moment this runs is folded
   * into `days/{date}`, where `date` is computed with the EXACT SAME
   * `getTrackingDate(now, dayStartHour)` rule the old `endDay()` used — i.e.
   * the date the old app would have archived those counts under had the user
   * pressed "End day" at this instant. This is a deterministic mapping, not a
   * guess: it never invents a date, and it never discards counts.
   *
   * Runs as TWO single-document transactions rather than one atomic
   * users+days commit. A combined commit was tried first and measurably hit
   * Firestore's hard per-commit rules-evaluation ceiling ("maximum of 1000
   * expressions") in the emulator once `days` validation was added — that is
   * a platform limit, not a bug in the math, and splitting the write is the
   * documented fix (see firestore.rules `validDayShape`'s comment). Each
   * phase is independently idempotent and safe to resume after a crash
   * between them, from any device:
   *   Phase 1 (single doc: users/{uid}) atomically CLAIMS `activeCounts` —
   *     stamps it onto `migratingLegacyCounts` + `migratingLegacyDate`,
   *     clears `activeCounts`, bumps `schemaVersion`. Guarded so it can only
   *     ever claim once.
   *   Phase 2 (single doc: users/{uid}/days/{date}) folds the claim into
   *     that day, marks the day `legacyMigrationApplied`, and (separately)
   *     clears the claim fields from the profile. A crash after phase 2's
   *     day-write but before the profile cleanup just leaves a harmless,
   *     already-applied claim that the next run detects and clears without
   *     re-folding (`legacyMigrationApplied` guards against double credit).
   */
  migrateLegacyActiveCounts: async (uid) => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);

    let claim = null;
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) return;
      const profile = snap.data();

      const pending = normalizeCounts(profile.migratingLegacyCounts || {});
      if (profile.migratingLegacyDate && Object.values(pending).some((v) => v > 0)) {
        claim = { counts: pending, date: profile.migratingLegacyDate };
        return; // resume an interrupted phase 2
      }
      if ((profile.schemaVersion || 0) >= CURRENT_SCHEMA_VERSION) return; // fully migrated already

      const legacy = normalizeCounts(profile.activeCounts || {});
      if (!Object.values(legacy).some((v) => v > 0)) {
        transaction.update(userRef, { schemaVersion: CURRENT_SCHEMA_VERSION, activeCounts: deleteField() });
        return;
      }

      const date = SmokingCalculator.getTrackingDate(new Date(), profile.dayStartHour ?? 6);
      transaction.update(userRef, {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        activeCounts: deleteField(),
        migratingLegacyCounts: legacy,
        migratingLegacyDate: date,
      });
      claim = { counts: legacy, date };
    });

    if (!claim) return;

    // Read non-transactionally: no concurrent-modification stakes worth a
    // transactional config read here (see the cost note above) — worst case
    // on a config edited in the gap before the commit below, one migrated
    // tracker's snapshot is a moment stale, self-corrected on its next tap.
    const configById = Object.fromEntries((await getConfigsOnce(uid)).map((c) => [c.id, c]));
    const dayRef = doc(db, 'users', uid, 'days', claim.date);

    let claimResolved = false;
    await runTransaction(db, async (transaction) => {
      const daySnap = await transaction.get(dayRef);
      const existing = daySnap.exists() ? daySnap.data() : null;
      if (existing?.legacyMigrationApplied) {
        claimResolved = true; // already folded by a prior run — safe to clean up
        return;
      }

      if (existing?.status === 'closed') {
        // Exceptionally rare: closed by a newer client in the window between
        // the claim and this commit. The claim is already safely parked on
        // the profile (migratingLegacyCounts/-Date) — leave it there rather
        // than guessing a different date or discarding it. claimResolved
        // stays false, so the cleanup below is correctly skipped.
        return;
      }

      const mergedCounts = SmokingCalculator.mergeCounts(existing?.counts, claim.counts);
      const trackerSnapshots = { ...(existing?.trackerSnapshots || {}) };
      Object.keys(claim.counts).forEach((id) => {
        if (configById[id]) trackerSnapshots[id] = SmokingCalculator.buildTrackerSnapshot(configById[id]);
      });
      const aggregateCredit = SmokingCalculator.computeDayCredit(mergedCounts, trackerSnapshots, 0.5);

      const payload = {
        date: claim.date,
        counts: mergedCounts,
        trackerSnapshots,
        aggregateCredit,
        status: 'open',
        legacyMigrationApplied: true,
        updatedAt: serverTimestamp(),
      };
      if (existing) transaction.update(dayRef, payload);
      else transaction.set(dayRef, { ...payload, createdAt: serverTimestamp() });
      claimResolved = true;
    });

    if (!claimResolved) return; // day was closed underneath us — claim stays parked for a future run

    // Cleanup (separate single-document write): only reached once the day
    // fold above is either freshly applied or was already applied by a prior
    // run. A crash between the two leaves a harmless, idempotently-resumable
    // claim — the next call re-detects it via migratingLegacyDate.
    await updateDoc(userRef, {
      migratingLegacyCounts: deleteField(),
      migratingLegacyDate: deleteField(),
    }).catch(() => { /* best-effort — next run retries the cleanup */ });
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

      const counts = { ...(existing?.counts || {}) };
      counts[counterId] = Math.max(0, (counts[counterId] || 0) + delta);
      const trackerSnapshots = {
        ...(existing?.trackerSnapshots || {}),
        [counterId]: SmokingCalculator.buildTrackerSnapshot(config),
      };
      const aggregateCredit = SmokingCalculator.computeDayCredit(counts, trackerSnapshots, defaultUnitPrice);

      const payload = {
        date: trackingDate,
        counts,
        trackerSnapshots,
        aggregateCredit,
        status: 'open',
        updatedAt: serverTimestamp(),
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
  closeDay: async (uid, date) => {
    if (!uid || !date) throw new Error('INVALID_PAYLOAD');
    const userRef = doc(db, 'users', uid);
    const dayRef = doc(db, 'users', uid, 'days', date);

    return runTransaction(db, async (transaction) => {
      const daySnap = await transaction.get(dayRef);
      if (!daySnap.exists()) throw new Error('NOTHING_TO_ARCHIVE');
      const day = daySnap.data();
      if (!SmokingCalculator.hasOpenSession(day.counts)) throw new Error('NOTHING_TO_ARCHIVE');

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
        await RegistryService.closeDay(uid, d.id);
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
    let q = query(collection(db, 'users', uid, 'logs'), orderBy('logDate', 'desc'), limit(pageSize));
    if (cursorLogId) {
      const cursorSnap = await getDoc(doc(db, 'users', uid, 'logs', cursorLogId));
      if (cursorSnap.exists()) {
        q = query(collection(db, 'users', uid, 'logs'), orderBy('logDate', 'desc'), startAfter(cursorSnap), limit(pageSize));
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
   * Spark-safe account wipe: delete configs + logs + days + meta in batches,
   * then user doc. Caller must reauthenticate and Auth.deleteUser afterward.
   */
  deleteAllUserData: async (uid) => {
    if (!uid) throw new Error('INVALID_REF');
    await deleteCollectionDocs(uid, 'configs');
    await deleteCollectionDocs(uid, 'logs');
    await deleteCollectionDocs(uid, 'days');
    await deleteCollectionDocs(uid, 'meta');
    await deleteDoc(doc(db, 'users', uid));
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
      orderBy('dayDate', 'desc'),
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
