# 08 — Performance and resource usage

Each item is labelled **Measured** (from this audit's runs) or **Estimate** (with its assumptions stated).

## Measured

| Item | Value |
|---|---|
| Web production build | 7 s. Precache: 32 entries, 1929.86 KiB |
| Largest chunks (raw / gzip) | `heic2any` 1,352,134 / 340,649 B (lazy, **not** precached); `firebase` 592,336 / 175,218 B; `recharts` 375,502 / 106,465 B; `react` 210,624 B; `framer` 145,597 B; app `index` 123,276 B |
| Web unit suite | 622 tests in 32.8 s (jsdom setup is 60% of tracked time; Vitest suggests `pool: 'vmThreads'`) |
| Gradle JVM tests + lint | 185 s cold (`--no-daemon`) |

## Firestore reads per session

**Assumptions:** one LEGACY user with N day docs (N ≤ 400 in the live window) and M logs (≤ 1200).

| Source | Web | Android |
|---|---|---|
| Profile, configs, avatar listeners | ~3 + configs | Same |
| `days` live listener | min(N, 400) on attach | min(N, 400) |
| `logs` live listener | min(M, 1200) on attach | Same window (`LIVE_LOG_QUERY_LIMIT`) |
| Stale-day reconcile per start / day change | Open days only (usually 0–1, plus the 1-read minimum) | **min(N, 2000) reads** — TABAK-003 |
| Option B ledgers | 0 for LEGACY (skipped since the last audit) | 0 for LEGACY |

**Estimate.** A user with 730 days and 300 logs reads about 1,450 docs per web cold start and about 2,180 per Android cold start. TABAK-003 is the difference: about 730 extra reads per start, on top of the full listener window being re-read on every cold start. At 5 Android cold starts a day that's about 3.6k reads/day for one user, against the Spark free quota of 50k/day **per project**. The cost scales linearly with history and with the number of users.

## Other scaling observations

- **Listener windows re-read history on every cold start.** The bounded windows are a reasonable trade-off for streak and chart features.
  - The web client uses `getFirestore(app)` with the default **memory** cache (`webApp/src/firebase.js:41`, confirmed by source), so each web cold start re-reads up to 400 days plus 1200 logs from the server.
  - The Android native SDK enables an on-disk cache by default. How Firestore bills a resumed query depends on how long the client was offline, so I didn't estimate that saving.
  - Option (P3, measure first): `initializeFirestore(app, { localCache: persistentLocalCache() })` on web. It has trade-offs: multi-tab coordination, and cached user data on shared devices, which is a privacy consideration for this domain.
- **Write amplification.** One day-doc write per tap, which carries the full counts and snapshots maps (≤ 8 entries), so it's small. Close day writes 2 docs. No fan-out.
- **Document growth.** Day docs are bounded by rules (≤ 25 counts, ≤ 8 snapshots). The profile is bounded by the allowlist; a legacy avatar (≤ 100 KB) may still sit on older profiles until it's migrated.
- **Not measured:** Android memory, startup latency on a device, real Firestore billing. No device or production metrics were available.
