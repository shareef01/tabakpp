## What & why

<!-- One paragraph. Link the issue this closes, if any. -->

## Invariants touched

Check every one that applies — see [CONTRIBUTING.md](../CONTRIBUTING.md) §3.

- [ ] `firestore.rules` (authorization or validation shape)
- [ ] Dated-day model (`days/{date}`, `trackerSnapshots`, `foldedIntoLifetime`, close-once)
- [ ] Domain maths — `shared-tests/domain-fixtures.json` updated **and** both ports (Kotlin + web JS)
- [ ] OPTION B trusted boundary (`functions/`, `financialMode`, `financialLocked`)
- [ ] Design tokens (`webApp/src/constants/ui.js` ⇄ `index.css` ⇄ `Color.kt`)
- [ ] Client/Android parity (a change visible in one client but not the other)
- [ ] None of the above

## Behaviour change for existing data?

<!--
Existing accounts may hold documents written by an older client. Say what an
old document means after this change, or write "no schema/interpretation change".
-->

## Verification

<!-- Delete what you did not run. Paste the numbers. -->

- [ ] `cd webApp && npm run lint` (only the intentional `exhaustive-deps` warnings)
- [ ] `cd webApp && npm run coverage` — __ tests passed
- [ ] `cd webApp && npm run test:contract`
- [ ] `cd webApp && npm run build && npm run test:pwa`
- [ ] `cd webApp && npm run test:a11y` — 0 violations
- [ ] `cd webApp && npm run test:rules` — __ tests passed
- [ ] `./gradlew :shared:testDebugUnitTest :composeApp:testDebugUnitTest :androidApp:testDebugUnitTest`
- [ ] `cd functions && npm test` (if `functions/` touched)

## Screenshots / recording

<!-- For any UI change, before/after. Mobile width matters most. -->
