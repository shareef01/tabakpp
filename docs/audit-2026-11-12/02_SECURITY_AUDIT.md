# 02 — Threat model and security audit

Commit `ec8bdf7`. Production is Spark/`LEGACY`; nothing in `functions/` is deployed.

## Threat model

| Element | Detail |
|---|---|
| Protected assets | Per-user consumption history (health-adjacent behavioural data), settings, avatar image, lifetime totals; account existence |
| Actors | Anonymous visitor; authenticated owner using the official client; authenticated owner with a modified client or raw REST calls (no App Check); another authenticated user attempting cross-account access; holder of a stolen device/session |
| Entry points | Firestore REST/gRPC via client SDKs; Firebase Auth (email/password, Google); hosting (static PWA); undeployed callables |
| Privileged operations | Profile `financialMode` transitions, account wipe, legacy migrations, lifetime-aggregate writes |
| Key assumption | Rules are the only server-side control. An owner's own financial numbers are **not** integrity-protected against that owner. This is documented in `SECURITY.md` and `docs/financial-semantics.md` |

## Verified controls (no finding)

Inspected: every `match` block and helper in `firestore.rules` (lines 46–833). Evidence comes from the 180-test rules/emulator suite, which passed, plus 7 adversarial probes written for this audit (`zz_auditprobe.rules.test.js`, run on the Firestore emulator; kept outside the repo).

- **Cross-user isolation.** Every path uses `isOwner(userId)` (`request.auth.uid == userId`). The catch-all `match /{document=**}` denies everything else (`firestore.rules:831`). The suite covers cross-user reads and writes. I found no path that reads or writes another uid.
- **Unauthenticated access.** It's denied everywhere, because `isOwner` requires `request.auth != null`.
- **Mode lock.** A client can't change `financialMode` (`:720`). A profile can only be created as `LEGACY` (`:391`). A locked profile can't be deleted (`:741`), and a tombstone can't drop the mode (`validDeletionUpdate`, `:353`).
- **Server-only namespaces.** `trusted*` collections are deny-all (`:813–827`).
- **Settings/mutation split.** Settings writes can't touch aggregates, and mutation writes can't touch identity or economics (`isSettingsOnlyUpdate` / `isMutationOnlyUpdate`). `createdAt` is immutable after create.
- **Bounds.** Counts are whole numbers in 0–10000. Count maps hold ≤ 25 keys on days and ≤ 50 on logs. Snapshot maps hold ≤ 8 keys, the avatar is ≤ 100 KB, names are ≤ 100/80 characters, and dates match the regex.
- **Expression budget.** The unrolled validators are deliberate. The comments document the 1000-expression per-commit cap, and the suite exercises multi-document commits.
- **Authentication flows.** Persistence is `browserLocalPersistence`. Redirect results are processed before `onAuthStateChanged`. On a uid change, `useRegistry` clears all state before it attaches new listeners (`useRegistry.js:186–229`), so I found no stale-account bleed-through. Deletion needs a recent login (re-auth in `SettingsScreen.jsx:334–340`). Auth deletion retries 3 times, then signs out (`deleteAuthUserAfterWipe.js`). A wipe that's interrupted can be retried, because the tombstone keeps the subcollections deletable (`accountDeletable`).
- **Client-only authorization.** No operation relies only on a client-side check for **cross-user** safety. Client-side checks (`MAX_TRACKERS`, future-date backfill, `financialWritesLocked`) cover **own-account** semantics only (see the design limitations).

## Findings

### TABAK-002 — Closed-day freezes can be bypassed with delete + recreate

- **Severity:** Low. **Classification:** design limitation; the documentation overstates the guarantee. **Confidence:** confirmed by execution (PROBE-1).
- **Affected:** `firestore.rules:766–774` (`days` create/delete), `:602–612` (the freezes in `validDayUpdate`). Docs: `SECURITY.md:19`, `README.md` "Closed days: trackerSnapshots frozen", and the rules comment at `:606–607` ("prevents a client from re-triggering a credit").
- **Evidence:** On a seeded closed, folded day, the owner's `updateDoc` of `trackerSnapshots`, `foldedIntoLifetime:false` or `status:'open'` is **denied**. But `deleteDoc(day)` followed by `setDoc(day, {status:'open', foldedIntoLifetime:false, trackerSnapshots:{t1:{target:1000, unitPrice:1000}}, …})` is **allowed**. A later batch that re-folds it (`status:'closed', foldedIntoLifetime:true` plus a lifetime update) is also allowed.
- **Root cause:** The delete rule only requires `accountDeletable` (no lease held, or the account is tombstoned). Create validates shape, not history, so "one-way" holds per document version, not per date.
- **Impact:** The data affected is the owner's own. The owner can already write `lifetimeAggregates` directly within bounds (an accepted residual), so this adds no new capability against other users. What it does mean is that the stated invariants ("snapshot frozen", "cannot re-trigger a credit") aren't storage guarantees. That matters for (a) documentation accuracy, and (b) any future Option B `migrateAccount` that would read client-written days as historical truth.
- **Recommended fix:**
  1. Minimal fix: correct the wording in `SECURITY.md`, the README and the rules comment to say the freeze applies "against in-place updates".
  2. Optional fix: restrict client `days` deletes to tombstoned accounts, i.e. `allow delete: if isOwner(userId) && !financialLocked(...) && get(/…/users/$(userId)).data.get('deleting', false) == true`. Both clients' only day-delete path is the account wipe, which tombstones the profile first (`registryService.js:1308–1314`, `FirebaseRegistryRepository.kt:1494`), so this doesn't break existing flows.
- **Regression test:** Add a rules test that a closed day can't be deleted while the profile isn't tombstoned and can be once it is, plus the existing wipe emulator tests.

### TABAK-007 — Rules hygiene: configs without a profile; owner self-tombstone

- **Severity:** Low (P3). **Classification:** design limitation. **Confidence:** confirmed by execution (PROBE-2, PROBE-5).
- **Affected:** `firestore.rules:325–328` (`accountWritable` treats a missing profile as writable) and `:747` (configs don't check `financialLocked`, so a missing profile doesn't fail them, whereas `days`/`logs` creates without a profile are denied, per PROBE-3). Also `:711`, which lets anyone create their own profile as a bare `{deleting:true}`.
- **Impact:**
  - Orphan `configs` can exist without a profile. That's harmless, because the bootstrap creates the profile.
  - An owner with a raw API call can permanently brick their own account: no un-tombstone path exists (PROBE-4), and recovery needs Auth deletion. The impact is self-inflicted only.
- **Recommendation:** Accept and document. If tightened, require `exists(profile)` for configs create.

### Secrets and supply chain

- **Secret scan.** I ran a pattern scan over tracked files and history for private keys, AWS/GitHub/Slack/OpenAI token shapes, service-account JSON, keystores and `.env` files. gitleaks, trufflehog and osv-scanner aren't installed, so I didn't run them.
  - Six Google-API-key-shaped strings exist. All of them are synthetic or emulator placeholders: two are documented as synthetic in `PHASE_8_REAL_STAGING_EXECUTION.md` §4.1, one is the emulator config in `android-integration.yml`, and the rest are test fixtures. **No credential was found.** I've deliberately left the values out of this report.
  - `.gitignore` excludes `google-services.json`, keystores and `.env*`, and the history contains no such file.
- **Workflows.** Top-level `permissions: contents: read`; `contents: write` appears only in the `release` job, behind `environment: release`.
  - No `pull_request_target`, `workflow_run` or untrusted-input interpolation into `run:` was found. `RELEASE_VERSION` is validated with a SemVer regex before use.
  - All `uses:` are SHA-pinned, and `validate-action-pins.py` enforces that in CI.
  - Secrets are scoped to individual steps.
  - The release job restores the `setup-java` Gradle cache on `main`. PR-scoped caches aren't visible to `main`, so cache poisoning would need a merged change. Low risk.
- **Firebase web config.** It's public by design and is not treated as a leak. API-key restrictions are not presented as authorization (`firestore.rules:4–9`).
- **CSP** (`firebase.json`). `script-src 'self' https://www.gstatic.com https://apis.google.com`, `frame-ancestors 'none'` and `object-src 'none'`. `style-src` keeps `'unsafe-inline'` (common for CSS-in-JS and Tailwind; low risk with no inline scripts).
- **Dependency advisories:** see `12_DEPENDENCY_AUDIT.md`. None are reachable in shipped code.
