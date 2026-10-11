/**
 * Account-wipe routing by financial mode.
 *
 * A MIGRATING/OPTION_B account cannot wipe itself from the client — the rules
 * deny its financial deletes and the profile delete — so deleteAllUserData must
 * route it to the trusted `deleteAccountData` callable and attempt no direct
 * delete. LEGACY keeps the client-side wipe (no Cloud Functions needed).
 *
 * Mocks deliberately: this asserts routing. The client-side wipe against the
 * real rules is in registryService.emulator.test.js and the callable itself in
 * functions/emulator.integration.mjs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: { app: {} } }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: h.deleteDoc,
  getDoc: h.getDoc,
  getDocs: h.getDocs,
  query: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(() => ({ delete: vi.fn(), commit: vi.fn() })),
  limit: vi.fn(),
  serverTimestamp: vi.fn(),
  runTransaction: vi.fn(),
  deleteField: vi.fn(),
  startAfter: vi.fn(),
}));

vi.mock('./trustedFinancial', () => ({
  TrustedFinancial: { isEnabled: vi.fn(), execute: vi.fn(), deleteAccountData: vi.fn() },
}));

const { RegistryService } = await import('./registryService');
const { TrustedFinancial } = await import('./trustedFinancial');

const snapOf = (data) => ({ exists: () => data !== undefined, data: () => data });

beforeEach(() => {
  vi.resetAllMocks();
  h.getDocs.mockResolvedValue({ empty: true, docs: [], size: 0 });
});

describe('deleteAllUserData — financial-mode routing', () => {
  for (const mode of ['OPTION_B', 'MIGRATING']) {
    it(`${mode}: wipes via the trusted callable and performs no direct delete`, async () => {
      h.getDoc.mockResolvedValue(snapOf({ financialMode: mode }));
      TrustedFinancial.deleteAccountData.mockResolvedValue({ deleted: true });

      await RegistryService.deleteAllUserData('u1');

      expect(TrustedFinancial.deleteAccountData).toHaveBeenCalledTimes(1);
      expect(h.getDocs).not.toHaveBeenCalled();
      expect(h.deleteDoc).not.toHaveBeenCalled();
    });
  }

  it('OPTION_B: routes to the callable even when the Option-B build flag is off', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(false);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));

    await RegistryService.deleteAllUserData('u1');

    expect(TrustedFinancial.deleteAccountData).toHaveBeenCalledTimes(1);
    expect(h.deleteDoc).not.toHaveBeenCalled();
  });

  it('LEGACY: keeps the client-side wipe and never calls the function', async () => {
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'LEGACY' }));

    await RegistryService.deleteAllUserData('u1');

    expect(TrustedFinancial.deleteAccountData).not.toHaveBeenCalled();
    expect(h.deleteDoc).toHaveBeenCalledWith({ path: 'users/u1' });
  });

  it('a callable failure propagates, so the caller does not go on to delete the Auth user', async () => {
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.deleteAccountData.mockRejectedValue(new Error('RECENT_LOGIN_REQUIRED'));

    await expect(RegistryService.deleteAllUserData('u1')).rejects.toThrow('RECENT_LOGIN_REQUIRED');
  });
});
