# 10 — Test report

Environment: Windows 11, Node v24.16.0 (CI pins 24.21.0), npm per lockfile, OpenJDK 21.0.11, Gradle 9.8.2 wrapper, Chrome 158. The JVM and emulator runs used `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/shareef01/jtmp`, a machine-specific Windows loopback workaround that changes no code. All runs happened at `ec8bdf7` on 2026-11-12.

| Suite | Command | Total | Pass | Fail | Skip | Time |
|---|---|---|---|---|---|---|
| Web unit | `cd webApp && npx vitest run` | 622 (39 files) | 622 | 0 | 0 | 36 s |
| Web lint | `npm run lint` | — | 0 problems | — | — | 5 s |
| Contract fixtures | `npm run test:contract` | 76 | 76 | 0 | 0 | 3 s |
| Rules + emulator | `npm run test:rules` | 180 (4 files) | 180 | 0 | 0 | 59 s |
| Functions unit | `cd functions && npm test` | 69 | 69 | 0 | 0 | 2 s |
| Functions emulator integration | `npx firebase emulators:exec --config ../firebase.json --project demo-takabpp-test --only functions,firestore,auth "node ../functions/emulator.integration.mjs"` | 30 suites | 30 | 0 | — | 50 s |
| Kotlin shared JVM | `./gradlew.bat :shared:testDebugUnitTest` | 221 | 221 | 0 | 0 | 185 s combined with the next three rows |
| Compose UI JVM (Robolectric) | `:composeApp:testDebugUnitTest` | 59 | 59 | 0 | 0 | (combined) |
| Android app JVM | `:androidApp:testDebugUnitTest` | 2 | 2 | 0 | 0 | (combined) |
| Android lint | `:androidApp:lintDebug` | — | 0 errors / 10 warnings | — | — | (combined) |
| Web build | `npm run build` | — | success (chunk-size warning for the lazy `heic2any`) | — | — | 7 s |
| PWA regression | `npm run test:pwa` | 27 scenarios | 27 | 0 | — | 31 s |
| Accessibility | `npm run test:a11y` | all views/viewports, 10 accents, reflow | 0 violations | — | — | 41 s |
| CI gate scripts | `python .github/scripts/test-validate-action-pins.py`, `validate-lockfile.py`, `test-release-safety.py` (9), `test-android-test-results-gate.py` (26) | — | all OK | 0 | — | <1 s each |
| Audit probes (temporary) | rules probe file on the emulator | 7 | 7 (each assertion encodes the observed behaviour) | — | — | 9 s |

Totals: 1,153 application tests (web 622, which includes the 76 contract assertions, plus rules 180, Functions 69, Kotlin 221, Compose 59 and app 2), 35 gate self-tests and 30 integration suites, with 0 failures. Coverage was not collected locally; CI runs `npm run coverage`.

**Not run (environment):**

- `./gradlew :androidApp:connectedDebugAndroidTest` (Android instrumentation) needs an emulator or device. The last recorded result in the repo docs is 31/31 on 2026-10-26, which this audit did not reproduce.
- `validate-action-pins.py` against GitHub needs `GITHUB_TOKEN` and the network. Only its self-test ran.
- `:androidApp:assembleRelease` with real signing needs release secrets.

## Test-quality review

- **Strong.**
  - The rules suite includes denial cases, cross-user cases and commit-budget cases.
  - The emulator tests drive the real SDK against real rules, covering late writes, reconcile and export.
  - The Android XML gate fails closed on zero tests or stale results.
- **Gaps tied to findings.**
  - Nothing asserts that closed-day immutability survives delete + recreate (TABAK-002).
  - The emulator test `:231–239` **pins** the TABAK-001 refusal but not the UI copy that contradicts it.
  - No Android test covers reconcile query cost or > 2000 days (TABAK-003).
  - No Kotlin repository test covers invalid-count rejection (TABAK-005).
- **Fixture realism.** The contract fixtures cover the calculators, not the service layer, and they don't parameterise time zones (see `04`).
- **Weak spots (no false passes found).**
  - Several `HistoryScreen` tests assert rendered strings that will churn with copy.
  - The PWA harness relies on a local Chrome binary.

## Proposed regression tests (one per confirmed finding)

| Finding | Test |
|---|---|
| TABAK-001 | Copy assertion for the close-day dialog on both platforms. If the additive-stamp option is chosen: a rules test plus an emulator test inverting `registryService.emulator.test.js:231–239` |
| TABAK-002 | Rules test: closed-day delete is denied unless the profile is tombstoned; the wipe emulator test still passes |
| TABAK-003 | Instrumentation or emulator test with 250+ closed days and 1 stale day: the stale day closes and the read count is bounded |
| TABAK-005 | Kotlin `RegistryRepository` test: negative, fractional or > 10000 count → `INVALID_COUNT`, and no log is written |
