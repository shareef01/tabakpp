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
      activeCounts: { cig: 3, ryo: 2 },
    }));
  });

  it('rejects out-of-range, fractional, or non-numeric count map values', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });

    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users/alice'), {
      activeCounts: { cig: 1.5 },
    }));
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

describe('tracker baseline field (item 3)', () => {
  const seedAlice = async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });
    return testEnv.authenticatedContext('alice').firestore();
  };

  it('accepts a whole-number baseline, or an explicit null (not set)', async () => {
    const db = await seedAlice();
    await assertSucceeds(setDoc(doc(db, 'users/alice/configs/cig'), {
      name: 'Cig', limit: 10, order: 0, baseline: 20,
    }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/configs/cig2'), {
      name: 'Cig2', limit: 10, order: 1, baseline: null,
    }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/configs/cig3'), {
      name: 'Cig3', limit: 10, order: 2,
    }));
  });

  it('rejects a negative, fractional, or oversized baseline', async () => {
    const db = await seedAlice();
    await assertFails(setDoc(doc(db, 'users/alice/configs/bad1'), { name: 'x', limit: 10, order: 0, baseline: -1 }));
    await assertFails(setDoc(doc(db, 'users/alice/configs/bad2'), { name: 'x', limit: 10, order: 0, baseline: 1.5 }));
    await assertFails(setDoc(doc(db, 'users/alice/configs/bad3'), { name: 'x', limit: 10, order: 0, baseline: 10001 }));
  });
});

describe('users/{uid}/days/{date} — dated daily-document model (items 1, 2, 13)', () => {
  const seedAlice = async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });
    return testEnv.authenticatedContext('alice').firestore();
  };

  const openDay = {
    date: '2026-07-20',
    counts: { cig: 4 },
    trackerSnapshots: { cig: { name: 'Cig', type: 'CIGARETTE', target: 10, baseline: 20, unitPrice: 1, isFinanciallyTracked: true } },
    aggregateCredit: { saved: 6, wasted: 4, smokingUnits: 4, baselineSaved: 16 },
    status: 'open',
  };

  it('allows an owner to create a day doc whose date matches the document id', async () => {
    const db = await seedAlice();
    await assertSucceeds(setDoc(doc(db, 'users/alice/days/2026-07-20'), openDay));
  });

  it('rejects a day doc whose date field does not match the document id', async () => {
    const db = await seedAlice();
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), { ...openDay, date: '2026-07-21' }));
  });

  it('denies cross-user reads and writes on days', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/days/2026-07-20'), openDay);
    });
    const mallory = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(mallory, 'users/alice/days/2026-07-20')));
    await assertFails(updateDoc(doc(mallory, 'users/alice/days/2026-07-20'), { counts: { cig: 0 } }));
  });

  it('allows counts/snapshot updates while a day is still open', async () => {
    const db = await seedAlice();
    await setDoc(doc(db, 'users/alice/days/2026-07-20'), openDay);
    await assertSucceeds(updateDoc(doc(db, 'users/alice/days/2026-07-20'), {
      counts: { cig: 5 },
      trackerSnapshots: { cig: { ...openDay.trackerSnapshots.cig, target: 12 } },
      aggregateCredit: { saved: 5, wasted: 5, smokingUnits: 5, baselineSaved: 15 },
    }));
  });

  it('closing a day (open -> closed) is allowed, but reopening it is not', async () => {
    const db = await seedAlice();
    await setDoc(doc(db, 'users/alice/days/2026-07-20'), openDay);
    await assertSucceeds(updateDoc(doc(db, 'users/alice/days/2026-07-20'), {
      status: 'closed', foldedIntoLifetime: true,
    }));
    await assertFails(updateDoc(doc(db, 'users/alice/days/2026-07-20'), { status: 'open' }));
  });

  it('once closed, trackerSnapshots is frozen even though counts may still be corrected', async () => {
    const db = await seedAlice();
    await setDoc(doc(db, 'users/alice/days/2026-07-20'), { ...openDay, status: 'closed', foldedIntoLifetime: true });

    // A historical correction to counts (+ its derived credit) is allowed...
    await assertSucceeds(updateDoc(doc(db, 'users/alice/days/2026-07-20'), {
      counts: { cig: 6 },
      aggregateCredit: { saved: 4, wasted: 6, smokingUnits: 6, baselineSaved: 14 },
    }));
    // ...but rewriting what the day's target/price/baseline WAS is not, even
    // if bundled with an otherwise-legitimate counts edit.
    await assertFails(updateDoc(doc(db, 'users/alice/days/2026-07-20'), {
      counts: { cig: 6 },
      trackerSnapshots: { cig: { ...openDay.trackerSnapshots.cig, target: 999 } },
    }));
  });

  it('foldedIntoLifetime cannot be reset to false once true', async () => {
    const db = await seedAlice();
    await setDoc(doc(db, 'users/alice/days/2026-07-20'), { ...openDay, status: 'closed', foldedIntoLifetime: true });
    await assertFails(updateDoc(doc(db, 'users/alice/days/2026-07-20'), { foldedIntoLifetime: false }));
  });

  it('rejects a malformed date, an oversized snapshot map, or extra keys', async () => {
    const db = await seedAlice();
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), { ...openDay, date: 'not-a-date' }));
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-13-01'), { ...openDay, date: '2026-13-01' }));
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-02-32'), { ...openDay, date: '2026-02-32' }));
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), { ...openDay, somethingElse: true }));

    const oversizedSnapshots = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`t${i}`, { target: 1 }]),
    );
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), {
      ...openDay, trackerSnapshots: oversizedSnapshots,
    }));
  });

  it('rejects fractional counts and fractional snapshot targets in day documents', async () => {
    const db = await seedAlice();
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), {
      ...openDay, counts: { cig: 2.5 },
    }));
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), {
      ...openDay,
      trackerSnapshots: { cig: { ...openDay.trackerSnapshots.cig, target: 10.5 } },
    }));
    await assertFails(setDoc(doc(db, 'users/alice/days/2026-07-20'), {
      ...openDay,
      trackerSnapshots: { cig: { ...openDay.trackerSnapshots.cig, baseline: 8.2 } },
    }));
  });
});

describe('users/{uid}/meta/{id} — avatar split from the profile doc (item 12)', () => {
  it('allows an owner to write and read their own avatar doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/alice/meta/profile'), { avatar: 'data:short' }));
    await assertSucceeds(getDoc(doc(db, 'users/alice/meta/profile')));
  });

  it('denies cross-user access', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/meta/profile'), { avatar: 'x' });
    });
    const mallory = testEnv.authenticatedContext('mallory').firestore();
    await assertFails(getDoc(doc(mallory, 'users/alice/meta/profile')));
    await assertFails(updateDoc(doc(mallory, 'users/alice/meta/profile'), { avatar: 'evil' }));
  });

  it('rejects an oversized avatar or unknown keys', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), emptyProfile);
    });
    const db = testEnv.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/meta/profile'), { avatar: 'A'.repeat(100001) }));
    await assertFails(setDoc(doc(db, 'users/alice/meta/profile'), { avatar: 'x', extra: true }));
  });
});
