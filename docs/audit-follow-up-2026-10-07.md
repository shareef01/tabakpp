# Audit follow-up — 2026-10-07

This change is stacked on PR #82. Production currently runs the independently verified PR #82 rules; the additional rules in this change are not deployed.

## Findings addressed

- M2/M3: monthly economics include stamped manual credits. Current open-day counts replace the persisted projection, and folded lifetime totals do not count today twice. Missing historical economics are explicitly unknown.
- M4: reconciliation closes empty stale days so the 30-document window cannot permanently hide later consumed days.
- M6/L1: failed chunk imports reload once per build, then surface an error. Reset removes only application storage keys.
- M7: smoking-unit migration claims a 120-second lease before scanning. Rules freeze input writes during the lease, require timely completion, and preserve other lifetime fields. Folded dated days contribute smoking units. Failed scans can resume after lease expiry.
- M8: account deletion first fences writes, drains all collections, and retains a minimal UID-keyed `{deleting: true}` marker. Interrupted deletion can resume; surviving authentication tokens cannot recreate data or remove the marker. This retained identifier is intentional, not an anonymous record.
- M9/M11: dispatch versions enter Bash through environment variables, are validated before use, and cannot execute shell substitutions. Signing requires successful latest main-push CI and Android instrumentation runs for the recorded exact commit. Release validation also builds Android and runs web production/PWA checks.
- L2: reporting comments and rollout guarantees describe the implemented schema and limitations. M1/M5 were addressed in PR #82.

Deploy the reviewed follow-up rules before releasing clients that use migration leases and deletion markers. Older clients cannot finish the new fenced migration protocol; an active lease temporarily blocks their mutations. Server time and rules determine lease validity. These fences protect concurrency and account deletion; they do not make owner-written aggregate values authoritative.

## App Check: M10 remains conditional

Read-only production inspection found registered Play Integrity and reCAPTCHA Enterprise providers. Firestore and Auth remain UNENFORCED. Cloud Monitoring's App Check verification metric for September 30–October 7 reported 400 valid web Firestore requests and 5 valid web Auth requests. No Android series was returned; this is not proof of Android compatibility.

Verify a production-signed released Android build on a physical device and correlate valid Android tokens in service metrics before enabling enforcement. Older incompatible clients also need an upgrade plan. No enforcement setting was changed by this work.

## Tooling dependencies: M12 partially addressed

Compatible lockfile updates reduced npm audit findings from 27 package entries (including one critical) to 13 entries: 4 moderate and 9 high, with no critical findings. Remaining underlying advisories affect OpenTelemetry baggage parsing, basic-ftp directory-list parsing, braces pattern parsing, and uuid buffer handling. They are development-tool transitive dependencies; production dependency audit is checked separately.

Firebase tooling and Puppeteer dependency trees still carry these advisories. This application does not ship those packages in its production dependency set. That distinction does not prove every CI path unreachable. Forced downgrades suggested by npm were rejected; upstream-compatible patched versions and CI input exposure still need tracking. Do not describe the full tooling audit as clean.

## Validation

- 346 web unit/contract tests passed.
- 68 Firestore rules and real SDK tests passed, including two-client migration/deletion races and empty-day reconciliation.
- Shared and Compose JVM tests, Android debug APK build, and Android lint passed.
- Release safety tests passed, including literal malicious dispatch values and exact-commit CI gates.

Production web build and 27 PWA scenarios passed. Production dependency audit reported zero vulnerabilities.
