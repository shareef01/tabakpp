# Contributing to tabak++

Thanks for taking a look. This repo is small but carries a few hard invariants —
this document exists so you don't have to reverse-engineer them from 1,400-line
repository files.

**Before you start:** for anything touching Firestore rules, the dated-day data
model, CI, or the domain maths, **open an issue first**. Those areas fail
silently when changed casually, and the test suites are the only thing that will
catch you.

---

## 1. Set up

| For | You need |
|---|---|
| Web | Node **24.21.0** ([`.nvmrc`](.nvmrc)), npm **10.9.8** (`packageManager`) |
| Android | **JDK 21** and Android Studio, plus `androidApp/google-services.json` ([SETUP_GUIDE.md](SETUP_GUIDE.md)) |
| Rules / Functions tests | Firebase CLI — the emulator is enough, **no Firebase project required** |

```bash
cd webApp
npm ci                      # reproducible install from the committed lockfile
cp .env.example .env.local  # fill in VITE_FIREBASE_* (or use the demo build below)
npm run dev
```

No Firebase account? Explore the UI with fixture data instead:

```bash
cd webApp && npm run build:demo && npm run preview
```

## 2. Verify before you push

Run the suites that cover what you changed. The full set:

```bash
# web
cd webApp
npm run lint
npm run coverage          # unit + component tests
npm run test:contract     # JS ⇄ Kotlin domain fixtures
npm run build
npm run test:pwa          # offline nav + deploy freshness (needs a build)
npm run test:a11y         # axe over 4 viewports × 4 views + 10 accents + 200% zoom
npm run test:rules        # Firestore rules against the emulator

# Kotlin
./gradlew :shared:testDebugUnitTest :composeApp:testDebugUnitTest :androidApp:testDebugUnitTest

# Cloud Functions (Option B, undeployed)
cd functions && npm test
```

### About `npm run lint` warnings

`npm run lint` reports ~17 `react-hooks/exhaustive-deps` warnings of the form
*"missing dependency: 'user'"*. **These are intentional — do not "fix" them.**
Those effects and callbacks key on `user?.uid`, while the `user` object is a
Firebase `User` whose identity changes on every token refresh; depending on the
whole object would tear down all six Firestore listeners mid-session. The
reasoning is documented at the top of `webApp/src/hooks/useRegistry.js`.

`react-hooks/rules-of-hooks` is an **error**: a violation there is a runtime
crash, so it must never land.

## 3. Invariants you must not break

These are the contracts the project actually enforces. Each one has tests — if
you change behaviour, change the tests deliberately and say why in the PR.

| Invariant | Where it lives | What breaks if you get it wrong |
|---|---|---|
| **Counts belong to an explicit date, decided at write time.** There is no mutable "current session" bucket. | `webApp/src/services/registryService.js` (`adjustCounter`), `useRegistry.resolveTrackingDateForMutation` | Counts silently cross a midnight/day-start boundary and land on the wrong day |
| **A closed day's `trackerSnapshots` are immutable.** Repricing a tracker must never rewrite what an old day cost. | `firestore.rules` (`validDayUpdate`), `SmokingCalculator.computeDayCredit` | Historical spend/savings change retroactively |
| **Never fabricate a financial zero.** Missing ledger ⇒ `null`/"Unavailable", not `0`. | `webApp/src/services/financialReadModel.js`, `useRegistry` `canonical` memo | The UI confidently reports money that was never computed |
| **Baseline ≠ target.** Reduction is measured against the user's baseline, never their goal. | `calculateBaselineSavings`, `docs/financial-semantics.md` | Two different claims get merged into one number |
| **Domain maths is hand-mirrored in 3 places** (Kotlin, web JS, Functions JS) and kept honest by shared fixtures. | `shared-tests/domain-fixtures.json` | The two clients disagree about the same day |
| **Design tokens have one definition.** `constants/ui.js` ⇄ `index.css` ⇄ `Color.kt` | `webApp/src/theme.tokens.test.js` | Accent/danger colours drift between web, pre-hydration CSS and Android |
| **Firestore rules are the authorization boundary.** Default-deny, owner-scoped. | `firestore.rules` + `webApp/src/firestore.rules.test.js` | Cross-user data access |
| **`MAX_TRACKERS = 8` is a rules budget, not a product opinion.** | `firestore.rules` (`validSnapshotMap`), `registryService.MAX_TRACKERS` | A 9th tracker makes day writes fail with `permission-denied` mid-use |

## 4. Pull requests

- Keep a PR to one concern. Rules changes ship separately from client changes.
- Fill in the PR template's "Invariants touched" section honestly — it is what
  reviewers look at first.
- Add a test that fails before your fix and passes after it.
- Do not reformat files you did not otherwise change; it makes the rules and
  domain-math diffs unreviewable.

## 5. Commit messages

Conventional commits are used in history (`feat:`, `fix:`, `test:`, `docs:`,
`chore:`, `ci:`), scoped where useful — e.g. `fix(security): lease-guard ledger
deletes`. Match that style.

## 6. Licence

By contributing you agree that your work is licensed under the
[MIT Licence](LICENSE).
