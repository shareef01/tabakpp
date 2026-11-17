# TABAKPP — Release Gates

PASS · OPEN · BLOCKED · APPROVAL_REQUIRED · PARKED

| Gate | Status | Evidence / reason |
|---|---|---|
| No P0 (corruption / financial inconsistency / authz bypass) defects | **PASS** | rules 108/108; `effectiveDay` fix verified; migration interruption fix verified; no open integrity defect |
| No P1 release blocker | **PASS** | full regression green; the two OPTION_B gaps are now implemented (HISTORICAL_DAY_UPDATE + TRACKER_DELETE), not fail-closed |
| Trusted financial mutations complete on Web | **VERIFIED** | day close, stale reconciliation, historical-day update and tracker deletion all route through the trusted callable for OPTION_B/MIGRATING |
| Migration recovery verified | **VERIFIED (interruption/resume + concurrency)** | per-date atomic migration; emulator tests reproduce the pre-fix defect and pass after the fix; classification covered by `financial.test.js` 26 tests. Interrupted finalization + large-history paging remain TODO |
| Android instrumentation green | **VERIFIED** | **31 executed / 0 failed / 0 errors / 0 skipped** on the reconciled branch (main's 22 `FirebaseRegistryRepositoryTest` + 9 `RegistryErrorStructuredCodeTest`), re-verified on a dedicated AVD (`aus_api36`) with demo-project emulators. History: 28/28 on a physical Mi 9T Pro, 27/27 on an AVD and a Pixel 7 (pre-rewrite base) |
| Callable + idempotency green | **VERIFIED (tested scenarios)** | `testL` PASS (increment, source, ledger, receipt, duplicate, conflict) |
| Ledger → repository → ViewModel refresh device-verified | **PARTIAL** | repository live-refresh **VERIFIED on-device** (`testM`); ViewModel projection covered by unit tests, not yet wired on-device |
| UI/UX preserved, no unapproved visual change | **PASS (so far)** | no UI files touched this engagement |
| Security: authorization intact, no weakening | **PASS** | rules 131/131; `financialLocked`, ownership, ledger/receipt validation, 50-entry contract all intact |
| Dependency vulnerabilities | **OPEN (low risk)** | Web prod 0; Web dev 19H/1C/14M (build tooling only); functions prod 8 moderate (GCP SDK transitives) — no high/critical shipped |
| Production Firebase | **PARTIAL (rules + hosting)** | Firestore rules and LEGACY hosting (ledger off) deployed to `tabakpp-ff036` from `main` 2791ada on 2026-11-18 (TABAK-001, on top of TABAK-002 + TABAK-007) (OPTION_B/MIGRATING gates live but inert). Functions NOT deployed; no migration; no Option-B activation |
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

Latest production deploys (each after `CI` and `Android Instrumentation Tests` passed on that commit):

- **2026-11-18, `main` 2791ada, `firebase deploy --only firestore:rules`, then `--only hosting`:**
  - ✅ Firestore Security Rules with TABAK-001 (#181): a closed day may gain exactly one new stamp,
    for `updatedTrackerId` (`validLateSnapshotAdd`); existing stamps stay frozen. The CLI uploaded a
    new ruleset and released it. Deployed before the clients that use it.
  - ✅ Hosting: web build with the TABAK-001 late stamp and the new close-day copy. The live
    `index.html` serves the same entry (`index-B-nquC9U.js`) as the local build of 2791ada.

- **2026-11-17, `main` f024a95, `firebase deploy --only firestore:rules`:**
  ✅ Firestore Security Rules with TABAK-007 (#179): tracker (`configs`) creates and updates
  require the profile to exist (`profileExistsAfter`). The permanent `deleting: true` marker is
  unchanged and now documented as accepted. The CLI uploaded a new ruleset and released it.
- **2026-11-17, `main` 9b36d06, `firebase deploy --only firestore:rules`:**
  ✅ Firestore Security Rules with TABAK-002 (#172): `days` deletes require a tombstoned profile
  (`accountTombstoned`), so a closed day can't be deleted and recreated. The CLI uploaded a new
  ruleset and released it. Account deletion from Android v1.0.6–v1.0.8 (which wipe without
  tombstoning first) now stops at `days` and must be finished from a current client (accepted).
- **2026-11-16, `main` c10d851, `firebase deploy --only hosting,firestore:rules`:**
  - ✅ Firestore Security Rules (LEGACY-preserving; the `financialLocked` gate is live but inert
    because no account is MIGRATING/OPTION_B). The CLI reported the deployed rules already matched
    `firestore.rules` at c10d851 (upload skipped, same ruleset re-released), so the v1.0.15
    day-status rules were already live; an intermediate rules deploy after 2026-10-20 wasn't recorded here.
  - ✅ Hosting at https://tabakpp.web.app — LEGACY build with `VITE_OPTION_B_LEDGER` unset (ledger off).
    Inter is self-hosted (#170): the live CSP has no Google Fonts hosts, and a headless-Chromium load
    of the live site requested only `tabakpp.web.app`.
    Previous hosting releases: 2026-10-20 (32312ff), 2026-10-12.

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
