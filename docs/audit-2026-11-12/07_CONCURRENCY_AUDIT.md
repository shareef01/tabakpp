# 07 — Database and distributed-systems audit

Firestore client transactions (web and Android native SDKs) are **optimistic**. Reads record document versions, and the commit fails and retries if any document read in the transaction changed. Every financial read-modify-write in both clients runs inside `runTransaction` and reads everything it writes. Each scenario below was traced through the code; the right-hand column says whether it was reproduced.

| # | Scenario | Initial state | A | B | Ordering | Final state | Invariant | Result |
|---|---|---|---|---|---|---|---|---|
| C1 | Tap vs close (two devices) | day D open, cig=2, unfolded | `adjustCounter(+1, D)` | `closeDay(D)` | Both read D; B commits first | A's commit fails its precondition and retries, sees `closed`, takes `applyLateCounterWrite`: cig=3, lifetime += Δcredit | I1 | **Holds**. Late write after close reproduced by `registryService.emulator.test.js:218–229` |
| C2 | Two closes | D open, unfolded | `closeDay(D)` | `closeDay(D)` / reconcile | Both read D unfolded | The second retries, sees `foldedIntoLifetime`, and only flips status | I1 (no double fold) | **Holds** (`:857–860`) |
| C3 | Two taps on one tracker | cig=2 | +1 | +1 | Concurrent | cig=4 after one retry | No lost update | **Holds** (transactional) |
| C4 | Historical edit vs late tap | D closed, folded | `updateHistoricalDay(D)` | late `+1` on D | Both read D and the profile | The loser retries on the new counts and credit; lifetime delta is applied once each | I1 | **Holds** (both read the day and the user doc inside the tx) |
| C5 | Manual entry vs close | Profile P | `createManualEntry` writes log L and P | `closeDay` writes D and P | Both read P | The loser retries; both credits land | I1 | **Holds** |
| C6 | Tracker creation race | 7 configs | `addProtocol` | `addProtocol` | Both count 7 outside any tx | 9 configs | Cap ≤ 8 | **Fails, bounded**: a known limitation. Day writes for a 9th stamped tracker are refused (`TRACKER_LIMIT` plus the rules' snapshot cap of 8) |
| C7 | Delete-log undo across devices | Log L | `deleteLog(L)` | `restoreLog(L)` from a stale undo payload | — | Restore checks `existing.exists()` inside the tx, which prevents a double credit | I1 | **Holds** |
| C8 | Clock- or time-zone-ahead device closes "today" | D open on B | reconcile closes D | B taps an **unstamped** tracker on D | A then B | B is refused (`DAY_CLOSED_NO_SNAPSHOT`) | Usability | **Fails** (TABAK-001), confirmed by the emulator test `:231–239` |
| C9 | Smoking-units migration lease | Unmigrated legacy profile | Acquires the 120 s lease | Taps or saves settings | — | B is denied with a migration message until the lease ends or is released | Availability | One-time limitation; confirmed by source |
| C10 | Export during writes | — | Export pass | Close day or edit | — | The profile fingerprint changes, so the export is retried (≤ 3) and `stable:false` is reported if it never settles. Open-day taps aren't detected | Snapshot consistency | Documented limitation |

## Listener ordering and read-after-write

- The optimistic overlay doesn't assume read-after-write ordering. Ops are acknowledged when the listener's `currentServer` reaches `targetCount`, and they are re-targeted if the server moved past them (`useRegistry.js:470–487`).
- A late listener snapshot can't undo an acknowledged op, because acknowledged ops are dropped and the overlay becomes the server value.

## Idempotency

- Counter taps aren't idempotent (by design, each tap is an event). Close and fold are idempotent through `foldedIntoLifetime`.
- The legacy claim is idempotent through per-tracker `meta/legacy_*` markers read inside each transaction. The markers are owner-deletable (PROBE-7), so a deliberate delete followed by a re-run of the claim could re-apply counts. That only matters for owner-tampering and only during a migration window that no longer opens for current accounts.

## Contention

- The hottest document is `days/{today}`, at one write per tap. The profile document is written on close, edit and manual entry only. That's far below Firestore's per-document sustained-write guidance.

No race in the official clients produced a broken financial invariant. C6 and C8 are the only reproducible failures, and both are bounded.
