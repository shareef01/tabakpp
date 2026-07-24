# T++ (TabakPP) Project Setup Guide

This document contains instructions to set up the **T++** project on a new development machine. Since sensitive configuration files and environment secrets are excluded from Git, you must manually restore them to run the app.

## 1. Prerequisites
- **Android Studio** (Latest version recommended)
- **JDK 17** or higher
- **Xcode** (only for experimental iOS work; no reproducible host project is committed yet)

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

### iOS (experimental)
The Kotlin and Compose modules expose iOS targets, but this repository does not
currently include a complete Xcode project, native Firebase bootstrap, or Google
Sign-In implementation. Do not treat iOS as a supported release target yet.

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

This project is designed for **Firebase Spark** — Auth, Firestore, Hosting, and App Check only. **No Cloud Functions / Blaze** are required or assumed.

Ensure the following services are enabled in your Firebase Console:
- **Authentication**: Enable Email/Password and Google Sign-in providers.
- **Firestore Database**: Create a database in **Production mode**. Never use Test mode — it leaves the database world-readable/writable.

### Security Rules
The authoritative rules live in `firestore.rules` at the repo root. They restrict every user to their own `users/{uid}` subtree, validate profile / config / log field shapes, **require empty counts + zero aggregates on create**, bound aggregate magnitudes, **split settings updates from counter/aggregate mutations**, and deny everything else. Deploy them with the Firebase CLI:
```bash
firebase deploy --only firestore:rules
```
After deploying, verify in the Firebase Console (Firestore > Rules) that the published rules match `firestore.rules`.

**Spark residual:** forging self-stats via a dedicated mutation write remains possible without Cloud Functions. Mitigate with App Check + the write-path split + restricted API keys.

### API Key Hygiene
`google-services.json` is git-ignored and must never be committed. Additionally, in Google Cloud Console (APIs & Services > Credentials), restrict the Android API key to the `com.tabakpp.app` package + release/debug signing certificate fingerprints, and consider enabling **Firebase App Check** to block requests from unofficial clients.

If Android email/password sign-in fails with **Requests from this Android client application com.tabakpp.app are blocked**, the API key’s Android app restriction is missing the signing cert for that APK. Add both fingerprints (package `com.tabakpp.app`):

```text
# debug (default ~/.android/debug.keystore)
ED:B5:69:97:3B:1F:A5:F0:25:A7:BC:CF:B7:17:94:37:C5:FB:EC:BD

# release (your upload/app-signing key — also keep it on the Firebase Android app)
```

Refresh local config after Firebase SHA changes:

```bash
firebase apps:sdkconfig ANDROID <ANDROID_APP_ID> --project tabakpp-ff036 -o androidApp/src/debug/google-services.json
```

(Delete the existing file first if `-o` refuses to overwrite.)

### Web App Check (recommended on Spark)
1. In Firebase Console → App Check, register the web app with **reCAPTCHA v3**.
2. Add to `webApp/.env.local`:
   ```
   VITE_FIREBASE_APPCHECK_SITE_KEY=your_recaptcha_v3_site_key
   ```
3. For local dev, either register a debug token (`VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=...`) or leave unset — App Check only initializes when the site key is present. Never save tokens in repository log files.
4. **Enforce checklist** (do last): Console → App Check → APIs → set Firestore and Authentication to **Enforced**. Confirm production PWA and release Android both send tokens first; keep debug tokens registered for local builds.

### Android App Check
The Android app initializes Play Integrity only in release builds. Debug builds intentionally install no provider, so they cannot access enforced APIs. In Firebase Console → App Check:
1. Register the Android app with **Play Integrity**.
2. Verify a Play-distributed release build receives valid tokens.
3. Enforce only after both web and release Android ship tokens successfully.
4. Revoke any debug token that has appeared in logs or chat history.

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

### Account deletion
Settings → Delete Account (web) / DELETE ACCOUNT (Android) reauthenticates, deletes `users/{uid}/configs` + `logs` + the user doc in batches, then deletes the Auth user. No Cloud Functions required (Spark-safe).

- **Email/password** accounts: enter password to confirm.
- **Google** accounts: confirm via Google (Credential Manager on Android, popup on web).
- **Linked** accounts: either method works.

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

Deploy hosting after `npm run build` from `webApp/`.

---
**Tip**: If you encounter a "Checksum mismatch" or Gradle errors, try deleting the `.gradle/` and `build/` directories and syncing again.
