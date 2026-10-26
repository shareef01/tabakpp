# tabak++ Privacy Notice

Last updated: 19 October 2026

tabak++ stores account identifiers, profile settings, smoking-tracker counts,
history entries, financial estimates, and an optional avatar in Firebase
Authentication and Cloud Firestore. This information is used only to provide
sign-in, synchronization, history, and calculated insights across the user's
devices.

## Data handling

- Firebase processes and stores cloud data on behalf of the app.
- Avatars are stored as compressed image data in the user's profile metadata (`meta/profile`).
- The app does not intentionally sell personal data or use tracker data for ads.
- Local diagnostic logs must not be committed or shared because third-party SDKs
  may include account identifiers in development output.

## Retention and deletion

Data remains until the user deletes individual history entries or uses Delete
Account in Settings.

- **Account deletion (current production, Spark plan)**: The app deletes your tracker
  configurations, history logs, daily dated records, canonical ledgers, operation
  receipts and profile metadata (including the avatar). It then replaces your
  profile document with a one-field marker (`{ deleting: true }`) keyed by your
  anonymous Firebase user ID, and finally deletes your Firebase Authentication account.
- **Deletion marker**: The marker holds no name, email address, settings or usage
  data. It stops a still-valid sign-in token on another device from recreating data
  after deletion. Security rules do not let the app remove it, so it is kept after
  the account is deleted.
- **Interrupted deletion**: Deletion runs in batches. If it is interrupted, signing in
  again and repeating Delete Account resumes it. If final Authentication deletion
  fails after the data is erased, the app reports the partial failure so you can
  re-authenticate and retry.
- **Server-side deletion (Option B, not currently deployed)**: If the Cloud Functions
  backend is enabled, accounts in that mode are erased by the `deleteAccountData`
  function (recent sign-in required, within 5 minutes) using the Admin SDK's
  recursive delete, which also removes the server-only `trustedOperations` and
  `trustedDeletedLogs` records.

## Security and limitations

Access rules restrict each signed-in user strictly to their own Firestore subtree.
In Legacy mode, Firestore Security Rules enforce owner isolation and validation bounds.
In Option B mode, calculations and ledger writes are strictly server-authoritative via Cloud
Functions, preventing client modification of financial totals while preserving owner isolation.
Firebase App Check is not used: no attestation provider is installed on either client and no
App Check token is requested, so the app does not collect or transmit app-attestation data.
Firestore rules and API-key restrictions remain the active controls. API-key restrictions limit
which applications and origins may use the public key, but they are not a substitute for device
attestation, so abuse resistance is lower than an App-Check-enforced deployment.

## Contact

This notice is published in the repository from which tabak++ is distributed:
https://github.com/shareef01/tabakpp (releases include each APK). Privacy
questions can be raised via that repository's issue tracker.
