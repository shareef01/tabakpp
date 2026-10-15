# tabak++ Privacy Notice

Last updated: 15 August 2026

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
  may include account identifiers or App Check tokens in development output.

## Retention and deletion

Data remains until the user deletes individual history entries or uses Delete
Account in Settings.

- **Account deletion**: Erases application subcollections (tracker configurations,
  history logs, daily dated records, canonical ledgers, profile metadata, trusted
  restoration tombstones `trustedDeletedLogs`, and operation receipts `trustedOperations`),
  the profile document, and the Firebase Authentication account.
- **Trusted deletion (Option B)**: Because security rules deny client-side deletion of
  financial history for Option B accounts, account data erasure is performed server-side
  by the `deleteAccountData` Cloud Function, requiring recent authentication (within 5 minutes).
- **Tombstone marker**: During deletion, a minimal UID-keyed marker (`{ deleting: true }`)
  is recorded to prevent surviving or cached authentication tokens from recreating data.
  This marker contains no personal identifiers and survives token reuse until final account removal.
- **Erasure semantics and retry**: Firestore data erasure is executed across batched deletes
  using the Firestore Admin SDK (`recursiveDelete`). In the event of a network interruption or
  timeout during bulk subcollection deletion, the operation is idempotent and can be safely retried:
  subsequent calls resume deletion until all user subcollections and documents are purged.
- If final Authentication deletion fails after data erasure, the app reports the partial
  failure so the user can re-authenticate and retry.

## Security and limitations

Access rules restrict each signed-in user strictly to their own Firestore subtree.
In Legacy mode, Firestore Security Rules enforce owner isolation and validation bounds.
In Option B mode, calculations and ledger writes are strictly server-authoritative via Cloud
Functions, preventing client modification of financial totals while preserving owner isolation.
Firebase App Check is integrated on both web and Android clients (advisory mode) to provide
device and app attestation.

## Contact

This notice is published in the repository from which tabak++ is distributed:
https://github.com/shareef01/tabakpp (releases include each APK). Privacy
questions can be raised via that repository's issue tracker.
