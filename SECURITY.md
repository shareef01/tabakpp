# Security Policy

## Supported Versions

Only the latest release of `tabak++` is actively maintained and supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Threat Model & Security Architecture

`tabak++` is designed to run on Firebase Spark (free) tier without custom backend servers:
1. **Zero-Trust Client Model**: Clients are completely untrusted. All data validation, ownership isolation, numeric boundaries, and lifecycle immutability are enforced by Cloud Firestore Security Rules (`firestore.rules`).
2. **User Data Isolation**: Every document is scoped under `/users/{uid}/` and strictly requires `request.auth.uid == userId`. No user can read or modify another user's data under any circumstance.
3. **Public Firebase Configuration**: In accordance with Google's Firebase architecture, client configuration parameters (such as `apiKey`, `projectId`, `appId`) embedded in client binaries or web bundles are identifiers, not secrets. Security is enforced through Firestore rules, Firebase Authentication, and API key restrictions in Google Cloud Console.
4. **App Check**: Web supports reCAPTCHA Enterprise and Android supports App Check. Enforcement is currently disabled by default to permit GitHub Releases sideloaded APK installations without mandatory Google Play Console linking (see `SETUP_GUIDE.md`).

## Reporting a Vulnerability

If you discover a security vulnerability in `tabak++`, please report it responsibly:

1. **Do not create public GitHub issues** for security vulnerabilities.
2. Report via **GitHub Private Vulnerability Reporting** (Security tab -> "Report a vulnerability").
3. Include:
   - Detailed description of the issue and potential impact.
   - Exact steps or minimal proof-of-concept to reproduce the vulnerability.
   - Any proposed mitigations or fixes.

We will acknowledge receipt within 48 hours and work toward timely remediation and coordinated disclosure.
