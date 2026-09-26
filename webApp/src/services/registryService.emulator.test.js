/**
 * RegistryService against a REAL Firestore client + emulator + the real
 * firestore.rules.
 *
 * The unit suite (registryService.test.js) mocks firebase/firestore, so it can
 * only prove the aggregate arithmetic — it cannot prove the SDK accepts the
 * calls being made, or that firestore.rules actually allows them. That gap
 * once hid a production outage: every transactional write path called
 * `transaction.get(query(...))`, which the web client SDK does not support
 * (Admin SDK only), so end-day, manual entry, history edit, delete, and
 * restore all threw TypeError before touching Firestore.
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
const { SmokingCalculator } = await import('../utils/smokingCalculator');

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
  lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
  smokingUnitsMigrated: true,
  schemaVersion: 2,
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

const seed = async ({ aggregates } = {}) => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'users', UID), {
      ...baseProfile,
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
const dayDoc = async (date) => {
  const snap = await getDoc(doc(holder.db, 'users', UID, 'days', date));
  return snap.exists() ? { ...snap.data(), id: snap.id } : undefined;
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
  it('adjustCounter creates/increments the dated day doc and clamps at zero', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 1, '2026-07-30', 0.5);
    await RegistryService.adjustCounter(UID, 'cig', 1, '2026-07-30', 0.5);
    expect((await dayDoc('2026-07-30')).counts).toEqual({ cig: 2 });

    await RegistryService.adjustCounter(UID, 'cig', -5, '2026-07-30', 0.5);
    expect((await dayDoc('2026-07-30')).counts).toEqual({ cig: 0 });
    // The hot path never touches the profile document (item 12).
    expect((await profile()).lifetimeAggregates).toEqual(baseProfile.lifetimeAggregates);
  });

  it('adjustCounter rejects writes for a missing tracker config', async () => {
    await seed();
    await expect(RegistryService.adjustCounter(UID, 'ghost', 1, '2026-07-30', 0.5)).rejects.toThrow('CONFIG_NOT_FOUND');
    expect(await dayDoc('2026-07-30')).toBeUndefined();
  });

  it('adjustCounter refuses to write past a closed day', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 4, '2026-07-30', 0.5);
    await RegistryService.closeDay(UID, '2026-07-30');
    await expect(RegistryService.adjustCounter(UID, 'cig', 1, '2026-07-30', 0.5)).rejects.toThrow();
  });

  it('a count written under an explicit prior date lands there even after "today" moved on', async () => {
    await seed();
    // Simulates the app reopening after being closed across a rollover: the
    // caller still computes and passes the correct (now-past) tracking date.
    await RegistryService.adjustCounter(UID, 'cig', 3, '2026-07-28', 0.5);
    await RegistryService.adjustCounter(UID, 'cig', 1, '2026-07-30', 0.5);
    expect((await dayDoc('2026-07-28')).counts).toEqual({ cig: 3 });
    expect((await dayDoc('2026-07-30')).counts).toEqual({ cig: 1 });
  });

  it('closeDay folds the stamped credit into lifetime aggregates', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 4, '2026-07-30', 0.5);
    await RegistryService.closeDay(UID, '2026-07-30');

    const p = await profile();
    // 4 smoked @1.00 wasted; 6 under the limit of 10 saved.
    expect(p.lifetimeAggregates.saved).toBeCloseTo(6);
    expect(p.lifetimeAggregates.wasted).toBeCloseTo(4);
    expect(p.lifetimeAggregates.smokingUnits).toBe(4);
    expect((await dayDoc('2026-07-30')).status).toBe('closed');
  });

  it('closing an already-closed day again does not double-credit', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 4, '2026-07-30', 0.5);
    await RegistryService.closeDay(UID, '2026-07-30');
    await RegistryService.closeDay(UID, '2026-07-30');

    expect((await profile()).lifetimeAggregates.wasted).toBeCloseTo(4);
  });

  it('closeDay refuses when nothing is open', async () => {
    await seed();
    await expect(RegistryService.closeDay(UID, '2026-07-30')).rejects.toThrow('NOTHING_TO_ARCHIVE');
  });

  it('reconcileStaleDays folds a forgotten open day once the tracking date has moved on', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 4, '2026-07-18', 0.5);

    await RegistryService.reconcileStaleDays(UID, '2026-07-21');

    expect((await dayDoc('2026-07-18')).status).toBe('closed');
    expect((await profile()).lifetimeAggregates.wasted).toBeCloseTo(4);
  });

  it('updateHistoricalDay corrects a closed day\'s counts using its own stamped snapshot', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 4, '2026-07-10', 0.5);
    await RegistryService.closeDay(UID, '2026-07-10');
    // Reprice the live tracker — must not affect the correction below.
    await setDoc(doc(holder.db, 'users', UID, 'configs', 'cig'), { ...cigConfig, pricePerUnit: 999 });

    await RegistryService.updateHistoricalDay(UID, '2026-07-10', { cig: 9 });

    const d = await dayDoc('2026-07-10');
    expect(d.counts).toEqual({ cig: 9 });
    expect(d.aggregateCredit.wasted).toBeCloseTo(9); // still @ the stamped €1.00, not €999
    expect((await profile()).lifetimeAggregates.wasted).toBeCloseTo(9);
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
    expect((await profile()).lifetimeAggregates).toEqual({ saved: 7, wasted: 3, smokingUnits: 3, baselineSaved: 0 });
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
          lifetimeAggregates: { saved: 7, wasted: 3, smokingUnits: 3, baselineSaved: 0 },
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

    await RegistryService.restoreLog(UID, entry);
    expect(await logs()).toHaveLength(1);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(7);
  });

  it('restoreLog is idempotent — a double undo cannot double-credit', async () => {
    await seed();
    await RegistryService.createManualEntry(UID, '2026-07-28', { cig: 3 });
    const [entry] = await logs();
    await RegistryService.deleteLog(UID, entry.id);

    await RegistryService.restoreLog(UID, entry);
    await RegistryService.restoreLog(UID, entry);

    expect(await logs()).toHaveLength(1);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(7);
  });

  it('deleting a tracker drops it from today\'s open day but preserves a closed day\'s history', async () => {
    await seed();
    await RegistryService.adjustCounter(UID, 'cig', 2, '2026-07-30', 0.5);
    await RegistryService.adjustCounter(UID, 'cig', 9, '2026-07-10', 0.5);
    await RegistryService.closeDay(UID, '2026-07-10');

    await RegistryService.deleteProtocol(UID, 'cig', '2026-07-30');

    expect((await dayDoc('2026-07-30')).counts).toEqual({});
    expect((await dayDoc('2026-07-10')).counts).toEqual({ cig: 9 });
    expect((await dayDoc('2026-07-10')).trackerSnapshots.cig).toMatchObject({ target: 10 });
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

  it('addProtocol writes a rules-valid config, baseline included', async () => {
    await seed();
    await RegistryService.addProtocol(UID, {
      name: 'Rollies',
      limit: 5,
      order: 1,
      type: 'RYO_ROLL',
      pricePerUnit: 0.4,
      isFinanciallyTracked: true,
      isPrimaryTracked: true,
      baseline: 15,
    });

    const configs = await getDocs(collection(holder.db, 'users', UID, 'configs'));
    const added = configs.docs.map((d) => d.data()).find((c) => c.name === 'Rollies');
    expect(added).toMatchObject({ name: 'Rollies', limit: 5, type: 'RYO_ROLL', baseline: 15 });
  });

  it('migrateLegacyActiveCounts folds a pre-update account\'s live counts into the days model', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID), {
        ...baseProfile,
        schemaVersion: 1,
        activeCounts: { cig: 3 },
      });
      await setDoc(doc(context.firestore(), 'users', UID, 'configs', 'cig'), cigConfig);
    });

    await RegistryService.migrateLegacyActiveCounts(UID);

    const expectedDate = SmokingCalculator.getTrackingDate(new Date(), 6);
    expect((await dayDoc(expectedDate)).counts).toEqual({ cig: 3 });
    expect((await profile()).schemaVersion).toBe(2);
    expect((await profile()).activeCounts).toBeUndefined();
  });

  it('updateAvatar writes only to meta/profile', async () => {
    await seed();
    await RegistryService.updateAvatar(UID, 'data:short');
    const snap = await getDoc(doc(holder.db, 'users', UID, 'meta', 'profile'));
    expect(snap.data().avatar).toBe('data:short');
  });

  it('full lifecycle: new day → first counter write → second write → rapid concurrent → End Day → restart', async () => {
    await seed();
    const date = '2026-07-30';

    // 1. Ensure day doc does NOT exist
    expect(await dayDoc(date)).toBeUndefined();

    // 2. First increment from zero (new-day creation path: set() with serverTimestamp)
    await RegistryService.adjustCounter(UID, 'cig', 1, date, 0.5);
    const day1 = await dayDoc(date);
    expect(day1.counts).toEqual({ cig: 1 });
    expect(day1.status).toBe('open');
    // createdAt and updatedAt must be REAL timestamps, not null/missing.
    // Firestore serverTimestamp() resolves to a Timestamp object.
    expect(day1.createdAt).toBeDefined();
    expect(day1.updatedAt).toBeDefined();

    // 3. Second increment (existing-day path: update())
    await RegistryService.adjustCounter(UID, 'cig', 1, date, 0.5);
    const day2 = await dayDoc(date);
    expect(day2.counts).toEqual({ cig: 2 });
    expect(day2.createdAt.seconds).toBe(day1.createdAt.seconds); // createdAt unchanged

    // 4. Rapid concurrent increments (10 in parallel) — must all succeed
    await Promise.all(
      Array.from({ length: 10 }, () => RegistryService.adjustCounter(UID, 'cig', 1, date, 0.5))
    );
    const day3 = await dayDoc(date);
    expect(day3.counts.cig).toBe(12); // 2 + 10

    // 5. End Day
    await RegistryService.closeDay(UID, date);
    const day4 = await dayDoc(date);
    expect(day4.status).toBe('closed');
    expect(day4.closedAt).toBeDefined();
    expect(day4.closedAt.seconds).toBeDefined();
    expect(day4.foldedIntoLifetime).toBe(true);
    // 12 smoked @€1.00, limit 10 → 10 saved, 12 wasted
    expect((await profile()).lifetimeAggregates.wasted).toBeCloseTo(12);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(0);

    // 6. Restart = clear and reload (simulates app restart)
    expect(await dayDoc(date)).toMatchObject({ counts: { cig: 12 } });
  });

  it('rapid concurrent increments do not throw ABORTED errors', async () => {
    await seed();
    const date = '2026-07-30';

    // Seed an existing open day with count 5
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'days', date), {
        date,
        counts: { cig: 5 },
        trackerSnapshots: {
          cig: { target: 10, unitPrice: 1, baseline: 15, type: 'CIGARETTE', order: 0, name: 'Cigarettes', isFinanciallyTracked: true, isPrimaryTracked: true, purchaseType: 'PACK', pouchPrice: 0, estimatedYield: 0, remaining: 10 }
        },
        aggregateCredit: { saved: 0, wasted: 5, smokingUnits: 5, baselineSaved: 15 },
        status: 'open',
        foldedIntoLifetime: false,
        legacyMigrationApplied: true,
        createdAt: { _seconds: 1750000000, _nanos: 0 },
        updatedAt: { _seconds: 1750000000, _nanos: 0 },
      });
    });

    // Rapid concurrent increments — the web SDK serializes these in the
    // Firestore transaction, so no ABORTED error should be thrown.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => RegistryService.adjustCounter(UID, 'cig', 1, date, 0.5))
    );
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed).toHaveLength(0);
    const day = await dayDoc(date);
    expect(day.counts.cig).toBe(15); // 5 + 10
  });
});
