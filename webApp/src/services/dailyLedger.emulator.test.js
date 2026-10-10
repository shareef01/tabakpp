/**
 * DailyLedger against a REAL Firestore client + emulator + the real
 * firestore.rules (OPTION B canonical daily ledger).
 *
 * Proves the core Option-B invariants at the persistence layer:
 *   - ONE day-level credit per date (no per-record allowance multiplication)
 *   - combined consumption is exactly additive
 *   - lifetime fold is idempotent and applies only the exact day-level delta
 *   - concurrent writes serialize correctly
 *
 * Runs under `npm run test:rules` (boots the Firestore emulator).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../firebase', () => ({
  get db() { return holder.db; },
}));

const { DailyLedger } = await import('./dailyLedger');

const UID = 'alice';
const PROJECT_ID = 'demo-tabakpp-ledger';
const DATE = '2026-10-01';

let testEnv;

const baseProfile = {
  name: '', accent: '#FF5F5F', widgetSize: 'MEDIUM', purchaseType: 'PACK', unitPrice: 1,
  pouchPrice: 0, estimatedYield: 0, dayStartHour: 6,
  lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
  smokingUnitsMigrated: true, schemaVersion: 2,
};

const snap10_15 = { cig: { type: 'CIGARETTE', target: 10, baseline: 15, unitPrice: 1, isFinanciallyTracked: true, isPrimaryTracked: true } };

const seed = async (aggregates = baseProfile.lifetimeAggregates) => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID), { ...baseProfile, lifetimeAggregates: aggregates });
  });
};

const profile = async () => (await getDoc(doc(holder.db, 'users', UID))).data();
const ledger = async () => {
  const s = await getDoc(doc(holder.db, 'users', UID, 'dailyFinancials', DATE));
  return s.exists() ? s.data() : undefined;
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('../firestore.rules', 'utf8') },
  });
  holder.db = testEnv.authenticatedContext(UID).firestore();
});

beforeEach(async () => { await testEnv.clearFirestore(); });
afterAll(async () => { await testEnv?.cleanup(); });

describe('DailyLedger — OPTION B canonical day-level credit', () => {
  it('one credit per date: day 3 + manual 2 + manual 1 ⇒ units 6, spent €6, saved €4, baselineSaved €9', async () => {
    await seed();
    await DailyLedger.recordConsumption(UID, DATE, { cig: 3 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.recordConsumption(UID, DATE, { cig: 2 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.recordConsumption(UID, DATE, { cig: 1 }, { snapshots: snap10_15, defaultUnitPrice: 1 });

    const l = await ledger();
    expect(l.countsByTracker.cig).toBe(6);
    expect(l.canonicalCredit.wasted).toBeCloseTo(6);
    expect(l.canonicalCredit.saved).toBeCloseTo(4); // (10 − 6) × €1 — NOT (10−3)+(10−2)+(10−1)
    expect(l.canonicalCredit.baselineSaved).toBeCloseTo(9); // (15 − 6) × €1
    expect(l.canonicalCredit.smokingUnits).toBeCloseTo(6);
    // Not folded yet → lifetime untouched.
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(0);
  });

  it('two manual logs, no day doc (target 10, €1, 2 & 3) ⇒ ONE allowance (€5, not €15)', async () => {
    await seed();
    await DailyLedger.recordConsumption(UID, DATE, { cig: 2 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.recordConsumption(UID, DATE, { cig: 3 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    const l = await ledger();
    expect(l.canonicalCredit.saved).toBeCloseTo(5);
    expect(l.canonicalCredit.wasted).toBeCloseTo(5);
  });

  it('fold is idempotent and lifetime receives the canonical credit exactly once', async () => {
    await seed();
    await DailyLedger.recordConsumption(UID, DATE, { cig: 5 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.foldIntoLifetime(UID, DATE);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5);

    await DailyLedger.foldIntoLifetime(UID, DATE); // second fold — no double credit
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5);
  });

  it('a post-fold correction applies the EXACT day-level delta (3→5 ⇒ saved −€2)', async () => {
    await seed();
    await DailyLedger.recordConsumption(UID, DATE, { cig: 3 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.foldIntoLifetime(UID, DATE);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(7); // (10 − 3)

    // Add a manual entry of 2 → consumption 5, saved €5 → delta −€2 (not +€8).
    await DailyLedger.recordConsumption(UID, DATE, { cig: 2 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    expect((await ledger()).canonicalCredit.saved).toBeCloseTo(5);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5); // 7 − 2
  });

  it('deleting a record restores the canonical day contribution (5→3 ⇒ saved +€2)', async () => {
    await seed();
    await DailyLedger.recordConsumption(UID, DATE, { cig: 3 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.recordConsumption(UID, DATE, { cig: 2 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    await DailyLedger.foldIntoLifetime(UID, DATE);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5);

    await DailyLedger.recordConsumption(UID, DATE, { cig: -2 }, { snapshots: snap10_15, defaultUnitPrice: 1 });
    expect((await ledger()).countsByTracker.cig).toBe(3);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(7);
  });

  it('concurrent writes to one date serialize without losing or double-counting consumption', async () => {
    await seed();
    await Promise.all(
      Array.from({ length: 5 }, () => DailyLedger.recordConsumption(UID, DATE, { cig: 1 }, { snapshots: snap10_15, defaultUnitPrice: 1 }))
    );
    const l = await ledger();
    expect(l.countsByTracker.cig).toBe(5); // exactly 5, not fewer or more
    expect(l.canonicalCredit.saved).toBeCloseTo(5); // (10 − 5) × €1
    expect(l.canonicalCredit.wasted).toBeCloseTo(5);
  });
});

describe('DailyLedger — atomic source+ledger+lifetime writes with request idempotency', () => {
  const LOG = 'log-1';
  const OP = 'op-create-1';
  const logDoc = async (id) => {
    const s = await getDoc(doc(holder.db, 'users', UID, 'logs', id));
    return s.exists() ? s.data() : undefined;
  };

  const create = (over = {}) => DailyLedger.createManualLog(UID, {
    logId: LOG, date: DATE, counts: { cig: 2 }, snapshots: snap10_15, defaultUnitPrice: 1, operationId: OP, ...over,
  });

  it('create writes the SOURCE log + ledger atomically; lifetime untouched until folded', async () => {
    await seed();
    const res = await create();
    expect(res.applied).toBe(true);
    expect((await logDoc(LOG))?.counts.cig).toBe(2);          // source persisted
    expect((await ledger()).countsByTracker.cig).toBe(2);      // ledger folded in
    expect((await ledger()).canonicalCredit.saved).toBeCloseTo(8); // (10 − 2) × €1
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(0); // not folded yet
  });

  it('is request-idempotent: the SAME operationId applied twice changes nothing the second time', async () => {
    await seed();
    await create();
    const second = await create(); // retry of the same logical action
    expect(second.applied).toBe(false);
    expect((await ledger()).countsByTracker.cig).toBe(2); // NOT 4
    expect((await logDoc(LOG))?.counts.cig).toBe(2);
  });

  it('rejects the same operationId with a different payload', async () => {
    await seed();
    await create();
    await expect(create({ counts: { cig: 5 } })).rejects.toThrow('OPERATION_CONFLICT');
    expect((await ledger()).countsByTracker.cig).toBe(2);
  });

  it('edit applies the exact source delta to the ledger and lifetime (3→5 ⇒ lifetime −€2)', async () => {
    await seed();
    await DailyLedger.createManualLog(UID, { logId: LOG, date: DATE, counts: { cig: 3 }, snapshots: snap10_15, defaultUnitPrice: 1, operationId: OP });
    await DailyLedger.foldIntoLifetime(UID, DATE);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(7); // (10 − 3)

    await DailyLedger.updateManualLog(UID, { logId: LOG, date: DATE, counts: { cig: 5 }, snapshots: snap10_15, defaultUnitPrice: 1, operationId: 'op-edit-1' });
    expect((await logDoc(LOG)).counts.cig).toBe(5);
    expect((await ledger()).canonicalCredit.saved).toBeCloseTo(5);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5); // 7 − 2, not +8
  });

  it('delete reverses the consumption; restore re-adds it exactly once', async () => {
    await seed();
    await create({ counts: { cig: 4 } });
    await DailyLedger.foldIntoLifetime(UID, DATE);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(6); // (10 − 4)

    await DailyLedger.deleteManualLog(UID, { logId: LOG, date: DATE, defaultUnitPrice: 1, operationId: 'op-del-1' });
    expect(await logDoc(LOG)).toBeUndefined();
    expect((await ledger()).countsByTracker.cig ?? 0).toBe(0);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(10); // (10 − 0)

    await DailyLedger.restoreManualLog(UID, { log: { id: LOG, logDate: DATE, counts: { cig: 4 } }, defaultUnitPrice: 1, operationId: 'op-res-1' });
    expect((await logDoc(LOG)).counts.cig).toBe(4);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(6);

    // Duplicate restore of an existing log is a no-op.
    const dup = await DailyLedger.restoreManualLog(UID, { log: { id: LOG, logDate: DATE, counts: { cig: 4 } }, defaultUnitPrice: 1, operationId: 'op-res-2' });
    expect(dup.applied).toBe(false);
    expect((await ledger()).countsByTracker.cig).toBe(4);
  });

  it('counter tap writes the day document AND the ledger in one transaction', async () => {
    await seed();
    await DailyLedger.adjustCounter(UID, { date: DATE, trackerId: 'cig', delta: 3, snapshots: snap10_15, defaultUnitPrice: 1, operationId: 'op-tap-1' });
    const day = await getDoc(doc(holder.db, 'users', UID, 'days', DATE));
    expect(day.data().counts.cig).toBe(3);
    expect((await ledger()).countsByTracker.cig).toBe(3);
  });

  it('atomicity on failure: a rejected operation persists NOTHING', async () => {
    await seed();
    // Closed day → adjustCounter must be rejected...
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', UID, 'days', DATE), { date: DATE, counts: { cig: 1 }, trackerSnapshots: {}, status: 'closed' });
    });
    await expect(
      DailyLedger.adjustCounter(UID, { date: DATE, trackerId: 'cig', delta: 1, snapshots: snap10_15, defaultUnitPrice: 1, operationId: 'op-tap-closed' })
    ).rejects.toThrow('DAY_CLOSED');
    // ...and neither the ledger nor a receipt exists.
    expect(await ledger()).toBeUndefined();
    const r = await getDoc(doc(holder.db, 'users', UID, 'financialOperations', 'op-tap-closed'));
    expect(r.exists()).toBe(false);
  });

  it('migration seed replaces the already-folded LEGACY contribution once (no double credit)', async () => {
    // Stored lifetime already includes a legacy folded contribution of €15.
    await seed({ saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 });
    // Canonical Option-B credit for the same day is €5.
    await DailyLedger.seedLedgerFromLegacy(UID, {
      date: DATE, legacyFolded: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
      counts: { cig: 5 }, snapshots: snap10_15, defaultUnitPrice: 1,
    });
    // 15 − 15 + 5 = 5 (the erroneous €15 is replaced, not added to).
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5);
    expect((await ledger()).canonicalCredit.saved).toBeCloseTo(5);

    // Re-running the seed is a no-op (marked migratedFromLegacy).
    await DailyLedger.seedLedgerFromLegacy(UID, {
      date: DATE, legacyFolded: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
      counts: { cig: 5 }, snapshots: snap10_15, defaultUnitPrice: 1,
    });
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5); // not 5 − 15 + 5
  });

  it('two CONCURRENT migration attempts apply the correction exactly once', async () => {
    await seed({ saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 });
    const args = {
      date: DATE, legacyFolded: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
      counts: { cig: 5 }, snapshots: snap10_15, defaultUnitPrice: 1,
    };
    const results = await Promise.allSettled([
      DailyLedger.seedLedgerFromLegacy(UID, args),
      DailyLedger.seedLedgerFromLegacy(UID, args),
    ]);
    // Exactly one attempt wins the migration marker; the net correction is 15 − 15 + 5 = 5
    // (a double-apply would give 5 − 15 + 5 = −5).
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await profile()).lifetimeAggregates.saved).toBeCloseTo(5);
    expect((await ledger()).canonicalCredit.saved).toBeCloseTo(5);
  });
});
