import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegistryService } from './registryService';

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
      get: async (ref) => {
        if (ref && ref.__collection) {
          const docs = collectionDocs(ref.path);
          return { docs, empty: docs.length === 0, size: docs.length };
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
    doc, collection, query, orderBy, limit, startAfter, serverTimestamp, deleteField,
    getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction, writeBatch, onSnapshot,
  };
});

// --- fixtures & helpers ---------------------------------------------------

const UID = 'u1';
const USER_PATH = `users/${UID}`;

// cig: smoking, €1.00, limit 10 · ryo: smoking, €0.50, limit 5
const CIG = { id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 1.0 };
const RYO = { id: 'ryo', type: 'RYO_ROLL', limit: 5, pricePerUnit: 0.5 };

const seedUser = (data) => fake.store.set(USER_PATH, data);
const seedConfig = (c) => fake.store.set(`${USER_PATH}/configs/${c.id}`, c);
const seedLog = (l) => fake.store.set(`${USER_PATH}/logs/${l.id}`, l);
const userDoc = () => fake.store.get(USER_PATH);
const logDoc = (id) => fake.store.get(`${USER_PATH}/logs/${id}`);
const logPaths = () => [...fake.store.keys()].filter((k) => k.startsWith(`${USER_PATH}/logs/`));

const baseAgg = () => ({ saved: 50, wasted: 50, smokingUnits: 50 });

beforeEach(() => fake.store.clear());

// --- tests ----------------------------------------------------------------

describe('RegistryService.adjustCounter', () => {
  it('increments the live counter', async () => {
    seedUser({ activeCounts: { cig: 3 } });
    await RegistryService.adjustCounter(UID, 'cig', 1);
    expect(userDoc().activeCounts.cig).toBe(4);
  });

  it('clamps a decrement at zero', async () => {
    seedUser({ activeCounts: { cig: 1 } });
    await RegistryService.adjustCounter(UID, 'cig', -5);
    expect(userDoc().activeCounts.cig).toBe(0);
  });

  it('throws when the user document is missing', async () => {
    await expect(RegistryService.adjustCounter(UID, 'cig', 1)).rejects.toThrow('USER_NOT_FOUND');
  });
});

describe('RegistryService.deleteAllUserData', () => {
  it('removes configs, logs, and the user document', async () => {
    seedUser({ name: 'X', activeCounts: { cig: 1 } });
    seedConfig(CIG);
    seedLog({ id: '2026-07-20_DAY', logDate: '2026-07-20', counts: { cig: 1 } });

    await RegistryService.deleteAllUserData(UID);

    expect(userDoc()).toBeUndefined();
    expect(fake.store.has(`${USER_PATH}/configs/cig`)).toBe(false);
    expect(logPaths()).toHaveLength(0);
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
});

describe('RegistryService.endDay', () => {
  beforeEach(() => { seedConfig(CIG); seedConfig(RYO); });

  it('refuses to archive an empty session', async () => {
    seedUser({ activeCounts: {}, lifetimeAggregates: baseAgg(), unitPrice: 0.5 });
    await expect(RegistryService.endDay(UID, '2026-07-20')).rejects.toThrow('NOTHING_TO_ARCHIVE');
  });

  it('archives the session, credits aggregates and resets counts', async () => {
    seedUser({
      activeCounts: { cig: 8, ryo: 2 },
      lifetimeAggregates: { saved: 100, wasted: 50, smokingUnits: 200 },
      unitPrice: 0.5,
    });

    await RegistryService.endDay(UID, '2026-07-20');

    const u = userDoc();
    expect(u.activeCounts).toEqual({});
    // fin{cig:8,ryo:2} = saved (2*1)+(3*0.5)=3.5 · wasted (8*1)+(2*0.5)=9 · units 10
    expect(u.lifetimeAggregates.saved).toBeCloseTo(103.5);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(59);
    expect(u.lifetimeAggregates.smokingUnits).toBe(210);

    const archive = logDoc('2026-07-20_DAY');
    expect(archive.counts).toEqual({ cig: 8, ryo: 2 });
    expect(archive.isArchive).toBe(true);
    expect(archive.origin).toBe('DAY_RESET');
  });

  it('merges a second end-day by delta without double-counting', async () => {
    seedUser({
      activeCounts: { cig: 8, ryo: 2 },
      lifetimeAggregates: { saved: 100, wasted: 50, smokingUnits: 200 },
      unitPrice: 0.5,
    });

    await RegistryService.endDay(UID, '2026-07-20');
    // user logs more after the reset, then ends the same tracking day again
    userDoc().activeCounts = { cig: 2 };
    await RegistryService.endDay(UID, '2026-07-20');

    const u = userDoc();
    expect(u.activeCounts).toEqual({});
    // merged counts {cig:10,ryo:2}; only the delta over the first archive is applied
    expect(u.lifetimeAggregates.saved).toBeCloseTo(101.5);
    expect(u.lifetimeAggregates.wasted).toBeCloseTo(61);
    expect(u.lifetimeAggregates.smokingUnits).toBe(212);
    expect(logDoc('2026-07-20_DAY').counts).toEqual({ cig: 10, ryo: 2 });
  });
});

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
  it('creates a default document when missing', async () => {
    await RegistryService.ensureUserDocument(UID, { name: 'Alex', accent: '#123456' });
    const u = userDoc();
    expect(u.name).toBe('Alex');
    expect(u.accent).toBe('#123456');
    expect(u.activeCounts).toEqual({});
    expect(u.lifetimeAggregates).toEqual({ saved: 0, wasted: 0, smokingUnits: 0 });
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
