# Portfolio case study — tabak++

A cross-platform tobacco-use tracker built to be genuinely used, not demonstrated:
one product, a native Android client and an installable web PWA, sharing domain logic
and a Firebase backend, on the free tier.

Everything below describes the implementation as it exists in this repository at
`v1.0.9`. No usage figures, team sizes or business outcomes are claimed — there are
none to claim; this is a personal project with a single maintainer.

---

## Problem

Counting a behaviour by day is easy to do badly. The hard parts are the ones that only
appear after weeks of use:

- a tap at 23:59:59 versus 00:00:01 must land on the right day, including across DST
  shifts and a configurable day-start hour;
- a day that has been closed must not silently change when a unit price is edited later;
- the same account on two devices must agree, in realtime, without merge conflicts;
- and all of it has to work under an authorization model where the client cannot be
  trusted to enforce anything.

The product surface is deliberately small: trackers, dated counts, money, streaks,
history, settings. The engineering is in the invariants.

## Scope

| In scope | Out of scope (deliberate) |
|---|---|
| Android client (Kotlin + Compose Multiplatform) | iOS releases — shell present, gated as unsupported |
| Web PWA (React + Vite), installable, offline shell | Offline *writes* — transactions need the network |
| Kotlin Multiplatform domain module | Server-authoritative money in production (needs Blaze) |
| Firebase Auth + Firestore + Hosting, Spark plan | App Check (removed; trade-off documented) |
| Automated tests + 5 gated CI jobs | Native desktop clients |

## Technologies

Kotlin · Jetpack Compose · Compose Multiplatform · Kotlin Multiplatform · React 19 ·
Vite · Tailwind CSS · Firebase Authentication · Cloud Firestore · Firebase Hosting ·
Firebase Functions (Node 24, undeployed) · Gradle · Vitest · axe-core · GitHub Actions.

The web client is **JavaScript/JSX** — no TypeScript, no `tsconfig`, no type-check step.

## Architecture

```
          Android app (Compose)              Web PWA (React + Vite)
                  │                                   │
          composeApp (shared UI)                webApp/src
                  │                                   │
          shared/ (KMP domain)  ──contract──▶ JS mirror of the domain math
                  │                                   │
                  └──────────┬────────────────────────┘
                             ▼
            Firebase Auth ──▶ Firestore (users/{uid}) ──▶ Security Rules
                             └── Cloud Functions (Option B, written + tested, NOT deployed)
```

Two clients, one backend. The Kotlin domain module is the reference implementation;
the web client mirrors it in JavaScript because the two platforms cannot share
executable code.

## Challenges and solutions

**1. Two implementations of the same arithmetic, guaranteed to agree.**
The web and Android clients cannot share executable code, so the domain math is
hand-mirrored — the classic source of slow divergence (a rounding rule changes on one
side only). The fix is a shared fixture set: `shared-tests/` holds semantic vectors that
both implementations must satisfy, and `npm run test:contract` runs 76 assertions
against the JavaScript port while the Kotlin suites run the same vectors. Drift now
fails a build instead of producing two different histories for the same account.

**2. Dates that survive midnight, DST, and a user-configurable day start.**
A cached "today" is the root cause of mis-dated writes: a poller expires, and a tap
records against yesterday. Every mutation instead derives its tracking date from the
clock at the moment of the write, including the day-start-hour offset, so a tap at any
boundary is attributed correctly. The Android client additionally refuses to guess the
offset while the profile is still loading rather than writing a plausible-but-wrong date.

**3. Historical records that cannot be rewritten.**
Repricing a tracker today must not change what last month cost. When a day closes, its
tracker snapshot is stamped and frozen — enforced in `firestore.rules`, not only in the
client — so subsequent edits cannot reach back into closed history. The limit is stated
plainly: a closed day is immutable, and the rules that guarantee it are covered by 176
emulator-backed assertions including the denial cases.

**4. A CI job that reported success while the test run had failed.**
The instrumentation job parsed Gradle's XML output with `grep`/`awk`, which silently
produced "no failures" when the runner itself died — a green check for a suite that
never ran. It was replaced by a fail-closed parser that rejects a missing results
directory, missing or stale XML, malformed or unexpected structure, inconsistent
totals, all-skipped runs, non-numeric or negative attributes, and a Gradle exit code
that disagrees with the XML. That gate has 26 regression tests of its own, and it runs
*before* the emulator starts. CI trust is a feature; this is the piece that makes the
green check mean something.

**5. Financial integrity on a plan with no server.**
On the Spark plan, rules can validate the shape and ownership of a write but cannot
recompute money, so an account owner can rewrite their own aggregates. Rather than
hide this, the trusted path is implemented and tested but not deployed: three callables
(`executeFinancialOperation`, `migrateAccount`, `deleteAccountData`) reconcile the four
canonical ledger metrics atomically server-side, exercised by 62 unit tests and 25
emulator integration suites. Production stays client-computed, with the trust boundary
documented in `README.md` and `SECURITY.md`. The upgrade is a deployment decision, not
a rewrite.

## Decisions and trade-offs

| Decision | Why | What it costs |
|---|---|---|
| Firestore rules as the only authorization boundary | No server on Spark; rules are the one enforcement point that cannot be bypassed by a modified client | Rules cannot recompute money, so totals are owner-editable |
| App Check removed entirely | It was never enforced and no client sent tokens; keeping configured-but-unenforced attestation is a false sense of security | No attestation: automated traffic is bounded only by API-key restrictions and Spark quotas. Documented, with API-key restrictions explicitly *not* presented as equivalent |
| Client-derived dates over a cached "today" | Correctness at boundaries is a core invariant of the product | Slightly more work per mutation; no shared clock state |
| Kotlin domain as reference, JS as mirror + contract tests | Compose Multiplatform cannot share executable code with a React client | Two implementations to keep in step — mitigated by fixtures, not eliminated |
| No offline write queue | Firestore transactions need the network; a fake queue would risk double-counting | Logging requires connectivity (the PWA shell still opens offline) |
| Undeployed Functions retained | Keeps the trusted-totals design exercised by CI so Blaze stays an operational choice | Some readers assume "code present = deployed"; the README and this document say otherwise |

## Security and privacy

- Every Firestore path is owner-scoped: `request.auth.uid == userId`, with per-collection
  shape validation and immutable closed days.
- The web API key is public by design; the actual controls are rules plus Google Cloud
  API-key restrictions (HTTP referrer for web, package + signing certificate for Android).
  Neither substitutes for authorization.
- No secrets in the repository: only `*.example` templates; the Android keystore exists
  solely as a protected-environment secret that is decoded, used and removed within the
  release job.
- Account deletion wipes the user's data and then deletes the Auth user client-side, with
  a clear failure mode when a recent login is required.
- Health framing: population-level life-expectancy figures are labelled as estimates.
  The app is not a medical device and gives no medical advice.

## Testing and validation

| Suite | Count | What it protects |
|---|---|---|
| Web unit | 584 | UI and domain behaviour |
| Contract | 76 | JS ↔ Kotlin semantic parity |
| Firestore rules | 176 | Real rules against the emulator, allows *and* denials |
| Android JVM | 257 | KMP domain, repositories, view models, Compose UI |
| Android instrumentation | 31 | Behaviour on a real emulator, behind the fail-closed gate |
| Functions unit | 62 | Trusted-ledger math and validation |
| Functions emulator integration | 25 suites | Callables end-to-end |
| Gate self-tests | 26 | The result parser itself |

CI: `web-and-rules`, `mobile`, `functions`, `test`, `validate-action-pins` — all five
green on the release commit. Actions are SHA-pinned, asserted by a pin-check job, and
the release workflow is manual-dispatch-only behind a required reviewer.

## Capabilities shipped (v1.0.9)

Dated counts with undo · per-tracker daily limits and burn-down · spend, savings and
streak analytics with an optional personal baseline · editable and backfillable history
with frozen closed days · realtime cross-device sync · five accent themes and layout
density · profile settings · account deletion · installable PWA with an offline shell ·
Android APK distributed via GitHub Releases with checksum.

## Lessons and possible next steps

- **Instrumentation that fails closed is worth more than instrumentation that runs more
  tests.** The gate change came out of a CI run that lied; it is the single highest-value
  thing in the repository.
- **Contract fixtures beat good intentions** for cross-language parity. Any future
  domain rule should arrive with a vector in `shared-tests/`.
- Possible next steps, none required for personal use: enable the protected checks
  (`functions`, `test`) on `main`; add a small JVM unit suite for `:androidApp`, whose
  Gradle task is currently a no-op; and, only if billing is ever acceptable, deploy the
  Option B callables behind a migration plan.
