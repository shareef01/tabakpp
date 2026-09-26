/**
 * Reproduction test: old validCreateProfile() (delegating to validUserProfile()
 * which calls validCountMap on activeCounts/migratingLegacyCounts for a
 * 17-field UserProfile bootstrap document) vs the budget-fixed version.
 *
 * Loads BOTH rule sets from separate string constants so we can compare
 * side-by-side without touching the production firestore.rules file.
 *
 * Uses the @firebase/rules-unit-testing Firestore emulator (demo-tabakpp-test).
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-tabakpp-test';

// --- The Android bootstrap profile produced by ensureUserDocument ---
// Matches FirebaseRegistryRepository.ensureUserDocument + Kotlin serialization defaults.
// activeCounts and migratingLegacyCounts are EMPTY maps (defaults), but they ARE
// present in the serialized form when encodeDefaults is used, or they may be
// absent. We test the worst case: present and empty.
const androidBootstrapProfile = {
  name: '',
  accent: '#FF5F5F',
  widgetSize: 'MEDIUM',
  purchaseType: 'PACK',
  unitPrice: 0.5,
  unitsPerPack: 20,
  pouchPrice: 0,
  estimatedYield: 0,
  dayStartHour: 6,
  activeCounts: {},
  lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
  smokingUnitsMigrated: true,
  avatar: null,
  createdAt: { seconds: 0, nanos: 0 },
  updatedAt: { seconds: 0, nanos: 0 },
  schemaVersion: 2,
  migratingLegacyCounts: {},
  migratingLegacyDate: null,
};

// --- OLD rules: validCreateProfile delegates to validUserProfile() ---
// The critical difference: validUserProfile() calls validCountMap() on
// activeCounts and migratingLegacyCounts, each of which evaluates the full
// 50-unrolled validCountEntries() predicate even for empty maps.
const OLD_RULES = readFileSync('./firestore.rules.old.repro', 'utf8');

// --- NEW rules: current production firestore.rules ---
const NEW_RULES = readFileSync('../firestore.rules', 'utf8');

let oldEnv;
let newEnv;

beforeAll(async () => {
  oldEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID + '-old',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: OLD_RULES,
    },
  });
  newEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID + '-new',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: NEW_RULES,
    },
  });
});

beforeEach(async () => {
  await oldEnv.clearFirestore();
  await newEnv.clearFirestore();
});

afterAll(async () => {
  await oldEnv?.cleanup();
  await newEnv?.cleanup();
});

describe('Rules expression budget: old vs new validCreateProfile', () => {
  it('OLD rules: Android bootstrap profile creation (may hit 1000-expr budget)', async () => {
    const uid = 'alice-old';
    await oldEnv.withSecurityRulesDisabled(async (context) => {
      // Seed a user doc so the owner check passes
    });
    const db = oldEnv.authenticatedContext(uid).firestore();
    // The create write triggers validCreateProfile() -> validUserProfile()
    // -> validCountMap() on activeCounts and migratingLegacyCounts
    try {
      await setDoc(doc(db, `users/${uid}`), androidBootstrapProfile);
      console.log('OLD: profile creation succeeded');
    } catch (e) {
      const msg = e.message || String(e);
      console.log('OLD: profile creation result:', msg.substring(0, 500));
      // Check if it's the 1000-expression budget error
      if (msg.includes('1000') || msg.includes('expression') || msg.includes('maximum')) {
        console.log('OLD: *** REPRODUCED: 1000-expression budget exceeded ***');
      }
    }
    // Verify what persisted
    const snap = await getDoc(doc(db, `users/${uid}`));
    console.log('OLD: doc exists =', snap.exists);
  });

  it('NEW rules: Android bootstrap profile creation succeeds', async () => {
    const uid = 'alice-new';
    const db = newEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${uid}`), androidBootstrapProfile));
    const snap = await getDoc(doc(db, `users/${uid}`));
    expect(snap.exists()).toBe(true);
    console.log('NEW: profile creation succeeded, doc exists = true');
  });

  it('NEW rules: reject forged lifetime totals on create', async () => {
    const uid = 'bob-new';
    const db = newEnv.authenticatedContext(uid).firestore();
    const forgedProfile = {
      ...androidBootstrapProfile,
      lifetimeAggregates: { saved: 999, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
    };
    await assertFails(setDoc(doc(db, `users/${uid}`), forgedProfile));
  });

  it('NEW rules: reject cross-user create', async () => {
    const db = newEnv.authenticatedContext('mallory').firestore();
    await assertFails(setDoc(doc(db, 'users/alice-new'), androidBootstrapProfile));
  });

  it('NEW rules: reject unexpected extra field', async () => {
    const uid = 'carol-new';
    const db = newEnv.authenticatedContext(uid).firestore();
    const extraFieldProfile = {
      ...androidBootstrapProfile,
      forgedField: true,
    };
    await assertFails(setDoc(doc(db, `users/${uid}`), extraFieldProfile));
  });
});
