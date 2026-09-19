import { describe, it, expect, vi } from 'vitest';

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
 * setupTests.js globally mocks ./firebase — we use vi.unmock to load
 * the real module, with Firebase SDK modules mocked to avoid network.
 */

const mockInitializeAppCheck = vi.fn();
const mockReCaptchaEnterpriseProvider = vi.fn(function (siteKey) {
  return { _isMockReCaptchaProvider: true, siteKey };
});

vi.unmock('./firebase');

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
// because firebase.js awaits it in an async IIFE
vi.mock('firebase/app-check', () => ({
  initializeAppCheck: vi.fn((app, options) => {
    mockInitializeAppCheck(app, options);
    return Promise.resolve({ app, options });
  }),
  ReCaptchaEnterpriseProvider: mockReCaptchaEnterpriseProvider,
}));

describe('firebase.js — App Check initialization', () => {

  it('exports appCheckReady, auth, db, and firebaseConfigError', async () => {
    const mod = await vi.importActual('./firebase');
    expect(mod).toHaveProperty('appCheckReady');
    expect(mod).toHaveProperty('auth');
    expect(mod).toHaveProperty('db');
    expect(mod).toHaveProperty('firebaseConfigError');
  });

  it('appCheckReady resolves (never rejects), regardless of site key', async () => {
    const { appCheckReady } = await vi.importActual('./firebase');
    const result = await appCheckReady;
    // appCheckReady resolves to:
    // - null when no site key is configured (graceful degradation)
    // - an AppCheck instance when site key is present
    // It must NEVER reject.
    expect(result).not.toBeUndefined();
  });

  it('auth/db are null when Firebase config is incomplete (CI has no .env.local)', async () => {
    const { auth, db, appCheckReady, firebaseConfigError } = await vi.importActual('./firebase');
    await appCheckReady;

    // In CI without .env.local, firebaseConfigError is non-null and
    // auth/db are null — this is the expected graceful failure path.
    if (firebaseConfigError) {
      expect(auth).toBeNull();
      expect(db).toBeNull();
    }
  });

  it('auth/db are non-null when Firebase config is complete', async () => {
    const { auth, db, appCheckReady, firebaseConfigError } = await vi.importActual('./firebase');
    await appCheckReady;

    // When config is complete (e.g. local dev with .env.local), auth/db are set
    if (!firebaseConfigError) {
      expect(auth).not.toBeNull();
      expect(db).not.toBeNull();
    }
  });

  it('calls initializeAppCheck with ReCaptchaEnterpriseProvider when site key present', async () => {
    const { appCheckReady } = await vi.importActual('./firebase');
    const result = await appCheckReady;

    if (result) {
      // Site key was present → App Check initialized
      expect(mockReCaptchaEnterpriseProvider).toHaveBeenCalledWith(
        import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY
      );
      expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
      expect(mockInitializeAppCheck).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          isTokenAutoRefreshEnabled: true,
        })
      );
    } else {
      // No site key → App Check not initialized (graceful degradation)
      expect(mockReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
      expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    }
  });
});
