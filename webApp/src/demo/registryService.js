// Demo stub for the screenshot build. Subscriptions are inert; every mutation
// resolves to a no-op so the app never touches Firestore while capturing.
const asyncNoop = () => Promise.resolve();
const unsubscribe = () => () => {};

export const RegistryService = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'subscribeToConfigs' || prop === 'subscribeToLogs') return unsubscribe;
    return asyncNoop;
  },
});
