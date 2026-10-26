# T++ (TabakPP) Project Setup Guide

This document contains instructions to set up the **T++** project on a new development machine. Since sensitive configuration files and environment secrets are excluded from Git, you must manually restore them to run the app.

## 1. Prerequisites
- **Android Studio** (Latest version recommended)
- **JDK 17** or higher
- **Xcode** (only for experimental iOS work; no reproducible host project is committed yet)
- **Node.js** — LTS 24 (use the version in `.nvmrc`, currently `24.21.0`; run `nvm use` or `fnm use` to load it)
- **npm** — `npm@10.9.8`. The `packageManager` field in `webApp/package.json` declares this version (Corepack can use it automatically if enabled via `corepack enable`). Without Corepack, install it globally: `npm install -g npm@10.9.8`.

> The Web lockfile (`webApp/package-lock.json`) is generated with npm 10.9.8. npm 11.11.0+ on Linux writes `libc` metadata for platform-specific optional dependencies (e.g. `@rollup/rollup-linux-*`) that the npm audit endpoint has rejected with HTTP 400. Always use the canonical npm version when regenerating the lockfile.

To intentionally update dependencies:
1. Use the canonical toolchain (Node 24.21.0, npm 10.9.8).
2. Run `npm install` (not `npm ci`) in `webApp/`.
3. Verify: `npm ci`, `npm run audit:prod`, `npm run coverage`, `npm run build`, and `git diff -- webApp/package-lock.json` — review the diff before committing.

## 2. Clone the Repository
Run the following command in your terminal:
```bash
git clone https://github.com/shareef01/tabakpp.git
cd tabakpp
```

## 3. Required Missing Files
The following files are ignored by Git and must be copied manually from your original machine or recreated from the Firebase Console.

### Android
- **File**: `androidApp/google-services.json`
- **Location**: Place it in the `androidApp/` directory.
- **Source**: Download from Firebase Console (Settings > Your apps > Android App).

### iOS (not a release target)
The Kotlin/Compose modules still compile iOS frameworks for experimentation, but
the shipped shell **does not initialize Firebase, Koin, or Google Sign-In**.
`MainViewController` shows an explicit “iOS is not supported yet” screen instead
of launching the production `App` graph (which would crash without DI).

Do not ship an App Store build from this repository until Firebase iOS bootstrap,
`GoogleService-Info.plist`, and a supported sign-in path are implemented.

### Local Properties
- **File**: `local.properties`
- **Location**: Project root.
- **Content**: Usually contains the path to your Android SDK:
  ```properties
  sdk.dir=/path/to/your/android/sdk
  ```

## 4. Initialization Steps
Once the files are in place, perform these steps in Android Studio:

1. **Gradle Sync**: Open the project and wait for the "Sync Now" prompt or click the elephant icon in the top right.
2. **Clean Build**: 
   - Run `./gradlew clean` in the terminal.
3. **Run Android**: Select `androidApp` from the run configurations and click the play button.

## 5. Firebase Configuration (Spark / free plan)

This project is designed for **Firebase Spark** — Auth, Firestore, and Hosting only (no App Check). **No Cloud Functions / Blaze** are required or assumed.

Ensure the following services are enabled in your Firebase Console:
- **Authentication**: Enable Email/Password and Google Sign-in providers.
- **Firestore Database**: Create a database in **Production mode**. Never use Test mode — it leaves the database world-readable/writable.

### Security Rules
The authoritative rules live in `firestore.rules` at the repo root. They restrict every user to their own `users/{uid}` subtree, validate profile / config / log field shapes, **require empty counts + zero aggregates on create**, bound aggregate magnitudes, **split settings updates from counter/aggregate mutations**, and deny everything else. Deploy them with the Firebase CLI:
```bash
firebase deploy --only firestore:rules
```
After deploying, verify in the Firebase Console (Firestore > Rules) that the published rules match `firestore.rules`.

**Self-owned statistics:** As a client-side self-tracking application on the Spark tier (without a trusted backend recalculating every stat), a sufficiently determined authenticated owner can manipulate their own client-supplied values. The principal boundary enforced is strict user isolation: an owner cannot read, modify, or delete another user's records. Lifetime stats are for self-tracking insight, not cryptographically authoritative audit trails.

### API Key Hygiene
`google-services.json` is git-ignored and must never be committed.

Firebase client API keys are client-visible project identifiers, not secrets or backend authorization boundaries. Primary authorization and data schema enforcement are handled by **Firestore Security Rules**. Google Cloud API key restrictions provide an additional layer of defense by limiting which APIs accept the key and constraining caller identity (HTTP referrers on web, package + signing cert on Android). In Google Cloud Console → APIs & Services → Credentials:

- **Android key** → Application restrictions → Android apps → package
  `com.tabakpp.app` + the release and your machine's debug SHA-1 fingerprints (see below).
- **Browser key** → Application restrictions → HTTP referrers →
  `tabakpp.web.app/*` and `tabakpp.firebaseapp.com/*`.
- Both keys → API restrictions → limit to the APIs actually used (Identity
  Toolkit, Cloud Firestore, Token Service).

Also worth setting: Firebase Console → Authentication → Settings → upgrade to
**Authentication with Identity Platform** (free on Spark, capped at 3,000 daily
active users), then **Password policy** → minimum length 12. Without it the
server floor is 6 and the 12-character rule in `AuthViewModel` is client-side
only, so a direct REST call can register a weaker password.

If Android email/password sign-in fails with **Requests from this Android client application com.tabakpp.app are blocked**, the API key’s Android app restriction is missing the signing cert for that APK. Add the appropriate fingerprints for package `com.tabakpp.app`:

```text
# Debug fingerprint: machine-specific (derive your own via Gradle or keytool)
# Run: ./gradlew :androidApp:signingReport
# Or:  keytool -list -v -keystore ~/.android/debug.keystore -storepass android -alias androiddebugkey

# Canonical release fingerprints (public metadata for verifying release APKs):
SHA-1   E9:1D:C8:B7:A6:1E:82:6E:3C:D7:6B:64:3B:5F:BE:27:4B:84:23:95
SHA-256 31:C7:DA:2E:0B:FF:5E:ED:60:CB:CD:FC:DE:06:A4:67:03:AD:A9:A1:90:AA:F4:65:38:EB:F4:F8:F4:EC:05:EE
```

Verify published release APKs against the canonical fingerprints using `apksigner`:
```bash
apksigner verify --print-certs tabakpp-<version>.apk
```

When a debug keystore is replaced, **remove the old fingerprint from the Android
API key** in Google Cloud Console — a stale entry keeps authorising a key you no
longer control.

Refresh local config after Firebase SHA changes:

```bash
firebase apps:sdkconfig ANDROID <ANDROID_APP_ID> --project tabakpp-ff036 -o androidApp/src/debug/google-services.json
```

(Delete the existing file first if `-o` refuses to overwrite.)

### App Check (not used in this project)

This project deliberately does **not** use Firebase App Check. There is no
attestation provider on either client, no token request, and no enforcement in
Firebase Console. Nothing in `webApp/` or `androidApp/` references
`firebase/app-check`, and there are no App Check build dependencies, Gradle
source-set variants, debug tokens, or environment variables to configure.

What carries the security boundary instead:

- **Firestore Security Rules** — owner-scoped (`request.auth.uid == userId`),
  schema- and bounds-validated, default-deny. These are the authorization and
  data-validation boundary for every read and write.
- **API-key restrictions** (Google Cloud Console) — HTTP-referrer restricted for
  the web key, package + signing-certificate restricted for the Android key.

The accepted trade: without attestation, a modified client can still reach
Firestore as its **own** signed-in user (never as another user), and abuse
resistance for the public API key rests on the API-key restrictions rather than
on app attestation. That is acceptable for a single-user self-tracking app on
the Spark plan.

> **Operational warning.** Do **not** enable App Check enforcement in Firebase
> Console for Cloud Firestore or Firebase Authentication while the clients do
> not request tokens: every request would be rejected. Released clients up to
> and including v1.0.7 did request Play Integrity / reCAPTCHA Enterprise
> tokens; builds from this revision do not.

### Adding App Check later (not currently used)

If attestation is ever wanted, it is a separate, opt-in change and must be
rolled out for the clients **before** any enforcement toggle is touched:

1. **Web:** register the web app with reCAPTCHA Enterprise in Firebase Console →
   App Check, then initialize the provider in `webApp/src/firebase.js` with
   `initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey),
   isTokenAutoRefreshEnabled: true })` and expose the site key as a
   `VITE_FIREBASE_APPCHECK_SITE_KEY` environment variable.
2. **Android:** add `firebase-appcheck-playintegrity` for release builds and
   `firebase-appcheck-debug` for debug builds as **variant-scoped** Gradle
   dependencies, and install the matching provider factory in `TabakApp`
   (release: Play Integrity, debug: debug token). Keep the selection in
   compile-time source sets — never a runtime branch that could fall back to a
   debug provider in a release APK.
3. Register the production signing certificate SHA-256
   (`31:C7:DA:2E:0B:FF:5E:ED:60:CB:CD:FC:DE:06:A4:67:03:AD:A9:A1:90:AA:F4:65:38:EB:F4:F8:F4:EC:05:EE`
   for the v1.0.7 release key) in Firebase Console → App Check → Android app,
   and link the Play Console app entry. Play Integrity supports apps
   distributed outside Google Play, but tokens cannot be *verified* until that
   entry exists and the Cloud project is linked.
4. **Only after** released clients report verified traffic in App Check metrics
   may enforcement be enabled — per Firebase product (Firestore and
   Authentication have independent toggles, metrics, and rollback).

#### Notes for a future opt-in (kept from the earlier rollout attempt)

These points are still true and non-obvious, so they are recorded here rather
than rediscovered. None of them is active today: nothing in this repository
requests an App Check token.

- **Play Integrity supports apps distributed outside Google Play**, but tokens
  cannot be *verified* until a Play Console app entry exists and is linked to
  the Cloud project. Sideloading is not itself a blocker.
- For a sideloaded app, Firebase Console → App Check → Android app → advanced
  settings needs **PLAY_RECOGNIZED** = not required, **LICENSED** = not
  required, and minimum device integrity = **Device integrity**. A non-Play
  install can never receive `PLAY_RECOGNIZED`, which is why the defaults fail.
- **Enforcement is per Firebase product.** Enabling it for Cloud Firestore does
  not enable it for Authentication (or vice versa); each has its own toggle,
  metrics, and rollback.
- **Verify before enforcing.** Enable enforcement only after released clients
  report `verified` traffic in App Check metrics for that product. There is no
  forced-update mechanism here, so enforcing while outdated clients exist risks
  locking them out. Note that clients released up to and including v1.0.7 *do*
  request tokens while builds from this revision do not, so a mixed fleet would
  break the newer clients first.
- **Debug tokens are bearer secrets.** Register them per device in Console → App
  Check → Manage debug tokens, and revoke any token that has appeared in logs,
  screenshots, or chat.
- The production release signing certificate SHA-256 used for the v1.0.7 build
  was `31:C7:DA:2E:0B:FF:5E:ED:60:CB:CD:FC:DE:06:A4:67:03:AD:A9:A1:90:AA:F4:65:38:EB:F4:F8:F4:EC:05:EE`;
  a new release key needs its own fingerprint registered.

The `.github/workflows/` release pipeline does not reference App Check and needs
no change beyond the Gradle dependencies described above.
### Release signing
The Android release build reads signing credentials from environment variables;
keystores and passwords must never be committed:

```text
TABAKPP_KEYSTORE_PATH
TABAKPP_KEYSTORE_PASSWORD
TABAKPP_KEY_ALIAS
TABAKPP_KEY_PASSWORD
```

Without all four variables, Gradle still produces an unsigned release artifact
for R8 verification.

### GitHub Releases (Android APK)
Push a version tag to publish a signed APK:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Workflow: `.github/workflows/release-android.yml`. Required repo secrets:

```text
TABAKPP_KEYSTORE_BASE64
TABAKPP_KEYSTORE_PASSWORD
TABAKPP_KEY_ALIAS
TABAKPP_KEY_PASSWORD
GOOGLE_SERVICES_JSON_BASE64
```

After installing a new device build, no App Check debug token or Console step is needed — signed-in requests are authorized by Firestore Security Rules alone.

### Account deletion
Settings → Delete Account (web) / DELETE ACCOUNT (Android) reauthenticates, marks the profile as deleting, deletes `users/{uid}/configs` + `logs` + `days` + `meta` + `dailyFinancials` + `financialOperations` in batches, replaces the user doc with a one-field `{ deleting: true }` marker (kept so a still-valid token on another device cannot recreate data), then deletes the Auth user (with retries). If Auth delete still fails after the wipe, both clients sign out and show recovery copy (`DATA_WIPED_AUTH_REMAINED` on Android). No Cloud Functions required (Spark-safe).

- **Email/password** accounts: enter password to confirm.
- **Google** accounts: confirm via Google (Credential Manager on Android, popup on web).
- **Linked** accounts: either method works.

### Password policy
Firebase Auth enforces **minimum 12 characters** server-side (`passwordPolicyConfig`, Require mode, no force-upgrade on sign-in). Clients keep the same client-side check for faster UX.

### Android Google Sign-In
1. In Firebase Console → Authentication, enable **Google**.
2. Ensure `google-services.json` includes a **Web client** OAuth ID (the Google Services plugin exposes it as `default_web_client_id`).
3. Add your debug/release SHA-1 fingerprints under Project settings → Your apps → Android.
4. The auth screen **CONTINUE WITH GOOGLE** button uses Credential Manager + Firebase `GoogleAuthProvider`.

### Web Google Sign-In
Desktop browsers use `signInWithPopup`. **iPhone Safari and installed PWAs** use `signInWithRedirect` + `getRedirectResult` (popups are unreliable there).

Authorized domains must include your Hosting domain (`tabakpp.web.app` / custom domain) and `localhost` for local dev. After enabling Google in Authentication, also confirm the OAuth consent screen includes your app.
### Web PWA / service worker
Production builds register a service worker via `vite-plugin-pwa`:
- Precaches hashed JS/CSS/icons (app shell)
- `NetworkOnly` for Google/Firebase API hosts (never caches Auth/Firestore)
- `NetworkFirst` for navigations so deploys win quickly

Run `npm run build` in `webApp/`, then deploy hosting from the repository root
(`firebase deploy --only hosting`); the root `firebase.json` serves `webApp/dist`.

Build from a checkout that has `webApp/.env.local`. A build without it still
succeeds but only shows "CONFIG MISSING" (git worktrees don't have the
gitignored file). A hosting `predeploy` hook
(`webApp/scripts/check-dist-config.mjs`) blocks the deploy when the build has
no Firebase config, or a config for a different project than the one you're
deploying to.

---
**Tip**: If you encounter a "Checksum mismatch" or Gradle errors, try deleting the `.gradle/` and `build/` directories and syncing again.
