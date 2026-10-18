# tabak++ (t++) — Web PWA

React PWA companion to the Kotlin Multiplatform mobile app. Shares the same Firebase Auth + Firestore backend on the **Spark (free) plan** — no Cloud Functions required.

<p align="center">
  <img src="../assets/screenshots/showcase/web-track.png" width="900" alt="PWA Track screen: tracker cards with cigarette gauges above today's metrics" />
</p>
<p align="center">
  <img src="../assets/screenshots/showcase/web-history.png" width="440" alt="PWA History: usage trend chart, at-a-glance stats and session log" />
  &nbsp;
  <img src="../assets/screenshots/showcase/web-settings.png" width="440" alt="PWA Settings: profile, accent colors and trackers" />
</p>

## Features
- Live trackers with the same Firestore schema as Android
- History velocity chart, streaks, and financial metrics
- Settings: identity, accent, density, day start, economics, account delete
- PWA service worker caches the app shell only (Auth/Firestore stay NetworkOnly)
- Optional App Check (reCAPTCHA Enterprise) — integrated; follow SETUP_GUIDE.md before considering enforcement
- iPhone-friendly PWA: safe-area insets, redirect Google auth, 16px inputs, Home Screen icons

## Stack
React 19 · Vite 8 · Tailwind CSS 4 · Recharts · Framer Motion · Firebase Auth/Firestore · Vitest

## Live
[https://tabakpp.web.app](https://tabakpp.web.app)

See the root [SETUP_GUIDE.md](../SETUP_GUIDE.md) for Spark-safe Firebase setup and App Check checklist.
