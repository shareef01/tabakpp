# 06 — Kotlin Multiplatform and Android

## Inspected

- `FirebaseRegistryRepository.kt`: write paths, reconcile, export, deletion, legacy claim.
- `RegistryViewModel.kt`: init collectors at `:350–531` and the mutation entry points.
- `InputSanitizer.kt`, `SmokingCalculator.kt` (date and credit functions), `AndroidManifest.xml`, `data_extraction_rules.xml`, the network security configs, `androidApp/build.gradle.kts` (signing and versionCode) and `libs.versions.toml`.
- The Android lint report produced in this audit.

## Findings

### TABAK-003 — Android stale-day reconcile scans the whole `days` history on every start or day change

- **Severity:** Medium (P2: cost and reliability). **Classification:** confirmed defect (performance; correctness at scale). **Confidence:** confirmed by source analysis. I didn't measure it on a device.
- **Affected:**
  - `shared/.../data/FirebaseRegistryRepository.kt:517–548` (`listStaleOpenDays`)
  - Callers: `:507–515` and `RegistryViewModel.kt:498–519`
- **Evidence:**
  - The query is `days.orderBy("date", ASC).limit(200)`, paged up to 10 times. Each page decodes every document and keeps only `status == "open"`, and it stops only on reaching a date ≥ today.
  - The collector runs on every `combine(userUid, _trackingDay)` emission: app/VM start, sign-in and each tracking-day change.
  - The web equivalent queries `where('status','==','open')` (`registryService.js:899–903`) and reads only open days.
- **Impact:**
  - **Cost.** Each run is billed as roughly N document reads for an account with N tracked days, up to 2000 reads. For a user with 2 years of daily use, that's about 730 reads per Android cold start, on top of the 400-doc live `days` listener. Firestore read billing scales linearly with history; on Spark it eats into the 50k/day free quota.
  - **Correctness.** With more than 2000 day docs, the 10-page cap ends the scan before it reaches recent dates. Recent stale open days are then **never** reconciled on Android: their credit stays out of `lifetimeAggregates` until a web session reconciles them.
- **Recommended fix:** Mirror the web query: `daysCollection.where { "status" equalTo "open" }.limit(pageSize)`, paged with `startAfter`. Equality on one field is auto-indexed, and the implicit `__name__` order is date order because the doc id is the date. Then filter `date < currentTrackingDate` client-side. The Option B branch (`:506`) keeps using the same function.
- **Regression test:** An Android instrumentation or emulator test with 250 closed days plus 1 stale open day. Assert that the stale day closes and that the query reads ≤ 2 pages. A JVM test with a fake repository can assert the query shape.

### TABAK-005 — see `04_CROSS_PLATFORM_AUDIT.md` (repository filters invalid counts)

## No significant findings (with what was checked)

- **Structured concurrency.** Collectors live in `viewModelScope`, and `authUser.collectLatest` cancels per-session bootstrap work on sign-out. The 30 s tracking-day poll is UI-only, because mutations re-derive their date.
- **Transactions.** Every read happens before any write (documented and followed). `decodeExistingDay` fails closed instead of overwriting an undecodable day (`:211–214`).
- **Backup and transfer.** `android:allowBackup="false"`, and the data-extraction rules exclude every domain. Locally there are only accent preferences.
- **Network security.** The production manifest has no custom config. The debug config (`src/debug/res/xml/network_security_config_debug.xml`) trusts user CAs; lint flags it as "release", but it's wired only from `src/debug/AndroidManifest.xml:17`. The staging variant doesn't inherit `src/debug` (per the CI comment). No release exposure.
- **Release signing.** Credentials come from environment secrets. CI verifies the APK with `apksigner verify --print-certs` and publishes a SHA-256 checksum. The `versionCode` derivation rejects collisions (`build.gradle.kts:13–57`).
- **Lint** (`:androidApp:lintDebug`): 0 errors and 10 warnings: `UseTomlInstead` ×5, `MonochromeLauncherIcon` ×2, `OldTargetApi` (targetSdk 36 < compileSdk 37), `ObsoleteSdkInt` and `AcceptsUserCertificates` (the debug-only false positive above).
- **Deprecations.** The prior audit's two KMP deprecation warnings (`startAfter`, `kotlin.time.Instant`) are still open (P3).
- **Not verified:** process recreation, TalkBack and real-device lifecycle. Instrumentation (`connectedDebugAndroidTest`) needs an emulator or device and **wasn't run** in this audit.
