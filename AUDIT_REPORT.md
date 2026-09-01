# tabak++ Production Audit

Audit date: 1 September 2026 · Baseline commit: `3829789`

## Executive summary

**Verdict: RELEASE READY.**

> Verification status was upgraded after the fact. The Android/KMP and Firestore
> checks below could not run on the audit machine; they were executed on CI in
> [PR #4](https://github.com/shareef01/tabakpp/pull/4)
> (run [33457292404](https://github.com/shareef01/tabakpp/actions/runs/33457292404))
> and **all passed**. The environment constraint is documented below because it
> will recur locally, but it no longer gates the verdict.

The core product is in good shape. The Track screen — the app's primary surface —
audited clean at every viewport tested, the domain math is a careful 1:1 port
between Kotlin and JS, Firestore rules are a real security boundary with schema
validation and a settings/mutation write-path split, and the mutation paths use
transactions with stamped `aggregateCredit` so lifetime totals cannot drift from
the logs that produced them.

Biggest risks found and fixed:

1. **The committed root `firebase.json` shipped hosting with no security headers.**
   The recent "add Hosting configuration" commit created a second hosting config
   at the repo root without CSP, HSTS, `X-Frame-Options`, `nosniff`,
   `Referrer-Policy`, or `Permissions-Policy`. Deploying from the repo root —
   which is where `.firebaserc` lives — would have silently dropped every one of
   them.
2. **The History trend chart erased the current day as soon as it was archived.**
   "End tracking day" moves counts into a `${date}_DAY` archive and clears
   `activeCounts`; the chart read only the live session, so a completed day
   dropped to zero on the graph while the archive sat visible in the session log
   directly below it.
3. **The user-facing privacy page was stale** relative to `PRIVACY.md`, missing
   the App Check and partial-deletion disclosures, and rendered an internal
   pre-launch TODO to end users.

No release blockers remain. The open items are P2/P3 polish and two shared-schema
gaps, all listed under Remaining findings.

## Local environment cannot run Android or the Firestore emulator

Every JVM process on this machine fails identically:

```
java.io.IOException: Unable to establish loopback connection
  at sun.nio.ch.PipeImpl$Initializer.run
Caused by: java.net.SocketException: Invalid argument: connect
  at sun.nio.ch.UnixDomainSockets.connect0
```

This reproduces with a three-line program calling `Selector.open()`, so it is an
environment restriction on `AF_UNIX` socket pairs, not a project defect. It
blocks both Gradle (which forks a daemon) and the Firestore emulator (Netty), so
`:shared:testDebugUnitTest`, `:composeApp:testDebugUnitTest`,
`:androidApp:lintDebug`, `:androidApp:assembleDebug`, `:androidApp:assembleRelease`
and `npm run test:rules` cannot be run locally. **All six were executed on CI and
passed** — see the verification table.

For that reason **all code changes in this pass are confined to the web client
and to configuration/docs**, so that everything changed was covered by checks
that could be run locally before pushing. Android findings below are reported,
not patched.

## Architecture reviewed

| Area | Files |
|---|---|
| Web shell / routing / error boundary | `webApp/src/App.jsx`, `main.jsx`, `index.html` |
| Auth | `context/AuthContext.jsx`, `components/auth/AuthScreen.jsx`, `utils/deleteAuthUserAfterWipe.js`, `utils/errorHandlers.js`, `utils/platform.js` |
| Data layer | `services/registryService.js`, `hooks/useRegistry.js`, `firebase.js` |
| Domain math | `utils/smokingCalculator.js` ↔ `shared/.../domain/SmokingCalculator.kt`, `RegistryMutations.kt` |
| Screens | Track (`App.jsx` + `TrackerCard`, `MetricBanner`), `history/HistoryScreen.jsx`, `settings/SettingsScreen.jsx` |
| Modals / a11y | `hooks/useDialogA11y.js`, `ConfirmModal`, `Modals`, `EditOverlay`, `ManualEntryOverlay`, `ProtocolFormOverlay`, `UndoToast` |
| Security | `firestore.rules`, `firebase.json`, `webApp/firebase.json`, `utils/security.js`, `shared/.../InputSanitizer.kt` |
| Android/KMP (read-only) | `FirebaseRegistryRepository.kt`, `RegistryViewModel.kt`, `AuthErrorMapper.kt`, `composeApp/.../SettingsScreen.kt`, `HistoryScreen.kt`, `HistoryChart.kt`, `AndroidManifest.xml` |
| Build / CI / PWA | `vite.config.js`, `.github/workflows/*`, `public/manifest.json`, `scripts/screenshot.mjs` |

## Verification performed

| Check | Result |
|---|---|
| `npm ci` | **PASS** |
| `npm run lint` | **PASS** (0 problems) |
| `npm run audit:prod` | **PASS** (0 vulnerabilities) |
| `npm run test:run` | **PASS** — 13 files, 117 tests (was 12 / 106) |
| `npm run coverage` | **PASS** (no thresholds configured) |
| `npm run build` | **PASS** — 30 precache entries, 1713 KiB |
| `npm run build:demo` | **PASS** |
| Responsive / a11y sweep, 4 screens × 16 viewports (Chromium) | **PASS** after fixes — 64/64 combos clean |
| `:shared:testDebugUnitTest` | **PASS** — CI only (`mobile` job, 7m3s) |
| `:composeApp:testDebugUnitTest` | **PASS** — CI only |
| `:androidApp:lintDebug` / `assembleDebug` / `assembleRelease` | **PASS** — CI only |
| `npm run test:rules` (Firestore emulator) | **PASS** — CI only; 2 files, 27 tests (13 rules + 14 emulator-backed service) |

CI evidence: run
[33457292404](https://github.com/shareef01/tabakpp/actions/runs/33457292404) on
`audit/production-hardening` — `web-and-rules` green in 59s, `mobile` green in
7m3s. Task-level logs confirm each Gradle task actually executed rather than
being skipped or up-to-date.

Coverage note: reported statement coverage moved 72.79% → 66.13%. Absolute
covered lines went **up** (709 → 754). The percentage fell because the new
`HistoryScreen.test.js` pulls the 545-line `HistoryScreen.jsx` (and transitively
`UndoToast`, `ConfirmModal`) into the denominator for the first time. No
previously-covered code lost coverage.

The responsive sweep drove a headless Chromium over the demo build at 320×568,
360×640, 375×667, 390×844, 393×852, 412×915, 430×932, 768×1024, 820×1180,
1024×768, 1280×720, 1366×768, 1440×900, 1920×1080 plus a short (390×500) and a
tall (1280×1600) window, checking page-level horizontal overflow, touch-target
size, accessible names, and computed WCAG contrast. Final state: **0 overflow,
0 sub-44px targets, 0 unnamed controls, 0 contrast failures, 0 console errors.**

## Fixed

### P0/P1 — Hosting deployed without security headers
- **Problem:** `firebase.json` (root) defined `hosting` with `public: webApp/dist`
  and no `headers` block. `webApp/firebase.json` had the full header set. The
  root config wins for `firebase deploy` run from the repo root, where
  `.firebaserc` lives.
- **Root cause:** commit `c235739` added a second hosting config without porting
  the headers. The deploy cache (`.firebase/hosting.ZGlzdA.cache`, base64 `dist`)
  shows the last real deploy used the `webApp/` config, so the regression was
  latent, not yet shipped.
- **Files:** `firebase.json`
- **Solution:** ported CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, no-store on HTML, and immutable
  caching on `/assets/**` into the root config verbatim.
- **Follow-up:** `webApp/firebase.json` is now a redundant duplicate and a drift
  trap. It was **not** deleted (it is the maintainer's file and was the config
  actually used for past deploys) — see Remaining findings.

### P1 — History chart lost the day as soon as it was archived
- **Problem:** the "Today"/NOW point used `m.count` (live session only). Ending
  the day clears `activeCounts` into a `${date}_DAY` archive, so the chart's last
  point collapsed to 0 while the session log below showed the archived entry.
- **Root cause:** every historical point read `aggregateLoggedCounts(logs)`; the
  final point alone read live state, so archive and manual entries dated today
  were never counted.
- **Files:** `webApp/src/components/history/HistoryScreen.jsx`
- **Solution:** extracted `buildVelocitySeries(logs, today, days, activeCounts)`;
  today's value is now `sumCounts(logged[today]) + sumCounts(activeCounts)`. The
  two are disjoint (end-day clears `activeCounts` as it writes the archive), so
  this is the same merge `calculateStreak` already uses. Android was already
  correct here — `HistoryChart.kt` appends NOW to `aggregateDailyChartTotals`,
  which includes today's archive — so this closes a parity gap.
- **Regression test:** `HistoryScreen.test.js`, 8 cases including
  "keeps today visible after the day is archived", archive + post-archive
  session, archive + same-day manual entry, and month-boundary windows.

### P1 — In-app privacy notice stale and leaking an internal TODO
- **Problem:** `webApp/public/privacy.html` (linked from Settings → Danger zone)
  was dated 24 July 2026 vs `PRIVACY.md` at 15 August 2026, omitted the App Check
  non-enforcement disclosure and the partial-deletion-failure disclosure, and
  displayed to users: *"Before public distribution, the app operator must add a
  current privacy contact and publish store-specific disclosures."*
- **Files:** `webApp/public/privacy.html`
- **Solution:** brought in line with `PRIVACY.md`, added the Google sign-in
  mention, replaced the operator TODO with the real Contact section, and added a
  comment tying the two documents together.

### P2 — Accent palette diverged from Android; default accent unreachable
- **Problem:** web offered 6 accents, Android 10, with only 3 shared. The
  shipped default `#FF5F5F` (`UserProfile.accent`) was **not in the web list**,
  so a new account showed "Custom" with nothing selected and could never return
  to the default from the web; accents chosen on the phone showed as unselected.
- **Files:** `webApp/src/constants/ui.js`
- **Solution:** adopted Android's ten swatches. Verified every one clears WCAG AA
  in both usages — as accent text on the card surface and as black text on an
  accent fill — worst case `#EC4899` at 5.54:1 / 5.95:1.

### P2 — `€Infinity` in the unit-cost preview
- **Problem:** `packPrice / (packQty || 1)` — `packQty` is a string from the
  input, so `"0"` is truthy and the preview divided by zero, rendering
  `€Infinity`. The saved value was correct; only the preview broke. Android
  clamps with `coerceAtLeast(1)` and was unaffected.
- **Files:** `webApp/src/components/settings/SettingsScreen.jsx`
- **Solution:** parse and clamp the divisor to ≥ 1, matching `handleSaveEco` and
  Android.

### P2 — Accessibility: contrast and touch targets
Measured, not guessed — all figures from the Chromium sweep.
- `text-neutral-500` (#737373) rendered at **3.97–4.37:1** on the card surfaces,
  below the 4.5:1 AA threshold, across ~30 call sites (settings helper text, the
  account email, density labels, history period chips, stat-tile hints, empty
  states). Moved to `text-neutral-400` (already the dominant muted tone in the
  same components, ~7:1) — a token correction, not a restyle.
- `text-neutral-600` icon buttons (reorder, delete, dismiss) sat at ~2.5:1,
  under the 3:1 required for interactive controls. Raised to `text-neutral-400`.
- Day-start range input had an **8px-tall** hit area. Now 44px, with the painted
  track held at 8px via `background-size`.
- Day-start preset chips (36px), History/Settings "Add" buttons (40px), and the
  privacy link (16.5px) raised to 44px.
- **Files:** `SettingsScreen.jsx`, `HistoryScreen.jsx`, `Common.jsx`,
  `AuthScreen.jsx`, `MetricBanner.jsx`, `UndoToast.jsx`, `TopBanner.jsx`,
  `Modals.jsx`, `EditOverlay.jsx`, `ManualEntryOverlay.jsx`,
  `ProtocolFormOverlay.jsx`, `App.jsx`

### P2 — Undo toast overlapped the bottom nav on desktop
- **Problem:** toast pinned at `5.75rem`; from `md` up the nav pill's top edge is
  at `6rem`, giving a measured 4px vertical overlap across 300px of width, with
  the toast (z-4000) painting over the nav (z-100).
- **Files:** `webApp/src/components/feedback/UndoToast.jsx`
- **Solution:** `md:bottom-[calc(7rem+env(safe-area-inset-bottom))]`.

### P2 — Bottom-nav active glow silently disabled
- **Problem:** `drop-shadow-[0_0_15px_var(--accent-rgb)]` — `--accent-rgb` is a
  bare `"255, 95, 95"` triple, so the filter was invalid CSS and the browser
  discarded it. The intended glow never rendered.
- **Files:** `webApp/src/components/layout/BottomNav.jsx`
- **Solution:** `rgba(var(--accent-rgb),0.55)`.

### P2 — 3-digit hex accents fell back to cyan
- **Problem:** `firestore.rules` accepts `#abc` as well as `#aabbcc`, but
  `hexToRgbValues` matched only the 6-digit form. A stored 3-digit accent left
  `--accent` on the user's color while `--accent-rgb` fell back to `0, 210, 255`,
  so accent fills and glows disagreed with accent text.
- **Files:** `webApp/src/utils/formatters.js`
- **Regression test:** `formatters.test.js` — 3-digit expansion, 6-digit, and
  genuine-garbage fallback.

### P2 — Copy and consistency
- Settings "Economic Constants" card restyled to the same header pattern
  (`p-6 md:p-8`, label + heading) as every other card; it was the only card at
  `p-8 md:p-12` with a bare label heading.
- **"Beutel Price"** (German) → "Pouch price". "Retail/Loose" → "Pack/Pouch",
  matching the persisted `purchaseType` values. "Units / Pack" / "Est. Yield" →
  "Units per pack" / "Units per pouch". "Synchronize Economics" → "Save
  economics". "Calibration synchronized." → "Unit price saved."
- Currency was rendered two different ways: `€8.00` in Settings vs `8,00 €`
  everywhere else. Settings now uses the shared `SmokingCalculator.formatCurrency`.
- Manual entry: "Deployment Timestamp" → "Date".
- Purchase-type toggle gained `role="radiogroup"` / `role="radio"` /
  `aria-checked` and focus rings, matching the accent and density groups.
- Edit and Manual Entry overlays: backdrop click no longer dismisses mid-save
  (`ConfirmModal` already guarded this).

### P2 — `firestore.rules` header contradicted the App Check decision
The file opened with *"enforce App Check on Firestore + Auth in Console … after
release clients send tokens"* while README, SETUP_GUIDE, and PRIVACY all document
enforcement as deliberately off. Replaced with an explicit **do not enable**
note explaining why (debug provider on release APKs), so a future pass does not
"harden" it and break every APK from GitHub Releases.

### P2 — Android accent palette highlighted the wrong default swatch
- **Problem:** `SettingsScreen.kt` fell back to `"#10B981"` when the profile had
  not loaded, while `UserProfile.accent` defaults to `"#FF5F5F"`, so the palette
  briefly checked a swatch the account was not using.
- **Files:** `composeApp/.../ui/screens/SettingsScreen.kt`
- **Solution:** fall back to `"#FF5F5F"`, matching the model.

### P2 — Android register error fell through on a server-side policy rejection
- **Problem:** `AuthErrorMapper`'s REGISTER branch matched only `"weak"`. Firebase
  reports a password-policy failure as `PASSWORD_DOES_NOT_MEET_REQUIREMENTS`,
  which matched nothing and fell through to "Could not create account."
- **Scope correction:** this is defensive, not user-facing today.
  `AuthViewModel.signUp` already rejects passwords under 12 characters before any
  network call and emits the right message, and the Console policy is a 12-char
  minimum — so the fallthrough is currently unreachable. It opens only if that
  policy is later tightened (for example with complexity rules).
- **Files:** `shared/.../data/AuthErrorMapper.kt`
- **Solution:** match the policy codes alongside `"weak"`.
- **Regression test:** `ErrorAndInputPolicyTest` — policy rejection maps to the
  requirement message and stays distinct from the generic failure; the legacy
  `auth/weak-password` code still maps too.

### P2 — Future-dated manual entries accepted on both clients
- **Problem:** neither client bounded the backfill date. `isValidDate` only checks
  that the calendar date exists, and `firestore.rules` can only match the
  `YYYY-MM-DD` pattern, so an entry dated 2099 was written.
- **Impact:** not just a nonsense row — `calculateStreak` bails early only when
  the most recent logged date is older than yesterday, and a future date is not,
  so a user with no recent activity read as **streak 1 instead of 0**.
- **Files:** `utils/smokingCalculator.js`, `services/registryService.js`,
  `hooks/useRegistry.js`, `utils/errorHandlers.js`,
  `components/modals/ManualEntryOverlay.jsx`, `App.jsx`,
  `shared/.../domain/SmokingCalculator.kt`, `shared/.../viewmodels/RegistryViewModel.kt`,
  `composeApp/.../ui/components/ManualEntryForm.kt`, `composeApp/.../ui/screens/HistoryScreen.kt`
- **Solution:** shared `isBackfillDateAllowed(dateStr, trackingDay)` on both
  sides, enforced at three layers — the date field (`max` on web, error text on
  Android), the submit gate, and the service/view-model write path. Editing an
  existing log is unaffected: `updateLog` keeps the original date and `logDate`
  is immutable in the rules.
- **Regression test:** date-bound vectors including month/year boundaries in both
  suites, plus a test that asserts the old streak-inflation behaviour to document
  why the bound exists.

### P3 — formatCurrency rounded differently on the two clients
- **Problem:** `kotlin.math.round` is `Math.rint` (ties-to-even) where the web's
  `Math.round` ties upward. On an exact half-cent — reachable from a unit price
  like 0.125 — the clients printed amounts a cent apart for identical stored data.
- **Files:** `shared/.../domain/SmokingCalculator.kt`
- **Solution:** `floor(x + 0.5)`, which is both JS-identical and the conventional
  currency rounding; the now-unused `kotlin.math.round` import was dropped.
- **Regression test:** shared half-cent vectors (`0.125` → `0,13 €`, `0.135` →
  `0,14 €`, `2.505` → `2,51 €`) asserted in both suites.

### P2 — Units-per-pack was not persisted on either client
- **Problem:** both clients hardcoded 20 units per pack and re-derived the shown
  pack price as `unitPrice * 20`, without ever storing the quantity. Entering
  `11.00 / 25` saved a correct `unitPrice` of 0.44 and then displayed **8.80** on
  the next load. The number moved under the user while every derived metric
  stayed right — the hardest version of this to notice or report.
- **Files:** `shared/.../data/Models.kt`, `shared/.../data/FirebaseRegistryRepository.kt`,
  `composeApp/.../ui/screens/SettingsScreen.kt`, `firestore.rules`,
  `services/registryService.js`, `hooks/useRegistry.js`, `App.jsx`,
  `components/settings/SettingsScreen.jsx`
- **Solution:** `UserProfile.unitsPerPack` (default 20, so legacy documents are
  unaffected), wired through the settings write path on both clients. A POUCH
  save deliberately leaves it alone on both sides, so switching purchase type
  does not discard the pack quantity. Rules bound it to a whole number in
  1..1000 — the lower bound matters because 0 divides by zero in the unit-cost
  derivation — and keep it on the settings side of the settings/mutation split.
- **Regression test:** 2 service cases (round-trip reloads as 11.00; a POUCH save
  preserves an existing quantity) and 4 adversarial rules cases — in-bounds
  accepted; zero, negative, fractional, oversized, string, null, cross-user, and
  mutation-path smuggling all rejected. Rules suite 27 → 31.

## Remaining findings

None are release blockers.

> **Correction (post-audit).** An earlier revision of this table claimed Android had
> no client-side password-length check and called it the highest-value follow-up.
> That was wrong: `AuthViewModel.signUp` enforces `MIN_PASSWORD_LENGTH = 12` and
> emits the correct message. The check lives in the view model, not in
> `AuthScreen`'s `canSubmit`, which is where the original pass stopped looking. The
> two Android items are now fixed and have moved to Fixed, below.

| Sev | Finding | Why not fixed | Next step |
|---|---|---|---|
| P2 | `webApp/firebase.json` now duplicates the root hosting config | It is the maintainer's file and was the config used for prior deploys; deleting it is their call | Delete it and always deploy from the repo root, or keep it and add a comment that root is authoritative |
| P3 | Tracker names truncate early in the Settings list ("Cigarettes" → "Cig…" at 1440px) while the row below has space | Cosmetic; the type badge and limit block are `shrink-0` | Allow the badge to wrap or drop it below the name at narrow column widths |
| P3 | `manifest.json` describes the app as a "High-Fidelity Health Optimization Tracker" | Marketing-ish and health-adjacent for a smoking counter; no functional impact | Consider "Smoking tracker with daily limits, history, and spend" |
| P3 | `hiddenLogIds` in `HistoryScreen` grows unbounded within a session | Only ever holds deleted ids; memory impact negligible | Prune on `logs` change if ever relevant |

## UI/UX findings

**Mobile.** Track is the strongest screen — clean at every width including 320px,
all controls ≥44px, safe-area insets handled on the header
(`pt-[env(safe-area-inset-top)]`), main padding, bottom nav, and every modal.
`min-h-dvh` is used alongside `min-h-screen` throughout, and `useKeyboardInset`
drives real `visualViewport`-based padding on the auth screen and every sheet.
Inputs are 16px (`text-base`), so iOS will not zoom on focus. The four
touch-target failures found were all in Settings/History and are fixed.

**Desktop.** Content is capped at `max-w-5xl` with a genuine two-column Settings
layout and a 12-column History grid, not stretched mobile cards. The tracker grid
adapts 1→2→4 columns by count. One real bug (undo toast over the nav) fixed.

**Android.** Reviewed by reading only. Compose screens use
`collectAsStateWithLifecycle`, `rememberSaveable` for screen state,
`heightIn(min = 48.dp)` on filter chips, and `semantics { contentDescription }`
on the chart with a full spoken data summary. `HistoryChart` correctly includes
today's archive — it was the web that diverged.

**Accessibility.** The existing baseline was already strong and deliberate:
`useDialogA11y` implements a complete modal contract (scroll lock, focus trap,
Escape, focus restore); `TrackerCard` carries an `aria-live` region announcing
"name: N of M, K left" after each tap; the increment button binds both
`pointerdown` and `click` specifically so screen readers and Switch Access can
activate it; the chart has an `sr-only` numeric table so it is not the only way
to read the data; `MotionConfig reducedMotion="user"` plus a `matchMedia` check
on the chart animation honour `prefers-reduced-motion`. This pass fixed the
contrast and target-size gaps on top of that.

**Visual consistency.** The dark/high-contrast/numeric identity was preserved
throughout. The only structural change was bringing the Economics card into the
same header and padding rhythm as its five siblings.

## Security findings

- **Auth.** Anti-enumeration is handled properly: password reset always returns
  the same acknowledgment on success and failure, and credential errors collapse
  to "Invalid email or password." Persistence is `browserLocalPersistence`;
  iOS/standalone-PWA correctly prefer redirect over popup, with the redirect
  result and a `google-delete` re-auth intent completed in `AuthContext` so it
  works regardless of the active tab on landing.
- **User switching.** Verified clean on both sides of the boundary:
  `App.jsx` resets `settings`/`isHydrated`/`incrementUndo` on `user?.uid` change,
  and `useRegistry` clears configs, logs, counts, aggregates, profile, and both
  optimistic-overlay refs *before* attaching new listeners, with all three
  listeners torn down in the effect cleanup. No path found for user A's data to
  appear in user B's session.
- **Firestore rules.** A genuine boundary, not decoration: owner-only on
  `users/{uid}` and both subcollections, default-deny catch-all, `hasOnly` key
  allowlists, per-field type and range checks, count maps bounded to 50 entries
  with key-pattern and 0–10000 value validation, immutable `logDate` on log
  updates, zeroed aggregates required at profile creation, and a settings/mutation
  write-path split so a settings save cannot touch counters and a counter write
  cannot touch identity or pricing. Both update paths correctly validate only
  `affectedKeys()`, so an oversized legacy avatar cannot brick unrelated writes.
  Not re-run against the emulator here.
- **App Check.** Left exactly as designed — integrated, not enforced. The
  reasoning (debug provider on release APKs, no Play Console link, enforcement is
  per-product and global) is documented in README and SETUP_GUIDE; the
  contradictory note in `firestore.rules` was corrected to match.
- **Secrets.** None committed. `google-services.json`, `.env.local`, `*.apk`, and
  diagnostic logs are gitignored; `.env.example` holds only key names. The
  `VITE_FIREBASE_*` config is public by design and is not hidden behind theatre.
  CI generates a placeholder `google-services.json` so the Android build compiles
  without secrets.
- **Input validation.** Layered correctly — UI (`sanitizeInput` strips ISO control
  characters and angle brackets, mirroring `InputSanitizer.kt`), service
  (`sanitizeConfigPayload` clamps to the exact bounds the rules enforce, so
  out-of-range input is clamped rather than surfacing "blocked by security
  rules"), and rules as the authority. `createManualEntry` does full calendar
  validation because the rules can only check the date *pattern*.
- **XSS.** No `dangerouslySetInnerHTML` anywhere. The single `innerHTML` write is
  in `main.jsx` and interpolates only a hardcoded list of missing config-key
  names. Avatars are same-origin data URLs bounded to 100 000 chars by the rules.
- **Account deletion.** Honest about its limits, which is the right call: it
  re-authenticates first (password or Google, popup or redirect), wipes Firestore
  in paginated batches, then retries `deleteUser` three times, and on persistent
  failure signs out and reports "Your data was erased but login removal failed"
  rather than claiming success. `PRIVACY.md` states the same.

## Cross-platform parity

Verified equivalent: profile bootstrap, tracker CRUD and ordering,
increment/decrement, end-day (including the merge-on-second-end-day and
delta-credited aggregates), manual entry, history edit/delete/restore, streak,
spend/save, life-lost and recovery minutes, tracking-day computation and
`dayStartHour`, settings write-path split, realtime listeners. The JS
`SmokingCalculator` is a faithful port; `registryService.js` mirrors
`RegistryMutations.kt` including `resolveContribution` fallback for legacy logs
and `mergeHistoricalEditCounts` preserving counts for deleted trackers.

Remaining intentional differences: Android renders the trend chart only over
dates that have logs, while web plots a continuous zero-filled axis (presentation,
both now include today's archive); Android has no `packQty` persistence *and
neither does web* (shared limitation); iOS remains a truthful unsupported gate.

Remaining accidental differences, all Android-side and all documented above:
password-policy error mapping, the missing client-side password length check, the
`#10B981` fallback accent, and the `formatCurrency` half-cent rounding mode.

## Release checklist

- [x] Web dependencies install cleanly
- [x] Web lint passes
- [x] Web production dependency audit passes at configured severity
- [x] Web tests pass (117)
- [x] Coverage run passes
- [x] Web production build passes
- [x] Firestore emulator rules tests (CI — 27 tests)
- [x] Shared Kotlin tests (CI)
- [x] Compose tests (CI)
- [x] Android lint (CI)
- [x] Android debug build (CI)
- [x] Android release build (CI)
- [x] No committed secrets found
- [x] No cross-user Firestore access path found
- [x] Auth flow reviewed
- [x] Account switching reviewed
- [x] Account deletion reviewed
- [x] Tracker CRUD reviewed
- [x] Increment/decrement reviewed
- [x] Undo reviewed
- [x] Rollover reviewed
- [x] End-day reviewed
- [x] History reviewed
- [x] Manual backfill reviewed (future-date gap documented)
- [x] Streak reviewed
- [x] Economics reviewed
- [x] Date/time boundaries reviewed
- [x] Multi-device sync reviewed
- [x] Offline behaviour reviewed
- [x] Service-worker lifecycle reviewed
- [x] PWA manifest reviewed
- [x] Mobile safe areas reviewed
- [x] Responsive layouts reviewed (16 viewports × 4 screens)
- [x] Keyboard accessibility reviewed
- [x] Screen-reader semantics reviewed
- [x] Reduced motion reviewed
- [x] Android TalkBack semantics reviewed (by inspection)
- [x] Loading states reviewed
- [x] Error states reviewed
- [x] Empty states reviewed
- [x] Destructive confirmations reviewed
- [x] Privacy documentation matches implementation
- [x] README/setup documentation matches implementation
- [x] iOS status remains truthful
- [x] App Check decision remains intentional and documented

## Final verdict

**RELEASE READY.**

Every item on the release checklist is now backed by a check that actually ran:
lint, dependency audit, 117 unit tests, coverage, production build and a 64-combo
responsive/accessibility sweep locally; shared Kotlin tests, Compose tests,
Android lint, both Android builds and the 27 Firestore rules/emulator tests on CI
(run 33457292404, both jobs green).

Three P1 defects were found and fixed — hosting deployed without security
headers, the History chart erasing a day the moment it was archived, and a stale
user-facing privacy notice carrying an internal pre-launch TODO. The remaining
findings are P2/P3 polish plus two schema gaps shared by both clients
(units-per-pack not persisted, future-dated manual entries accepted); none block
a release.

Caveat on scope: the Android client was reviewed by reading and is verified only
to the depth CI provides — unit tests, lint and a successful release assemble. No
instrumented or on-device testing was performed in this audit.
