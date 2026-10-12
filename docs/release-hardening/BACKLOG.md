# TABAKPP — Backlog

States: TODO · IN_PROGRESS · BLOCKED · FIXED_UNVERIFIED · VERIFIED · DEFERRED_APPROVAL

| ID | Pri | Item | State | Evidence |
|---|---|---|---|---|
| W1A-1 | P1 | 12 Android device tests fail with Firestore `maximum of 1000 expressions` | **VERIFIED** | Device **26/26, 0 failed** after the fix below |
| W1A-2 | P1 | Capture real Android write payload + prior doc state | **VERIFIED** | Minimal reproducing sequence `{testL, testF}` isolated; leaked mode proven |
| W1A-3 | P1 | Restore Android full instrumentation to green | **VERIFIED** | `:androidApp:connectedDebugAndroidTest` → 26 passed / 0 failed / 0 skipped |
| W1A-4 | P1 | Remove temporary androidTest diagnostics (`setLoggingEnabled`, `DIAG_APP_PROJECT`); make `testL`'s mode restore exception-safe | **VERIFIED** | diagnostics removed; restore in `finally`; Android suite re-run → **26/26, 0 failed**, no `DIAG_APP_PROJECT` in logcat |
| W1B-1 | P1 | Web `endDay`/`closeDay` not routed through the trusted backend for OPTION_B | **VERIFIED** | `closeDay` routes `DAY_CLOSE` via `TrustedFinancial` when mode is OPTION_B; deterministic `close_<date>` op id; LEGACY unchanged. 7 new routing tests; backend integration PASS (close-once); rules 108; vitest 434 |
| W1B-2 | P1 | `updateHistoricalDay` under OPTION_B/MIGRATING | **VERIFIED** | Backend `HISTORICAL_DAY_UPDATE` implemented (recompute canonical credit + net lifetime delta from frozen snapshots); Web `updateHistoricalDay` routes through the callable (`hist_<date>_<hash>`). Emulator: counts 5→2 ⇒ saved €8, lifetime saved 5→8. LEGACY unchanged. |
| W1B-3 | P1 | `reconcileStaleDays` untrusted | **VERIFIED (routing)** | Inherits the `closeDay` route: each stale date closes through the callable with a stable `close_<date>` op id; current tracking date untouched. 3 new tests |
| W1B-4 | P1 | Audit remaining Web mutation entry points; no OPTION_B/MIGRATING direct financial write | **VERIFIED (audit + guards)** | Inventory complete: **all** Firestore writes live in `registryService.js`/`dailyLedger.js` (none in components/hooks). Gated via the callable: `adjustCounter`, `createManualEntry`, `updateHistoricalLog`, `deleteLog`, `restoreLog`, `closeDay`. New explicit fail-closed guard (`financialWritesLocked`) for `deleteProtocol` (throws `TRACKER_DELETE_UNSUPPORTED`) and the two legacy migrations (skipped). 11 new tests |
| W1B-4a | P1 | No trusted route for deleting a tracker (OPTION_B/MIGRATING) | **VERIFIED** | Backend `TRACKER_DELETE` implemented (delete config + drop tracker from the open day + ledger; closed days keep frozen state). Web `deleteProtocol` routes through the callable (`del_<pid>_<date>`); MIGRATING still fails closed. Emulator: config gone + tracker dropped from day/ledger. |
| W1B-4b | P2 | `DailyLedger` module is unused by production code (canonical ledger is backend-owned) | TODO | Dead-ish module kept for its emulator test; removal is out of scope |
| W1B-5 | P2 | End-to-end Web financial user journeys | TODO | after W1B-4 |
| W1C-1 | P1 | Migration interruption / resume recovery | **VERIFIED** | Reproduced the defect (`got 15, expected 5`): a crash after a date's ledger write but before the lifetime delta left the account at its LEGACY totals while the ledger said canonical. Fixed by committing **each date's ledger + delta in one transaction** (`functions/index.js`). Emulator test: partial-resume (2 dates, 1 already migrated → `saved` 20 → 10) + repeat-resume no-op |
| W1C-2 | P1 | Migration concurrency | **VERIFIED** | Two racing `migrateAccount` workers on one account → `saved` 5 (no double-apply) |
| W1C-3 | P2 | Migration classification scenarios (dry-run, missing config, conflicting snapshots, ambiguous, genuine zero, unreconstructible) | **VERIFIED (unit)** | `functions/financial.test.js` 26 tests (E2/ A/B/C/ D, unresolved contributes zero, no fabrication) |
| W1C-4 | P2 | Interrupted **finalization** (MIGRATING → OPTION_B) and large-history migration | TODO | finalization is a single `set`, so an interruption leaves the account in MIGRATING (safe); large-history paging would need real production-sized data |
| W2-1 | P2 | Android ledger → repository → ViewModel live refresh | **VERIFIED (repository)** | New `testM_canonicalLedgerLiveRefresh_afterTrustedIncrement`: real SDK `subscribeToLedgers` returns no ledger before a trusted `COUNTER_INCREMENT`, then emits the server-written canonical ledger (counts 1, saved €9, wasted €1) after it. Device suite **27/27, 0 failed**. The ViewModel projection (`canonical`/`ledgers`) is covered by `RegistryViewModelTest` (unit); wiring the real ViewModel on-device remains TODO |
| W2-2 | P2 | Duplicate/conflict assertions beyond `testL` (receipt + lifetime) | TODO | |
| W4-1 | P2 | Security review of callable trust boundary + rules | TODO | |
| — | — | AUD-013 XP/Rank | **DEFERRED_APPROVAL** | explicitly deferred |

## Resolved (prior sessions, do not reopen)
Firebase project-ID mismatch · Callable NOT_FOUND routing · GitLive response
deserialization (`@Serializable` DTO) · OPTION_B fixture · canonical ledger on first
consumption of a new day (`effectiveDay`) · trusted COUNTER_INCREMENT · receipt creation ·
duplicate op-id idempotency · conflicting op-id rejection (`testL` PASSES).
