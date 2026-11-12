# 09 — Privacy, accessibility, reliability

## Privacy (for legal review; nothing here is a legal conclusion)

| Topic | Observation | Evidence |
|---|---|---|
| Data collected | Tobacco and cannabis-type consumption counts per date, prices, targets and baselines, display name, optional avatar image, email/Google identity in Firebase Auth | rules allowlists; `PRIVACY.md` |
| Sensitivity | Consumption history (including the `JOINT_KING` tracker type) may be **health-related** data and could fall under GDPR Art. 9 special-category data. **Flagged for legal review.** | `firestore.rules:529` |
| Minimisation | No analytics, crash-reporting or ad SDKs were found in either client | manifests, `package.json`, `libs.versions.toml` |
| Third parties | Web loads Inter from Google Fonts (disclosed in `PRIVACY.md:16–20`) and Google sign-in. Android makes neither font request | `webApp/index.html:34–36` |
| Retention after deletion | A `users/{uid}` document `{deleting:true}` is kept permanently. It's disclosed in `PRIVACY.md:32`, and a client can't remove it (PROBE-4) | `registryService.js:1316–1318` |
| Erasure completeness | The client wipe covers every client-visible subcollection (`USER_SUBCOLLECTIONS`, guarded by `AccountWipeCoverageTest`). The `trusted*` collections only exist for Option B, where `deleteAccountData` wipes the tree | `registryService.js:1461` |
| Export | A full paginated JSON export on both platforms (portability) | `readCompleteExportSnapshot` |
| Device storage | Android excludes all backup and transfer domains. Web stores the accent colour and auth flags only, and Firestore uses the memory cache | — |
| Logging | `console.warn` / `console.error` with error objects. No counts, tokens or emails are logged deliberately | grep of `console.` |
| Hosting region | Functions are configured for `europe-west1` (undeployed). The **Firestore database location wasn't verified**, because it isn't in the repo | — |

**Recommended review:**

1. The Art. 9 question (explicit consent wording at sign-up).
2. Whether a uid-keyed tombstone kept indefinitely needs a retention period.
3. The Google Fonts disclosure versus self-hosting the font (there's EU case law on dynamic Google Fonts embedding; ask counsel). Self-hosting Inter would remove the third-party request and simplify the CSP.

## Accessibility

- **Measured:** `npm run test:a11y` reported 0 axe-core violations across all views and viewports, all 10 accent swatches passed contrast, and the 200% zoom reflow check passed.
- **By source:**
  - Dialogs use `useDialogA11y` (focus trap and restore, with tests).
  - Inline save errors have `role="alert"` (fixed in the prior audit).
  - A reduced-motion policy exists on both platforms.
- **Not verified:** TalkBack on a device, manual screen-reader passes, and touch-target sizes on Android. Automated axe can't cover these.

## Reliability

| Area | Status |
|---|---|
| Offline | Writes are refused up front with a clear message, and the PWA shell opens offline (PWA regression: 27 scenarios passed) |
| Interrupted writes | Transactions are all-or-nothing. A failed tap restores the count and says so |
| Partial initialization | Profile-bootstrap errors are surfaced, there's a sync-failed state with Retry, and taps are blocked until `dayStartHour` is known |
| Account deletion interrupted | Retryable. The tombstone fence keeps the deletes authorized, and an Auth-delete failure signs the user out with clear copy |
| Session expiry | The Firebase SDK refreshes tokens. A permission-denied error maps to readable copy |
| Closed-day logging | TABAK-001 |
| Migration lease | All writes blocked for ≤ 120 s, one-time for unmigrated legacy accounts (design limitation) |
