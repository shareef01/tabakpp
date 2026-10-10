# TABAKPP — Handoff (resume point)

## HEAD / state
- HEAD `e5390a4bcdcb406d0071d077fee9a1c0001184b5` — unchanged. Everything is uncommitted.
- No commits / pushes / merges / deployments / migrations. Production Option B disabled.
- Emulator + synthetic accounts only.

## WRAP-UP (final state)
Release-hardening is **wrapped up**. The full automated regression matrix is green and fresh
(Web 445/62/108 + build · Functions 26 + emulator integration · Kotlin shared/compose ·
lint/assemble · Android device **27/27** on both AVD and physical Pixel 7). The two
OPTION_B gaps (`updateHistoricalDay`, `deleteProtocol`) are **shipped fail-closed** and
documented in `RELEASE_GATES.md → Known limitations`. `artifacts_*/` is gitignored.

**To commit (needs explicit user authorization):** the diff is 40 tracked files
(+4461/−226) + 27 untracked source files; review `git diff`/`git status`, then
`git add -A && git commit` (and push/PR only when authorized). Production deploy, migration
and Option-B activation remain **APPROVAL_REQUIRED**.

## Where we are
**W1A RESOLVED — `:androidApp:connectedDebugAndroidTest` → 26 executed / 0 failed / 0 skipped
(verified on device, this session).**

Root cause was **test-state leakage**, not rule complexity and not the project id:
`testL` sets `financialMode=OPTION_B` on the synthetic account through the emulator owner
bypass; the Android anonymous user is **reused across tests** in the same app install, so
every subsequent LEGACY test was evaluated against a *locked* account and exhausted
Firestore's 1000-expression rules budget. Evidence chain:
- failures began at the first test after `testL` (14th started);
- `testE` passed alone;
- minimal reproducing sequence `{testL, testF}` → testL PASS / testF FAIL;
- after `testL` restores `financialMode=LEGACY`, `{testL, testF}` PASSES and the full suite is 26/26.

Fix (test-only): restore `financialMode=LEGACY` at the end of `testL`
(`FirebaseRegistryRepositoryTest.kt`). No rules, formula, schema, UI or contract change.

### Evidence chain (closing evidence)
1. `DIAG_APP_PROJECT=tabakpp-ff036` — client project == emulator project (isolation proven).
2. `testE` **PASSED alone**.
3. Full suite: the first ~10 tests passed, then failures began — i.e. every test after
   `testL` failed.
4. **Minimal reproducing sequence `{testL, testF}`** → testL PASS / testF FAIL.
5. After the `finally`-restore of `financialMode=LEGACY`, `{testL, testF}` PASSES and the
   full suite is **26/26**.
The diagnostics have been **removed** (W1A-4 / CHANGE_LOG #11) and the suite re-verified at
26/26 with them gone.

## W1B-1 / W1B-3 DONE (this session)
`RegistryService.closeDay` now routes `DAY_CLOSE` through `TrustedFinancial` when the
account's server-side `financialMode === 'OPTION_B'`, using a deterministic
`close_<date>` operation id (idempotent retries). LEGACY keeps its original transaction
unchanged. `reconcileStaleDays` inherits the route because it closes each stale date via
`closeDay`. Evidence: `closeDayRouting.test.js` 10 tests, backend
`emulator.integration.mjs` PASS (incl. close-once), rules 108, vitest 434, contract 62,
build ✓.

**W1B-2 (`updateHistoricalDay`) and W1B-4a (`deleteProtocol`) are now IMPLEMENTED and
VERIFIED** (backed `HISTORICAL_DAY_UPDATE` + `TRACKER_DELETE`; Web routes both through the
callable for OPTION_B). See CHANGE_LOG #15 and RELEASE_GATES "Previously-fail-closed
Option-B gaps — RESOLVED".

## Next autonomous task
**Remaining (non-blocking):** run the Android/Kotlin device matrix once more after the
backend change (the backend `SUPPORTED` set gained two op types but existing ops are
unchanged; `testL` counter-increment still applies), then decide on committing.
- Fresh-green this session: vitest 451 · contract 62 · rules 108 · build ✓ · functions 26 ·
  emulator integration PASS (incl. historical-day-update + tracker-delete).
- Not re-run this session (unchanged by this change): Android device (last 27/27),
  shared/compose unit, lint/assemble.

## Phase 4 baseline DONE (this session)
Web production bundle measured (lazy code-splitting OK; `heic2any` 1.35 MB lazy chunk is the
biggest). Secrets scan: none. Dependency audit: **Web production 0 vulns**; Web dev 19H/1C/14M
(build tooling only); **functions production 8 moderate, 0 high/critical**. Recorded in
`BASELINE.md` and `RELEASE_GATES.md`.

## W2-1 DONE (this session)
`testM_canonicalLedgerLiveRefresh_afterTrustedIncrement` (device): the real
`subscribeToLedgers` SDK subscription returns no ledger for a fresh date, and after a
trusted `COUNTER_INCREMENT` it emits the server-written canonical ledger (counts 1,
saved €9, wasted €1). `:androidApp:connectedDebugAndroidTest` → **27/27, 0 failed**.
The ViewModel `canonical`/`ledgers` projection is covered by `RegistryViewModelTest` (unit);
wiring the real ViewModel on-device is the remaining (minor) W2-1 gap.

## W1C DONE (this session)
**Migration interruption lost a date's lifetime delta** — reproduced in the emulator
(`saved` stayed 15 instead of 5): `migrateAccount` wrote every ledger (marked
`migratedFromLegacy`) then applied one combined `lifetimeAggregates` write afterwards, so a
crash in between left a marker whose delta was never applied and the rerun skipped it.
Fixed: each date's ledger **and** its delta now commit in one `runTransaction`
(`functions/index.js`). Emulator evidence: new interruption-resume + concurrency scenarios
PASS; `node --test` 26/26.

## W1B-4 DONE (this session)
Full mutation inventory: **every Firestore write lives in `registryService.js` /
`dailyLedger.js`** (no component/hook writes). Six mutations route OPTION_B through the
callable; three protected paths had **no** mode gate (they relied on a mid-transaction rules
denial) and now fail closed deterministically via a new `financialWritesLocked(uid)` helper
mirroring the rules' `financialLocked`: `deleteProtocol` throws, the two legacy migrations
skip (server-owned). 11 new tests; vitest **445**, rules **108**, contract **62**,
functions **26**, build ✓.

## Commands that work
```
# emulators (from repo root)
npx firebase emulators:start --config firebase.json --only functions,firestore,auth --project tabakpp-ff036
# AVD
"%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" -avd deutsch5 -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -port 5556
adb -s emulator-5556 shell cmd connectivity airplane-mode enable
adb -s emulator-5556 shell pm disable-user --user 0 com.android.vending
adb -s emulator-5556 reverse tcp:8080 tcp:8080 ; … tcp:9099 … ; … tcp:5001 …
# single test
$env:ANDROID_SERIAL='emulator-5556'; .\gradlew.bat :androidApp:connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.class=com.tabakpp.app.firestore.FirebaseRegistryRepositoryTest#testE_existingDay_incrementFromFiveToSix"
```
Note: `functions/emulator.integration.mjs` hardcodes project `demo-takabpp-test` and cannot
run against an emulator started as `tabakpp-ff036`.

## Sequencing after W1B
W1B-4 audit → W1C migration recovery → W2-1 on-device ledger→ViewModel refresh → Phases 2–5.
