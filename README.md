# tabak++

**A precision habit tracker for cutting down on smoking — real-time counters, daily limits, streaks, and financial insight in an industrial dark UI. One Firebase backend, two clients: a Kotlin Multiplatform Android app and a React PWA.**

![Kotlin](https://img.shields.io/badge/Kotlin-2.2-7F52FF?logo=kotlin&logoColor=white)
![Compose Multiplatform](https://img.shields.io/badge/Compose%20Multiplatform-1.7-4285F4?logo=jetpackcompose&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20·%20Firestore%20·%20Hosting-FFCA28?logo=firebase&logoColor=black)
![Platform](https://img.shields.io/badge/Platform-Android%20·%20Web%20·%20iOS%20experimental-3DDC84?logo=android&logoColor=white)

**Try it in the browser → [tabakpp.web.app](https://tabakpp.web.app)**

## Screenshots

Accent themes (Emerald · Cobalt · Rose · Violet) on both clients. Web shots are seeded demo data (no live account). Android shots are from the Compose app on device.

### Web PWA

<table align="center">
  <tr>
    <th></th>
    <th align="center">Emerald</th>
    <th align="center">Cobalt</th>
    <th align="center">Rose</th>
    <th align="center">Violet</th>
  </tr>
  <tr>
    <td><b>Track</b></td>
    <td align="center"><img src="assets/screenshots/web/emerald/track.png" width="160" alt="Web track — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/web/cobalt/track.png" width="160" alt="Web track — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/web/rose/track.png" width="160" alt="Web track — Rose" /></td>
    <td align="center"><img src="assets/screenshots/web/violet/track.png" width="160" alt="Web track — Violet" /></td>
  </tr>
  <tr>
    <td><b>History</b></td>
    <td align="center"><img src="assets/screenshots/web/emerald/history.png" width="160" alt="Web history — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/web/cobalt/history.png" width="160" alt="Web history — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/web/rose/history.png" width="160" alt="Web history — Rose" /></td>
    <td align="center"><img src="assets/screenshots/web/violet/history.png" width="160" alt="Web history — Violet" /></td>
  </tr>
  <tr>
    <td><b>Settings</b></td>
    <td align="center"><img src="assets/screenshots/web/emerald/settings.png" width="160" alt="Web settings — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/web/cobalt/settings.png" width="160" alt="Web settings — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/web/rose/settings.png" width="160" alt="Web settings — Rose" /></td>
    <td align="center"><img src="assets/screenshots/web/violet/settings.png" width="160" alt="Web settings — Violet" /></td>
  </tr>
  <tr>
    <td><b>Auth</b></td>
    <td align="center"><img src="assets/screenshots/web/emerald/auth.png" width="160" alt="Web auth — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/web/cobalt/auth.png" width="160" alt="Web auth — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/web/rose/auth.png" width="160" alt="Web auth — Rose" /></td>
    <td align="center"><img src="assets/screenshots/web/violet/auth.png" width="160" alt="Web auth — Violet" /></td>
  </tr>
</table>

### Android

<table align="center">
  <tr>
    <th></th>
    <th align="center">Emerald</th>
    <th align="center">Cobalt</th>
    <th align="center">Rose</th>
    <th align="center">Violet</th>
  </tr>
  <tr>
    <td><b>Track</b></td>
    <td align="center"><img src="assets/screenshots/android/emerald/track.png" width="160" alt="Android track — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/android/cobalt/track.png" width="160" alt="Android track — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/android/rose/track.png" width="160" alt="Android track — Rose" /></td>
    <td align="center"><img src="assets/screenshots/android/violet/track.png" width="160" alt="Android track — Violet" /></td>
  </tr>
  <tr>
    <td><b>History</b></td>
    <td align="center"><img src="assets/screenshots/android/emerald/history.png" width="160" alt="Android history — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/android/cobalt/history.png" width="160" alt="Android history — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/android/rose/history.png" width="160" alt="Android history — Rose" /></td>
    <td align="center"><img src="assets/screenshots/android/violet/history.png" width="160" alt="Android history — Violet" /></td>
  </tr>
  <tr>
    <td><b>Settings</b></td>
    <td align="center"><img src="assets/screenshots/android/emerald/settings.png" width="160" alt="Android settings — Emerald" /></td>
    <td align="center"><img src="assets/screenshots/android/cobalt/settings.png" width="160" alt="Android settings — Cobalt" /></td>
    <td align="center"><img src="assets/screenshots/android/rose/settings.png" width="160" alt="Android settings — Rose" /></td>
    <td align="center"><img src="assets/screenshots/android/violet/settings.png" width="160" alt="Android settings — Violet" /></td>
  </tr>
</table>

## Features

- **Live tracker cards** — Cigarette, RYO, or Custom units; each with a daily limit, animated fill gauge, and one-tap increment/decrement with haptic feedback and undo.
- **Day archiving** — End tracking day rolls the session into an immutable archive and resets counters. Configurable day boundary (night-owl mode).
- **Streaks & quotas** — Consecutive days within limits, live daily quota progress, and over-limit states across the UI.
- **Financial intelligence** — Per-unit pricing for money spent today and money saved lifetime, updated transactionally with each archive.
- **Usage trends** — History chart of recent days including the live session, plus an editable log vault with manual backfill and delete-with-undo.
- **Cross-device sync** — Mobile and web share one Firestore schema; changes appear in real time on both clients.
- **Personalization** — Accent color spectrum, dashboard density (compact / comfortable / spacious), display name, optional avatar.
- **Offline aware** — Connectivity is surfaced in the UI; failed writes get consistent feedback. The PWA caches its app shell only; Auth/Firestore traffic stays network-only.
- **Readable type** — Shared label floors and contrast tuned for dark UI (web + Compose).

## Architecture

Two independent clients against one Firebase backend. Domain math (day-boundary rollover, streaks, financial aggregation) is a pure, unit-tested calculator on each platform — `SmokingCalculator.kt` in shared Kotlin, `smokingCalculator.js` on the web — on the same Firestore document schema.

| Module | Role |
|---|---|
| `shared` | KMP domain logic, Firebase data layer (GitLive SDK), ViewModels, DI (Koin). Compiles to Android + iOS. |
| `composeApp` | Mobile UI in Compose Multiplatform — screens, navigation, theming, custom `Canvas` gauges and charts. |
| `androidApp` | Android entry point: splash, edge-to-edge window, Koin bootstrap. |
| `iosApp` | Experimental SwiftUI shell. The repository does not yet contain a reproducible Xcode/Firebase host project. |
| `webApp` | Installable React 18 PWA — Vite, Tailwind, Recharts, Framer Motion. Live at [tabakpp.web.app](https://tabakpp.web.app). |

**Data flow (mobile):** Firestore snapshot listeners → Kotlin `Flow` → `StateFlow` in shared ViewModels → Compose. Writes that touch money or archives run inside Firestore **transactions**, so counters, day archives, and lifetime aggregates stay consistent across concurrent devices.

**Stack:** Kotlin 2.2 · Compose Multiplatform · Firebase Auth + Firestore ([GitLive](https://github.com/GitLiveApp/firebase-kotlin-sdk)) · Koin · kotlinx-datetime · React 18 · Vite · Tailwind CSS · Recharts · Vitest.

## Security (Spark-safe)

- Designed for **Firebase Spark (free)**: Auth, Firestore, Hosting, App Check — **no Cloud Functions**.
- Firestore access is locked down by [`firestore.rules`](firestore.rules): every user can read/write **only their own** `users/{uid}` subtree; settings writes cannot touch counters; mutations cannot touch profile settings. Deploy with `firebase deploy --only firestore:rules`.
- Mobile Firebase config files (`google-services.json`, `GoogleService-Info.plist`) are git-ignored; the web client reads config from `VITE_FIREBASE_*` environment variables.
- Account deletion and registry math run client-side with Firestore transactions (Spark-compatible).
- **Known Spark residual:** an owner can still forge their own aggregates without a backend verifier — mitigate with App Check enforcement (see [SETUP_GUIDE.md](SETUP_GUIDE.md)).
- **Platform notes:** Google Sign-In and avatar pickers are wired on Android + web; iOS hides Google Sign-In until a native helper ships. Android Google Sign-In requires the debug/release SHA-1 fingerprints on the Firebase/Google Cloud API key (documented in SETUP_GUIDE).

## Getting Started

### Mobile (Android)

1. Clone the repo and open it in Android Studio (Ladybug or newer, JDK 17).
2. Create a Firebase project with **Email/Password auth** and **Firestore**, then drop your `google-services.json` into `androidApp/`.
3. Add your debug and release SHA-1 fingerprints to the Android API key restrictions (see [SETUP_GUIDE.md](SETUP_GUIDE.md)).
4. Deploy the security rules: `firebase deploy --only firestore:rules`.
5. Run the `androidApp` configuration.

Full Android and web setup details, plus current iOS limitations, live in [SETUP_GUIDE.md](SETUP_GUIDE.md).
Data categories, retention, and account deletion behavior are described in [PRIVACY.md](PRIVACY.md).

### Web

```bash
cd webApp
npm install
# create .env.local with your VITE_FIREBASE_* values (apiKey, authDomain, projectId, ...)
npm run dev        # local development
npm run build && firebase deploy --only hosting   # production deploy
npm run screenshots   # regenerate multi-theme PWA screenshots (seeded demo, no live Firebase)
```

From the repo root, with a device connected and the app signed in:

```powershell
powershell -File scripts/android-screenshots.ps1
```

Web screenshots land in `assets/screenshots/web/{theme}/`; Android in `assets/screenshots/android/{theme}/`. Root-level `assets/screenshots/{auth,track,history,settings}.png` stay synced to the Emerald web set for simple embeds.

## Testing

Domain logic is covered by unit tests on both platforms:

```bash
./gradlew :shared:testDebugUnitTest   # Kotlin: rollover, streaks, financial math, archive merging
cd webApp
npm run lint                          # ESLint static checks
npm run coverage                      # JS tests + coverage
npm run test:rules                    # Firestore emulator security tests
```

---

Built by [shareef01](https://github.com/shareef01).
