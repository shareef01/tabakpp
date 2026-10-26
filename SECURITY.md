# Security Policy

## Supported Versions

Only the latest release of `tabak++` is actively maintained and supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Threat Model & Security Architecture

**What is deployed today:** production runs on the Firebase Spark plan in **Legacy mode** only. Clients write directly to Firestore, and Firestore Security Rules are the security boundary. Rules guarantee owner isolation and bound the shape of every write, but they cannot recompute money, so an account owner can rewrite their own totals. The Option B Cloud Functions described below are written and tested in CI but **not deployed**, and App Check is **not used at all** — it was removed from both clients rather than enforced (see item 7).

`tabak++` is built for two financial modes. Owner data isolation holds in both; server-verified financial integrity exists only in Option B:

1. **Dual Financial Modes (Legacy vs Option B)**:
   - **Legacy Mode**: Operates on direct client Firestore writes constrained by Firestore Security Rules (`firestore.rules`). On closed days, rules freeze `trackerSnapshots`, `status`, `date`, `foldedIntoLifetime`, and `legacyMigrationApplied`.
   - **Option B Trusted Mode (not deployed)**: Financial mutations for migrated accounts route exclusively through trusted server-side Cloud Functions (`executeFinancialOperation`). Firestore Security Rules enforce a strict `financialLocked` fence denying all direct client writes to financial collections (`days`, `logs`, `dailyFinancials`, `financialOperations`, and profile `lifetimeAggregates`).
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
7. **App Check — not used**:
   - This project runs without Firebase App Check: no attestation provider is installed on either client, no App Check token is requested, and no enforcement is configured. Web and Android both talk to Firebase Authentication and Cloud Firestore directly, authorized by Firestore Security Rules.
   - This is an explicit security trade-off, not an oversight: **it does not weaken owner data isolation** (every rule path still requires `request.auth.uid == userId`), but it **removes a layer of abuse resistance**. Automated or non-app traffic is not stopped by attestation; the remaining control is Google Cloud **API-key restriction** (HTTP-referrer restricted web key, package + signing-certificate restricted Android key), which limits *which applications and domains may use the key*. That is **not equivalent** to attestation: API-key restrictions raise the cost of casual reuse of the public key, while App Check attests the running app. Quota abuse within a permitted app/origin is therefore only bounded by Spark quotas.
   - Operational warning: do **not** enable App Check enforcement in the Firebase Console while these clients are current — they send no tokens, so Firestore/Auth would reject their requests. Adding App Check later means re-introducing providers and re-releasing clients first; see `SETUP_GUIDE.md` → "Adding App Check later (not currently used)".

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
