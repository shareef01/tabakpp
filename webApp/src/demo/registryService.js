// Demo stub for the screenshot build. Subscriptions are inert; every mutation
// resolves to a no-op so the app never touches Firestore while capturing.
const asyncNoop = () => Promise.resolve();
const unsubscribe = () => () => {};
const SUBSCRIBERS = new Set([
  'subscribeToConfigs', 'subscribeToLogs', 'subscribeToDay', 'subscribeToDays', 'subscribeToProfileExtra',
]);

export const RegistryService = new Proxy({}, {
  get(_target, prop) {
    if (SUBSCRIBERS.has(prop)) return unsubscribe;
    // Shaped like the real return value so a demo click on "Load older
    // entries" (HistoryScreen calls this directly, not through a prop)
    // destructures cleanly instead of throwing on `undefined`.
    if (prop === 'fetchOlderLogs') return () => Promise.resolve({ items: [], hasMore: false, nextCursor: null });
    return asyncNoop;
  },
});
