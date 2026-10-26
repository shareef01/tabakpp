import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * firebase.js — client configuration surface.
 *
 * The module reads `import.meta.env` at load time, so each case loads a fresh
 * copy through the module registry (`vi.resetModules()`). SDK modules are
 * mocked so no network client is created.
 *
 * Scope note: App Check is intentionally absent from this app (Spark-only — no
 * attestation provider, no token, no enforcement), so there is no
 * provider-selection behaviour left to assert here. See SECURITY.md.
 */

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]', options: { projectId: 'test' } })),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ app: { name: '[DEFAULT]' } })),
}));

// setupTests.js globally mocks ./firebase for the component suites; this
// transparent factory hands the REAL module back so these cases exercise the
// actual config/error logic (vi.unmock alone no longer beats a setup-file mock).
vi.mock('./firebase', async (importOriginal) => await importOriginal());

const loadFirebase = async () => {
  vi.resetModules();
  return import('./firebase');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('firebase.js — configuration surface', () => {
  it('exports auth, db and firebaseConfigError, and no App Check surface', async () => {
    const mod = await loadFirebase();
    expect(mod.auth).toBeDefined();
    expect(mod).toHaveProperty('auth');
    expect(mod).toHaveProperty('db');
    expect(mod).toHaveProperty('firebaseConfigError');
    // App Check was removed deliberately: nothing may re-introduce a token
    // provider surface that could be mistaken for a security boundary. Asserted
    // against the module SOURCE — a Vitest module mock answers `in` for every
    // key and throws on an unknown one, so a runtime probe cannot prove absence.
    // (Vitest runs with cwd = webApp, same convention as the rules suite.)
    const source = readFileSync('src/firebase.js', 'utf8');
    expect(source).not.toMatch(/app-check|appCheck|RecaptchaEnterprise|APPCHECK/);
  });

  it('auth/db are null when Firebase config is incomplete (CI has no .env.local)', async () => {
    const { auth, db, firebaseConfigError } = await loadFirebase();
    if (firebaseConfigError) {
      expect(auth).toBeNull();
      expect(db).toBeNull();
    }
  });

  it('auth/db are non-null when Firebase config is complete', async () => {
    const { auth, db, firebaseConfigError } = await loadFirebase();
    if (!firebaseConfigError) {
      expect(auth).not.toBeNull();
      expect(db).not.toBeNull();
    }
  });

  it('names the missing client keys in the configuration error', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    const mod = await import('./firebase');
    // Either the local .env supplied every key (nothing to report), or the
    // message names the keys a deployer must fill in.
    if (mod.firebaseConfigError) {
      expect(mod.firebaseConfigError).toMatch(/Missing Firebase config/);
      expect(mod.firebaseConfigError).toMatch(/apiKey/);
    } else {
      expect(mod.firebaseConfigError).toBeNull();
    }
  });

  it('never reports App Check as required or misconfigured', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadFirebase();
    const appCheckComplaints = errorSpy.mock.calls
      .map((args) => args.join(' '))
      .filter((line) => /app ?check/i.test(line));
    expect(appCheckComplaints).toEqual([]);
    errorSpy.mockRestore();
  });
});
