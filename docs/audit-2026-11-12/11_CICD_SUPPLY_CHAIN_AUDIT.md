# 11 — CI/CD and release engineering

## Workflows

| Workflow | Trigger | Jobs and gates |
|---|---|---|
| `ci.yml` | `pull_request`, push to `main` | `validate-action-pins` · `mobile` (KMP/Compose/app JVM tests, lint, debug, release and staging assemble) · `web-and-rules` (`npm ci`, lockfile validation, lint, `audit:prod`, coverage, build, PWA, contract, a11y, rules) · `functions` (prod audit, unit, emulator integration) |
| `android-integration.yml` | `pull_request` (+ dispatch) | Emulator instrumentation; uploads JUnit XML keyed by head SHA; the results gate fails closed |
| `release-android.yml` | `workflow_dispatch` only (version input) | `require-ci` (must run from `main`, SemVer check, tag resolution, full suite re-run, `check-release-ci.py` exact-SHA CI + instrumentation acceptance), then `release` (`environment: release`, secrets, signed assemble, `apksigner verify`, sha256, annotated tag that refuses to move, GitHub Release) |

## Verified good

- Top-level `permissions: contents: read`, and job-level least privilege. `contents: write` appears only in `release`.
- Every third-party action is pinned to a full SHA and validated in CI. Dependabot covers npm (×2), Gradle and Actions.
- There are no `pull_request_target` or `workflow_run` workflows, so fork PRs never see secrets. Untrusted input reaches `run:` only after regex validation.
- The release can't publish a commit whose exact-SHA CI or instrumentation run didn't pass (`check-release-ci.py` with self-tests).
- Tags are immutable by policy (the step refuses to move an existing tag).
- An integrity checksum is published with the release.
- Functions deploy is blocked by a predeploy guard unless `TABAKPP_DEPLOY_FUNCTIONS=1`. Hosting predeploy runs `check-dist-config.mjs`, which refuses placeholder or staging configs.

## Gaps and recommendations

| ID | Item | Severity | Notes |
|---|---|---|---|
| CI-1 | **Branch protection can't be verified from the repo.** The earlier audit states `mobile` and `web-and-rules` are required on `main`. If `functions` and `android-integration` aren't required, a PR that breaks them can still merge. The release job re-runs everything, so a broken commit can merge but can't be released | P3 | Check in GitHub settings. Recommended required set: `validate-action-pins`, `mobile`, `web-and-rules`, `functions` |
| CI-2 | No build provenance or SBOM for the APK | P3 (enhancement) | `actions/attest-build-provenance` (SHA-pinned) plus a CycloneDX SBOM from Gradle would make the release verifiable beyond the sha256 |
| CI-3 | `npm audit --audit-level=high` gates **prod** deps only. Dev-only highs (see `12`) don't fail CI | Info | Reasonable. Dev tooling isn't shipped, but it runs in CI with `GITHUB_TOKEN`-less jobs |
| CI-4 | Hosting and rules deploys are manual (`firebase deploy --only …`) with no workflow | Design | No automated deployment means there's also no automated rollback. Rollback is a redeploy of the previous rules or the previous hosting release from the Firebase console. Document this in the runbook |
| CI-5 | The release job restores the Gradle cache (`setup-java cache: gradle`) in the job that holds signing secrets | Low | The cache is scoped to `main`, so poisoning needs a merged change. Optionally disable caching in `release` for hermeticity |
| CI-6 | Builds aren't reproducible (no Gradle dependency verification or locking) | P3 | `gradle --write-verification-metadata sha256` would pin artifact hashes |
