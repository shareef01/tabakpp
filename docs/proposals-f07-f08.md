# Proposals: F-07 tracker cap and F-08 closed-day writes

Status: **decided 5 November 2026** — F-08 option 3, F-07 option 1 now and
option 4 with Option B. Nothing here is implemented yet; both land with the
Option B rollout.
Both items come from [audit-2026-11-04.md](audit-2026-11-04.md); the current
behaviour is recorded in [financial-semantics.md](financial-semantics.md) §27.

Context that shapes both answers: production runs on the Spark plan with
direct client writes (`LEGACY`). The Option B Cloud Functions are written and
tested but not deployed, because they need the Blaze plan.

---

## F-08 — what OPTION_B should do with writes to past days

### Today

| Write | LEGACY (live) | OPTION_B (not deployed) |
|---|---|---|
| +/− on a **closed** day (late tap, Undo after close) | Allowed; credit recomputed from the day's frozen prices; lifetime moves by the delta | Rejected, `DAY_CLOSED` |
| +/− on the **previous, still open** day | Allowed | Allowed for 5 minutes after the day boundary (`COUNTER_GRACE_MS`) |
| History edit of an **open** day | Allowed | Rejected |
| History edit of a **closed** day | Allowed | Allowed, reconciled server-side |

### What a user would actually lose

Less than the table suggests:

- **A closed day can still be corrected** — through History, which OPTION_B
  supports. Only the shortcut (tapping +/− on the Track screen, or Undo after
  the day was closed) goes away. The web app already answers `DAY_CLOSED` with
  "That day is already closed. Edit it in History instead."; Android maps only
  `DAY_CLOSED_NO_SNAPSHOT` and shows a generic error for `DAY_CLOSED`.
- **An open past day is short-lived.** On every start the app closes stale days
  (`reconcileStaleDays`, through the callable in OPTION_B), after which the day
  is editable in History. The awkward window is a past day that is open
  *and* more than 5 minutes old on a device that has not restarted — it can be
  neither tapped nor history-edited until the next close.

### Options

1. **Keep OPTION_B strict (current code).** Simplest server; every money change
   on a past day goes through one reconciled path (History).
2. **Match LEGACY on the server.** Treat a closed-day tap as a ±1 history edit
   and allow history edits of open days. Restores the shortcuts, but adds two
   more server write paths to the part of the system that must never double-count.
3. **Strict, plus close-before-edit (recommended).** Keep option 1, and when
   History opens a day that is past but still open, close it first (the same
   `DAY_CLOSE` call the app makes at start) so the edit is always possible.
   Undo across a day boundary keeps today's behaviour: it works inside the
   5-minute grace window, otherwise the user is pointed to History. Android
   gains the same `DAY_CLOSED` → "Edit it in History" message as the web.

**Recommendation: option 3.** It removes the only real dead end, adds no new
server write path, and keeps History as the single way to change a past day's
money. It is a small client change, only active for OPTION_B accounts, and can
ship with the Option B rollout rather than now.

**Decision (5 November 2026): option 3.** To ship with the Option B rollout:
close a past-but-open day before History edits it, and add the Android
`DAY_CLOSED` → "Edit it in History" message.

---

## F-07 — enforcing the 8-tracker cap in storage

### Today

The cap is enforced by both apps (a pre-check plus single-flight on add).
Firestore rules cannot count documents, so two devices adding a tracker at the
same instant can create a 9th. The damage is bounded: no day can record a 9th
tracker (rules cap `trackerSnapshots` at 8; the apps raise `TRACKER_LIMIT`),
and the user is told to remove one. Only the account owner can trigger it, and
only against their own data.

### Options

1. **Leave it (documented).** No work; a rare, self-inflicted, visible edge case.
2. **Counter on the profile, checked by rules.** Add `trackerCount` to
   `users/{uid}`; adding or deleting a tracker updates it in the same batch, and
   rules check `getAfter()` so a config can only be created while the count is
   below 8. Two simultaneous adds then conflict on the profile document and one
   is retried and refused. Costs:
   - both apps change, plus a backfill of `trackerCount` for existing users;
   - a **staged rollout**: apps that maintain the counter must ship first, and
     the rule can only be enforced once old app versions (≤ v1.0.13) are gone —
     otherwise those users can no longer add trackers;
   - the owner can still write any `trackerCount`, so it stops races, not a
     determined owner (the same trust model as LEGACY totals, F-04).
3. **Slot-keyed tracker IDs** (`configs/slot-0` … `slot-7`, rules allow only
   those IDs). A hard cap with trivial rules, but every existing tracker ID —
   referenced from days, logs, snapshots and ledgers — would have to be
   migrated. Not proportionate.
4. **Server-side add via the Option B callable.** The backend counts and
   enforces. Needs the Blaze plan, i.e. comes with the Option B deployment.

**Recommendation: option 1 now, option 4 when Option B is deployed.** The
failure is rare, visible and harmless to anyone but the owner, while option 2
needs a staged, multi-release rollout with a backfill to close it — and still
does not stop a determined owner. Moving tracker creation into the backend
when Option B ships gives a real guarantee for little extra work.

**Decision (5 November 2026): option 1 now, option 4 with Option B.** No
change until then; when Option B is deployed, tracker creation moves into the
backend, which enforces the cap.
