# TABAKPP — Baseline

## Stack
React + Vite PWA (`webApp/`) · Kotlin Multiplatform (`shared/`) · Jetpack Compose
(`composeApp/`) · Firebase Auth/Firestore/Functions + Security Rules · Emulator Suite.

## Financial architecture (do not redesign)
- Modes `LEGACY → MIGRATING → OPTION_B` (one-way, server-owned `financialMode`).
- Canonical daily ledger `users/{uid}/dailyFinancials/{date}`; receipts
  `users/{uid}/financialOperations/{operationId}`; trusted callable
  `executeFinancialOperation`; admin `migrateAccount` (dry-run default).
- Source: `users/{uid}/days/{date}` (counters) + `users/{uid}/logs/{logId}` (manual/archive).
- In MIGRATING/OPTION_B direct client financial writes are denied (`financialLocked`);
  the Admin SDK bypasses rules, so the *financial* boundary is the function.

## Feature inventory
Auth + account lifecycle · tracker config (`configs`) · daily counters · manual logs ·
day close/rollover · history + filtering · dashboard metrics · insights · export ·
settings/persistence · PWA install/recovery · Android navigation/lifecycle · cross-device
sync · financial mode transitions · canonical ledger + lifetime accounting.

## Environment
- Emulator project used for device tests: `tabakpp-ff036` (debug `google-services.json`).
  **Not** a `demo-` project — isolation comes from `useEmulator()`/`setSettings(host:)`
  plus `adb reverse 8080/9099/5001`, not from the project id.
- AVD `deutsch5` (x86_64, port 5556); airplane mode + `pm disable-user com.android.vending`
  required or boot stalls.
- Web rules tests run their own emulator (project `demo-takabpp-test`).

## Known platform difference
`functions/emulator.integration.mjs` hardcodes `demo-takabpp-test`; the Android emulator runs
as `tabakpp-ff036`, so the two cannot share one running emulator instance simultaneously.

## Unverified assumptions
- That the Android write payload is shape-identical to the Web fixtures (unproven).
- That GitLive merge semantics reproduce the JS `writeBatch` fixtures (unproven).

## UI/UX baseline (Phase 3, started)

### Screen inventory (from source — not a visual pass)
- Web (`webApp/src/components/`): `auth/AuthScreen`, `dashboard/{DashboardSkeleton,
  GettingStartedCard, MetricBanner, TrackerCard}`, `gauges/Gauges`,
  `history/{HistoryScreen, InsightsScreen}`, `layout/{BottomNav, TopBanner}`,
  `modals/{ConfirmModal, EditOverlay, ManualEntryOverlay, Modals, ProtocolFormOverlay}`,
  `settings/SettingsScreen`, `feedback/UndoToast`, `Common`.
- Android (`composeApp/.../screens/`): `AuthScreen`, `TrackScreen`, `HistoryScreen`,
  `InsightScreen`, `SettingsScreen`.

### Visual-capture status
- **Web screenshots: BLOCKED** — no Chrome/Edge/Chromium installed and `puppeteer-core`
  bundles no browser, so no browser can be launched to render the PWA.
- **Android screenshot: CAPTURED** — `docs/release-hardening/screenshots/android-auth-screen.png`
  (AVD `deutsch5`, `com.tabakpp.app/.MainActivity`, 320×480, airplane mode). **Not yet
  verified by a human/model**: this environment has no image-understanding model configured,
  so the capture is retained as evidence but its content has not been inspected.
- Render-level evidence that *does* exist: jsdom render tests (`HistoryScreen.render.test.jsx`,
  `MetricBanner.test.jsx`, `AuthScreen.test.jsx`, `TrackerCard.test.jsx`,
  `GettingStartedCard.test.jsx`, `ProtocolFormOverlay.test.jsx`) — part of the 445 vitest
  tests. These assert React rendering, not visual layout.

### Known defect-capture gaps (to verify visually once tooling exists)
- Overflow/clipping, keyboard obstruction, focus order, touch targets, contrast, empty /
  loading / error states, and responsive widths are **not** yet verified on either platform.
- No visual regression baseline exists yet (no before/after pair possible until the first
  verified capture).

### Next to unblock
- Install a Chromium binary (or use a machine with one) so `puppeteer-core` can render the
  Web PWA at desktop + mobile widths; and/or enable an image-understanding model to inspect
  the captured screenshots.

## Phase 4 baseline (performance + security, started)

### Web production bundle (fresh `npm run build`)
- Code-split lazy chunks observed: `SettingsScreen`, `HistoryScreen`, `AuthScreen`,
  `TrackerCard` (good). Total app JS is split across `index`, `react`, `vendor`, `recharts`,
  `firebase`, `framer`.
- Largest chunk: `heic2any-*.js` **1.35 MB minified (341 kB gzip)** — a lazy-loaded
  HEIC→JPEG library used only for avatar conversion; flagged by Vite (>500 kB). Next-largest:
  `firebase` 418 kB, `recharts` 306 kB, `vendor` 283 kB.

### Security scan
- **Hardcoded secrets: none.** `rg` over source (excl. `node_modules`/`dist`/`google-services.json`
  /`artifacts_*`) found no `AIza…` keys, no private keys; the only `apiKey` hit is
  `webApp/src/firebase.js` reading `import.meta.env.VITE_FIREBASE_API_KEY` (env-provided),
  and a `SECURITY.md` note that Firebase config is not secret.
- **Web production dependencies: 0 vulnerabilities** (`npm audit --omit=dev`: 0 low/moderate/high/critical).
- **Web devDependencies: 19 high / 1 critical / 14 moderate** — build/test toolchain only
  (`firebase-tools`, `vite`, `chokidar`, `braces`, `grpc-js`, `proxy-addr` — critical), not shipped.
- **Functions production deps: 8 moderate, 0 high/critical** — Google Cloud SDK transitives
  (`uuid`, `gaxios`, `google-gax`, `retry-request`, `teeny-request`, `@google-cloud/*`).

### Not yet measured
- Firestore listener duplication, React rerenders, query amplification, Android
  startup/recomposition — deferred (needs runtime profiling; not done).
