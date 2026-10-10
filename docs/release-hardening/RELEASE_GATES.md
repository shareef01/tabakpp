# TABAKPP — Release Gates

PASS · OPEN · BLOCKED · APPROVAL_REQUIRED

| Gate | Status | Evidence / reason |
|---|---|---|
| No P0 (corruption / financial inconsistency / authz bypass) defects | **PASS** | rules 108/108; `effectiveDay` fix verified; migration interruption fix verified; no open integrity defect |
| No P1 release blocker | **PASS** | full regression green; the two OPTION_B gaps are now implemented (HISTORICAL_DAY_UPDATE + TRACKER_DELETE), not fail-closed |
| Trusted financial mutations complete on Web | **VERIFIED** | day close, stale reconciliation, historical-day update and tracker deletion all route through the trusted callable for OPTION_B/MIGRATING |
| Migration recovery verified | **VERIFIED (interruption/resume + concurrency)** | per-date atomic migration; emulator tests reproduce the pre-fix defect and pass after the fix; classification covered by `financial.test.js` 26 tests. Interrupted finalization + large-history paging remain TODO |
| Android instrumentation green | **VERIFIED** | 27 executed / **0 failed** / 0 skipped (AVD **and** physical Pixel 7) |
| Callable + idempotency green | **VERIFIED (tested scenarios)** | `testL` PASS (increment, source, ledger, receipt, duplicate, conflict) |
| Ledger → repository → ViewModel refresh device-verified | **PARTIAL** | repository live-refresh **VERIFIED on-device** (`testM`); ViewModel projection covered by unit tests, not yet wired on-device |
| UI/UX preserved, no unapproved visual change | **PASS (so far)** | no UI files touched this engagement |
| Security: authorization intact, no weakening | **PASS** | rules 108/108; `financialLocked`, ownership, ledger/receipt validation, 50-entry contract all intact |
| Dependency vulnerabilities | **OPEN (low risk)** | Web prod 0; Web dev 19H/1C/14M (build tooling only); functions prod 8 moderate (GCP SDK transitives) — no high/critical shipped |
| Production Firebase | **PARTIAL (rules only)** | Firestore rules deployed to `tabakpp-ff036` (LEGACY-preserving; OPTION_B/MIGRATING gates live but inert). Functions/hosting NOT deployed; no migration; no Option-B activation |
| Production actions (deploy/migrate/activate Option B) | **BLOCKED (billing)** | Cloud Functions require the Blaze plan; `tabakpp-ff036` is on Spark → Option-B cannot be enabled until a plan upgrade |

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

Production **Option-B is intentionally disabled**: `tabakpp-ff036` is on the Firebase
**Spark (free)** plan, and the trusted financial boundary is a **Cloud Function**
(`executeFinancialOperation` / `migrateAccount`) — Cloud Functions require **Blaze**. On
Spark, no account can be migrated to OPTION_B and no account can mutate canonical financial
state, so production runs as the original **LEGACY** app, which is fully functional.

Deployed to production:
- ✅ Firestore Security Rules (LEGACY-preserving; the `financialLocked` gate is live but inert
  because no account is MIGRATING/OPTION_B).

Not deployed (Spark):
- ❌ Cloud Functions · ❌ Hosting (re-deploy) · ❌ Migration / Option-B activation.

Activation path (requires a Blaze upgrade): deploy functions → deploy hosting (ledger
enabled) → run `migrateAccount` per account with an operator credential.

## Release verdict
**TABAKPP NOT RELEASE-READY — production Option-B disabled on Spark (billing).**
The automated regression matrix is fully green (Web 451/62/108 + build, Functions 26 +
emulator integration, Kotlin shared/compose, lint/assemble, Android device 27/27), and the
two formerly fail-closed Option-B gaps are implemented. The Option-B implementation is
**committed and pushed** (`23a988e`, PR #84) but inactive in production pending a Blaze
upgrade. Remaining non-billing gaps: tooling-blocked UI/UX visual baseline and a few
E2E/ViewModel verification gaps.
