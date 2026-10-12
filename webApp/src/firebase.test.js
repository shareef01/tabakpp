import { describe, it, expect, vi } from 'vitest';

const { appCheckCalls } = vi.hoisted(() => ({
  // Shared call recorder: under Vitest 5 the hoisted mock factory can execute
  // in a module context where its own vi.fn() bindings differ from the test
  // file's (and from the mocked module's exports). A plain hoisted object is
  // the one guaranteed-shared reference for call assertions.
  appCheckCalls: { initializeAppCheck: [], reCaptchaProvider: [] },
}));

/**
 * Tests the App Check initialization logic in firebase.js.
 *
 * firebase.js uses dynamic import() for "firebase/app-check" and reads
 * import.meta.env at module-load time. These tests verify:
 * - appCheckReady always resolves (never rejects), regardless of site key
 * - auth/db are exported (may be null if firebaseConfigError, which is expected
 *   when VITE_FIREBASE_* env vars are missing in CI)
 * - When a site key is present, ReCaptchaEnterpriseProvider is used
 * - isTokenAutoRefreshEnabled is true in the config
 *
 * setupTests.js globally mocks ./firebase; the transparent importOriginal
 * factory below loads the REAL module instead (vi.unmock alone no longer
 * beats a setup-file mock under Vitest 5), with Firebase SDK modules mocked
 * to avoid network.
 */

vi.mock('./firebase', async (importOriginal) => await importOriginal());
const loadFirebase = () => import('./firebase');

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]', options: { projectId: 'test' } })),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ app: { name: '[DEFAULT]' } })),
}));

// Mock firebase/app-check — initializeAppCheck must return a Promise
// because firebase.js awaits it in an async IIFE. ReCaptchaEnterpriseProvider
// is called with `new`, so it must be a constructable function.
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: (app, options) => {
    appCheckCalls.initializeAppCheck.push(options);
    return Promise.resolve({ app, options });
  },
  ReCaptchaEnterpriseProvider: function (siteKey) {
    appCheckCalls.reCaptchaProvider.push(siteKey);
    return { _isMockReCaptchaProvider: true, siteKey };
  },
}));

describe('firebase.js — App Check initialization', () => {

  it('exports appCheckReady, auth, db, and firebaseConfigError', async () => {
    const mod = await loadFirebase();
    expect(mod).toHaveProperty('appCheckReady');
    expect(mod).toHaveProperty('auth');
    expect(mod).toHaveProperty('db');
    expect(mod).toHaveProperty('firebaseConfigError');
  });

  it('appCheckReady resolves (never rejects), regardless of site key', async () => {
    const { appCheckReady } = await loadFirebase();
    const result = await appCheckReady;
    // appCheckReady resolves to:
    // - null when no site key is configured (graceful degradation)
    // - an AppCheck instance when site key is present
    // It must NEVER reject.
    expect(result).not.toBeUndefined();
  });

  it('auth/db are null when Firebase config is incomplete (CI has no .env.local)', async () => {
    const { auth, db, appCheckReady, firebaseConfigError } = await loadFirebase();
    await appCheckReady;

    // In CI without .env.local, firebaseConfigError is non-null and
    // auth/db are null — this is the expected graceful failure path.
    if (firebaseConfigError) {
      expect(auth).toBeNull();
      expect(db).toBeNull();
    }
  });

  it('auth/db are non-null when Firebase config is complete', async () => {
    const { auth, db, appCheckReady, firebaseConfigError } = await loadFirebase();
    await appCheckReady;

    // When config is complete (e.g. local dev with .env.local), auth/db are set
    if (!firebaseConfigError) {
      expect(auth).not.toBeNull();
      expect(db).not.toBeNull();
    }
  });

  it('calls initializeAppCheck with ReCaptchaEnterpriseProvider when site key present', async () => {
    const { appCheckReady } = await loadFirebase();
    const result = await appCheckReady;

    if (result) {
      // Site key was present → App Check initialized
      expect(appCheckCalls.reCaptchaProvider).toEqual([
        import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY,
      ]);
      expect(appCheckCalls.initializeAppCheck).toHaveLength(1);
      expect(appCheckCalls.initializeAppCheck[0]).toEqual(
        expect.objectContaining({
          isTokenAutoRefreshEnabled: true,
        })
      );
    } else {
      // No site key → App Check not initialized (graceful degradation)
      expect(appCheckCalls.reCaptchaProvider).toHaveLength(0);
      expect(appCheckCalls.initializeAppCheck).toHaveLength(0);
    }
  });
});
