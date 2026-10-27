# Repository audit — tabak++

Evidence-based snapshot of the repository as it stands at `main` = **`9548213`**
(release `v1.0.9`). Findings marked **Verified** were read from the repository,
the GitHub API, or executed locally during this audit. Anything marked
**Recommendation** is a proposal that has not been applied.

---

## 1. Current state

| Property | Value | Status |
|---|---|---|
| Default branch | `main` @ `9548213` — *Merge pull request #128* | Verified |
| Working tree | clean, no unpushed commits | Verified |
| Repository size | 34.6 MB, 309 tracked files | Verified |
| License / visibility | MIT / public | Verified |
| Hosting | `https://tabakpp.web.app` (site `tabakpp`, project `tabakpp-ff036`) | Verified |
| Latest release | `v1.0.9` — `tabakpp-1.0.9.apk` (3.91 MB) + `.sha256` | Verified |
| Open PRs | none (100 PRs total, all closed; 95 merged) | Verified |
| Open issues | 1 — #64 dependency modernization backlog | Verified |
| Branch protection | required: `mobile`, `web-and-rules`; `strict`; `enforce_admins` | Verified |

### Stack actually present

| Layer | Verified implementation |
|---|---|
| Android | Kotlin, Jetpack Compose + Compose Multiplatform (`androidApp/`, `composeApp/`) |
| Shared domain | Kotlin Multiplatform (`shared/`), JVM tests + contract fixtures |
| Web | **React 19 + Vite, JavaScript/JSX** — `webApp/src` has **zero** `.ts`/`.tsx` files, no `tsconfig.json`, no `typescript` dependency |
| Backend | Firebase Auth + Cloud Firestore (JS SDK `firebase@13.0.0`, `@firebase/firestore@4.18.0`), Firebase Hosting |
| Functions | Node 24, `firebase-admin`/`firebase-functions`; three `onCall` callables **not deployed** |
| iOS | `iosApp/` shell (2 Swift files) — present, not a release target |

> **Correction to commonly quoted project descriptions:** this repository is
> **not** TypeScript, and App Check is **not** "integrated but unenforced" — it
> has been fully removed (see §6). Both claims should not be repeated.

---

## 2. Branches

11 non-default branches exist on the remote. Merge state was verified two ways:
ancestry (`git merge-base --is-ancestor`) and patch-id matching (`git cherry`),
because squash merges make ancestry alone misleading.

| Branch | PR | Ancestry | Patches in `main` | Disposition |
|---|---|---|---|---|
| `chore/hosting-predeploy-config-guard` | #116 merged | merged | — | delete (safe) |
| `chore/node-24-firebase-13` | #112 merged | merged | — | delete (safe) |
| `dependabot/npm_and_yarn/webApp/dev-dependencies-0a04ba22e9` | #111 merged | merged | — | delete (safe) |
| `docs/release-gates-deploy-2026-10-20` | #108 merged | merged | — | delete (safe) |
| `fix/android-insights-trend` | #114 merged | merged | — | delete (safe) |
| `fix/insights-docs-rules-cleanup` | #115 merged | merged | — | delete (safe) |
| `test/callable-isolation-and-date-boundaries` | #124 merged | merged | — | delete (safe) |
| `fix/aud016-trusted-receipt-namespace` | #90 merged | **not** merged | **192/192 applied** | delete (squash-merged) |
| `review/final-adversarial-verification` | #91 merged | **not** merged | **198/198 applied** | delete (squash-merged) |
| `ui/polish-compose-chips-metrics` | #94 merged | **not** merged | **1/1 applied** | delete (squash-merged) |
| `docs/readme-screenshots` | #105 merged | **not** merged | **0/1 applied** | **unique content** — see below |

`docs/readme-screenshots` carries one unpreserved change: `webApp/scripts/screenshot.mjs`
stopped writing a duplicate root-level copy of every captured screenshot. That is
the line that would regenerate the per-theme image directories removed in #127.
**Recommendation:** land that one-line change (done in this audit's PR) and then
retire the branch.

Deletion is a remote, irreversible action → **requires owner approval** (none performed).

---

## 3. Documentation and assets

| Path | State |
|---|---|
| `README.md` | complete: hero, features, screenshots, design principles, engineering decisions, stack, architecture (Mermaid), data model, security & privacy, platforms, getting started, testing, known limitations, repository structure, contributing, license |
| `SETUP_GUIDE.md`, `SECURITY.md`, `PRIVACY.md`, `RELEASE_BLOCKER_FIXES.md` | present |
| `docs/audit-2026-10-26.md`, `docs/audit-2026-10-23.md` | historical audits (retained deliberately) |
| `docs/release-hardening/*` | change log, backlog, handoff, release gates, test matrix |
| `docs/REPOSITORY_AUDIT.md`, `docs/PORTFOLIO_CASE_STUDY.md` | added by this audit |
| `assets/screenshots/showcase/` | 7 images, all referenced by `README.md` / `webApp/README.md` |
| README link integrity | 14 relative links + 9 `<img src>` — **0 broken** (verified) |

No `docs/TESTING.md` or `docs/ARCHITECTURE.md` was created: `README.md` already
carries architecture, data-model and testing sections, and `shared-tests/README.md`
covers fixtures. Adding more files would duplicate rather than clarify.

---

## 4. Tests and CI

| Suite | Count | Where it runs |
|---|---|---|
| Web unit (`npm run test:run`) | 584 | `web-and-rules` |
| Cross-platform contract | 76 | `web-and-rules` |
| Firestore rules (emulator) | 176 | `web-and-rules` |
| PWA regression | 27 scenarios | `web-and-rules` |
| Accessibility (axe-core) | 16 view/viewport combos, 0 violations | `web-and-rules` |
| Shared/Compose/Android JVM | 257 | `mobile` |
| Android instrumentation | 31 (22 + 9) | `test`, behind a fail-closed JUnit-XML gate + 26 gate self-tests |
| Functions unit | 62 | `functions` |
| Functions emulator integration | 25 suites | `functions` |

CI workflows: `ci.yml` (jobs `validate-action-pins`, `mobile`, `web-and-rules`, `functions`),
`android-integration.yml` (`test`), `release-android.yml` (manual dispatch only, protected
`release` environment with a required reviewer). Actions are SHA-pinned and enforced by
25 pin assertions. `main` at `9548213` is green on all five checks.

---

## 5. Security review

| Area | Finding | Status |
|---|---|---|
| `firestore.rules` | owner-scoped on every path (`isOwner`), shape validation, unchanged by the hardening work | Verified |
| Tracked secrets | none — no `.env`, keystore, service-account or `.pem` files tracked; only `*.example` templates | Verified |
| Firebase web API key | public by design; protection is the HTTP-referrer restriction plus rules — **not** a secret, and **not** an authorization boundary | Verified |
| App Check | **not present**: no provider, no token, no enforcement; Console shows Firestore *Monitoring*, Auth *Monitoring*, Storage *Unenforced* | Verified |
| `@grpc/grpc-js` override | **still required** — `@firebase/firestore@4.18.0` declares `~1.9.0`, which resolves to 1.9.0 inside a published vulnerable range; the `1.14.5` override is what keeps `npm audit --omit=dev` at 0 | Verified |
| Dev-dependency advisories | 9 (1 low, 6 moderate, 2 high: `body-parser`, `undici`, both via `firebase-tools`); no production or bundle impact | Verified, accepted |
| Functions advisory | `body-parser` pinned at `2.4.0` (GHSA-27r3-jxmh-p828) | Verified |
| Android signing | keystore supplied only through the protected `release` environment; decoded, used, then removed in the same job | Verified |
| Trust model | totals are client-computed on Spark; an owner can rewrite their own aggregates. Documented, not fixable in rules | Verified |

---

## 6. Technical debt

| Item | Severity | Note |
|---|---|---|
| 11 merged/squash-merged remote branches | Low | hygiene only; deletion needs approval |
| `docs/readme-screenshots` unpreserved one-line change | Low | content worth keeping; retired by this PR |
| Issue #64 (gRPC override follow-up) | Low | answered above: keep the override |
| Dev-only advisories (2 high) | Low | dev tooling only; fixing churns dozens of packages |
| Two overlapping audit documents (`docs/audit-2026-10-23.md`, `-10-26.md`) | Low | historical record; consolidation optional |
| `:androidApp:testDebugUnitTest` is a no-op | Low | documented in README; instrumentation covers behaviour |
| Local `v1.0.8` tag divergence | Resolved | resynced to `origin` (`7d2755a`) during this session |
| Repository topic `typescript` | Medium (accuracy) | web client is JavaScript — corrected in repo metadata |

---

## 7. Proposed actions

| # | Action | Priority | Risk | Approval |
|---|---|---|---|---|
| 1 | Land `docs/REPOSITORY_AUDIT.md` + `docs/PORTFOLIO_CASE_STUDY.md` + README *Project status* | High (portfolio) | none — docs only | in PR |
| 2 | Preserve the screenshot-script dedupe from `docs/readme-screenshots` | Medium | none — one deleted line in a dev script | in PR |
| 3 | Correct repository topics (`typescript` → `vite`, `kotlin-multiplatform`, `jetpack-compose`, `security-rules`) | Medium | none — metadata only | applied |
| 4 | Delete the 11 merged branches | Low (hygiene) | irreversible remote deletion | **owner approval required** |
| 5 | Close or comment issue #64 with the override finding | Low | none | owner decision |
| 6 | Optionally consolidate the two audit documents | Low | none | not proposed now |
| 7 | Dev-dependency advisory bumps | Low | churn, no production effect | recommend leaving |

**Not proposed:** App Check re-introduction, Blaze/Functions deployment, rules changes,
schema changes, UI redesign, or new dependencies. None are needed for this project's
purpose, and several would break the currently released clients.
