# tabak++ — master audit (2026-11-12)

Repository `shareef01/tabakpp`, branch `main`, commit **`ec8bdf7`** (release `v1.0.14`). This audit was independent: the earlier reports (`docs/audit-*.md`) were treated as hypotheses and re-checked against code and executions. Detail lives in `01`–`12` in this folder.

## Executive summary

**The application is in good technical condition for its intended use**, a personal tracker on Firebase Spark with no server-side computation.

- **Cross-account isolation holds.** Every Firestore path is owner-scoped and the catch-all denies everything else. 180 rules/emulator tests and 7 new adversarial probes found no cross-user or unauthenticated path.
- **Financial invariants hold under normal use.** All official write paths are transactional and reconcile `lifetimeAggregates` in the same transaction. Every concurrent sequence traced held the invariants, apart from two bounded failures (C6, C8).
- **Every runnable suite passed.** That's 1,153 tests plus 30 integration suites, with 0 failures.

**No Critical or High findings.** The confirmed issues are smaller:

| ID | Title | Severity | Class | Confidence |
|---|---|---|---|---|
| TABAK-003 | Android stale-day reconcile scans the whole `days` history (≤ 2000 reads) on every start or day change. Past 2000 days it never reaches recent stale days | **Medium** | Confirmed defect (cost / correctness at scale) | Source analysis |
| TABAK-001 | "Close day" dialog promises continued logging, but trackers not yet used that day are then rejected | Low | Confirmed functional bug (misleading UI over a documented limitation) | Source + existing emulator test |
| TABAK-002 | Closed-day freezes (snapshot, status, fold-once) can be bypassed by delete + recreate; the docs overstate them as guarantees | Low | Design limitation / documentation overclaim | **Executed** (PROBE-1) |
| TABAK-005 | Kotlin repository silently drops invalid counts where web rejects them (the "phantom allowance" class); not reachable from the current Android UI | Low | Maintainability / latent bug | Source analysis |
| TABAK-007 | Rules hygiene: configs creatable without a profile; owner can self-tombstone with no recovery | Low | Design limitation | **Executed** (PROBE-2/5) |

(TABAK-004 and TABAK-006 were drafted and merged into other items to avoid duplicates. The IDs aren't reused.)

## Audit scope

- **Reviewed in full:**
  - `firestore.rules`
  - `webApp/src/services/registryService.js`
  - The core of `webApp/src/hooks/useRegistry.js`
  - `AuthContext.jsx`, `deleteAuthUserAfterWipe.js`
  - The calculator date and credit functions on both platforms
  - `FirebaseRegistryRepository.kt` write, reconcile and deletion paths
  - The `RegistryViewModel.kt` init and mutation flow
  - `InputSanitizer.kt`
  - All three workflows and their gate scripts
  - `firebase.json` (CSP, deploy guards)
  - The Android manifests and build config
  - Dependency manifests and audits
- **Reviewed selectively:** React components (copy, error mapping, dialogs), Compose screens (copy and inputs), the Functions code (auth gates, deploy guard; the Functions aren't deployed).
- **Tools:**
  - npm audit; Vitest; Firestore, Auth and Functions emulators via firebase-tools; Gradle; Android lint; Puppeteer PWA harness; axe-core
  - A pattern-based secret scan (gitleaks, trufflehog and osv-scanner were unavailable)
- **Limitations:**
  - No Android device or emulator.
  - No production or staging access, by design.
  - No GitHub settings access, so branch protection is unverified.
  - No Gradle CVE scanner.

## Architecture assessment

**Strengths:**

- A dated-day data model where the date is decided at write time.
- Per-day frozen config stamps.
- Transactional rollups.
- A clear separation of settings and mutation writes in the rules.
- Explicit fail-closed mode locks for a future trusted backend.
- Duplicated domain logic deliberately tied together by contract fixtures.
- Unusually candid documentation of the Spark residuals.

**Weaknesses:**

- Domain logic is implemented twice. The service layers have already diverged in validation (TABAK-005) and query strategy (TABAK-003).
- The rules can't express "one-way per date", only "per document version" (TABAK-002).
- `registryService.js` and `FirebaseRegistryRepository.kt` are each about 1.5k lines with mixed concerns (LEGACY, Option B and migrations). That's maintainability debt, not a defect.

## Confirmed findings

Full write-ups use the required format in the linked documents:

- TABAK-003: `06_ANDROID_KMP_AUDIT.md`
- TABAK-001: `05_WEB_AUDIT.md`
- TABAK-002 and TABAK-007: `02_SECURITY_AUDIT.md`
- TABAK-005: `04_CROSS_PLATFORM_AUDIT.md`

## Design limitations (deliberate; re-verified, unchanged since the prior audit)

1. **No server-authoritative money on Spark.** The owner can rewrite their own `counts`, `aggregateCredit` and `lifetimeAggregates` within bounds. There's no App Check.
2. **Option A manual entries.** Each manual entry on a date credits the full target allowance.
3. **Zero-count day credit.** A zero-count day doc (tap then undo) folds its full target-based `saved`.
4. **Tracker cap.** It's enforced per write, not per collection, so the cross-device race can create 9 configs, which fail closed at use time.
5. **Offline.** There's no offline write queue.
6. **Export.** It isn't an atomic multi-collection snapshot; open-day taps aren't detected.
7. **Migration lease.** It blocks all writes for ≤ 120 s, once, on unmigrated legacy accounts.
8. **Tombstone.** A permanent uid-keyed `{deleting:true}` tombstone (disclosed in `PRIVACY.md`).

## Unverified risks

- Android runtime behaviour: process death, TalkBack and real-device lifecycle. Instrumentation wasn't run.
- Branch-protection settings (CI-1).
- Gradle and KMP dependency CVEs (no scanner).
- Firestore database location and data residency (not in the repo).
- GDPR Art. 9 classification of the consumption data. **Needs legal review.**
- The undeployed Option B `migrateAccount`. It would ingest client-written days, including any shaped as in TABAK-002. Before any Blaze deployment it needs a validation pass that recomputes the credit from the snapshots.

## Security assessment

- **Authorization:** sound for cross-user isolation.
- **Data integrity:** protected against honest-client errors (transactions, bounds, freezes). It isn't protected against an owner tampering with their own records, which is accepted and documented, and TABAK-002 shows the freezes are weaker than described.
- **Trust boundary:** client ↔ rules only. No secrets in the repo.
- **Workflows:** least-privilege, SHA-pinned, and with no untrusted-trigger patterns.

## Correctness assessment

- **Business logic:** the credit formula, snapshots and rollups are correct and match across platforms on the 76 contract fixtures and in source comparison.
- **Dates:** local-hour boundaries handle DST implicitly.
- **Concurrency:** the transactions hold all financial invariants, with two bounded failures (C6 tracker cap, C8 / TABAK-001).
- **Cross-platform:** the calculators are equivalent; the service layers diverge (TABAK-003, TABAK-005).

## Performance assessment

- **Measured:** the precache is 1.93 MiB, `heic2any` is correctly lazy and excluded, and the Firebase chunk is 175 KB gzip.
- **Estimated** (assumptions in `08`): Android cold start costs about 730 more reads than web for 2 years of history (TABAK-003). Web uses the memory cache, so each cold start re-reads the listener windows.

## Testing assessment

- Every runnable suite passed: web 622, rules 180, Functions 69 + 30 integration suites, Kotlin 221 + 59 + 2, PWA 27, a11y 0 violations, plus the gate self-tests.
- The suite is strong on rules and transactions.
- The gaps align with the findings: delete + recreate, the copy/behaviour contract, Android reconcile cost, and Kotlin invalid counts.

## CI/CD assessment

- **Strong:** exact-SHA release gating, immutable tags, signature verification, checksums, SHA-pinned actions, a functions-deploy guard.
- **Recommended minimal mandatory gates on `main`:** `validate-action-pins`, `mobile`, `web-and-rules`, `functions`.
- **Enhancements:** build provenance or SBOM, and Gradle dependency verification.

## Privacy and accessibility

- **Privacy:** no analytics or crash SDKs, a full export, a complete client wipe, backups disabled on Android. Open questions: Art. 9 classification, tombstone retention, Google Fonts (self-host to remove it).
- **Accessibility:** axe reports 0 violations, contrast and 200% reflow pass. TalkBack and screen-reader checks are manual and outstanding.

## Remediation roadmap

Nothing below has been implemented. Each item waits for explicit authorization and then goes on its own branch, one change at a time, with regression tests.

| Order | Item | Type | Effort | Compatibility risk |
|---|---|---|---|---|
| 1 | **TABAK-003:** switch Android `listStaleOpenDays` to `where status == "open"` paging (web parity) | Safe minimal fix | S (≈ 20 lines + test) | None (same result set, auto index) |
| 2 | **TABAK-001 (minimal):** correct the close-day copy on web and Android | Safe minimal fix | XS | None |
| 3 | **TABAK-005:** Kotlin repository rejects invalid caller counts (`INVALID_COUNT`) | Safe minimal fix | S | None for the shipped UI |
| 4 | **TABAK-002 (docs):** reword "frozen / one-way" claims to "against in-place updates" in `SECURITY.md`, the README and the rules comment | Docs | XS | None |
| 5 | **TABAK-002 (rules, optional):** allow client `days` deletes only when the profile is tombstoned | Rules change, needs approval | S + rules tests | At `ec8bdf7` both clients delete days only in the wipe, after tombstoning. **Before deploying, confirm the same for the oldest APK still in use**, because there's no forced update |
| 6 | **TABAK-001 (product option):** additive-only snapshot stamp on closed days (rules + both clients) | Design change, needs a product decision | M | A rules deploy before the clients; old clients keep today's behaviour |
| 7 | CI-1: confirm required checks; CI-2/CI-6 provenance, SBOM, dependency verification | Ops / enhancement | S–M | None |
| 8 | Dev-dependency highs: take the next `firebase-tools` through Dependabot | Maintenance | XS | Low |
| 9 | Seeded differential and DST contract fixtures (`04`) | Test enhancement | M | None |
| 10 | Legal review items (`09`) | Non-engineering | — | — |

Architectural proposals kept separate from the fixes:

- Extract a shared "write-path contract" test set at the repository and service layer (both platforms).
- Before any Option B deployment, add recompute-on-ingest to `migrateAccount`.

## Remediation status (branch `fix/audit-2026-11-12-safe-fixes`, not pushed)

| Item | Change | Regression test |
|---|---|---|
| TABAK-003 | `listStaleOpenDays` queries `status == "open"` (doc-id order = date order) instead of scanning all days. The legacy-claim day create sets `status = "open"` explicitly | `FirebaseRegistryRepositoryTest.testD3b_…` (instrumentation, 2,100 closed days + 1 stale day). Compiled here; **not run** (no emulator/device) |
| TABAK-001 (minimal) | Close-day dialog copy shared as `CLOSE_DAY_CONFIRM_MESSAGE` (web `constants/ui.js`, Android `TrackScreen.kt`). The web button hint "(you can keep logging)" was corrected too, found during browser verification | `webApp/src/constants/closeDayCopy.test.js` (includes an exact web↔Kotlin parity check), `CloseDayCopyTest.kt` |
| TABAK-005 | `InputSanitizer.validateCounts` rejects with `INVALID_COUNT`. It's used for caller input in `updateHistoricalDay`, `createManualEntry`, `updateHistoricalLog`, `createManualLogAtomic` and `updateManualLogAtomic`; stored-state paths still filter. `RegistryErrorMapper` maps the code | `ErrorAndInputPolicyTest.validateCountsRejectsEveryInvalidCallerValue`, `invalidCountIsMappedToAnActionableMessage` |
| TABAK-002 (docs) | "Frozen / one-way" now says "against in-place updates" in `SECURITY.md`, `README.md`, `docs/PORTFOLIO_CASE_STUDY.md` and the `firestore.rules` comments. Rule logic is unchanged | n/a (comments only; the rules suite was re-run) |

## Verification matrix

| Claim | Evidence |
|---|---|
| No cross-user access | `firestore.rules:46–48, 709–833`; rules suite 180/180; catch-all `:831` |
| Freezes bypassable | PROBE-1 (`zz_auditprobe.rules.test.js`, kept outside the repo; reproducible from the snippet in `02`) |
| Closed-day unstamped tap refused | `registryService.js:274`; `FirebaseRegistryRepository.kt:229`; `registryService.emulator.test.js:231–239`; copy `App.jsx:617`, `TrackScreen.kt:217` |
| Android full-history reconcile | `FirebaseRegistryRepository.kt:517–548`; `RegistryViewModel.kt:498–519`; web contrast `registryService.js:899–903` |
| Kotlin filters invalid counts | `InputSanitizer.kt:22–29`; `FirebaseRegistryRepository.kt:553, 764`; UI guard `ManualEntryForm.kt:182, 207` |
| Lease blocks writes | `firestore.rules:321–328`; `registryService.js:567–577`; `useRegistry.js:631–634` |
| Prod web deps clean | `npm audit --omit=dev` → 0 |
| Release gated on exact-SHA CI | `release-android.yml` `require-ci` → `check-release-ci.py`; `test-release-safety.py` 9/9 |
| Test results | `10_TEST_REPORT.md` (commands and counts) |

## Remaining audit gaps

- Android instrumentation, TalkBack, and device performance and memory.
- GitHub branch-protection and environment-reviewer settings.
- Gradle dependency CVE scan.
- Line-by-line review of all 44 Compose UI files and every React component. They were spot-checked for copy, inputs and error mapping; the data and security-relevant paths were read in full.
- Functions: auth gates and the deploy guard were reviewed, and the unit and integration suites ran green. I didn't review the full financial logic line by line, because it isn't deployed.
- iOS: it's a stub and not a release target, so it was out of scope.
