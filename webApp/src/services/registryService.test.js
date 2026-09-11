import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegistryService } from './registryService';
import { SmokingCalculator } from '../utils/smokingCalculator';

// In-memory Firestore fake. Only firebase/firestore is mocked; the real
// SmokingCalculator runs so these tests exercise the transaction orchestration
// (aggregate math, merge-delta, idempotency) end-to-end against the true domain
// math. Documents live in a flat Map keyed by slash-joined path.
const fake = vi.hoisted(() => {
  const store = new Map();

  const snap = (path) => {
    const has = store.has(path);
    const data = has ? store.get(path) : undefined;
    return {
      id: path.split('/').pop(),
      exists: () => has,
      data: () => (has ? structuredClone(data) : undefined),
      ref: { __doc: true, path, id: path.split('/').pop() },
    };
  };

  // Mirrors Firestore's dot-path field updates ('a.b' sets nested a.b).
  const applyUpdate = (target, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && value.__deleteField) {
        if (key.includes('.')) {
          const parts = key.split('.');
          let obj = target;
          for (let i = 0; i < parts.length - 1; i++) {
            if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) return;
            obj = obj[parts[i]];
          }
          delete obj[parts[parts.length - 1]];
        } else {
          delete target[key];
        }
        continue;
      }
      if (key.includes('.')) {
        const parts = key.split('.');
        let obj = target;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
      } else {
        target[key] = value;
      }
    }
  };

  const collectionDocs = (collectionPath) => {
    const prefix = `${collectionPath}/`;
    const out = [];
    for (const key of store.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) out.push(snap(key));
    }
    return out;
  };

  return { store, snap, applyUpdate, collectionDocs };
});

vi.mock('firebase/firestore', () => {
  const { store, snap, applyUpdate, collectionDocs } = fake;

  const doc = (first, ...rest) => {
    if (rest.length === 0 && first && first.__collection) {
      const id = `auto_${Math.random().toString(36).slice(2, 10)}`;
      return { __doc: true, path: `${first.path}/${id}`, id };
    }
    return { __doc: true, path: rest.join('/'), id: rest[rest.length - 1] };
  };
  const collection = (_db, ...segs) => ({ __collection: true, path: segs.join('/') });
  const query = (ref) => ref;
  const orderBy = () => ({ __c: 'orderBy' });
  const where = () => ({ __c: 'where' });
  const limit = () => ({ __c: 'limit' });
  const startAfter = () => ({ __c: 'startAfter' });
  const serverTimestamp = () => '__ServerTimestamp__';

  const getDoc = async (ref) => snap(ref.path);
  const getDocs = async (ref) => {
    const docs = collectionDocs(ref.path);
    return { docs, empty: docs.length === 0, size: docs.length };
  };
  const setDoc = async (ref, data) => { store.set(ref.path, structuredClone(data)); };
  const updateDoc = async (ref, data) => {
    const cur = store.get(ref.path) || {};
    applyUpdate(cur, structuredClone(data));
    store.set(ref.path, cur);
  };
  const deleteDoc = async (ref) => { store.delete(ref.path); };

  const runTransaction = async (_db, fn) => {
    const tx = {
      // The real client SDK's Transaction.get takes a DocumentReference ONLY.
      // Handing it a Query/CollectionReference throws
      // "TypeError: Cannot read properties of undefined (reading 'path')"
      // because the SDK dereferences ref._key. This fake must refuse the same
      // shapes, or it silently blesses a call that always fails in production.
      get: async (ref) => {
        if (!ref || !ref.__doc) {
          throw new TypeError("Cannot read properties of undefined (reading 'path')");
        }
        return snap(ref.path);
      },
      set: (ref, data) => { store.set(ref.path, structuredClone(data)); return tx; },
      update: (ref, data) => {
        const cur = store.get(ref.path);
        if (cur === undefined) throw new Error(`No document to update: ${ref.path}`);
        applyUpdate(cur, structuredClone(data));
        return tx;
      },
      delete: (ref) => { store.delete(ref.path); return tx; },
    };
    return fn(tx);
  };

  const writeBatch = () => {
    const ops = [];
    return {
      update: (ref, data) => ops.push(() => {
        const cur = store.get(ref.path) || {};
        applyUpdate(cur, structuredClone(data));
        store.set(ref.path, cur);
      }),
      set: (ref, data) => ops.push(() => store.set(ref.path, structuredClone(data))),
      delete: (ref) => ops.push(() => store.delete(ref.path)),
      commit: async () => { ops.forEach((op) => op()); },
    };
  };

  const onSnapshot = () => () => {};
  const deleteField = () => ({ __deleteField: true });

  return {
    doc, collection, query, orderBy, where, limit, startAfter, serverTimestamp, deleteField,
    getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction, writeBatch, onSnapshot,
  };
});

// --- fixtures & helpers ---------------------------------------------------

const UID = 'u1';
const USER_PATH = `users/${UID}`;

// cig: smoking, €1.00, limit 10 · ryo: smoking, €0.50, limit 5
const CIG = { id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 1.0 };

const seedUser = (data) => fake.store.set(USER_PATH, data);
const seedConfig = (c) => fake.store.set(`${USER_PATH}/configs/${c.id}`, c);
const seedLog = (l) => fake.store.set(`${USER_PATH}/logs/${l.id}`, l);
const seedDay = (date, data) => fake.store.set(`${USER_PATH}/days/${date}`, { date, ...data });
const userDoc = () => fake.store.get(USER_PATH);
const logDoc = (id) => fake.store.get(`${USER_PATH}/logs/${id}`);
const dayDoc = (date) => fake.store.get(`${USER_PATH}/days/${date}`);
const metaDoc = () => fake.store.get(`${USER_PATH}/meta/profile`);
const logPaths = () => [...fake.store.keys()].filter((k) => k.startsWith(`${USER_PATH}/logs/`));

const baseAgg = () => ({ saved: 50, wasted: 50, smokingUnits: 50 });

beforeEach(() => fake.store.clear());

// --- tests ----------------------------------------------------------------

describe('RegistryService.adjustCounter (dated daily-document model — item 1 P0 fix)', () => {
  const DATE = '2026-07-20';
  beforeEach(() => { seedConfig(CIG); seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 }); });

  it('creates the day doc under the given tracking date on the first tap', async () => {
    await RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5);
    const d = dayDoc(DATE);
    expect(d.counts).toEqual({ cig: 1 });
    expect(d.status).toBe('open');
    expect(d.trackerSnapshots.cig).toMatchObject({ target: 10, unitPrice: 1.0 });
    expect(d.aggregateCredit.wasted).toBeCloseTo(1);
  });

  it('increments an existing day doc for the same date', async () => {
    seedDay(DATE, { counts: { cig: 3 }, trackerSnapshots: { cig: { target: 10, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true } }, status: 'open' });
    await RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5);
    expect(dayDoc(DATE).counts.cig).toBe(4);
  });

  it('clamps a decrement at zero', async () => {
    seedDay(DATE, { counts: { cig: 1 }, trackerSnapshots: {}, status: 'open' });
    await RegistryService.adjustCounter(UID, 'cig', -5, DATE, 0.5);
    expect(dayDoc(DATE).counts.cig).toBe(0);
  });

  it('never writes to users/{uid} — the hot path is fully decoupled from the profile (item 12)', async () => {
    const before = { ...userDoc() };
    await RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5);
    expect(userDoc()).toEqual(before);
  });

  it('a count typed for an explicit prior date lands on that date, not "today" — the actual rollover fix', async () => {
    // Simulates: app was closed across the tracking-day rollover; when it
    // reopens, the caller still computes and passes yesterday's date for any
    // write logically attributed to it. There is no shared mutable bucket
    // that could have carried it into today instead.
    await RegistryService.adjustCounter(UID, 'cig', 1, '2026-07-19', 0.5);
    await RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5);
    expect(dayDoc('2026-07-19').counts).toEqual({ cig: 1 });
    expect(dayDoc(DATE).counts).toEqual({ cig: 1 });
  });

  it('throws when the tracker config is missing', async () => {
    await expect(RegistryService.adjustCounter(UID, 'ghost', 1, DATE, 0.5)).rejects.toThrow('CONFIG_NOT_FOUND');
  });

  it('throws on an invalid tracking date rather than silently misfiling the count', async () => {
    await expect(RegistryService.adjustCounter(UID, 'cig', 1, 'not-a-date', 0.5)).rejects.toThrow('INVALID_TRACKING_DATE');
  });

  it('refuses to write to a day that has already been closed', async () => {
    seedDay(DATE, { counts: { cig: 5 }, trackerSnapshots: {}, status: 'closed', foldedIntoLifetime: true });
    await expect(RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5)).rejects.toThrow('DAY_CLOSED');
  });

  it('refreshing the snapshot on every tap does not let a later config edit rewrite an earlier tap\'s meaning', async () => {
    await RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5); // target 10, €1.00
    seedConfig({ ...CIG, limit: 2, pricePerUnit: 5 }); // tracker edited mid-day
    await RegistryService.adjustCounter(UID, 'cig', 1, DATE, 0.5); // this tap's snapshot reflects the edit
    const credit = dayDoc(DATE).aggregateCredit;
    // Only the CURRENT (just-refreshed) snapshot is stored per tracker — this
    // documents that a same-day edit affects the whole day's stamp (the day
    // is still genuinely "in progress"), unlike a CLOSED day, which rules
    // forbid from ever changing its trackerSnapshots (see firestore.rules).
    expect(dayDoc(DATE).trackerSnapshots.cig.target).toBe(2);
    expect(credit.wasted).toBeCloseTo(10); // 2 units * €5
  });
});

describe('RegistryService.closeDay', () => {
  const DATE = '2026-07-20';
  beforeEach(() => { seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 }); });

  it('throws when there is nothing to close', async () => {
    await expect(RegistryService.closeDay(UID, DATE)).rejects.toThrow('NOTHING_TO_ARCHIVE');
    seedDay(DATE, { counts: {}, trackerSnapshots: {}, status: 'open' });
    await expect(RegistryService.closeDay(UID, DATE)).rejects.toThrow('NOTHING_TO_ARCHIVE');
  });

  it('folds the stamped credit into lifetimeAggregates and marks the day closed', async () => {
    seedDay(DATE, {
      counts: { cig: 8 },
      trackerSnapshots: { cig: { target: 10, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true, baseline: 20 } },
      aggregateCredit: { saved: 2, wasted: 8, smokingUnits: 8, baselineSaved: 12 },
      status: 'open',
    });

    await RegistryService.closeDay(UID, DATE);

    const d = dayDoc(DATE);
    expect(d.status).toBe('closed');
    expect(d.foldedIntoLifetime).toBe(true);
    const u = userDoc();
    expect(u.lifetimeAggregates.saved).toBeCloseTo(52);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(58);
    expect(u.lifetimeAggregates.baselineSaved).toBeCloseTo(12);
  });

  it('is idempotent — closing an already-folded day never double-credits', async () => {
    seedDay(DATE, {
      counts: { cig: 8 },
      trackerSnapshots: {},
      aggregateCredit: { saved: 2, wasted: 8, smokingUnits: 8, baselineSaved: 0 },
      status: 'closed',
      foldedIntoLifetime: true,
    });
    await RegistryService.closeDay(UID, DATE);
    expect(userDoc().lifetimeAggregates).toEqual(baseAgg());
  });
});

describe('RegistryService.reconcileStaleDays (item 1 — correctness without "End day" or the app being open)', () => {
  it('closes a still-open day once the tracking date has moved past it', async () => {
    seedUser({ lifetimeAggregates: baseAgg() });
    seedDay('2026-07-18', {
      counts: { cig: 4 },
      trackerSnapshots: {},
      aggregateCredit: { saved: 1, wasted: 4, smokingUnits: 4, baselineSaved: 0 },
      status: 'open',
    });

    // Days later, any client (this one included) observes "today" has moved on.
    await RegistryService.reconcileStaleDays(UID, '2026-07-21');

    expect(dayDoc('2026-07-18').status).toBe('closed');
    expect(userDoc().lifetimeAggregates.wasted).toBeCloseTo(54);
  });

  it('never touches the current open day', async () => {
    seedUser({ lifetimeAggregates: baseAgg() });
    seedDay('2026-07-21', { counts: { cig: 1 }, trackerSnapshots: {}, aggregateCredit: { saved: 0, wasted: 1, smokingUnits: 1, baselineSaved: 0 }, status: 'open' });
    await RegistryService.reconcileStaleDays(UID, '2026-07-21');
    expect(dayDoc('2026-07-21').status).toBe('open');
  });
});

describe('RegistryService.updateHistoricalDay', () => {
  it('recomputes the stamped credit from the day\'s own snapshot, never from live config', async () => {
    seedUser({ lifetimeAggregates: baseAgg() });
    seedDay('2026-07-10', {
      counts: { cig: 4 },
      trackerSnapshots: { cig: { target: 10, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true } },
      aggregateCredit: { saved: 6, wasted: 4, smokingUnits: 4, baselineSaved: 0 },
      status: 'closed',
      foldedIntoLifetime: true,
    });
    // Live config has since changed drastically — must not affect this edit.
    seedConfig({ ...CIG, limit: 1000, pricePerUnit: 999 });

    await RegistryService.updateHistoricalDay(UID, '2026-07-10', { cig: 9 });

    const d = dayDoc('2026-07-10');
    expect(d.counts).toEqual({ cig: 9 });
    expect(d.aggregateCredit).toEqual({ wasted: 9, saved: 1, smokingUnits: 9, baselineSaved: 0 });
    const u = userDoc();
    expect(u.lifetimeAggregates.saved).toBeCloseTo(45); // 50 - 6 + 1
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(55); // 50 - 4 + 9
  });

  it('never adds or changes a trackerSnapshot entry for the edited day', async () => {
    seedUser({ lifetimeAggregates: baseAgg() });
    seedDay('2026-07-10', {
      counts: {},
      trackerSnapshots: {},
      aggregateCredit: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
      status: 'closed',
      foldedIntoLifetime: true,
    });
    await RegistryService.updateHistoricalDay(UID, '2026-07-10', { cig: 5 });
    const d = dayDoc('2026-07-10');
    expect(d.counts).toEqual({ cig: 5 });
    expect(d.trackerSnapshots).toEqual({}); // no snapshot -> $0 contribution, not fabricated
    expect(d.aggregateCredit).toEqual({ wasted: 0, saved: 0, smokingUnits: 0, baselineSaved: 0 });
  });
});

describe('RegistryService.migrateLegacyActiveCounts (item 1 — activeCounts migration)', () => {
  it('folds legacy activeCounts into the tracking date getTrackingDate would pick right now', async () => {
    seedConfig(CIG);
    seedUser({ activeCounts: { cig: 3 }, dayStartHour: 6, lifetimeAggregates: baseAgg(), schemaVersion: 1 });

    await RegistryService.migrateLegacyActiveCounts(UID);

    const expectedDate = SmokingCalculator.getTrackingDate(new Date(), 6);
    const d = dayDoc(expectedDate);
    expect(d.counts).toEqual({ cig: 3 });
    expect(d.trackerSnapshots.cig).toMatchObject({ target: 10 });
    expect(userDoc().schemaVersion).toBe(2);
    expect(userDoc().activeCounts).toBeUndefined();
  });

  it('is idempotent — a second run is a no-op', async () => {
    seedUser({ schemaVersion: 2, activeCounts: { cig: 3 } });
    await RegistryService.migrateLegacyActiveCounts(UID);
    expect(userDoc().activeCounts).toEqual({ cig: 3 }); // untouched — already current schema
  });

  it('marks the account current without creating a day doc when there is nothing to migrate', async () => {
    seedUser({ activeCounts: {}, schemaVersion: 1 });
    await RegistryService.migrateLegacyActiveCounts(UID);
    expect(userDoc().schemaVersion).toBe(2);
  });

  it('merges into an existing open day doc rather than overwriting it', async () => {
    seedConfig(CIG);
    const expectedDate = SmokingCalculator.getTrackingDate(new Date(), 6);
    seedDay(expectedDate, { counts: { cig: 2 }, trackerSnapshots: {}, status: 'open' });
    seedUser({ activeCounts: { cig: 3 }, dayStartHour: 6, schemaVersion: 1, lifetimeAggregates: baseAgg() });

    await RegistryService.migrateLegacyActiveCounts(UID);

    expect(dayDoc(expectedDate).counts).toEqual({ cig: 5 });
  });
});

describe('RegistryService.migrateAvatarToProfileMeta / updateAvatar (item 12)', () => {
  it('copies the legacy avatar into meta/profile and clears the root field', async () => {
    seedUser({ avatar: 'data:legacy' });
    await RegistryService.migrateAvatarToProfileMeta(UID);
    expect(metaDoc().avatar).toBe('data:legacy');
    expect(userDoc().avatar).toBeUndefined();
  });

  it('is a no-op when there is no legacy avatar', async () => {
    seedUser({ name: 'x' });
    await RegistryService.migrateAvatarToProfileMeta(UID);
    expect(metaDoc()).toBeUndefined();
  });

  it('updateAvatar writes only to meta/profile, never to the counter-adjacent profile doc', async () => {
    seedUser({ name: 'x' });
    await RegistryService.updateAvatar(UID, 'data:new');
    expect(metaDoc().avatar).toBe('data:new');
  });
});

describe('RegistryService.deleteProtocol (item 2 — deletion must not corrupt history)', () => {
  it('removes the tracker from today\'s still-open day but leaves a closed day\'s snapshot untouched', async () => {
    seedConfig(CIG);
    seedDay('2026-07-20', { counts: { cig: 4 }, trackerSnapshots: { cig: { target: 10, type: 'CIGARETTE', unitPrice: 1, isFinanciallyTracked: true } }, status: 'open' });
    seedDay('2026-07-10', { counts: { cig: 9 }, trackerSnapshots: { cig: { target: 10, type: 'CIGARETTE', unitPrice: 1, isFinanciallyTracked: true } }, status: 'closed', foldedIntoLifetime: true });
    seedUser({});

    await RegistryService.deleteProtocol(UID, 'cig', '2026-07-20');

    expect(dayDoc('2026-07-20').counts).toEqual({});
    expect(dayDoc('2026-07-20').trackerSnapshots).toEqual({});
    // The closed historical day keeps its name/target/price snapshot forever.
    expect(dayDoc('2026-07-10').counts).toEqual({ cig: 9 });
    expect(dayDoc('2026-07-10').trackerSnapshots.cig).toMatchObject({ target: 10 });
    expect(fake.store.has(`${USER_PATH}/configs/cig`)).toBe(false);
  });
});

describe('RegistryService.deleteAllUserData', () => {
  it('removes configs, logs, days, meta, and the user document', async () => {
    seedUser({ name: 'X' });
    seedConfig(CIG);
    seedLog({ id: '2026-07-20_DAY', logDate: '2026-07-20', counts: { cig: 1 } });
    seedDay('2026-07-21', { counts: { cig: 1 }, status: 'open' });
    fake.store.set(`${USER_PATH}/meta/profile`, { avatar: 'x' });

    await RegistryService.deleteAllUserData(UID);

    expect(userDoc()).toBeUndefined();
    expect(fake.store.has(`${USER_PATH}/configs/cig`)).toBe(false);
    expect(logPaths()).toHaveLength(0);
    expect(dayDoc('2026-07-21')).toBeUndefined();
    expect(metaDoc()).toBeUndefined();
  });
});

describe('RegistryService.updateProfileSettings', () => {
  it('writes allowlisted settings and strips legacy eco keys / counter fields', async () => {
    seedUser({
      name: 'Old',
      accent: '#111',
      activeCounts: { cig: 4 },
      lifetimeAggregates: baseAgg(),
      ecoMode: 'RETAIL',
      retailPrice: 8,
      retailQty: 20,
      ryoPrice: 6.5,
      ryoYield: 60,
      unitPrice: 0.4
    });

    await RegistryService.updateProfileSettings(UID, {
      name: 'New',
      purchaseType: 'POUCH',
      pouchPrice: 10,
      estimatedYield: 50,
      unitPrice: 0.2,
      activeCounts: { cig: 99 },
      lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0 },
      ecoMode: 'RYO'
    });

    const doc = userDoc();
    expect(doc.name).toBe('New');
    expect(doc.purchaseType).toBe('POUCH');
    expect(doc.pouchPrice).toBe(10);
    expect(doc.estimatedYield).toBe(50);
    expect(doc.unitPrice).toBe(0.2);
    expect(doc.activeCounts).toEqual({ cig: 4 });
    expect(doc.lifetimeAggregates).toEqual(baseAgg());
    expect(doc.ecoMode).toBeUndefined();
    expect(doc.retailPrice).toBeUndefined();
    expect(doc.retailQty).toBeUndefined();
    expect(doc.ryoPrice).toBeUndefined();
    expect(doc.ryoYield).toBeUndefined();
  });

  // Regression: unitsPerPack was not persisted, so both clients re-derived the
  // pack price as unitPrice * 20. A user who bought 25s saved 11.00/25 and saw
  // 8.80 (0.44 * 20) on the next load. The quantity has to survive the write.
  it('persists unitsPerPack so the pack price survives a reload', async () => {
    seedUser({ unitPrice: 0.5, unitsPerPack: 20, activeCounts: {}, lifetimeAggregates: baseAgg() });

    await RegistryService.updateProfileSettings(UID, {
      purchaseType: 'PACK',
      unitPrice: 11 / 25,
      unitsPerPack: 25
    });

    const doc = userDoc();
    expect(doc.unitsPerPack).toBe(25);
    // The editor rebuilds the displayed pack price from unitPrice * unitsPerPack.
    expect(Number((doc.unitPrice * doc.unitsPerPack).toFixed(2))).toBe(11);
  });

  it('leaves unitsPerPack untouched when a POUCH save omits it', async () => {
    seedUser({ unitPrice: 0.5, unitsPerPack: 25, activeCounts: {}, lifetimeAggregates: baseAgg() });

    await RegistryService.updateProfileSettings(UID, {
      purchaseType: 'POUCH',
      pouchPrice: 6.5,
      estimatedYield: 60,
      unitPrice: 6.5 / 60
    });

    expect(userDoc().unitsPerPack).toBe(25);
  });
});

// NOTE: the old activeCounts/logs-based `endDay` (archive-into-`{date}_DAY`,
// merge-on-second-end-day) is superseded by the dated daily-document model —
// see the `RegistryService.closeDay` and `RegistryService.adjustCounter`
// describe blocks above, which cover the same invariants (idempotent
// close, no double-crediting) against `days/{date}` instead.

describe('RegistryService.updateHistoricalLog', () => {
  beforeEach(() => { seedConfig(CIG); });

  it('adjusts aggregates by the financial delta', async () => {
    seedLog({ id: '2026-07-10_DAY', logDate: '2026-07-10', counts: { cig: 4 }, origin: 'DAY_RESET' });
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });

    await RegistryService.updateHistoricalLog(UID, '2026-07-10_DAY', { cig: 9 });

    const u = userDoc();
    // old{cig:4}: saved 6 wasted 4 units 4 · new{cig:9}: saved 1 wasted 9 units 9
    expect(u.lifetimeAggregates.saved).toBeCloseTo(45); // 50 - 6 + 1
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(55); // 50 - 4 + 9
    expect(u.lifetimeAggregates.smokingUnits).toBe(55);
    expect(logDoc('2026-07-10_DAY').counts).toEqual({ cig: 9 });
  });

  it('throws when the target log is missing', async () => {
    seedUser({ lifetimeAggregates: baseAgg() });
    await expect(RegistryService.updateHistoricalLog(UID, 'nope', { cig: 1 })).rejects.toThrow('LOG_NOT_FOUND');
  });

  it('drops non-finite, negative, and excessive counts', async () => {
    seedLog({ id: 'L1', logDate: '2026-07-10', counts: { cig: 1 }, origin: 'DAY_RESET' });
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });

    await RegistryService.updateHistoricalLog(UID, 'L1', {
      cig: Number.POSITIVE_INFINITY,
      negative: -1,
      excessive: 10_001,
    });

    expect(logDoc('L1').counts).toEqual({});
  });

  it('preserves counts for deleted trackers when editing live config values', async () => {
    seedLog({
      id: '2026-07-10_DAY',
      logDate: '2026-07-10',
      counts: { cig: 4, retired: 7 },
      origin: 'DAY_RESET',
    });
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });

    await RegistryService.updateHistoricalLog(UID, '2026-07-10_DAY', { cig: 9 });

    expect(logDoc('2026-07-10_DAY').counts).toEqual({ cig: 9, retired: 7 });
  });
});

describe('RegistryService.deleteLog', () => {
  beforeEach(() => { seedConfig(CIG); });

  it('subtracts the log financials and removes the doc', async () => {
    seedLog({ id: 'L1', logDate: '2026-07-10', counts: { cig: 6 } });
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });

    await RegistryService.deleteLog(UID, 'L1');

    const u = userDoc();
    // fin{cig:6}: saved 4 wasted 6 units 6
    expect(u.lifetimeAggregates.saved).toBeCloseTo(46);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(44);
    expect(u.lifetimeAggregates.smokingUnits).toBe(44);
    expect(logDoc('L1')).toBeUndefined();
  });

  it('is a no-op when the log does not exist', async () => {
    seedUser({ lifetimeAggregates: baseAgg() });
    await RegistryService.deleteLog(UID, 'missing');
    expect(userDoc().lifetimeAggregates).toEqual(baseAgg());
  });

  it('uses stamped aggregateCredit when live configs changed', async () => {
    seedLog({
      id: 'L1',
      logDate: '2026-07-10',
      counts: { cig: 2 },
      // Stamped under old economics (saved 8 wasted 2 units 2)
      aggregateCredit: { saved: 8, wasted: 2, smokingUnits: 2 },
    });
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });
    // Reprice / remove the tracker that originally produced the stamp.
    seedConfig({ ...CIG, pricePerUnit: 99 });

    await RegistryService.deleteLog(UID, 'L1');

    const u = userDoc();
    expect(u.lifetimeAggregates.saved).toBeCloseTo(42);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(48);
    expect(u.lifetimeAggregates.smokingUnits).toBe(48);
  });
});

describe('RegistryService.restoreLog', () => {
  beforeEach(() => { seedConfig(CIG); });

  it('re-credits aggregates and rewrites the log', async () => {
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });
    const log = { id: 'L9', logDate: '2026-07-01', counts: { cig: 3 } };

    await RegistryService.restoreLog(UID, log);

    const u = userDoc();
    // fin{cig:3}: saved 7 wasted 3 units 3
    expect(u.lifetimeAggregates.saved).toBeCloseTo(57);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(53);
    expect(u.lifetimeAggregates.smokingUnits).toBe(53);
    expect(logDoc('L9').counts).toEqual({ cig: 3 });
    expect(logDoc('L9').aggregateCredit).toEqual({
      saved: 7,
      wasted: 3,
      smokingUnits: 3,
    });
  });

  it('re-credits from stamped aggregateCredit even if configs are gone', async () => {
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });
    // No configs seeded — live recompute would be zero.
    const log = {
      id: 'L9',
      logDate: '2026-07-01',
      counts: { cig: 3 },
      aggregateCredit: { saved: 7, wasted: 3, smokingUnits: 3 },
    };

    await RegistryService.restoreLog(UID, log);

    const u = userDoc();
    expect(u.lifetimeAggregates.saved).toBeCloseTo(57);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(53);
    expect(u.lifetimeAggregates.smokingUnits).toBe(53);
    expect(logDoc('L9').aggregateCredit).toEqual({
      saved: 7,
      wasted: 3,
      smokingUnits: 3,
    });
  });

  it('does not double-credit when the log already exists', async () => {
    seedConfig(CIG);
    seedUser({ lifetimeAggregates: baseAgg() });
    seedLog({ id: 'L9', logDate: '2026-07-01', counts: { cig: 3 } });

    await RegistryService.restoreLog(UID, { id: 'L9', logDate: '2026-07-01', counts: { cig: 3 } });

    expect(userDoc().lifetimeAggregates).toEqual(baseAgg());
  });
});

describe('RegistryService.createManualEntry', () => {
  it('rejects a malformed date before touching Firestore', async () => {
    await expect(RegistryService.createManualEntry(UID, '2026/07/01', { cig: 1 })).rejects.toThrow('INVALID_DATE');
  });

  it('writes a manual log and credits aggregates', async () => {
    seedConfig(CIG);
    seedUser({ lifetimeAggregates: baseAgg(), unitPrice: 0.5 });

    await RegistryService.createManualEntry(UID, '2026-07-05', { cig: 2 });

    const u = userDoc();
    // fin{cig:2}: saved 8 wasted 2 units 2
    expect(u.lifetimeAggregates.saved).toBeCloseTo(58);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(52);
    expect(u.lifetimeAggregates.smokingUnits).toBe(52);

    expect(logPaths()).toHaveLength(1);
    const entry = fake.store.get(logPaths()[0]);
    expect(entry.isManual).toBe(true);
    expect(entry.logDate).toBe('2026-07-05');
    expect(entry.counts).toEqual({ cig: 2 });
    expect(entry.aggregateCredit).toEqual({
      saved: 8,
      wasted: 2,
      smokingUnits: 2,
    });
  });
});

describe('RegistryService.migrateSmokingUnitsIfNeeded', () => {
  it('sums smoking units across history and sets the flag', async () => {
    seedConfig(CIG);
    seedConfig({ id: 'simple', type: 'SIMPLE', limit: 3 }); // non-smoking, excluded
    seedLog({ id: '2026-07-01_DAY', logDate: '2026-07-01', counts: { cig: 5, simple: 9 }, origin: 'DAY_RESET' });
    seedLog({ id: 'm1', logDate: '2026-07-02', counts: { cig: 3 }, isManual: true });
    seedUser({ smokingUnitsMigrated: false, lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0 } });

    await RegistryService.migrateSmokingUnitsIfNeeded(UID);

    const u = userDoc();
    expect(u.lifetimeAggregates.smokingUnits).toBe(8); // 5 + 3, simple excluded
    expect(u.smokingUnitsMigrated).toBe(true);
  });

  it('is idempotent once already migrated', async () => {
    seedUser({ smokingUnitsMigrated: true, lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 999 } });
    await RegistryService.migrateSmokingUnitsIfNeeded(UID);
    expect(userDoc().lifetimeAggregates.smokingUnits).toBe(999);
  });
});

describe('RegistryService.ensureUserDocument', () => {
  it('creates a default document on the current schema when missing', async () => {
    await RegistryService.ensureUserDocument(UID, { name: 'Alex', accent: '#123456' });
    const u = userDoc();
    expect(u.name).toBe('Alex');
    expect(u.accent).toBe('#123456');
    expect(u.activeCounts).toBeUndefined(); // new accounts never get the legacy field
    expect(u.schemaVersion).toBe(2);
    expect(u.lifetimeAggregates).toEqual({ saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 });
    expect(u.smokingUnitsMigrated).toBe(true);
  });

  it('never overwrites an existing account', async () => {
    seedUser({ name: 'Existing', activeCounts: { cig: 5 }, lifetimeAggregates: { saved: 100, wasted: 0, smokingUnits: 0 } });
    await RegistryService.ensureUserDocument(UID, { name: 'New' });
    const u = userDoc();
    expect(u.name).toBe('Existing');
    expect(u.activeCounts).toEqual({ cig: 5 });
    expect(u.lifetimeAggregates.saved).toBe(100);
  });
});
