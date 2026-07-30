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

**Spark residual:** forging self-stats via a dedicated mutation write remains possible without Cloud Functions. The write-path split and restricted API keys narrow it; App Check would too, but enforcement is deliberately off (see "Why App Check is integrated but not enforced"). The blast radius is limited to the signed-in user's own numbers — no cross-user access.

### API Key Hygiene
`google-services.json` is git-ignored and must never be committed.

**API key restrictions are the layer that holds when App Check does not** — a
lifted key is useless from another origin or an unsigned build. In Google Cloud
Console → APIs & Services → Credentials:

- **Android key** → Application restrictions → Android apps → package
  `com.tabakpp.app` + the release and debug SHA-1 fingerprints below.
- **Browser key** → Application restrictions → HTTP referrers →
  `tabakpp.web.app/*` and `tabakpp.firebaseapp.com/*`.
- Both keys → API restrictions → limit to the APIs actually used (Identity
  Toolkit, Cloud Firestore, Token Service).

Also worth setting: Firebase Console → Authentication → Settings → upgrade to
**Authentication with Identity Platform** (free on Spark, capped at 3,000 daily
active users), then **Password policy** → minimum length 12. Without it the
server floor is 6 and the 12-character rule in `AuthViewModel` is client-side
only, so a direct REST call can register a weaker password.

If Android email/password sign-in fails with **Requests from this Android client application com.tabakpp.app are blocked**, the API key’s Android app restriction is missing the signing cert for that APK. Add both fingerprints (package `com.tabakpp.app`):

```text
# debug (~/.android/debug.keystore — machine-specific, regenerate invalidates it)
A2:14:6D:57:A5:5B:06:7D:3F:56:E8:CF:34:A4:3C:1A:16:09:6B:06

# release (also keep it on the Firebase Android app)
SHA-1   E9:1D:C8:B7:A6:1E:82:6E:3C:D7:6B:64:3B:5F:BE:27:4B:84:23:95
SHA-256 31:C7:DA:2E:0B:FF:5E:ED:60:CB:CD:FC:DE:06:A4:67:03:AD:A9:A1:90:AA:F4:65:38:EB:F4:F8:F4:EC:05:EE
```

The debug fingerprint is per-machine and changes if `debug.keystore` is
regenerated. Derive the current one rather than trusting this file:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -storepass android -alias androiddebugkey | grep SHA1

# release fingerprints, read back off any published APK
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

### Web App Check (recommended on Spark)
1. In Firebase Console → App Check, register the web app with **reCAPTCHA Enterprise**
   (or reCAPTCHA v3). Production uses `ReCaptchaEnterpriseProvider`.
2. Add to `webApp/.env.local`:
   ```
   VITE_FIREBASE_APPCHECK_SITE_KEY=your_recaptcha_enterprise_site_key
   ```
3. For local dev, either register a debug token (`VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=...`) or leave unset — App Check only initializes when the site key is present. Never save tokens in repository log files.
4. Console → App Check → APIs — leave **Cloud Firestore** and **Firebase
   Authentication** on **Unenforce**. Read why below before changing it.

### Why App Check is integrated but not enforced

Verify current state rather than trusting this file:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "x-goog-user-project: tabakpp-ff036" \
     https://firebaseappcheck.googleapis.com/v1/projects/tabakpp-ff036/services
```

Enforcement was **switched off deliberately on 2026-07-31**, having been on
before that. The reason is a hard conflict with how Android ships:

- **Enforcement is per Firebase product, not per platform.** Setting Cloud
  Firestore to Enforced rejects unattested requests from *every* client. There
  is no way to enforce for web only, and Android needs both Firestore and
  Authentication to function.
- **Android cannot attest per-install.** Release APKs use
  `DebugAppCheckProviderFactory`, which mints a random secret per install that
  must be pasted into Console → App Check → Manage debug tokens by hand.

With enforcement on, that combination meant **anyone who downloaded the APK
from Releases could not sign in** — their token was not on the allow list and
they had no way to add it. It also meant a reinstall (or clearing app data)
regenerated the token and silently broke sign-in on the maintainer's own device.
A download that cannot work is worse than an unattested one, so enforcement is
off.

What carries the load instead:

- **Firestore rules** — owner-scoped, schema- and bounds-validated, default deny.
- **API key restrictions** — package + signing certificate on Android, HTTP
  referrer on web, so a lifted key is useless elsewhere.

App Check still initializes on both clients, so tokens flow and the metrics in
Console stay meaningful. Turning enforcement back on is a one-line API call —
but only makes sense **after** Android can attest for real.

**That means Play Integrity** (below), which attests without a per-device allow
list. Do that first, verify release installs report verified in App Check
metrics, then enforce.

**Upgrade path (if this ever ships properly).** Contrary to a common
misconception, Play Integrity *does* support apps distributed outside Google
Play — the blocker is configuration, not the distribution channel. To switch:

1. Register a Google Play developer account (one-time fee) and add an app entry.
   Publishing and a store listing are **not** required.
2. Play Console → your app → Release → **App integrity** → Play Integrity API →
   link the Cloud project.
3. Firebase Console → App Check → Apps → your Android app → advanced settings:
   set **PLAY_RECOGNIZED** to not required, **LICENSED** to not required, and
   minimum device integrity to **Device integrity**. Non-Play apps can never
   receive `PLAY_RECOGNIZED`, which is why the default config fails for sideloads.
4. Swap `DebugAppCheckProviderFactory` for `PlayIntegrityAppCheckProviderFactory`
   in `androidApp/src/release/.../AppCheckInstaller.kt` and add the
   `firebase-appcheck-playintegrity` dependency.
5. Watch App Check metrics until release clients report verified, *then* enforce.

### Android App Check (current: debug provider)
Both debug and release builds use **DebugAppCheckProviderFactory**
(`AppCheckInstaller`). With enforcement off this is effectively inert, so the
setup below is only worth doing if you want App Check metrics.

1. Add your release and debug **SHA-1 / SHA-256** under Project settings → Your
   apps → Android (also add the release SHA-1 to the Android API key
   restrictions in Google Cloud — that part *does* matter).
2. Install the APK, open Logcat, copy the debug token from
   `DebugAppCheckProvider` / `Enter this debug secret`.
3. Console → App Check → Manage debug tokens → Add debug token (once per device).
4. **Revoke any debug token that has appeared in logs, screenshots, or chat.** A
   debug token is a bearer secret that bypasses attestation from anywhere.

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

After installing a new device build, register its App Check debug token (see Android App Check above).

### Account deletion
Settings → Delete Account (web) / DELETE ACCOUNT (Android) reauthenticates, deletes `users/{uid}/configs` + `logs` + the user doc in batches, then deletes the Auth user (with retries). If Auth delete still fails after the wipe, both clients sign out and show recovery copy (`DATA_WIPED_AUTH_REMAINED` on Android). No Cloud Functions required (Spark-safe).

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

Deploy hosting after `npm run build` from `webApp/`.

---
**Tip**: If you encounter a "Checksum mismatch" or Gradle errors, try deleting the `.gradle/` and `build/` directories and syncing again.
