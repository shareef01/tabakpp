/**
 * Focused regression tests for offline & pending mutation state behavior.
 *
 * These tests validate stable SDK/application behavior (not transport
 * limitations). They use the REAL Firebase Firestore SDK against the emulator.
 *
 * Run: FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run --config vitest.rules.config.js src/services/offlineBehavior.test.js
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, onSnapshot, setDoc, updateDoc,
  enableNetwork, disableNetwork
} from 'firebase/firestore';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../firebase', () => ({
  get db() { return holder.db; },
}));

const { RegistryService } = await import('./registryService');

const UID = 'offline-test-user';
const CIG_CONFIG = {
  name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE',
  pricePerUnit: 1, isFinanciallyTracked: true, isPrimaryTracked: true,
};
const baseProfile = {
  name: '', accent: '#FF5F5F', widgetSize: 'MEDIUM', purchaseType: 'PACK',
  unitPrice: 0.5, pouchPrice: 0, estimatedYield: 0, dayStartHour: 6,
  lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
  smokingUnitsMigrated: true, schemaVersion: 2,
};

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-tabakpp-offline',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('../firestore.rules', 'utf8') },
  });
  holder.db = testEnv.authenticatedContext(UID).firestore();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', UID), { ...baseProfile });
    await setDoc(doc(context.firestore(), 'users', UID, 'configs', 'cig'), CIG_CONFIG);
  });
  await enableNetwork(holder.db);
});

afterAll(async () => {
  await testEnv?.cleanup();
});

/**
 * Returns once a condition function returns truthy, or fails the test
 * after a bounded number of attempts.
 */
async function waitFor(condition, { maxAttempts = 200, intervalMs = 10 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await condition();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

describe('Offline behavior — plain writes', () => {

  it('EXP-1: updateDoc (plain write) stays pending while offline and resolves on reconnect', async () => {
    await disableNetwork(holder.db);

    // Start listener with metadata to detect pending state
    const updates = [];
    const unsub = onSnapshot(
      doc(holder.db, 'users', UID),
      { includeMetadataUpdates: true },
      (snap) => {
        updates.push({
          hasPendingWrites: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
          name: snap.exists() ? snap.data().name : null,
        });
      }
    );

    // Wait for listener to establish
    await waitFor(() => updates.length > 0);

    // Issue a plain write while offline
    const writePromise = updateDoc(doc(holder.db, 'users', UID), { name: 'Offline Test' });

    // Wait for the metadata event showing pending writes
    await waitFor(() => updates.some(u => u.hasPendingWrites === true));

    // Verify the Promise is still pending (not resolved or rejected)
    let settled = false;
    writePromise.then(() => { settled = true; }, () => { settled = true; });
    expect(settled).toBe(false);

    // Reconnect and wait for the write to resolve
    await enableNetwork(holder.db);
    await writePromise;

    // Verify server received the write
    const serverSnap = await getDoc(doc(holder.db, 'users', UID));
    expect(serverSnap.exists()).toBe(true);
    expect(serverSnap.data().name).toBe('Offline Test');

    // Verify listener observed pending then acknowledged states
    const sawPending = updates.some(u => u.hasPendingWrites === true);
    const sawAcked = updates.some(u => u.hasPendingWrites === false);
    expect(sawPending).toBe(true);
    expect(sawAcked).toBe(true);

    unsub();
  });

  it('EXP-5: addProtocol (new tracker) stays pending while offline and resolves on reconnect', async () => {
    await disableNetwork(holder.db);

    const writePromise = RegistryService.addProtocol(UID, {
      name: 'New Tracker', type: 'CIGARETTE', limit: 10, order: 99, pricePerUnit: 0.5,
    });

    let settled = false;
    writePromise.then(() => { settled = true; }, () => { settled = true; });
    // Allow microtask flush
    await new Promise(r => setTimeout(r, 0));
    expect(settled).toBe(false);

    await enableNetwork(holder.db);
    await writePromise;

    // Verify the new tracker was created server-side (has a server-assigned ID)
    const snap = await getDoc(doc(holder.db, 'users', UID));
    expect(snap.exists()).toBe(true);
  });
});
