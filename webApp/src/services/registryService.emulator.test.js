/**
 * RegistryService against a REAL Firestore client + emulator + the real
 * firestore.rules.
 *
 * The unit suite (registryService.test.js) mocks firebase/firestore, so it can
 * only prove the aggregate arithmetic — it cannot prove the SDK accepts the
 * calls being made. That gap once hid a production outage: every transactional
 * write path called `transaction.get(query(...))`, which the web client SDK
 * does not support (Admin SDK only), so end-day, manual entry, history edit,
 * delete, and restore all threw TypeError before touching Firestore.
 *
 * These tests exercise the same paths through the unmocked SDK, so an
 * unsupported API or a rules violation fails here.
 *
 * Runs under `npm run test:rules` (boots the Firestore emulator).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

// registryService imports `db` from '../firebase', which needs VITE_* env at
// import time. Swap it for the emulator-backed, authenticated instance. The
// getter is re-evaluated per access so beforeAll can populate it.
const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../firebase', () => ({
  get db() {
    return holder.db;
  },
}));

const { RegistryService } = await import('./registryService');

const UID = 'alice';
const PROJECT_ID = 'demo-tabakpp-registry';

let testEnv;

const baseProfile = {
  name: '',
  accent: '#FF5F5F',
  widgetSize: 'MEDIUM',
  purchaseType: 'PACK',
  unitPrice: 0.5,
  pouchPrice: 0,
  estimatedYield: 0,
  dayStartHour: 6,
  activeCounts: {},
  lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0 },
  smokingUnitsMigrated: true,
};

/** limit 10 @ 1.00 — a full day within limit saves 10.00, each unit wastes 1.00. */
const cigConfig = {
  name: 'Cigarettes',
  limit: 10,
  order: 0,
  type: 'CIGARETTE',
  pricePerUnit: 1,
  isFinanciallyTracked: true,
  isPrimaryTracked: true,
};

const seed = async ({ activeCounts = {}, aggregates } = {}) => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'users', UID), {
      ...baseProfile,
      activeCounts,
      lifetimeAggregates: aggregates ?? baseProfile.lifetimeAggregates,
    });
    await setDoc(doc(adminDb, 'users', UID, 'configs', 'cig'), cigConfig);
  });
};

const profile = async () => (await getDoc(doc(holder.db, 'users', UID))).data();
const logs = async () => {
  const snap = await getDocs(collection(holder.db, 'users', UID, 'logs'));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('../firestore.rules', 'utf8') },
  });
  holder.db = testEnv.authenticatedContext(UID).firestore();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('RegistryService against the real SDK and rules', () => {
  it('adjustCounter increments and clamps at zero', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 1);
    await RegistryService.adjustCounter(UID, 'cig', 1);
    expect((await profile()).activeCounts).toEqual({ cig: 2 });

    await RegistryService.adjustCounter(UID, 'cig', -5);
    expect((await profile()).activeCounts).toEqual({ cig: 0 });
  });

  it('adjustCounter rejects writes for a missing tracker config', async () => {
    await seed();
    await expect(RegistryService.adjustCounter(UID, 'ghost', 1)).rejects.toThrow('CONFIG_NOT_FOUND');
    expect((await profile()).activeCounts).toEqual({});
  });

  it('endDay archives the session and credits lifetime aggregates', async () => {
    await seed({ activeCounts: { cig: 4 } });
    await RegistryService.endDay(UID, '2026-07-30');

    const p = await profile();
    expect(p.activeCounts).toEqual({});
    // 4 smoked @1.00 wasted; 6 under the limit of 10 saved.
    expect(p.lifetimeAggregates).toEqual({ saved: 6, wasted: 4, smokingUnits: 4 });

    const all = await logs();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('2026-07-30_DAY');
    expect(all[0].counts).toEqual({ cig: 4 });
    expect(all[0].origin).toBe('DAY_RESET');
    expect(all[0].aggregateCredit).toEqual({ saved: 6, wasted: 4, smokingUnits: 4 });
  });

  it('a second endDay on the same date merges instead of double-counting', async () => {
    await seed({ activeCounts: { cig: 4 } });
    await RegistryService.endDay(UID, '2026-07-30');

    await RegistryService.adjustCounter(UID, 'cig', 1);
    await RegistryService.adjustCounter(UID, 'cig', 1);
    await RegistryService.endDay(UID, '2026-07-30');

    const all = await logs();
    expect(all).toHaveLength(1);
    expect(all[0].counts).toEqual({ cig: 6 });
    // Credited by the delta only: 6 wasted, 4 saved — not 4+6 wasted.
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 4, wasted: 6, smokingUnits: 6 });
  });

  it('endDay refuses when nothing is open', async () => {
    await seed({ activeCounts: { cig: 0 } });
    await expect(RegistryService.endDay(UID, '2026-07-30')).rejects.toThrow('NOTHING_TO_ARCHIVE');
  });

  it('createManualEntry writes a stamped backfill log and credits aggregates', async () => {
    await seed();
    await RegistryService.createManualEntry(UID, '2026-07-28', { cig: 3 });

    const all = await logs();
    expect(all).toHaveLength(1);
    expect(all[0].logDate).toBe('2026-07-28');
    expect(all[0].counts).toEqual({ cig: 3 });
    expect(all[0].isManual).toBe(true);
    expect(all[0].aggregateCredit).toEqual({ saved: 7, wasted: 3, smokingUnits: 3 });
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 7, wasted: 3, smokingUnits: 3 });
  });

  it('createManualEntry rejects impossible calendar dates', async () => {
    await seed();
    await expect(
      RegistryService.createManualEntry(UID, '2026-02-31', { cig: 1 })
    ).rejects.toThrow('INVALID_DATE');
    expect(await logs()).toHaveLength(0);
  });

  it('updateHistoricalLog re-prices the log and moves aggregates by the delta', async () => {
    await seed();
    await RegistryService.createManualEntry(UID, '2026-07-28', { cig: 3 });
    const [entry] = await logs();

    await RegistryService.updateHistoricalLog(UID, entry.id, { cig: 8 });

    const [updated] = await logs();
    expect(updated.counts).toEqual({ cig: 8 });
    expect(updated.aggregateCredit).toEqual({ saved: 2, wasted: 8, smokingUnits: 8 });
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 2, wasted: 8, smokingUnits: 8 });
  });

  it('updateHistoricalLog preserves counts for deleted trackers', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'logs', '2026-07-28_MANUAL'), {
        id: '2026-07-28_MANUAL',
        logDate: '2026-07-28',
        counts: { cig: 3, retired: 5 },
        origin: 'MANUAL_ENTRY',
        aggregateCredit: { saved: 7, wasted: 3, smokingUnits: 3 },
      });
      await setDoc(
        doc(context.firestore(), 'users', UID),
        {
          ...baseProfile,
          lifetimeAggregates: { saved: 7, wasted: 3, smokingUnits: 3 },
        },
      );
    });

    await RegistryService.updateHistoricalLog(UID, '2026-07-28_MANUAL', { cig: 8 });

    const [updated] = await logs();
    expect(updated.counts).toEqual({ cig: 8, retired: 5 });
  });

  it('deleteLog debits the stamped credit, and restoreLog re-credits it', async () => {
    await seed();
    await RegistryService.createManualEntry(UID, '2026-07-28', { cig: 3 });
    const [entry] = await logs();

    await RegistryService.deleteLog(UID, entry.id);
    expect(await logs()).toHaveLength(0);
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 0, wasted: 0, smokingUnits: 0 });

    await RegistryService.restoreLog(UID, entry);
    expect(await logs()).toHaveLength(1);
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 7, wasted: 3, smokingUnits: 3 });
  });

  it('restoreLog is idempotent — a double undo cannot double-credit', async () => {
    await seed();
    await RegistryService.createManualEntry(UID, '2026-07-28', { cig: 3 });
    const [entry] = await logs();
    await RegistryService.deleteLog(UID, entry.id);

    await RegistryService.restoreLog(UID, entry);
    await RegistryService.restoreLog(UID, entry);

    expect(await logs()).toHaveLength(1);
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 7, wasted: 3, smokingUnits: 3 });
  });

  it('deleting a tracker drops it from the open session', async () => {
    await seed({ activeCounts: { cig: 2 } });
    await RegistryService.deleteProtocol(UID, 'cig');

    expect((await profile()).activeCounts).toEqual({});
    const configs = await getDocs(collection(holder.db, 'users', UID, 'configs'));
    expect(configs.empty).toBe(true);
  });

  it('settings writes are accepted and strip legacy eco keys', async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', UID),
        { ...baseProfile, ecoMode: true, retailPrice: 9 },
      );
    });

    await RegistryService.updateProfileSettings(UID, { name: 'Alice', accent: '#00FF88' });

    const p = await profile();
    expect(p.name).toBe('Alice');
    expect(p.accent).toBe('#00FF88');
    expect('ecoMode' in p).toBe(false);
    expect('retailPrice' in p).toBe(false);
  });

  it('addProtocol writes a rules-valid config', async () => {
    await seed();
    await RegistryService.addProtocol(UID, {
      name: 'Rollies',
      limit: 5,
      order: 1,
      type: 'RYO_ROLL',
      pricePerUnit: 0.4,
      isFinanciallyTracked: true,
      isPrimaryTracked: true,
    });

    const configs = await getDocs(collection(holder.db, 'users', UID, 'configs'));
    const added = configs.docs.map((d) => d.data()).find((c) => c.name === 'Rollies');
    expect(added).toMatchObject({ name: 'Rollies', limit: 5, type: 'RYO_ROLL' });
  });
});
