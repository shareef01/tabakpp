# TABAK++ Release Candidate (RC1) Production Release Checklist

- **Target Release**: TABAK++ RC1 (UI/UX Navigation Redesign & Staging Safeguards)
- **Merged PRs Included**: PR #117 (UI/UX overhaul), PR #118 (Staging safeguards)
- **Base Commit**: `9c7dbeb`
- **Protected Production Target**: `tabakpp-ff036` (Hosting site `tabakpp`, Firestore `eur3`)
- **Financial Architecture**: `LEGACY` / Spark Free Tier (Zero Blaze, Zero Cloud Functions)
- **Authorizing Role**: Repository Owner / Release Engineer

---

## 1. Release Gates & Sign-Off Criteria

All release gates must be explicitly evaluated before authorizing an RC1 production release.

### Gate 1: Code Verification — **PASS**
- [X] **Static Code Quality / ESLint**: 0 errors, 0 warnings (`npm --prefix webApp run lint`).
- [X] **Web Build Transpilation**: Clean build without errors (`npm --prefix webApp run build`).
- [X] **Unit & Component Tests**: 550 / 550 Vitest tests passing (`npm --prefix webApp run test:run`).
- [X] **Domain Contract Parity**: 76 / 76 contract checks passing between Web and Kotlin Multiplatform (`npm --prefix webApp run test:contract`).
- [X] **Android Gradle Unit Tests**: `:shared:testDebugUnitTest`, `:composeApp:testDebugUnitTest`, `:androidApp:testDebugUnitTest` passing.

### Gate 2: Firebase Staging Readiness — **BLOCKED**
- [ ] **Real Cloud Project Provisioning**: **BLOCKED** by Google Cloud Project Creation Quota on account `shareef2189@gmail.com` (Error Code 8: `QuotaFailure`).
- [X] **Staging Safeguards & Target Isolation**: Staging targets isolated in `.firebaserc` (`staging-app`), `firebase.staging.json` configured with `--disallow-placeholders`.
- [X] **Deployment Guarding**: `webApp/scripts/deploy-staging.mjs` verifies live project presence in `firebase projects:list` and rejects unprovisioned/placeholder environments fail-closed.
- [X] **Zero Cost Incurred**: Spark Free Tier verified. No billing account attached.

### Gate 3: Web Integration Readiness — **PASS (Emulator) / BLOCKED (Real Cloud Staging)**
- [X] **Emulator Integration QA**: 65 / 65 service and concurrency integration tests passing (`registryService`, `dailyLedger`, `offlineBehavior`).
- [X] **PWA Lifecycle & Offline Shell**: 27 / 27 scenarios passing (precache, service worker lifecycle, offline shell, offline counter rejection).
- [X] **Accessibility & Visual Quality**: Axe-core 16 view/viewport permutations passed with 0 violations; WCAG AA contrast; 200% zoom reflow verified.
- [ ] **Real Cloud Staging Web QA**: **BLOCKED** pending Google Cloud project creation quota resolution.

### Gate 4: Android Integration Readiness — **PASS (Emulator & Build Config) / BLOCKED (Real Cloud Staging)**
- [X] **Staging Build Configuration**: Dedicated `staging` buildType created in `androidApp/build.gradle.kts` with `applicationIdSuffix = ".staging"`.
- [X] **Production Accidental Leak Guard**: `checkStagingFirebaseConfig` Gradle task enforces dedicated `src/staging/google-services.json` and blocks building staging with production `tabakpp-ff036`.
- [X] **Android Instrumentation (Emulator)**: CI Run `39718077899` verified with 31 / 31 tests passed on Android Emulator API 35.
- [ ] **Real Cloud Staging Android QA**: **BLOCKED** pending staging Firebase project creation and genuine `google-services.json` issuance.

### Gate 5: Security Readiness — **PASS**
- [X] **Firestore Security Rules**: 88 / 88 rules security assertions passing against Firestore Emulator (`npm --prefix webApp run test:rules`).
- [X] **Rules Guard**: `check-rules-project.mjs` prevents cross-project security rule overwrites.
- [X] **Client Authorization Integrity**: User data isolation enforced; counter mutations rejected offline; legacy financial mode preserved without Cloud Functions.
- [X] **Configuration-Shape vs Project-Identity Separation**: Flexible API key length regex `/AIza[0-9A-Za-z_-]{20,}/` and placeholder rejection enforced.

### Gate 6: Production Release Readiness — **NO-GO**
- [ ] **Overall Decision**: **NO-GO FOR PRODUCTION RELEASE** until Gate 2 (Firebase Staging Provisioning) is unblocked and verified on real cloud infrastructure.
- [X] **Codebase Readiness**: The codebase on branch `feature/staging-launch-qa` is fully verified, stable, and ready for staging deployment immediately upon quota clearance.

---

## 2. Production Deployment Execution Steps

> **IMPORTANT**: Production deployment must be executed by the authorized repository owner.

### Step 1: Synchronize with Latest `main`
```bash
git checkout main
git pull origin main
```

### Step 2: Build Production Bundle
Ensure `webApp/.env.local` contains the verified production Firebase credentials (`tabakpp-ff036`):
```bash
npm --prefix webApp run build
```

### Step 3: Run Production Predeploy Verification
```bash
node webApp/scripts/check-dist-config.mjs webApp/dist \
  --expected-project tabakpp-ff036 \
  --forbid-project tabakpp-staging
```
Expected output:
```
✔ Web build has valid Firebase config for tabakpp-ff036.
```

### Step 4: Deploy Production Hosting Only
```bash
npx --prefix webApp firebase deploy --only hosting --project tabakpp-ff036
```
> **Security Rule Precaution**: Do **NOT** deploy `firestore:rules` unless security rule changes are explicitly intended. The current production rules are stable.

---

## 3. Post-Deployment Smoke Tests (Production Live Site)

Immediately upon deploying to `https://tabakpp.web.app`:
1. **PWA Freshness**: Open the site in an Incognito / private browsing window. Verify HTTP 200 and version freshness.
2. **Navigation Bar**: Verify bottom navigation dock displays visible labels: `Track`, `History`, `Settings` with active accent indicator.
3. **Authentication**: Test login with existing test account and verify profile loading.
4. **Counter Increment**: Test incrementing primary counter by 1. Verify Firestore updates without latency or errors.
5. **History Loading**: Verify previous historical days render properly in chart and table views.
6. **Console Audit**: Inspect browser DevTools Console for zero uncaught exceptions or failed network requests.

---

## 4. Emergency Rollback Plan

### 4.1 Immediate Hosting Rollback (Under 60 Seconds)
In case of unforeseen production regression on the web frontend:
1. Open the [Firebase Hosting Console](https://console.firebase.google.com/project/tabakpp-ff036/hosting/sites/tabakpp).
2. Under **Release history**, locate the release prior to the current deployment.
3. Click the three dots `⋮` and select **Roll back**.
4. Alternatively, roll back via CLI:
   ```bash
   npx --prefix webApp firebase hosting:clone tabakpp:<PREVIOUS_VERSION_ID> tabakpp:live --project tabakpp-ff036
   ```

### 4.2 Data & Security Rules Rollback Limitations
- **Hosting Rollback**: Reverts static assets and frontend JavaScript immediately.
- **Database Writes**: Cannot be rolled back via Hosting rollback. Any user records created during an issue must be addressed via manual administration.
- **Security Rules**: Reverting rules requires re-deploying the previous `firestore.rules` commit.

---

## 5. Human Sign-Off & Release Authorization

| Role | Name / Identity | Decision | Date & Signature |
| :--- | :--- | :--- | :--- |
| **Lead QA Engineer** | Autonomous Agent (Gemini 3.8 Flash) | **NO-GO FOR PRODUCTION RELEASE**<br>(Codebase verified; Cloud Staging blocked by GCP Quota) | 2026-10-22 (Verified via test suites & staging guards) |
| **Repository Owner** | `shareef01` | *Pending Quota Clearance & Owner Action* | `___________________________` |

