/**
 * The callable must be addressed in the region it is deployed to
 * (functions/index.js → setGlobalOptions). The SDK default is us-central1,
 * where `executeFinancialOperation` does not exist, and the emulator tests
 * cannot catch the mismatch because they hardcode the region in their URL.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn(async () => ({ data: { applied: true } }))),
}));

vi.mock('../firebase', () => ({ db: { app: { name: 'test-app' } } }));
vi.mock('firebase/functions', () => ({
  getFunctions: h.getFunctions,
  httpsCallable: h.httpsCallable,
  connectFunctionsEmulator: vi.fn(),
}));

import { FUNCTIONS_REGION, TrustedFinancial } from './trustedFinancial';

describe('TrustedFinancial', () => {
  it('calls the callable in the region the function is deployed to', async () => {
    const res = await TrustedFinancial.execute('DAY_CLOSE', { operationId: 'close_2026-10-01', date: '2026-10-01' });

    expect(FUNCTIONS_REGION).toBe('europe-west1');
    expect(h.getFunctions).toHaveBeenCalledWith({ name: 'test-app' }, 'europe-west1');
    expect(h.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'executeFinancialOperation');
    expect(res).toEqual({ applied: true });
  });
});
