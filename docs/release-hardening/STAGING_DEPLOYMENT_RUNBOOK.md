# TABAK++ Staging Deployment Runbook

- **Document Version**: 1.0.0
- **Status**: Active / Production-Guarded
- **Applies to**: Firebase Staging Infrastructure for TABAK++
- **Target Project ID**: `tabakpp-staging` (Location: `eur3`, Spark Plan)
- **Production Project (Protected)**: `tabakpp-ff036`

---

## 1. Overview & Architecture Boundaries

This runbook describes the procedure for provisioning, configuring, building, and deploying TABAK++ to an isolated Firebase Staging environment.

### Critical Guardrails:
1. **Never target `tabakpp-ff036`**: The production project is strictly protected by automated predeploy hooks.
2. **Spark Tier Free Limits**: Staging operates solely within the Spark plan. No billing account may be attached, and no Cloud Functions may be deployed.
3. **LEGACY Ledger Architecture**: Staging runs the identical `LEGACY` financial read-model architecture as production. Option-B migration must remain inactive.
4. **Isolated Hosting Targets**: Staging assets deploy exclusively to the `staging-app` target configured in `.firebaserc`.

---

## 2. Prerequisites: Resolving GCP Project Quota

Currently, the Google Cloud account `shareef2189@gmail.com` has reached its global project creation limit (8/8 projects).

### Remediation Steps (Account Owner):
1. Navigate to [Google Cloud Resource Manager](https://console.cloud.google.com/cloud-resource-manager).
2. Identify any obsolete or unused test projects (e.g. `gemini-api-test-439517`, `tbbk-8ff39`, or `firmus-f2038`).
3. Delete the unused project to free up a project slot, **OR**
4. Request a quota increase at [Google Cloud Project Quota Increase](https://support.google.com/code/contact/project_quota_increase).

---

## 3. Provisioning Staging Resources (One-Time Setup)

Once a project slot is available, execute the following commands in order:

### 3.1 Create Isolated Firebase Project
> **Note**: Display name must NOT contain special characters like `+`. Use `Tabakpp Staging`.
```bash
npx --prefix webApp firebase projects:create tabakpp-staging --display-name "Tabakpp Staging" --non-interactive
```

### 3.2 Create Staging Hosting Site
```bash
npx --prefix webApp firebase hosting:sites:create tabakpp-staging --project tabakpp-staging --non-interactive
```

### 3.3 Register Staging Web App
```bash
npx --prefix webApp firebase apps:create WEB "TABAK++ Staging Web" --project tabakpp-staging --non-interactive
```
Retrieve the SDK configuration:
```bash
npx --prefix webApp firebase apps:sdkconfig WEB <APP_ID> --project tabakpp-staging
```

### 3.4 Initialize Staging Firestore
> **Location Requirement**: Production is verified in `eur3` (Europe multi-region). Staging MUST match.
```bash
gcloud firestore databases create --project=tabakpp-staging --location=eur3 --type=firestore-native
```

### 3.5 Configure Authentication Providers
In the Firebase Console for `tabakpp-staging`:
- Enable **Email/Password** authentication (12-char minimum password recommended).
- Enable **Google** provider if testing Google OAuth on staging.
- (Optional for test harnesses): Enable **Anonymous** authentication if running Android instrumentation tests against staging.
- Verify authorized domains include `tabakpp-staging.firebaseapp.com` and `tabakpp-staging.web.app`.

---

## 4. Local Environment Configuration

### 4.1 Web Staging Configuration
Retrieve authentic configuration from the registered Web app:
```bash
firebase apps:sdkconfig WEB <ACTUAL_STAGING_APP_ID> --project tabakpp-staging
```

Populate the local configuration file: `webApp/.env.staging.local` (this file is git-ignored):

```bash
# webApp/.env.staging.local
VITE_FIREBASE_API_KEY=<ACTUAL_API_KEY_FROM_STAGING_APP>
VITE_FIREBASE_AUTH_DOMAIN=tabakpp-staging.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tabakpp-staging
VITE_FIREBASE_STORAGE_BUCKET=tabakpp-staging.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<ACTUAL_SENDER_ID>
VITE_FIREBASE_APP_ID=<ACTUAL_APP_ID>
```

> **Authentic Configuration Guard**: Staging deployments strictly enforce `--disallow-placeholders`. Synthetic or dummy keys (e.g. containing `stagingKeyValidationQA` or `placeholder`) fail preflight checks immediately. A deployment-ready build must use real Firebase configuration issued from the registered staging application.

### 4.2 Android Staging Configuration
Download the Firebase-issued `google-services.json` for package `com.tabakpp.app.staging` from Firebase Console and place it at:
```bash
androidApp/src/staging/google-services.json
```
> **Android Production Isolation**: The `:androidApp:checkStagingFirebaseConfig` Gradle task verifies that `src/staging/google-services.json` does not reference production project `tabakpp-ff036`, ensuring staging builds can never silently connect to production.

---

## 5. Build and Preflight Validation

### 5.1 Build the Staging Bundle
```bash
npm --prefix webApp run build:staging
```
This builds the client in staging mode and outputs into `webApp/dist`.

### 5.2 Validate Build Artifacts
Run the distribution predeploy check with placeholder rejection:
```bash
node webApp/scripts/check-dist-config.mjs webApp/dist \
  --expected-project tabakpp-staging \
  --actual-project tabakpp-staging \
  --target staging-app \
  --forbid-project tabakpp-ff036 \
  --require-actual-project \
  --require-target \
  --disallow-placeholders
```
Expected output:
```
✔ Web build has valid Firebase config for tabakpp-staging.
```

If any production reference (`tabakpp-ff036`) or production Cloud Function endpoint is detected, the command immediately exits with code `1`.

---

## 6. Guarded Deployment Commands

Always use the repository's guarded deployment wrappers. **Never invoke unrestricted `firebase deploy` commands directly.**

### 6.1 Deploy Staging Firestore Rules
```bash
npm --prefix webApp run deploy:staging:rules
```
- Wrapper script: `webApp/scripts/deploy-staging.mjs firestore:rules`
- Validates that the active project is strictly `tabakpp-staging`.
- Executes Firestore predeploy safety check (`check-rules-project.mjs`).
- Deploys `firestore.rules` using configuration `firebase.staging.firestore.json`.

### 6.2 Deploy Staging Hosting Assets
```bash
npm --prefix webApp run deploy:staging:hosting
```
- Wrapper script: `webApp/scripts/deploy-staging.mjs hosting`
- Enforces `--only hosting:staging-app`.
- Executes `check-dist-config.mjs` preflight validation.
- Deploys `webApp/dist` using configuration `firebase.staging.json`.

### 6.3 Verify Deployment
Visit the deployed staging site:
```
https://tabakpp-staging.web.app
```
Perform smoke checks:
1. Open DevTools Console: verify no runtime errors.
2. Check Network tab: verify network calls route to `identitytoolkit.googleapis.com` and `firestore.googleapis.com` without calling production endpoints.
3. Test guest login and increment counter.

---

## 7. Rollback Procedures

### 7.1 Hosting Rollback
Firebase Hosting maintains versioned releases:
```bash
# List recent hosting releases
npx --prefix webApp firebase hosting:releases:list --site tabakpp-staging --project tabakpp-staging

# Rollback to previous version
npx --prefix webApp firebase hosting:clone tabakpp-staging:<PREVIOUS_VERSION_ID> tabakpp-staging:live --project tabakpp-staging
```
Alternatively, re-run `build:staging` from the previous git commit and deploy via `npm --prefix webApp run deploy:staging:hosting`.

### 7.2 Firestore Rules Rollback
Rules rollbacks are not automatic through Firebase CLI. To roll back Security Rules:
```bash
# Checkout previous rules commit
git checkout <COMMIT_HASH> -- firestore.rules

# Re-deploy staging rules
npm --prefix webApp run deploy:staging:rules
```

> **Warning on Data Rollbacks**: Firestore write mutations are permanent. A Hosting or Rules rollback cannot undo writes that have already been committed to the database.

---

## 8. Troubleshooting & Common Errors

| Symptom | Root Cause | Fix |
| :--- | :--- | :--- |
| `Hosting deploy blocked: The build has no Firebase config` | `VITE_FIREBASE_API_KEY` was missing during build or failed the regex. | Ensure `webApp/.env.staging.local` exists and has an `AIza...` key of exactly 39 characters. Rebuild with `npm --prefix webApp run build:staging`. |
| `Hosting deploy blocked: Hosting target "staging-app" is not defined` | Attempting to deploy without mapping `staging-app` in `.firebaserc`. | Verify `.firebaserc` contains `targets.tabakpp-staging.hosting.staging-app = ["tabakpp-staging"]`. |
| `Staging Firestore Rules deploy blocked: Actual deployment project ... is forbidden` | Deployment targeted `tabakpp-ff036`. | Predeploy hook working as intended. Specify `--project tabakpp-staging`. |
| `QuotaFailure (Code 8)` | GCP account project limit reached. | Free an existing unused project or request quota lift from Google Cloud support. |
