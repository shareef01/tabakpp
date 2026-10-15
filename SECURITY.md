# Security Policy

## Supported Versions

Only the latest release of `tabak++` is actively maintained and supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Threat Model & Security Architecture

`tabak++` operates under a dual-mode security architecture designed for complete financial integrity and owner data isolation:

1. **Dual Financial Modes (Legacy vs Option B)**:
   - **Legacy Mode**: Operates on direct client Firestore writes constrained by Firestore Security Rules (`firestore.rules`). On closed days, rules freeze `trackerSnapshots`, `status`, `date`, `foldedIntoLifetime`, and `legacyMigrationApplied`.
   - **Option B Trusted Mode**: Financial mutations for migrated accounts route exclusively through trusted server-side Cloud Functions (`executeFinancialOperation`). Firestore Security Rules enforce a strict `financialLocked` fence denying all direct client writes to financial collections (`days`, `logs`, `dailyFinancials`, `financialOperations`, and profile `lifetimeAggregates`).
2. **Zero-Trust Client Boundary & Admin Transactions**:
   - In Option B, client-supplied financial totals and price derivations are never trusted. All calculations (`calculateDailyFinancials`, `computeDayCredit`) execute server-side in Cloud Functions using immutable historical snapshots and server-verified profile configurations.
   - Operations execute in atomic Firestore transactions that atomically persist the source document mutation, canonical daily ledger, updated lifetime aggregates, and an idempotency receipt (`trustedOperations/{operationId}`).
3. **Configuration & Non-Financial State**:
   - Tracker configurations (`configs/{configId}`) allow owner-authenticated creation, updates, and reordering subject to strict schema, bounds, and cap validations (max 8 active trackers).
   - Tracker deletion for Option B accounts is executed via the `TRACKER_DELETE` Cloud Function to ensure active open-day counts and stamped snapshots are cleaned up atomically.
   - Profile metadata (`meta/{metaId}`) holds avatars and preferences outside the high-frequency financial write path.
4. **User Data Isolation**:
   - Every document is strictly scoped under `/users/{uid}/` and requires `request.auth.uid == userId`. Cross-user reads and writes are denied unconditionally.
   - Receipts in `trustedOperations` are denied to all client readers and writers; only the Admin SDK can read or write trusted receipts.
5. **Account Deletion & Recent Login Requirement**:
   - For Option B and Migrating accounts, client-side deletion of financial data is blocked by security rules. Complete account data wipe is handled server-side by the `deleteAccountData` Cloud Function, which validates recent authentication (auth time within 5 minutes) and removes all user subcollections.
6. **Public Firebase Configuration**:
   - In accordance with standard Firebase architecture, client identifiers (`apiKey`, `projectId`, `appId`) embedded in web or mobile binaries are identifiers, not secrets. Security is enforced through Firestore Security Rules, verified Firebase Authentication tokens, and Cloud Function callable context.
7. **App Check**:
   - Web uses reCAPTCHA Enterprise (`ReCaptchaEnterpriseProvider`). Android release builds use `PlayIntegrityAppCheckProviderFactory`. App Check reduces abuse and automated traffic; it complements but does not replace Firestore rules and server validation.

## Reporting a Vulnerability

If you discover a security vulnerability in `tabak++`, please report it responsibly:

1. **Do not create public GitHub issues** for security vulnerabilities.
2. Report via **GitHub Private Vulnerability Reporting** (Security tab -> "Report a vulnerability").
3. Include:
   - Detailed description of the issue and potential impact.
   - Exact steps or minimal proof-of-concept to reproduce the vulnerability.
   - Any proposed mitigations or fixes.

We will acknowledge receipt within 48 hours and work toward timely remediation and coordinated disclosure.

## Account lifecycle and migration fences

The audit follow-up rules fence account writes during smoking-unit migration and after deletion begins. Deletion retains a minimal UID-keyed marker to prevent surviving tokens from recreating data. These guarantees require deploying the follow-up rules before the corresponding clients. See [audit follow-up](docs/audit-follow-up-2026-10-07.md) for rollout limits and dependency triage.
