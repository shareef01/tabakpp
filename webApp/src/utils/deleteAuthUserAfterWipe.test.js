import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteAuthUserAfterWipe, DELETE_INCOMPLETE_MESSAGE } from './deleteAuthUserAfterWipe.js';

vi.mock('firebase/auth', () => ({
  deleteUser: vi.fn(),
  signOut: vi.fn(),
}));

import { deleteUser, signOut } from 'firebase/auth';

describe('deleteAuthUserAfterWipe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deleted when Auth delete succeeds', async () => {
    deleteUser.mockResolvedValue(undefined);
    const auth = { currentUser: { uid: 'u1' } };
    await expect(deleteAuthUserAfterWipe(auth)).resolves.toBe('deleted');
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('retries then signs out and throws DATA_WIPED_AUTH_REMAINED', async () => {
    deleteUser.mockRejectedValue({ code: 'auth/network-request-failed', message: 'net' });
    signOut.mockResolvedValue(undefined);
    const auth = { currentUser: { uid: 'u1' } };
    await expect(deleteAuthUserAfterWipe(auth)).rejects.toMatchObject({
      message: expect.stringContaining('DATA_WIPED_AUTH_REMAINED'),
    });
    expect(deleteUser).toHaveBeenCalledTimes(3);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(DELETE_INCOMPLETE_MESSAGE).toMatch(/data was erased/i);
  });

  it('does not retry requires-recent-login', async () => {
    deleteUser.mockRejectedValue({ code: 'auth/requires-recent-login', message: 'recent' });
    signOut.mockResolvedValue(undefined);
    const auth = { currentUser: { uid: 'u1' } };
    await expect(deleteAuthUserAfterWipe(auth)).rejects.toMatchObject({
      code: 'auth/requires-recent-login',
    });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
