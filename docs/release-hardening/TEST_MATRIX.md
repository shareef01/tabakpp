# TABAKPP — Test Matrix

Fresh results are recorded only when executed in-session. Historical counts are labelled.

| Requirement | Test / suite | Last executed | Result |
|---|---|---|---|
| Firestore rules: LEGACY allowed, OPTION_B/MIGRATING denied, cross-user denied, unknown ledger keys rejected, invalid receipt rejected | `webApp/src/firestore.rules.test.js` → `npm run test:rules` | this session | **106 passed / 0 failed** |
| LEGACY 5-doc atomic commit (log+day+ledger+receipt+profile) allowed | new `REGRESSION` test in rules suite | this session | **PASS** |
| Full-profile create under rules allowed | new `REGRESSION` test in rules suite | this session | **PASS** |
| Web unit/integration incl. financial read model, export, insights | `npx vitest run` | **this session** | **445 passed / 0 failed** |
| Day-close routing + locked-mode guards (`closeDayRouting.test.js`) | `npx vitest run src/services/closeDayRouting.test.js` | **this session** | **18 passed** |
| Financial contracts | `npm run test:contract` | **this session** | **62 passed** |
| Functions accounting unit | `node --test` (`functions/`) | this session | **26 passed / 0 failed** |
| Functions emulator integration (create/idempotency/conflict/close-once/mode-guard/phantom-savings/migration/interruption-resume/concurrency/**historical-day-update**/**tracker-delete**) | `node emulator.integration.mjs` | **this session** | **PASS** (project `demo-takabpp-test`) |
| Shared Kotlin | `:shared:testDebugUnitTest` | prior session | 172 passed |
| Compose | `:composeApp:testDebugUnitTest` | prior session | 50 passed |
| Android lint/build | `:androidApp:lintDebug :androidApp:assembleDebug` | prior session | SUCCESSFUL |
| Android trusted Callable lifecycle | `FirebaseRegistryRepositoryTest#testL…` | prior session | **PASS** |
| Android device instrumentation | `:androidApp:connectedDebugAndroidTest` | **this session** | **27 executed / 0 failed / 0 skipped** (incl. new `testM`) |
| Repository ledger live refresh (OPTION_B, trusted mutation) | `testM_canonicalLedgerLiveRefresh_afterTrustedIncrement` | **this session** | **PASS** |
| Web production build | `npm run build` | prior session | ✓ built |
| Hygiene | `git diff --check` | this session | clean |

## Complete Web mutation matrix (W1B-4, this session)

| Mutation | LEGACY | OPTION_B | MIGRATING | Enforcement | Status |
|---|---|---|---|---|---|
| `adjustCounter` | direct txn | callable `COUNTER_INCREMENT`/`DECREMENT` | callable → denied | gate + rules | VERIFIED |
| `createManualEntry` | direct txn | callable `MANUAL_CREATE` | denied | gate + rules | VERIFIED |
| `updateHistoricalLog` | direct txn | callable `MANUAL_UPDATE` | denied | gate + rules | VERIFIED |
| `deleteLog` / `restoreLog` | direct txn | callable `MANUAL_DELETE`/`RESTORE` | denied | gate + rules | VERIFIED |
| `closeDay` (`endDay`) | direct txn | callable `DAY_CLOSE` (`close_<date>`) | denied | gate + rules | VERIFIED |
| `reconcileStaleDays` | via `closeDay` | via `closeDay` → callable | denied | inherited | VERIFIED (routing) |
| `updateHistoricalDay` | direct txn | callable `HISTORICAL_DAY_UPDATE` (`hist_<date>_<hash>`) | denied | gate + rules | **VERIFIED** |
| `deleteProtocol` | direct txn | callable `TRACKER_DELETE` (`del_<pid>_<date>`) | fails closed | gate + `financialWritesLocked` + rules | **VERIFIED** |
| `migrateSmokingUnitsIfNeeded` | direct txn | skipped (server-owned) | skipped | `financialWritesLocked` | VERIFIED |
| `migrateLegacyActiveCounts` | direct txn | skipped (server-owned) | skipped | `financialWritesLocked` | VERIFIED |
| `addProtocol`/`updateProtocol`/`reorderConfigs` | direct `configs` | direct (allowed) | direct | none needed (non-financial) | n/a |
| `updateProfileSettings`, `updateAvatar` | direct (settings/meta) | direct (allowed) | direct | none needed | n/a |
| `ensureUserDocument` | profile create | profile create | profile create | rules | n/a |

Inventory evidence: **no Firestore write exists outside `registryService.js` / `dailyLedger.js`** (grep across `webApp/src`, excluding tests, for `updateDoc|setDoc|deleteDoc|writeBatch|runTransaction` in components/hooks → zero hits). The account mode is always read live from the profile (`optionBLedgerActive` / `financialWritesLocked`); a missing profile is LEGACY (same default as the rules); a failed mode read propagates (fail-closed, tested).

## Gaps
- The 12 Android failures have **no** reproducing case in the Web rules harness.
- Security-denial tests assert denial but not always the *cause*; a dedicated assertion that
  the denial is `financialLocked` (not an expression-budget error) is missing.
