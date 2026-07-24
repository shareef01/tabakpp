// Demo stub for the screenshot build only. No real Firebase is initialized;
// the screenshot harness renders the app with seeded data (see demo/useRegistry).
export const auth = {
  currentUser: { uid: 'demo' },
  signOut: () => Promise.resolve(),
};
export const db = {};
export const storage = {};
export const firebaseConfigError = null;
export default { auth, db, storage };
