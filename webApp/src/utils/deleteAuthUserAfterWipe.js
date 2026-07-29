import { deleteUser, signOut } from 'firebase/auth';

export const DELETE_INCOMPLETE_MESSAGE =
  'Your data was erased but login removal failed. Sign in again and retry Delete Account.';

/**
 * After Firestore wipe, remove the Auth user with retries.
 * On persistent failure, sign out so an empty shell is not left signed-in.
 * @returns {Promise<'deleted'|'auth_remained'>}
 */
export async function deleteAuthUserAfterWipe(authInstance, currentUser) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const user = currentUser || authInstance.currentUser;
      if (!user) return 'deleted';
      await deleteUser(user);
      return 'deleted';
    } catch (authErr) {
      lastErr = authErr;
      if (authErr?.code === 'auth/requires-recent-login') break;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  try {
    await signOut(authInstance);
  } catch {
    /* ignore */
  }
  const err = lastErr || new Error('Auth delete failed');
  err.code = err.code || 'auth/data-wiped-auth-remained';
  err.message = `DATA_WIPED_AUTH_REMAINED: ${err.message || 'Auth delete failed'}`;
  throw err;
}
