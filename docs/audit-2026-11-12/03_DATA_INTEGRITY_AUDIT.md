# 03 — Business logic and data integrity

## Invariants as implemented (LEGACY / Spark)

Let `credit(x)` be the stamped `aggregateCredit` of a day doc or log. For an account written only by the official clients:

- **I1** `lifetimeAggregates = Σ credit(day) for days with foldedIntoLifetime == true + Σ credit(log) for all logs` (apart from the one-time `smokingUnits` back-fill and `LEGACY_RECOVERY` rows, which credit smokingUnits only).
- **I2** `credit(day) = computeDayCredit(day.counts, day.trackerSnapshots)` at every commit.
- **I3** Once a day is closed, its `trackerSnapshots` never change (against in-place updates; see TABAK-002).
- **I4** Every count belongs to the tracking date computed at tap time (`getTrackingDate(now, dayStartHour)`, device time zone).

Each write that moves credit into or out of the folded set updates the profile in the same transaction:

- `closeDay`: `registryService.js:845–874`
- `applyLateCounterWrite`: `:272–298`
- `updateHistoricalDay`: `:953–984`
- Manual create/update/delete/restore: `:1074–1286`
- Kotlin mirrors at `FirebaseRegistryRepository.kt:222–255`, `:455–497`, `:550–588`

Open-day taps (`adjustCounter`) touch only the day doc, which is correct because an unfolded day is outside I1. **I1–I4 hold under normal application behaviour.** I found no non-malicious sequence that breaks them (see `07_CONCURRENCY_AUDIT.md`).

Direct writes by the owner can break I1–I3. That's the documented Spark residual; TABAK-002 shows that I3 and the "fold once" flag are also bypassable by delete + recreate.

## Consumption accounting

| Concern | Result | Evidence |
|---|---|---|
| Increment/decrement | Transactional read-modify-write per day doc; `Math.max(0, …)` floor; `delta` must be an integer | `registryService.js:762–818` |
| Rapid taps | The optimistic overlay tracks per-op `targetCount` and reconciles against listener snapshots, and each tap is its own transaction | `useRegistry.js:399–506`, `:646–688` |
| Negative counters | Impossible: client floor plus rules `v >= 0` | rules `:99` |
| Maximum value | 10000 is enforced by rules; going past it gets a denied write with a generic error rather than a pre-check on the tap path | `adjustCounter` has no upper pre-check (cosmetic) |
| Decrement at 0 | Blocked in the UI (`useRegistry.js:723`) | — |
| Tracker deletion | Removes the tracker from the current open day only; closed days keep their snapshot | `registryService.js:449–492` |
| Tracker recreation | A new auto-id, so it never collides with old snapshots | `addProtocol` |

## Daily rollover, time zones, clocks

- **Tracking date.** It's derived at mutation time on both platforms (`resolveTrackingDateForMutation`, `useRegistry.js:150`; `trackingDateForMutation`, `RegistryViewModel.kt:315`), from the device's local wall-clock hour.
- **DST.** It's handled implicitly: the boundary is a local-hour comparison, so a skipped or repeated hour moves the boundary with the wall clock. Contract fixtures and `SmokingCalculatorTest` cover day-start boundaries.
- **Travel and clock skew.** Counts go to the device-local date. A device that is ahead (time zone or clock) can close a date another device still treats as today (`reconcileStaleDays`). Later taps on stamped trackers are accepted as late writes. Taps on **unstamped** trackers are rejected; see TABAK-001.
- **Offline.** Live writes need `navigator.onLine`, and transactions don't queue. Verified by `offlineBehavior.emulator.test.js` in the passing rules suite.
- **Inconsistency (cosmetic, not a finding).** The profile's `timeZone` field is only used by the undeployed Functions path (`trustedExecute`). The LEGACY path ignores it. That's consistent between clients.

## Historical snapshots

Repricing a tracker, changing its limit or baseline, or deleting it never changes a closed day's credit. Closed-day edits use the frozen snapshots (`requireHistoricalPrices` refuses edits where the price is unknown). Configuration only affects history in these cases:

1. **Writes to an open past day.** Any write to a still-open past day (undo across rollover, a device behind) re-stamps that tracker's snapshot from the **live** config (`registryService.js:800–803`). The window is short (until reconcile) and the behaviour is documented.
2. **Legacy logs without stamps.** `resolveContribution` falls back to live configs for legacy logs that have no `aggregateCredit`. Documented in `docs/financial-semantics.md`.

## Accepted limitations re-verified (not new findings)

| Limitation | Status at `ec8bdf7` |
|---|---|
| Two manual entries on one date each credit the full target allowance (Option A) | Still true. `createManualEntry` stamps a per-record credit (`:1265–1267`), pinned by a unit test |
| A zero-count day doc (tap then undo) closes with full target-based `saved` | Still true (AUD-006), by design (`closeDay` with `allowEmpty`) |
| Tracker cap of 8 is client-enforced; a cross-device race can create 9 configs | Still true. The rules cap day snapshots at 8, so it fails closed at use time |
| Smoking-units migration lease freezes **all** writes for ≤ 120 s on unmigrated legacy accounts | Confirmed by source: `accountWritable` checks the lease (`rules:325–327`), and the client lease is 120 s (`registryService.js:568`). It's one-time, and the client surfaces "History migration is in progress" (`useRegistry.js:631–634`) |

## Reconciliation utility (proposal, read-only)

A read-only check is feasible with existing code. Read all days and logs (`readCompleteExportSnapshot`) and compute `expected = Σ folded day credits + Σ log credits`. Then compare it with `profile.lifetimeAggregates` per component, flag the dates whose stored credit differs from `computeDayCredit(counts, trackerSnapshots)` (I2 violations), and report it without writing anything. `SmokingCalculator.expectedLifetimeAggregates` (JS) already exists and could back this. Overwriting user data is out of scope and would need explicit authorization.
