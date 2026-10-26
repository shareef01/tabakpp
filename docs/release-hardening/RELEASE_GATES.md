# TABAKPP — Release Gates

PASS · OPEN · BLOCKED · APPROVAL_REQUIRED · PARKED

| Gate | Status | Evidence / reason |
|---|---|---|
| No P0 (corruption / financial inconsistency / authz bypass) defects | **PASS** | rules 108/108; `effectiveDay` fix verified; migration interruption fix verified; no open integrity defect |
| No P1 release blocker | **PASS** | full regression green; the two OPTION_B gaps are now implemented (HISTORICAL_DAY_UPDATE + TRACKER_DELETE), not fail-closed |
| Trusted financial mutations complete on Web | **VERIFIED** | day close, stale reconciliation, historical-day update and tracker deletion all route through the trusted callable for OPTION_B/MIGRATING |
| Migration recovery verified | **VERIFIED (interruption/resume + concurrency)** | per-date atomic migration; emulator tests reproduce the pre-fix defect and pass after the fix; classification covered by `financial.test.js` 26 tests. Interrupted finalization + large-history paging remain TODO |
| Android instrumentation green | **VERIFIED** | **28 executed / 0 failed / 0 errors / 0 skipped** (19 `FirebaseRegistryRepositoryTest` + 9 `RegistryErrorStructuredCodeTest`) — re-verified 2026-10-26 on a physical device (Xiaomi Mi 9T Pro, Android 13) against demo-project Firestore/Auth/Functions emulators; earlier 27/27 runs were on an AVD and a Pixel 7 |
| Callable + idempotency green | **VERIFIED (tested scenarios)** | `testL` PASS (increment, source, ledger, receipt, duplicate, conflict) |
| Ledger → repository → ViewModel refresh device-verified | **PARTIAL** | repository live-refresh **VERIFIED on-device** (`testM`); ViewModel projection covered by unit tests, not yet wired on-device |
| UI/UX preserved, no unapproved visual change | **PASS (so far)** | no UI files touched this engagement |
| Security: authorization intact, no weakening | **PASS** | rules 131/131; `financialLocked`, ownership, ledger/receipt validation, 50-entry contract all intact |
| Dependency vulnerabilities | **OPEN (low risk)** | Web prod 0; Web dev 19H/1C/14M (build tooling only); functions prod 8 moderate (GCP SDK transitives) — no high/critical shipped |
| Production Firebase | **PARTIAL (rules + hosting)** | Firestore rules and LEGACY hosting (ledger off) deployed to `tabakpp-ff036` from `main` 32312ff on 2026-10-20 (OPTION_B/MIGRATING gates live but inert). Functions NOT deployed; no migration; no Option-B activation |
| Production actions (deploy/migrate/activate Option B) | **PARKED (owner decision, 2026-10-11)** | The project stays on the Spark plan. Option-B needs Cloud Functions (Blaze), so it stays dormant: the code is kept, tested in CI against the emulators, and inert in production |

## Previously-fail-closed Option-B gaps — RESOLVED (2026)

The two Option-B gaps documented earlier are now implemented and verified:

1. **`updateHistoricalDay`** — backend `HISTORICAL_DAY_UPDATE` recomputes the canonical
   credit and the net lifetime delta from the day's FROZEN `trackerSnapshots` (no
   fabrication from today's settings). Web routes it through the callable with a stable
   per-edit operation id.
2. **`deleteProtocol`** — backend `TRACKER_DELETE` deletes the config and drops the tracker
   from the current open day + ledger (closed/historical days keep their frozen state). Web
   routes it through the callable; MIGRATING still fails closed.

Evidence: `node emulator.integration.mjs` PASS (historical-day-update + tracker-delete
scenarios); `closeDayRouting.test.js` 24 tests; vitest 451; rules 108; contract 62; build ✓.

## Production deployment status (2026)

**Decision (2026-10-11): stay on the Spark plan; Option-B is parked, not pending.**
The Option-B code (functions, client routing, rules gates) is kept dormant and
exercised in CI against the emulators, so it remains ready should the plan ever
change — but no upgrade is planned.

Production **Option-B is intentionally disabled**: `tabakpp-ff036` is on the Firebase
**Spark (free)** plan, and the trusted financial boundary is a **Cloud Function**
(`executeFinancialOperation` / `migrateAccount`) — Cloud Functions require **Blaze**. On
Spark, no account can be migrated to OPTION_B and no account can mutate canonical financial
state, so production runs as the original **LEGACY** app, which is fully functional.

Deployed to production (latest: `main` 32312ff, 2026-10-20, `firebase deploy --only hosting,firestore:rules`):
- ✅ Firestore Security Rules (LEGACY-preserving; the `financialLocked` gate is live but inert
  because no account is MIGRATING/OPTION_B).
- ✅ Hosting at https://tabakpp.web.app — LEGACY build with `VITE_OPTION_B_LEDGER` unset (ledger off).
  Previous hosting release: 2026-10-12.

Not deployed (Spark):
- ❌ Cloud Functions · ❌ Ledger-enabled hosting · ❌ Migration / Option-B activation.

Activation path (only if the project ever moves to Blaze — not planned): deploy functions → deploy hosting (ledger
enabled) → run `migrateAccount` per account with an operator credential.

## Release verdict
**Release target: the LEGACY app on Spark. Option-B is PARKED (owner decision).**
Production runs the original LEGACY write path, which is fully functional; Firestore
Security Rules are the authorization and validation boundary (an owner can misstate
their own totals — accepted for a self-tracking app, see SECURITY.md). The Option-B
implementation stays in the repository, dormant and covered by CI (functions unit +
emulator integration, web routing, Android `testL`/`testM`/`testN`).

Before release: merge PR #84 and deploy the updated Firestore rules (profile
delete-and-recreate fix) with `firebase deploy --only firestore:rules`. Remaining
non-billing gaps: tooling-blocked UI/UX visual baseline and a few E2E/ViewModel
verification gaps.
