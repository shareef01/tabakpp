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

  describe('unitsPerPack', () => {
    const seedAlice = async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
      });
      return testEnv.authenticatedContext('alice').firestore();
    };

    it('accepts whole numbers within bounds on the settings path', async () => {
      const db = await seedAlice();
      await assertSucceeds(updateDoc(doc(db, 'users/alice'), { unitsPerPack: 25 }));
      await assertSucceeds(updateDoc(doc(db, 'users/alice'), { unitsPerPack: 1 }));
      await assertSucceeds(updateDoc(doc(db, 'users/alice'), { unitsPerPack: 1000 }));
      // Realistic pairing: the pack editor saves quantity and derived price together.
      await assertSucceeds(updateDoc(doc(db, 'users/alice'), {
        purchaseType: 'PACK',
        unitsPerPack: 25,
        unitPrice: 0.44,
      }));
    });

    it('rejects zero, negative, fractional, oversized, and non-numeric values', async () => {
      const db = await seedAlice();
      // Zero would divide by zero in the unit-cost derivation.
      await assertFails(updateDoc(doc(db, 'users/alice'), { unitsPerPack: 0 }));
      await assertFails(updateDoc(doc(db, 'users/alice'), { unitsPerPack: -5 }));
      await assertFails(updateDoc(doc(db, 'users/alice'), { unitsPerPack: 20.5 }));
      await assertFails(updateDoc(doc(db, 'users/alice'), { unitsPerPack: 1001 }));
      await assertFails(updateDoc(doc(db, 'users/alice'), { unitsPerPack: '20' }));
      await assertFails(updateDoc(doc(db, 'users/alice'), { unitsPerPack: null }));
    });

    it('stays on the settings path — a mutation write cannot carry it', async () => {
      const db = await seedAlice();
      // The settings/mutation split must hold for the new field too: a counter
      // write has no business touching pack economics.
      await assertFails(updateDoc(doc(db, 'users/alice'), {
        activeCounts: { cig: 1 },
        unitsPerPack: 25,
      }));
    });

    it('is rejected on another user profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
      });
      const malloryDb = testEnv.authenticatedContext('mallory').firestore();
      await assertFails(updateDoc(doc(malloryDb, 'users/alice'), { unitsPerPack: 25 }));
    });
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

  it('allows in-range activeCounts values on mutation writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), {
      activeCounts: { cig: 3, ryo: 1.5 },
    }));
  });

  it('rejects out-of-range or non-numeric count map values', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      activeCounts: { cig: -1 },
    }));
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      activeCounts: { cig: 10001 },
    }));
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      activeCounts: { cig: 'lots' },
    }));
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      activeCounts: { 'bad key!': 1 },
    }));
  });

  it('rejects oversized count maps', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const oversized = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`t${i}`, 1]),
    );
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      activeCounts: oversized,
    }));
  });

  it('allows settings updates even when existing activeCounts would fail validCountMap', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), {
        ...emptyProfile,
        // Legacy / invalid key that current rules reject on mutation writes.
        activeCounts: { 'bad key!': 2 },
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), {
      name: 'Alice',
      accent: '#10B981',
    }));
  });

  it('allows settings updates when an existing avatar is oversized but unchanged', async () => {
    const hugeAvatar = `data:image/jpeg;base64,${'A'.repeat(120000)}`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), {
        ...emptyProfile,
        avatar: hugeAvatar,
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), {
      name: 'Alice',
      dayStartHour: 7,
    }));
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      avatar: `${hugeAvatar}B`,
    }));
  });

  it('allows stripping legacy eco fields alongside a settings change', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), {
        ...emptyProfile,
        ecoMode: true,
        retailPrice: 8,
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    const { deleteField } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), {
      name: 'Alice',
      ecoMode: deleteField(),
      retailPrice: deleteField(),
      retailQty: deleteField(),
      ryoPrice: deleteField(),
      ryoYield: deleteField(),
    }));
  });

  it('refuses to let a settings write rewrite createdAt', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), {
        ...emptyProfile,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      name: 'Alice',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }));
  });

  it('pins logDate on a history edit but allows re-counting the same day', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users/alice'), emptyProfile);
      await setDoc(doc(adminDb, 'users/alice/logs/2026-07-28_DAY'), {
        logDate: '2026-07-28',
        counts: { cig: 3 },
        origin: 'DAY_RESET',
        isArchive: true,
      });
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    const logRef = doc(db, 'users/alice/logs/2026-07-28_DAY');

    await assertSucceeds(updateDoc(logRef, { counts: { cig: 5 } }));
    // Relabelling the day would move counts while lifetimeAggregates stayed put.
    await assertFails(updateDoc(logRef, { logDate: '2026-07-01' }));
  });
});
