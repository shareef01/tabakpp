/**
 * Trusted financial client (Phase 5).
 *
 * The ONLY way an OPTION_B account mutates financial state is the trusted
 * callable `executeFinancialOperation`; the client never computes or persists
 * canonical credit itself. Gated on the same build flag as before
 * (`VITE_OPTION_B_LEDGER=1`, default off) AND the account's server-side
 * financialMode (checked by the server, and by the caller to decide routing).
 */
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { db } from '../firebase';

let functionsInstance = null;

const functions = () => {
  if (functionsInstance) return functionsInstance;
  const app = db?.app;
  if (!app) throw new Error('FIREBASE_NOT_CONFIGURED');
  functionsInstance = getFunctions(app);
  const host = import.meta?.env?.VITE_FUNCTIONS_EMULATOR_HOST;
  if (host) {
    connectFunctionsEmulator(
      functionsInstance,
      host,
      Number(import.meta?.env?.VITE_FUNCTIONS_EMULATOR_PORT || 5001),
    );
  }
  return functionsInstance;
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
    const callable = httpsCallable(functions(), 'executeFinancialOperation');
    const res = await callable({ type, ...payload });
    return res.data;
  },
};
