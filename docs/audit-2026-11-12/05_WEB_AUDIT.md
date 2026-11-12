# 05 — React web application

## Inspected

`App.jsx`, `hooks/useRegistry.js` (listener lifecycle, optimistic overlay, mutation guards), `context/AuthContext.jsx`, `services/registryService.js` (complete), `utils/smokingCalculator.js` (date/credit functions), `utils/errorHandlers.js`, `utils/security.js` (lazy HEIC), `utils/deleteAuthUserAfterWipe.js`, the build output and `vite.config.js`. The components were spot-checked for copy and error handling.

## Findings

### TABAK-001 — "Close day" promises continued logging, but trackers not used that day are then rejected

- **Severity:** Low. **Classification:** confirmed functional bug (misleading UI at the decision point) over a documented design limitation. **Confidence:** confirmed by source, plus an existing emulator test of the same code path.
- **Affected:**
  - Web: `webApp/src/App.jsx:617` (dialog copy), `services/registryService.js:788–794` and `:274` (`DAY_CLOSED_NO_SNAPSHOT`).
  - Android: `composeApp/.../screens/TrackScreen.kt:217` (copy), `shared/.../FirebaseRegistryRepository.kt:229`.
  - Rules: `firestore.rules:602` (frozen snapshots on closed days).
- **Reproduction** (both platforms):
  1. Have two trackers, A and B.
  2. Tap A once.
  3. Tap "Close day" and confirm. The dialog says "You can continue logging anytime today" (web) or "You can keep logging today" (Android).
  4. Tap B, which is still shown as a normal, tappable card for today.

  The tap is refused with "This day is closed and this tracker was not used on it. Add it with a manual entry in History." Taps on A still work. The emulator test `registryService.emulator.test.js:231–239` pins the refusal through the same `Object.hasOwn(snapshots, counterId)` check; there it uses a tracker created after the close.
- **Expected:** Either logging works for every tracker on the day, as the copy says, or the copy states the limitation.
- **Root cause:** A late write may only move trackers that already have a stamp, because the rules freeze `trackerSnapshots` once `status == 'closed'`.
- **Impact:**
  - A core action fails right after the app assured the user it wouldn't.
  - The user has to switch to a manual entry. With Option A, that entry credits a second target allowance for the date (a known limitation), so the workaround also distorts money.
  - The same failure appears without user action when another device whose clock or time zone is ahead reconciles the date.
- **Recommended fix:**
  1. Minimal: change both dialog strings to "Trackers you've already logged today can still be adjusted. Others will need a manual entry in History." (same text on both platforms).
  2. Product option (needs a decision): allow an **additive-only** snapshot stamp on a closed day. In rules, `before.status == 'closed'` would accept a `trackerSnapshots` diff whose `addedKeys()` is exactly `[updatedTrackerId]`, with an empty `changedKeys()`/`removedKeys()`. Existing stamps stay frozen. Then extend `applyLateCounterWrite` on both platforms to stamp from the live config.
- **Regression test:**
  - For option 1, a copy assertion in an existing `App`/`TrackScreen` test.
  - For option 2, a rules test (adding a new key is allowed; changing an existing key is denied) and an emulator test that inverts `:231–239` (the closed day accepts the first tap of a new tracker and lifetime moves by the credit delta).

## No significant findings (with what was checked)

- **Listener lifecycle.** All five profile-scope listeners are unsubscribed in the effect cleanup (`useRegistry.js:337–343`). The day listener is torn down whenever `today` changes (`:505`). The ledger listener is gated on the resolved mode, and LEGACY never subscribes. Online/offline listeners are removed. I found no leak.
- **Account switching.** All state is cleared before new listeners attach, and pending ops are reset (`:211–229`).
- **Stale closures.** Mutation callbacks read `profileSettingsRef`, `todayRef`, `isOnlineRef`, `activeCountsRef` and `latestServerCountsRef`. The tracking date is re-derived at tap time, so a throttled background tab can't mis-date a write.
- **UI vs committed state.**
  - The overlay is `server + Σ unacknowledged deltas`. A failed write removes its op and restores the count, with the message "Your count was restored." (`:682–687`).
  - A success is shown only after the transaction resolves.
  - Duplicate submissions: each tap is a separate op and a separate transaction, so double taps count twice by design.
- **Error boundaries and loading.** There's a sync-failure state with retry (`listenerEpoch`). Taps are blocked until `dayStartHour` is known (`guardDayStartKnown`).
- **Browser storage.** `sessionStorage` holds only the auth intent and pending-delete flags. `localStorage` holds the accent colour.
- **Bundle.** `heic2any` (1.35 MB raw / 341 KB gzip) is lazy-loaded and excluded from the precache (`vite.config.js:43`). The build's "> 500 kB" warning refers to that lazy chunk. Firebase is 592 KB raw / 175 KB gzip.
- **TypeScript.** Not recommended as a migration. The defects found in this audit sit at the domain and rules boundary, not in type confusion. A cheap win with demonstrated value would be JSDoc `@typedef`s for `DayDocument`/`TrackerSnapshot` checked by `tsc --checkJs` on `services/` and `utils/` only.
