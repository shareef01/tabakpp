# tabak++ Privacy Notice

Last updated: 24 July 2026

tabak++ stores account identifiers, profile settings, smoking-tracker counts,
history entries, financial estimates, and an optional avatar in Firebase
Authentication and Cloud Firestore. This information is used only to provide
sign-in, synchronization, history, and calculated insights across the user's
devices.

## Data handling

- Firebase processes and stores cloud data on behalf of the app.
- Avatars are stored as compressed image data in the user's Firestore profile.
- The app does not intentionally sell personal data or use tracker data for ads.
- Local diagnostic logs must not be committed or shared because third-party SDKs
  may include account identifiers or App Check tokens in development output.

## Retention and deletion

Data remains until the user deletes individual history entries or uses Delete
Account in Settings. Account deletion attempts to erase tracker configuration,
history, profile data, and the Firebase Authentication account. If final
Authentication deletion fails after data erasure, the app reports the partial
failure so the user can retry.

## Security and limitations

Access rules restrict each signed-in user to their own Firestore subtree.
Firebase App Check is used by production clients as an abuse-control layer.
Because the Spark-plan architecture performs calculations on clients, users can
modify their own calculated totals with a modified client; this does not grant
access to another user's data.

## Contact

Before public distribution, replace this section with the operator's current
privacy contact and publish this notice at a stable HTTPS URL linked from every
store listing and client.
