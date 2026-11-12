# 12 — Dependency audit

Scanners: `npm audit` (registry advisories) for `webApp/` and `functions/`. No Gradle vulnerability scanner was available (OWASP dependency-check and osv-scanner aren't installed), so I didn't scan the Android and KMP dependencies.

## webApp — production dependencies

`npm audit --omit=dev`: **0 vulnerabilities.**

## webApp — dev-only (28 advisories: 2 high, 23 moderate, 3 low)

| Package | Installed | Affected range | Advisory | Severity | Path | Exposure |
|---|---|---|---|---|---|---|
| undici | 6.29.0 | 4.0.0 – 6.29.0 | GHSA-4qv8-2p9j-2685, GHSA-xjj6-f33q-929c, GHSA-2m5v-pch6-74hx | high | `firebase-tools` → `undici` (jsdom's `undici@8.12.2` is outside the range) | Dev CLI / emulator only |
| body-parser | 2.3.0 | 2.0.0 – 2.3.0 | GHSA-27r3-jxmh-p828 | high | `firebase-tools` → `@modelcontextprotocol/sdk` → `express@5` | Dev CLI only (an MCP server feature that isn't used) |
| minimatch / glob / rimraf / archiver chain | various | see `npm audit` | GHSA-g3hv-75wg-m249, GHSA-3g3m-2fjr-6pw4, … | moderate | `firebase-tools`, `eslint`, `workbox-build` | Build and dev only |
| fast-uri, qs, uuid, @opentelemetry/core, @hono/node-server | — | — | (see `npm audit --json`) | moderate | `firebase-tools` | Dev only |
| serialize-javascript, deepmerge | — | — | GHSA-m5mm-p8h7-m29v, GHSA-gcqx-w48m-w2h4 | low | `workbox-build` | Build only |

- **Reachability.** None of these packages is bundled into `dist/` (the prod audit is clean). They run on developer machines and CI runners, against local emulators.
- **Safe path.** Wait for or take the next `firebase-tools` minor through the grouped Dependabot dev PR, then re-run `npm audit`. Don't use `npm audit fix --force`: it proposes semver-major changes to `eslint`, `vite-plugin-pwa` and `firebase-tools`.
- **Local drift (not a repo defect).** This machine's `node_modules` has `firebase-tools@15.34.1`, below the `^15.34.2` in `package.json`. CI uses `npm ci` from the lockfile. Run `npm ci` locally to match.

## functions — production dependencies (not deployed)

`npm audit --omit=dev`: **7 (1 low, 6 moderate), 0 high.**

| Package | Severity | Path | Note |
|---|---|---|---|
| fast-xml-parser ≤ 5.11.2 | low (GHSA-474x-hrwr-fgx4) | firebase-admin → Google Cloud SDKs | Transitive |
| gaxios 7.1.3, gcp-metadata, google-gax 5.0.5–5.0.8, rimraf, glob, minimatch | moderate | firebase-admin → @google-cloud/* | Transitive; CLI-style glob paths that aren't reachable from the callables |

- **Production exposure:** none today, because nothing is deployed.
- **Before any Blaze deployment:** re-run the audit and take a `firebase-admin` update. The CI gate (`--audit-level=high`) already blocks high and critical.

## Gradle / KMP (inventory only, not scanned)

AGP 9.5.0 · Kotlin 2.4.21 · Firebase BoM 35.1.0 · GitLive 2.7.0 · compileSdk 37 / targetSdk 36. Dependabot covers this ecosystem monthly.
