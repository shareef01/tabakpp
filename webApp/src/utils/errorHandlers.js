/**
 * TABAK++ Error Management
 */

/**
 * Map Firebase Auth errors to generic, non-enumerating copy.
 * @param {unknown} err
 * @param {'login'|'register'|'reset'|'delete'} [context='login']
 */
export const mapAuthError = (err, context = 'login') => {
  const code = err?.code || '';
  if (context === 'reset') {
    return 'If an account exists for that email, a reset link was sent.';
  }
  if (context === 'delete') {
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Deletion cancelled.';
    }
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return 'Incorrect password or Google confirmation failed.';
    }
    if (code === 'auth/requires-recent-login') {
      return 'Please sign in again, then retry deletion.';
    }
    return 'Could not delete account. Try again.';
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-email'
  ) {
    return 'Invalid email or password.';
  }
  if (code === 'auth/weak-password') {
    return 'Use a password with at least 12 characters.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Try again later.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error. Check your connection.';
  }
  return context === 'register' ? 'Could not create account.' : 'Sign-in failed. Try again.';
};

/**
 * Map Firestore / registry write failures to short UI copy.
 * @param {unknown} err
 * @param {string} [fallback='Could not save. Try again.']
 */
export const mapFirestoreError = (err, fallback = 'Could not save. Try again.') => {
  const code = err?.code || '';
  const msg = err?.message || '';
  if (code === 'permission-denied' || msg.includes('PERMISSION_DENIED')) {
    return 'Save blocked by security rules. Refresh and try again.';
  }
  if (msg === 'USER_NOT_FOUND') {
    return 'Profile not ready yet. Refresh and try again.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'Network error. Check your connection.';
  }
  if (msg === 'NOTHING_TO_ARCHIVE') return 'Nothing to archive yet.';
  return fallback;
};
