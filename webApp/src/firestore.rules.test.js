import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-tabakpp-rules';
let testEnv;

const emptyProfile = {
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

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('Firestore ownership and write paths', () => {
  it('allows an owner to create a zeroed profile', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/alice'), emptyProfile));
  });

  it('denies cross-user reads and writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const malloryDb = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(malloryDb, 'users/alice')));
    await assertFails(updateDoc(doc(malloryDb, 'users/alice'), { name: 'Mallory' }));
  });

  it('prevents settings writes from changing aggregates', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      name: 'Alice',
      lifetimeAggregates: { saved: 999, wasted: 0, smokingUnits: 0 },
    }));
  });

  it('rejects invalid tracker configuration fields', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/configs/bad'), {
      id: 'bad',
      name: 'x'.repeat(81),
      limit: 10,
      order: 0,
    }));
  });

  it('documents the Spark residual by allowing owner mutation-only aggregates', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), {
      lifetimeAggregates: { saved: 999, wasted: 0, smokingUnits: 0 },
    }));
    const snapshot = await getDoc(doc(db, 'users/alice'));
    expect(snapshot.data().lifetimeAggregates.saved).toBe(999);
  });
});
