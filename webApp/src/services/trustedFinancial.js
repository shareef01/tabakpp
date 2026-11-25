/**
 * Trusted financial client (Phase 5).
 *
 * The ONLY way an OPTION_B account mutates financial state is the trusted
 * callable `executeFinancialOperation`; the client never computes or persists
 * canonical credit itself. Gated on the same build flag as before
 * (`VITE_OPTION_B_LEDGER=1`, default off) AND the account's server-side
 * financialMode (checked by the server, and by the caller to decide routing).
 */
import { db } from '../firebase';

// Must match `setGlobalOptions({ region })` in functions/index.js — the SDK
// otherwise defaults to us-central1, where the callable does not exist.
//
// Production runs on Spark and has no deployed callables, so the production
// hosting CSP deliberately does NOT allow any cloudfunctions.net origin. A
// Blaze/Option-B deployment has to add it back (see SETUP_GUIDE.md).
export const FUNCTIONS_REGION = 'europe-west1';

let functionsPromise = null;

/**
 * The Functions SDK is loaded on first use only. No production (LEGACY)
 * account ever reaches a callable, so a static import shipped ~dead code in
 * the always-loaded `firebase` chunk; the dynamic import keeps it in its own
 * lazily fetched chunk (vite.config.js → manualChunks).
 */
const functions = () => {
  if (functionsPromise) return functionsPromise;
  const app = db?.app;
  if (!app) return Promise.reject(new Error('FIREBASE_NOT_CONFIGURED'));
  functionsPromise = import('firebase/functions').then(({ getFunctions, connectFunctionsEmulator }) => {
    const instance = getFunctions(app, FUNCTIONS_REGION);
    const host = import.meta?.env?.VITE_FUNCTIONS_EMULATOR_HOST;
    if (host) {
      connectFunctionsEmulator(
        instance,
        host,
        Number(import.meta?.env?.VITE_FUNCTIONS_EMULATOR_PORT || 5001),
      );
    }
    return instance;
  }).catch((e) => {
    // A failed chunk fetch (offline, stale deploy) must be retryable.
    functionsPromise = null;
    throw e;
  });
  return functionsPromise;
};

const callable = async (name) => {
  const instance = await functions();
  const { httpsCallable } = await import('firebase/functions');
  return httpsCallable(instance, name);
};

export const isTrustedWriteEnabled = () =>
  String(import.meta?.env?.VITE_OPTION_B_LEDGER || '') === '1';

export const TrustedFinancial = {
  isEnabled: isTrustedWriteEnabled,

  /**
   * Invoke the trusted boundary. `payload` carries `type` + op-specific fields
   * (operationId, date, trackerId, logId, counts, delta, defaultUnitPrice).
   * Throws on any non-OK result; never falls back to a direct client write.
   */
  async execute(type, payload) {
    const fn = await callable('executeFinancialOperation');
    const res = await fn({ type, ...payload });
    return res.data;
  },

  /**
   * Delete the signed-in caller's entire users/{uid} tree server-side. Used for
   * MIGRATING/OPTION_B accounts, whose financial data the rules forbid the
   * client from deleting. Requires a recent sign-in (the caller reauthenticates
   * first); does NOT delete the Auth user.
   */
  async deleteAccountData() {
    const fn = await callable('deleteAccountData');
    const res = await fn({});
    return res.data;
  },
};
