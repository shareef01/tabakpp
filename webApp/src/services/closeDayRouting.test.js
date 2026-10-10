/**
 * W1B-1 — mode-aware routing for the day-close mutation.
 *
 * Verifies that an OPTION_B account can only close a day through the trusted
 * callable (a direct client write is denied by `financialLocked`), that a
 * LEGACY account keeps its original direct-transaction behaviour, that the
 * operation id is stable across retries of the same logical action, and that
 * the routing fails closed when the mode read fails.
 *
 * Uses mocks deliberately: this suite asserts *routing*, not accounting. The
 * financial correctness of closeDay against the real SDK/rules lives in
 * `registryService.emulator.test.js`, and the canonical accounting in the
 * Functions suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  doc: vi.fn((_db, ...path) => ({ path: path.join('/') })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'TS'),
}));

vi.mock('../firebase', () => ({ db: { app: {} } }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: h.doc,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: h.getDoc,
  getDocs: h.getDocs,
  query: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: h.serverTimestamp,
  runTransaction: h.runTransaction,
  deleteField: vi.fn(() => 'DELETE_FIELD'),
  startAfter: vi.fn(),
}));

vi.mock('./trustedFinancial', () => ({
  TrustedFinancial: { isEnabled: vi.fn(), execute: vi.fn() },
}));

const { RegistryService } = await import('./registryService');
const { TrustedFinancial } = await import('./trustedFinancial');

const snapOf = (data) => ({ exists: () => data !== undefined, data: () => data });

beforeEach(() => {
  vi.resetAllMocks();
  h.runTransaction.mockResolvedValue(undefined);
});

describe('closeDay — financial-mode routing (W1B-1)', () => {
  it('LEGACY: closes via the direct client transaction, never the callable', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'LEGACY' }));

    await RegistryService.closeDay('u1', '2026-10-01');

    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
    expect(h.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('build flag off: keeps the direct client transaction', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(false);

    await RegistryService.closeDay('u1', '2026-10-01');

    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
    expect(h.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('OPTION_B: routes DAY_CLOSE to the trusted callable and performs no direct write', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.closeDay('u1', '2026-10-01');

    expect(TrustedFinancial.execute).toHaveBeenCalledTimes(1);
    expect(TrustedFinancial.execute).toHaveBeenCalledWith('DAY_CLOSE', {
      operationId: 'close_2026-10-01',
      date: '2026-10-01',
    });
    // No direct (rules-denied) financial write is attempted.
    expect(h.runTransaction).not.toHaveBeenCalled();
  });

  it('OPTION_B: the operation id is stable across retries of the same logical action', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.closeDay('u1', '2026-10-01');
    await RegistryService.closeDay('u1', '2026-10-01');

    const ids = TrustedFinancial.execute.mock.calls.map((c) => c[1].operationId);
    expect(ids).toEqual(['close_2026-10-01', 'close_2026-10-01']);
  });

  it('OPTION_B: an explicit operation id is honoured (caller-supplied)', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.closeDay('u1', '2026-10-01', 'op-explicit');

    expect(TrustedFinancial.execute).toHaveBeenCalledWith('DAY_CLOSE', {
      operationId: 'op-explicit',
      date: '2026-10-01',
    });
  });

  it('fails closed when the mode read throws — no direct write is attempted', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockRejectedValue(new Error('unavailable'));

    await expect(RegistryService.closeDay('u1', '2026-10-01')).rejects.toThrow('unavailable');
    expect(h.runTransaction).not.toHaveBeenCalled();
    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload before any read or write', async () => {
    await expect(RegistryService.closeDay(null, '2026-10-01')).rejects.toThrow('INVALID_PAYLOAD');
    expect(h.getDoc).not.toHaveBeenCalled();
    expect(h.runTransaction).not.toHaveBeenCalled();
  });
});

describe('reconcileStaleDays — inherits day-close routing (W1B-3)', () => {
  const stalePage = (dates, size) => ({
    empty: dates.length === 0,
    size,
    docs: dates.map((d) => ({ id: d, data: () => ({ date: d }) })),
  });

  it('OPTION_B: every stale day is closed through the trusted callable', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });
    // One short page, then an empty page terminates the loop.
    h.getDocs
      .mockResolvedValueOnce(stalePage(['2026-09-29', '2026-09-30'], 2))
      .mockResolvedValue(stalePage([], 0));

    await RegistryService.reconcileStaleDays('u1', '2026-10-01');

    const ids = TrustedFinancial.execute.mock.calls.map((c) => c[1].operationId);
    expect(TrustedFinancial.execute.mock.calls.every((c) => c[0] === 'DAY_CLOSE')).toBe(true);
    expect(ids).toEqual(['close_2026-09-29', 'close_2026-09-30']);
    expect(h.runTransaction).not.toHaveBeenCalled();
  });

  it('LEGACY: stale days are closed by the direct client transaction', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'LEGACY' }));
    h.getDocs
      .mockResolvedValueOnce(stalePage(['2026-09-30'], 1))
      .mockResolvedValue(stalePage([], 0));

    await RegistryService.reconcileStaleDays('u1', '2026-10-01');

    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
    expect(h.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('leaves the current tracking date untouched', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    h.getDocs
      .mockResolvedValueOnce(stalePage(['2026-10-01'], 1))
      .mockResolvedValue(stalePage([], 0));

    await RegistryService.reconcileStaleDays('u1', '2026-10-01');

    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
  });
});

describe('financialWritesLocked guard on ungated protected paths (W1B-4)', () => {
  for (const mode of ['OPTION_B', 'MIGRATING']) {
    it(`${mode}: deleteProtocol fails closed before any write`, async () => {
      h.getDoc.mockResolvedValue(snapOf({ financialMode: mode }));

      await expect(RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01'))
        .rejects.toThrow('TRACKER_DELETE_UNSUPPORTED');

      // No transaction, no direct day/config write is attempted.
      expect(h.runTransaction).not.toHaveBeenCalled();
      expect(TrustedFinancial.execute).not.toHaveBeenCalled();
    });

    it(`${mode}: migrateSmokingUnitsIfNeeded is skipped (server-owned aggregates)`, async () => {
      h.getDoc.mockResolvedValue(snapOf({ financialMode: mode }));

      await RegistryService.migrateSmokingUnitsIfNeeded('u1');

      expect(h.runTransaction).not.toHaveBeenCalled();
    });

    it(`${mode}: migrateLegacyActiveCounts is skipped (server-owned migration)`, async () => {
      h.getDoc.mockResolvedValue(snapOf({ financialMode: mode }));

      await RegistryService.migrateLegacyActiveCounts('u1');

      expect(h.runTransaction).not.toHaveBeenCalled();
    });
  }

  it('LEGACY: deleteProtocol still uses its original direct transaction', async () => {
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'LEGACY' }));

    await RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01');

    expect(h.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('missing profile is treated as LEGACY (same default as the rules)', async () => {
    h.getDoc.mockResolvedValue(snapOf(undefined));

    await RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01');

    expect(h.runTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('historical-update + tracker-delete trusted routing (W1B-2 / W1B-4a)', () => {
  it('OPTION_B: updateHistoricalDay routes HISTORICAL_DAY_UPDATE with a stable per-edit op id', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.updateHistoricalDay('u1', '2026-10-01', { cig: 2 });

    expect(h.runTransaction).not.toHaveBeenCalled();
    expect(TrustedFinancial.execute).toHaveBeenCalledTimes(1);
    const [type, payload] = TrustedFinancial.execute.mock.calls[0];
    expect(type).toBe('HISTORICAL_DAY_UPDATE');
    expect(payload.date).toBe('2026-10-01');
    expect(payload.counts).toEqual({ cig: 2 });
    expect(payload.operationId).toMatch(/^hist_2026-10-01_[0-9a-f]+$/);
  });

  it('OPTION_B: the historical-edit operation id is stable across identical retries', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.updateHistoricalDay('u1', '2026-10-01', { cig: 2 });
    await RegistryService.updateHistoricalDay('u1', '2026-10-01', { cig: 2 });

    const ids = TrustedFinancial.execute.mock.calls.map((c) => c[1].operationId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('LEGACY: updateHistoricalDay keeps its direct transaction', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'LEGACY' }));

    await RegistryService.updateHistoricalDay('u1', '2026-10-01', { cig: 2 });

    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
    expect(h.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('OPTION_B: deleteProtocol routes TRACKER_DELETE', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01');

    expect(h.runTransaction).not.toHaveBeenCalled();
    expect(TrustedFinancial.execute).toHaveBeenCalledWith('TRACKER_DELETE', {
      operationId: 'del_cig0_2026-10-01', date: '2026-10-01', trackerId: 'cig0',
    });
  });

  it('OPTION_B: deleteProtocol idempotent retries reuse the operation id', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'OPTION_B' }));
    TrustedFinancial.execute.mockResolvedValue({ applied: true });

    await RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01');
    await RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01');

    const ids = TrustedFinancial.execute.mock.calls.map((c) => c[1].operationId);
    expect(ids).toEqual(['del_cig0_2026-10-01', 'del_cig0_2026-10-01']);
  });

  it('MIGRATING: deleteProtocol still fails closed (no callable, no direct write)', async () => {
    TrustedFinancial.isEnabled.mockReturnValue(true);
    h.getDoc.mockResolvedValue(snapOf({ financialMode: 'MIGRATING' }));

    await expect(RegistryService.deleteProtocol('u1', 'cig0', '2026-10-01'))
      .rejects.toThrow('TRACKER_DELETE_UNSUPPORTED');
    expect(TrustedFinancial.execute).not.toHaveBeenCalled();
    expect(h.runTransaction).not.toHaveBeenCalled();
  });
});
