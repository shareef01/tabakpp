/**
 * URL-addressable tab routing (item 8) — a small, dependency-free mapping
 * between the app's three primary tabs and real, bookmarkable paths.
 *
 * A lightweight `history.pushState`/`popstate` approach was chosen over
 * pulling in a routing library: the app has exactly three top-level
 * destinations and no nested/dynamic routes, so a full router would add
 * bundle weight and abstraction for no behavioral gain. Firebase Hosting's
 * existing SPA rewrite (`"source": "**" -> "/index.html"`, see
 * webApp/firebase.json) already serves index.html for any path, so direct
 * navigation and refresh on `/history` or `/settings` require no hosting
 * config change — only client-side state needs to read the URL.
 */
export const TAB_PATHS = { track: '/track', history: '/history', settings: '/settings' };

export const pathForTab = (tab) => TAB_PATHS[tab] || TAB_PATHS.track;

/** Unrecognized or root paths fall back to `track` rather than a 404 — this is a single-page app with three known destinations. */
export const tabForPath = (pathname) => {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === TAB_PATHS.history) return 'history';
  if (path === TAB_PATHS.settings) return 'settings';
  return 'track';
};
