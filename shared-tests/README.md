# Cross-platform domain contract fixtures

`domain-fixtures.json` is a single set of semantic test vectors run against
**both** the JavaScript (`webApp/src/utils/smokingCalculator.js`) and Kotlin
(`shared/.../domain/SmokingCalculator.kt`) ports of the domain math.

The two implementations are hand-mirrored, not code-shared, so semantic drift
between them has historically only been caught by manually-duplicated unit
tests. This file is the single source of
truth both platforms are checked against; a value on one side that no longer
matches the other fails CI on **both** `npm run test:contract` (web) and
`:shared:testDebugUnitTest` (Android/KMP, `DomainContractFixturesTest`).

## Format

```json
{ "case": "<unique id>", "op": "<operation>", "input": { ... }, "expected": <value> }
```

`op` selects which pure domain function is under test and how `input`/
`expected` are shaped. Supported operations:

| `op` | Function under test | Notes |
|---|---|---|
| `trackingDate` | `getTrackingDate` | `input.localDateTime` is `[year, month(1-12), day, hour, minute, second]`, interpreted as **local wall-clock fields** (no timezone conversion) on both sides — this mirrors how the pre-existing unit tests in both languages already construct fixture instants (JS `new Date(y, m-1, d, hh, mm)`; Kotlin explicit `TimeZone.UTC`), and assumes a UTC-like CI runner. DST-sensitive local-clock arithmetic is covered separately in each platform's own unit tests (`smokingCalculator.test.js`, `SmokingCalculatorTest.kt`), since a DST wall-clock jump is inherently host-timezone-dependent and not practical to express as a portable fixture. |
| `limitStatus` | `getLimitStatus` | Zero-target semantics (item 4) and the three-state under/at/over model (item 5). |
| `reduction` | `getReduction` | Baseline vs. actual (item 3) — `null` baseline must produce a `null` result, never a fabricated number. |
| `baselineSavings` | `calculateBaselineSavings` | Money saved from baseline vs. actual — must never match a `target`-based computation (item 3). |
| `dayCredit` | `computeDayCredit` | The dated-daily-document model's self-contained per-day financial stamp (item 2) — computed only from `trackerSnapshots`, never live config. |
| `formatCurrency` | `formatCurrency` | Cross-platform cent-rounding parity (already a known historical drift point). |
| `backfillAllowed` | `isBackfillDateAllowed` | Manual-entry date bound. |

## Running

- Web: `cd webApp && npm run test:contract` (or it runs as part of `npm run test:run`).
- Android/KMP: `./gradlew :shared:testDebugUnitTest` runs `DomainContractFixturesTest`
  alongside the rest of the shared-module suite.

## Extending

Streak rules, historical tracker-snapshot immutability, and tracker
deletion/history behavior are covered by hand-mirrored (not fixture-driven)
tests on both platforms today (`smokingCalculator.test.js` /
`SmokingCalculatorTest.kt`, `registryService.test.js` /
`RegistryMutationsTest.kt`) rather than through this file, because they need
richer inputs (full log/day-doc histories) than the flat `input`/`expected`
shape here comfortably expresses. Extending this fixture format to cover them
— e.g. an `op: "calculateStreak"` taking a list of day-docs — is a reasonable
next step; it was left out of this pass to keep the dispatcher in both
languages small and reviewable.
