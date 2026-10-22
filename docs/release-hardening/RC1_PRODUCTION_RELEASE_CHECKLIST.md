# TABAK++ Release Candidate (RC1) Production Release Checklist

- **Target Release**: TABAK++ RC1 (UI/UX Navigation Redesign & Staging Safeguards)
- **Merged PRs Included**: PR #117 (UI/UX overhaul), PR #118 (Staging safeguards)
- **Base Commit**: `9c7dbeb`
- **Protected Production Target**: `tabakpp-ff036` (Hosting site `tabakpp`, Firestore `eur3`)
- **Financial Architecture**: `LEGACY` / Spark Free Tier (Zero Blaze, Zero Cloud Functions)
- **Authorizing Role**: Repository Owner / Release Engineer

---

## 1. Release Gates & Sign-Off Criteria

All criteria must be explicitly verified and marked `[X]` before initiating production deployment.

### Gate A: Static Code Quality & Linting
- [X] **ESLint Check**: 0 errors, 0 warnings (`npm --prefix webApp run lint`).
- [X] **TypeScript / Build Transpilation**: Clean build without errors (`npm --prefix webApp run build`).
- [X] **Clean Git Working Tree**: No untracked files, no credentials, no temporary artifacts committed.

### Gate B: Web & Emulator QA Test Suite
- [X] **Core Vitest Suites**: 546 / 546 unit and component tests passing.
- [X] **Firestore Security Rules**: 88 / 88 rules security assertions passing against Firestore Emulator.
- [X] **Emulator Integration Suites**: 65 / 65 service and concurrency integration tests passing (`registryService`, `dailyLedger`, `offlineBehavior`).
- [X] **Domain Contract Parity**: 76 / 76 contract checks passing between Web and Kotlin Multiplatform.
- [X] **PWA Regression Suite**: 27 / 27 scenarios passing (precache, service worker lifecycle, offline shell).

### Gate C: Accessibility & Visual Quality
- [X] **Axe-Core Automated Audit**: 16 view/viewport permutations passed with 0 violations across 320px, 390px, 768px, and 1440px.
- [X] **Color Contrast**: All 10 accent swatches verified passing WCAG AA contrast guidelines.
- [X] **WCAG 1.4.10 200% Zoom Reflow**: 640px equivalent desktop view verified free of horizontal scroll.
- [X] **Visual Screenshots**: Clean renders captured for desktop and mobile views with zero console errors.

### Gate D: Android & Cross-Platform Integrity
- [X] **Gradle Unit Tests**: `:shared:testDebugUnitTest`, `:composeApp:testDebugUnitTest`, `:androidApp:testDebugUnitTest` all passed (BUILD SUCCESSFUL).
- [X] **Android Instrumentation**: Post-merge CI Run `39718077899` verified with 31 / 31 tests passed on emulator API 35.
- [X] **Navigation Alignment**: Bottom navigation labels, active indicators, and text scaling verified across Compose and Web.

### Gate E: Infrastructure & Safety Safeguards
- [X] **Target Separation**: Staging targets isolated in `.firebaserc` (`staging-app`). Production target remains `tabakpp`.
- [X] **Predeploy Guard**: `check-dist-config.mjs` verifies that production deployments require explicit production Firebase config and rejects staging configurations.
- [X] **Rules Guard**: `check-rules-project.mjs` prevents cross-project security rule overwrites.
- [X] **Zero Cost Incurred**: Confirmed Spark Free Tier throughout. No billing account attached.

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
| **Lead QA Engineer** | Autonomous Agent (Gemini 3.8 Flash) | **RECOMMENDED: GO** | 2026-10-22 (Verified via 772 tests) |
| **Repository Owner** | `shareef01` | *Pending Owner Sign-Off* | `___________________________` |
