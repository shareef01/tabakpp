# TABAK++ Phase 8 Real Staging Activation & RC1 Release Evaluation Report

- **Date**: 2026-10-22
- **Lead Release / QA Engineer**: Antigravity Autonomous Agent (Gemini 3.8 Flash)
- **Repository**: `shareef01/tabakpp`
- **Active Branch**: `feature/staging-launch-qa`
- **Pull Request**: PR #119 (`feat(staging): verify isolated environment, complete release QA, and prepare RC1`)
- **Base Commit**: `342501e`
- **Production Firebase Target (Protected)**: `tabakpp-ff036` (Hosting site: `tabakpp`, Firestore: `eur3`)
- **Proposed Staging Project**: `tabakpp-staging`

---

## 1. Executive Summary & Objective

The primary objective of Phase 8 was to transition the extensive emulator-based QA completed in Phase 7 into a live, safely deployed staging application on Firebase, perform real cloud cross-platform integration QA, and produce an evidence-based Release Candidate 1 (RC1) decision.

### Key Outcomes
1. **Google Cloud Project Creation Quota (Infrastructure Blocker Confirmed)**:
   - An autonomous attempt to provision the staging project `tabakpp-staging` via the Firebase CLI failed due to project creation quota exhaustion on the account `shareef2189@gmail.com`.
   - In accordance with non-negotiable safety rules, no existing projects were modified or deleted, no billing accounts were attached, and no unverified cloud deployments were simulated.
   - Cloud staging deployment remains strictly **BLOCKED** pending owner quota clearance.
2. **Staging Configuration Ambiguity Resolved**:
   - The API key and Web App identifiers present in `webApp/.env.staging.local` from Phase 7 were determined to be manually generated synthetic placeholders, not authentic Firebase-issued credentials.
   - Engineering controls were refactored to separate syntax/shape validation from authentic project-identity verification:
     - Relaxed arbitrary 39-character key length regex in `check-dist-config.mjs` to standard Firebase API key pattern `/AIza[0-9A-Za-z_-]{20,}/`.
     - Implemented `--disallow-placeholders` check (scoped to the inlined `apiKey` / `appId` config values) and added it to the `firebase.staging.json` predeploy hook.
     - Added live project existence verification in `webApp/scripts/deploy-staging.mjs` (`getFirebaseProjects()`). The wrapper fails closed both when `tabakpp-staging` is absent from the account and when the `firebase projects:list` lookup itself fails; only an explicit `--skip-project-check` bypasses it.
3. **Android Staging Build-Time Separation Implemented**:
   - Implemented a dedicated `staging` buildType in `androidApp/build.gradle.kts` (`applicationIdSuffix = ".staging"`).
   - Added `checkStagingFirebaseConfig` Gradle task that requires a dedicated `androidApp/src/staging/google-services.json` for the `tabakpp-staging` project and rejects production references, the wrong package, and placeholder credentials (see §5.2).
   - Provided `androidApp/src/staging/google-services.json.example` template.
4. **Authentication Provider Model Reconciled**:
   - Application UI code (`AuthScreen.jsx`) implements **Email/Password** and **Google OAuth** authentication.
   - Clarified that the "guest login" tests referenced in Phase 7 documentation were Android instrumentation tests leveraging `auth.signInAnonymously()` on the emulator, rather than an end-user UI feature.
5. **Final Release Candidate Decision**:
   - **Codebase Readiness**: **GO** (772+ tests passing, 0 lint warnings, configuration cache compliant, strict preflight safety guards active).
   - **Production Release**: **NO-GO** (Production deployment is gated on real cloud staging validation once quota is resolved).

---

## 2. Safety Constraints Verification

Throughout Phase 8 execution, all non-negotiable safety constraints were strictly enforced:
- [x] **Zero Production Modification**: Target `tabakpp-ff036` was never targeted, touched, or reconfigured.
- [x] **Zero Production Deployment**: Hosting, Firestore rules, and Auth deployment commands never targeted production.
- [x] **Zero Project Deletion**: No existing Firebase or Google Cloud projects were deleted or repurpose-scavenged.
- [x] **Spark Free Plan Maintained**: No billing accounts were linked or upgraded to Blaze.
- [x] **Zero Cloud Functions**: Architecture remains serverless/client-driven under the Spark free plan.
- [x] **LEGACY Mode Preserved**: No Option-B or ledger migrations were initiated.
- [x] **Offline Counter Mutation Rejection**: Counter mutations when offline continue to fail-closed with explicit error toast.
- [x] **Zero Production Credentials Used**: No production service account keys or environment files were used.

---

## 3. Infrastructure & Quota Inspection Details

### 3.1 Live CLI Execution
To determine whether the project creation quota blocker reported in Phase 7 remained, the following CLI command was executed autonomously:

```bash
firebase projects:create tabakpp-staging --display-name "tabakpp-staging" --non-interactive
```

### 3.2 Exact Failure Telemetry
```
Error: Failed to create project "tabakpp-staging". See firebase-debug.log for more info.
Operation: operations/create_project.global.5192748742160836859
Status: FAILED
Error Code: 8
Error Message: The project cannot be created because you have exceeded your allotted project quota.
```

### 3.3 Account Status Analysis
- **Authenticated Identity**: `shareef2189@gmail.com`
- **Active Firebase Projects**: 8 (`tabakpp-ff036`, `tabakpp-firebase`, `friendlypix-web`, `fir-canvas-11633`, `photogallery-fcf87`, `project-58079612053`, `reactfir-e8d19`, `shareef-portfolio-9c04a`)
- **Active GCP Projects**: 12 (Free-tier maximum reached)
- **Status**: Quota is definitively exhausted. Cloud provisioning cannot proceed autonomously without human account owner action.

---

## 4. Staging Configuration Engineering Resolution

### 4.1 Ambiguity Identified in Phase 7
In Phase 7, `webApp/.env.staging.local` was generated with:
- `VITE_FIREBASE_API_KEY=AIzaSyB_stagingKeyValidationQA001234567`
- `VITE_FIREBASE_APP_ID=1:100000000001:web:abcdef1234567890`

While syntactically conforming to earlier regex patterns, these values were synthetic mock tokens, not authentic Firebase-issued configuration. Earlier predeploy checks only verified string patterns, which created a risk of deploying builds with non-functional mock keys.

### 4.2 Engineering Changes Implemented
1. **Separation of Shape vs Authenticity**:
   - Modified `webApp/scripts/check-dist-config.mjs`:
     - Updated API key regex to `/AIza[0-9A-Za-z_-]{20,}/`, removing the arbitrary 39-character length expectation that risked false rejections on valid Google API keys.
     - Added `PLACEHOLDER_KEY_PATTERN = /(?:stagingKeyValidation|placeholder|dummy|mock|testKey|fakeKey|FROM_FIREBASE_CONSOLE|0000000000|abcdef1234567890|abcdef0123456789)/i`.
     - Added CLI flag `--disallow-placeholders`. The pattern is applied only to the inlined `apiKey` and `appId` values extracted from the build (`extractConfigValues()`), not to whole bundle text: real bundles legitimately contain `placeholder` (input props), `mockUserToken` (Firebase SDK), `__dummy__` (heic2any) and long zero runs (framer). If no `apiKey` value can be located, the check fails closed.
     - *Audit correction (2026-10-22):* the first implementation scanned entire bundle chunks, which matched those vendor strings and would have blocked every staging deploy, including ones with authentic credentials. Fixed and covered by regression tests.
2. **Guarded Deployment Configuration**:
   - Modified `firebase.staging.json`:
     ```json
     "predeploy": [
       "node webApp/scripts/check-dist-config.mjs webApp/dist --expected-project tabakpp-staging --forbid-project tabakpp-ff036 --target staging-app --require-actual-project --require-target --disallow-placeholders"
     ]
     ```
   - Modified `webApp/scripts/deploy-staging.mjs`:
     - Added `getFirebaseProjects()` check: verifies that the target project actually exists in the account's active Firebase project list before building or deploying.
     - Halts execution with an informative error if `tabakpp-staging` is unprovisioned, preventing phantom deployments.
     - Also halts if the project lookup fails (not logged in, CLI error, 15 s timeout). *Audit correction:* the first implementation silently skipped the check in that case.
     - `--allow-placeholders` is accepted only together with `--dry-run`; live deploys always enforce the placeholder check (the predeploy hook enforces it regardless).
3. **Automated Regression Suite**:
   - Added unit and isolation tests in `check-dist-config.test.mjs` and `staging-isolation.test.mjs`.
   - Verified that placeholder keys pass local syntax-only tests but fail preflight with `--disallow-placeholders`.
   - Verified that attempting to deploy against an unprovisioned project, or when the project lookup fails, halts execution fail-closed.
   - Verified that a config with authentic-looking values passes even when other chunks contain vendor strings such as `placeholder` and `mockUserToken`, and that the real `webApp/dist` passes once its synthetic key is replaced.

---

## 5. Android Staging Architecture

### 5.1 Gradle Build Separation
To allow Android QA to connect to the staging Firebase environment without risk of leaking into production, a dedicated `staging` buildType was introduced in `androidApp/build.gradle.kts`:

```kotlin
buildTypes {
    getByName("release") { /* minify + shrink, release signing (unchanged) */ }
    getByName("debug") { }
    create("staging") {
        initWith(getByName("debug"))
        matchingFallbacks += listOf("debug")
        applicationIdSuffix = ".staging" // package: com.tabakpp.app.staging
    }
}
```

### 5.2 Build Guard Task (`checkStagingFirebaseConfig`)
To prevent accidental connection to production `tabakpp-ff036`, a custom task was implemented:
- Inspects `androidApp/src/staging/google-services.json`. It runs before `preStagingBuild`, `processStagingGoogleServices*` and `compileStaging*`, or directly via `:androidApp:checkStagingFirebaseConfig`.
- Fails if the file is missing or is not valid JSON.
- Fails if the file mentions `tabakpp-ff036` anywhere, or if `project_info.project_id` is not exactly `tabakpp-staging`.
- Fails if no client has package `com.tabakpp.app.staging`.
- Fails if that client's `api_key[].current_key` is missing, or if it or `mobilesdk_app_id` matches the same placeholder pattern as the web guard. A verbatim copy of `google-services.json.example` is rejected.
- Configuration-cache compliant (`@InputFiles` `ConfigurableFileCollection` plus `@Input` properties; verified with `--configuration-cache`).
- *Audit correction (2026-10-22):* the first implementation passed silently when the file was missing and only searched for the `tabakpp-ff036` string. The "Task executed successfully" result previously recorded in §7 reflected that silent no-op.

---

## 6. Authentication Provider Reconciliation

Phase 7 documentation contained references to an "anonymous guest login flow". Investigation of the codebase revealed:
1. **Web Frontend (`webApp/src/components/AuthScreen.jsx`)**:
   - End-user authentication is implemented exclusively via **Email/Password** and **Google Sign-In** (`signInWithPopup` / `signInWithRedirect`).
   - There is no anonymous guest login button or user flow in the Web UI.
2. **Android Tests (`androidApp/.../AuthFlowTest.kt`)**:
   - The Android instrumentation test suite utilized Firebase Auth's `signInAnonymously()` on the local Firebase Auth Emulator to seed synthetic test users without external network interaction.
3. **Documentation Alignment**:
   - `STAGING_QA_REPORT.md` and `STAGING_DEPLOYMENT_RUNBOOK.md` were updated to reflect this distinction. Staging authentication requirements require Email/Password and Google OAuth for end users.

---

## 7. Verification Matrix & Test Summary

All local unit, component, contract, PWA, script, and security rules tests were executed and passed cleanly:

| Test Suite | Scope | Target | Result | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **ESLint** | Static Analysis | `webApp/` | **PASS** | 0 errors, 0 warnings |
| **Vitest Unit & Component** | Core Application Logic | `webApp/src/` | **PASS** | 34 files, 550 tests passed |
| **Staging Script Regressions** | Preflight & Deployment Guards | `webApp/scripts/` | **PASS** | 54 tests passed (50 + 4 audit regressions) |
| **Domain Contract Parity** | Web vs Kotlin Multiplatform | Shared Schemas | **PASS** | 76 tests passed |
| **PWA Lifecycle & Precache** | Service Worker & Offline Cache | `webApp/` | **PASS** | 27 tests passed |
| **Firestore Security Rules** | Client Permission & Isolation | Emulator | **PASS** | 88 assertions passed |
| **Android Unit Tests** | Shared & Android App | `:androidApp`, `:shared` | **PASS** | Gradle BUILD SUCCESSFUL |
| **Staging Config Guard** | Staging Firebase Checker | `:androidApp:checkStagingFirebaseConfig` | **PASS** | Exercised with missing file, example copy, production project and wrong package (each rejected) and a realistic staging config (accepted) |

---

## 8. Release Candidate Evaluation Gates

| Gate | Category | Evaluation | Basis / Status |
| :--- | :--- | :--- | :--- |
| **Gate 1** | Code Verification | **PASS** | 550 unit tests, 76 contract tests, 54 script tests, Gradle builds all green; 0 lint issues. |
| **Gate 2** | Firebase Staging Readiness | **BLOCKED** | Project creation quota exhausted on Google Cloud account `shareef2189@gmail.com`. |
| **Gate 3** | Web Integration Readiness | **PASS (Emulator)**<br>**BLOCKED (Cloud)** | 65 emulator integration tests passing; Real cloud web hosting blocked by Gate 2. |
| **Gate 4** | Android Integration Readiness | **PASS (Emulator)**<br>**BLOCKED (Cloud)** | 31 emulator instrumentation tests passing; dedicated `staging` buildType created; Cloud blocked by Gate 2. |
| **Gate 5** | Security Readiness | **PASS** | 88/88 Firestore security rules, client-isolation verified, `--disallow-placeholders` preflight active (scoped to Firebase config values; verified not to false-positive on real bundles). |
| **Gate 6** | Production Release Readiness | **NO-GO** | Blocked pending unblocking of Gate 2 and live cloud staging acceptance. |

---

## 9. Final Decision & Recommendation

### Recommendation: **NO-GO FOR PRODUCTION RC1 RELEASE AT THIS TIME**

- **Codebase Status**: **READY** for staging deployment. The branch `feature/staging-launch-qa` contains all necessary safeguards, build configurations, and test coverage.
- **Release Decision**: **NO-GO** for production deployment to `tabakpp-ff036`. Releasing directly to production without real cloud staging validation would violate the release criteria and bypass end-to-end integration verification on Google Cloud infrastructure.

### Action Plan for Repository Owner
To unblock Real Staging Activation:
1. **Option A (Quota Request)**: Submit a Google Cloud Project Quota Increase request via the [Google Cloud Console Quotas Page](https://console.cloud.google.com/iam-admin/quotas) for account `shareef2189@gmail.com`.
2. **Option B (Project Deletion/Archive)**: Delete or shut down one unused existing GCP project (e.g., test or deprecated projects) to free up project quota.
3. Once quota is available, execute:
   ```bash
   firebase projects:create tabakpp-staging --display-name "tabakpp-staging"
   ```
4. Register Web and Android apps, obtain authentic credentials, and run `npm --prefix webApp run deploy:staging:rules` and `npm --prefix webApp run deploy:staging:hosting`. Android: place the real config at `androidApp/src/staging/google-services.json` (the Gradle guard validates it).
