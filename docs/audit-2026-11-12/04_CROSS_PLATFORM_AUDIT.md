# 04 — Cross-platform consistency (Kotlin ↔ JavaScript)

## Duplicated logic compared

| Function | JS | Kotlin | Result |
|---|---|---|---|
| `getTrackingDate` | `smokingCalculator.js:404` | `SmokingCalculator.kt:36` | Equivalent: local wall-clock hour < dayStartHour → previous date |
| `computeDayCredit` | `:356` | `:501` | Equivalent for valid stored data. JS `target` isn't floored, but rules and `buildTrackerSnapshot` guarantee whole targets. Kotlin `round()` is half-even vs JS `Math.round`, but smoking-unit sums of whole counts are integers, so there's no observable difference |
| `buildTrackerSnapshot` | `:478` | `:468` | Equivalent. JS floors `limit` and coerces `baseline` defensively, while Kotlin relies on `Int` types |
| `roundMoney` | `:16` | `:970` | Same decimal-string shift algorithm. JS `String(n)` and JVM `Double.toString` switch to exponent notation at different magnitudes, but both shift the exponent by 2, so they give the same result. The 76 contract fixtures include rounding cases |
| `requireHistoricalPrices` | `registryService.js:309` | `SmokingCalculator.kt:~480` | Equivalent |
| Late counter write | `registryService.js:272` | `FirebaseRegistryRepository.kt:222` | Equivalent |
| Stale-day reconcile | `status == 'open'` query (`:893`) | Full `days` scan in ascending order (`:517`) | **Semantically equivalent result, very different cost.** See TABAK-003 |
| Caller-count validation | `validateCounts` **rejects** invalid input with `INVALID_COUNT` (`:169`) | `InputSanitizer.counts` **filters** it out silently (`InputSanitizer.kt:22`) | **Divergent.** See TABAK-005 |
| Manual entry, profile missing | Returns without writing (`:1260`) | `userSnap.data<UserProfile>()` throws a decode error (`:769–770`) | Both fail closed; the error surfaces differently |

## TABAK-005 — Kotlin repository silently drops invalid counts where web rejects them

- **Severity:** Low (P3). **Classification:** maintainability concern; latent bug. **Confidence:** confirmed by source analysis.
- **Affected:** `shared/.../data/InputSanitizer.kt:22–29`, used by `FirebaseRegistryRepository.createManualEntry` (`:764`) and `updateHistoricalDay` (`:553`).
- **Evidence:** A negative, fractional or > 10000 value is filtered out. In `createManualEntry` that turns the entry into a zero-count record, which still earns the **full target allowance** as `saved`. The web comment at `registryService.js:160–163` names exactly that defect ("a negative manual entry into a zero-count record — a full phantom daily allowance") as the reason the web path rejects instead.
- **Reachability today:** It's not reachable from the shipped Android UI. `ManualEntryForm.kt:182` keeps digits only, and `:207` coerces to 0–10000.
- **Fix:** Make the repository reject invalid counts (throw `INVALID_COUNT`, matching web) and keep `InputSanitizer.counts` for stored-state normalization only. Add a Kotlin unit test that mirrors `registryService.test.js`'s negative-count case.

## Contract fixtures — what they do and don't prove

- `shared-tests/domain-fixtures.json` has 76 assertions, and both suites passed in this audit. The fixtures cover the pure calculator.
- They don't cover the repository and service layers, where the two divergences above live, and they don't cover time-zone-parameterised tracking dates.

**Proposed additions:**

1. A seeded randomized differential test. Generate N random `(counts, snapshots, defaultPrice)` tuples deterministically and write them to a fixture file. Both suites evaluate `computeDayCredit`, `calculateDayFinancials` and `roundMoney` on them and compare against expected values produced once by the JS implementation. This catches drift without a shared runtime.
2. Tracking-date fixtures across a DST transition (e.g. `Europe/Berlin` 2026-03-29 and 2026-10-25) at the `dayStartHour` boundary, with an explicit time zone on both sides.
3. A repository-level contract: "invalid caller counts → `INVALID_COUNT`" on both platforms.
