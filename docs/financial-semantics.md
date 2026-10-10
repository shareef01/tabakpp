# Financial semantics — decision record

**Status:** POLICY-1 **AWAITING PRODUCT APPROVAL**. Option **B (day-level)** is
the technically-preferred candidate and is fully specified below (§7–§10) but is
**not activated** — the live behaviour remains Option A. Everything else in this
document is established behaviour, implemented consistently on both clients.

Audience: product owner + maintainers. This record does **not** change any
formula; it documents the ambiguity and the exact, ready-to-approve Option B
contract so a future change is deliberate and testable.

---

## 1. The metrics

| Field | Meaning | Additivity |
|---|---|---|
| `wasted` ("spent") | money spent on what was consumed, at the **stamped** historical unit price (`count × price`) | **Event-additive** — summing consumption across days/entries is correct by definition |
| `smokingUnits` | count of consumed smoking units (CIGARETTE/RYO_ROLL/JOINT_KING) | **Event-additive** |
| `saved` ("budget left") | money *not* spent versus the day's **target**: `Σ (target − count)⁺ × price` | **Day-level** |
| `baselineSaved` ("money saved") | money *not* spent versus the tracker's **baseline** (previous average): `Σ (baseline − count)⁺ × price` | **Day-level** |

`README.md` (lines 140–143) states the product rule: *"Money saved and reduction
are always computed against a tracker's baseline … never against its target."*
So `baselineSaved` is the user-facing "money saved", and `saved` is a
target-adherence figure ("budget left today").

## 2. Where each value is computed

- **`days/{date}` (dated daily-document model, authoritative going forward):**
  `aggregateCredit` is computed **once per day** from that day's total `counts`
  and the day's stamped `trackerSnapshots` (`computeDayCredit`). This is a true
  **day-level** figure.
- **`logs/{id}` (legacy ledger: manual backfills + pre-migration archives):**
  each log stamps its own `aggregateCredit` from *its own* `counts`
  (`contributionFrom`). This is an **event-level** figure.
- **`lifetimeAggregates`** (profile rollup) sums every stamped credit: folded
  day-doc credits (`closeDay`) plus every log credit
  (`createManualEntry`/`restoreLog`, debited by `deleteLog`, replaced by
  `updateHistoricalLog`).
- **Monthly insights** (`aggregateMonthlyData`) sum the same stamped credits per
  date, so monthly now reconciles with `lifetimeAggregates`.

## 3. The ambiguity

`wasted` and `smokingUnits` are safe: they are event-additive under every model.

`saved` and `baselineSaved` are **day-level** quantities. When a single date
carries more than one day-level record (two or more manual logs on the same
date), the two possible policies diverge.

Worked example — target 10, price €1, two manual logs on the same date:

| | Log A (2 units) | Log B (3 units) | Total |
|---|---|---|---|
| **Option A — event-level (current)** | `(10−2)·1 = €8` | `(10−3)·1 = €7` | **€15** |
| **Option B — day-level** | — | — | `(10−5)·1 = **€5**` |

### Option A — event-level (current behavior)

- Every record is credited independently and summed.
- **Pros:** matches the shipped legacy ledger and the maintained
  `lifetimeAggregates`; no data migration; historical stamps are respected.
- **Cons:** the day's "budget left" can exceed the day's target budget when more
  than one record covers that date (€15 for a 10-unit, €10 day). Not
  mathematically a day-level figure.
- **Reachability:** requires ≥2 manual entries for the same date; a single entry
  per date is correct under both models.

### Option B — day-level

- Compute `saved`/`baselineSaved` **once** from the date's combined consumption.
- **Pros:** internally consistent day-level quantity.
- **Cons:** requires the day's `target`/`baseline`/`price` for the *combined*
  set. For existing data: `price` is recoverable (`wasted ÷ count`) but `target`
  and `baseline` are **not** recoverable from a log whose stamp predates those
  fields; and it is undefined when the multiple entries were stamped under
  different config versions. Implementing it therefore needs a write-path change
  (recompute the date's day-level credit on every manual write) plus a
  historical-repair decision — a **destructive migration** that must not be done
  without an explicit business rule.

## 4. Recommendation

- **Do not change the formula now.** The current event-level behavior is
  consistent with `lifetimeAggregates` (monthly reconciles with lifetime), and
  the divergence only occurs for ≥2 manual records on one date.
- **Product decision required** to choose A or B. If B is chosen:
  1. Make the manual-entry write path maintain a **per-date day-level
     reconciliation** (recompute the date's combined credit, apply the delta),
     rather than stamping per entry.
  2. Provide a **reconciliation/repair** for existing multi-entry dates, with a
     dry-run, idempotency, and rollback plan — and do **not** recompute
     historical `wasted` (consumption) or prices.
- **Interim UX option (no accounting change):** if B is intended, steer users to
  one record per date (merge same-date manual entries) — still a product choice.

## 5. Compatibility / migration impact

- Option A (status quo): no migration, old clients unaffected.
- Option B: requires the write-path change above + a historical-repair plan;
  old clients would keep stamping per-entry credits until updated, so a
  mixed-client window must be defined.

## 6. What this remediation did (and did not) change

- **Changed:** monthly insights now include the same stamped log credits that
  `lifetimeAggregates` already used, so **monthly reconciles with lifetime**
  (previously monthly ignored manual-log economics entirely).
- **Changed:** `baselineSaved` now moves together with `saved` on every manual/
  log write path (create/edit/delete/restore), on both clients.
- **Not changed:** the event-level-vs-day-level policy for multi-entry dates.
  This is the open product decision above.

---

## 7. Why Option B is the technically-preferred model

The application **already treats a date's consumption as one combined total**:
`aggregateMonthlyData.units` sums the day document **plus every manual log** for
that date (additive), and History shows each manual log as its own row. So the
day has exactly **one** consumption figure and **one** target. Crediting the
day's *budget allowance* once **per entry** (Option A) therefore counts the same
allowance more than once, and is internally inconsistent with the units model.

Day documents already do the correct thing: `computeDayCredit(counts,
trackerSnapshots)` computes the day-level credit **once** from the day's total.
Option B simply applies that same rule to the legacy `logs` path.

## 8. Option B — exact financial contract (AWAITING APPROVAL)

For each tracking date `d` and tracker `t`, let `total(d,t)` = day-doc count for
`d` + Σ of that tracker's manual-log counts for `d` (excluding legacy
`{date}_DAY` archive rows that duplicate the day document). Let
`target(d,t)`, `price(d,t)`, `baseline(d,t)` be the **historical** values for
that date (day-doc `trackerSnapshots` when present, otherwise the log's stamp).

```
wasted(d)        = Σ_t  total(d,t) × price(d,t)                         [event-additive, per unit]
saved(d)         = Σ_t  max(0, target(d,t)   − total(d,t)) × price(d,t) [DAY-LEVEL, once]
baselineSaved(d) = Σ_t  max(0, baseline(d,t) − total(d,t)) × price(d,t) [DAY-LEVEL, once]
smokingUnits(d)  = Σ_{t ∈ smoking} total(d,t)                           [event-additive]
```

`lifetimeAggregates` = Σ_d of the above over every closed day and every manual
log date. Monthly insights = the same, per month.

Worked example (target 10, €1, logs of 2 and 3 on one date):

| | Option A (current) | Option B (proposed) |
|---|---|---|
| `wasted` | €5 | €5 |
| `saved` | **€15** | **€5** |
| `smokingUnits` | 5 | 5 |

## 9. Affected functions (implementation map)

- **Web:** `webApp/src/utils/smokingCalculator.js` — `aggregateMonthlyData`
  (use one day-level credit per date), and a new `dayLevelCredit(counts,
  snapshots)`; `webApp/src/services/registryService.js` —
  `contributionFrom`/`createManualEntry`/`updateHistoricalLog`/`deleteLog`/
  `restoreLog` (recompute the affected **date's** credit and apply the delta,
  reading same-date logs in the transaction).
- **Kotlin:** `shared/.../domain/SmokingCalculator.kt` (`aggregateMonthlyData`,
  `computeDayCredit` already day-level), `shared/.../domain/RegistryMutations.kt`,
  `shared/.../data/FirebaseRegistryRepository.kt` (the four log write paths).
- **Primitive already present:** `computeDayCredit(counts, trackerSnapshots,
  defaultUnitPrice)` computes the day-level credit and is the building block.
- **`smokingUnits` must stay config-independent** (AUD-008) — unchanged.

## 10. Minimum implementation changes + tests (ready to apply on approval)

1. Add `dayLevelCredit(totalCounts, snapshots)` = `computeDayCredit` (JS + Kotlin).
2. Log write paths recompute the affected date's credit from combined counts and
   adjust `lifetimeAggregates` by `new − previous` (idempotent per transaction).
3. `aggregateMonthlyData` emits one day-level credit per date for legacy logs.
4. New tests: one entry; two entries same date (expect `saved = €5`, not €15);
   three entries; manual + day-doc; edit; delete; restore; differing historical
   prices; deleted tracker; missing baseline; legacy log without
   `aggregateCredit`; rounding.
5. **Already-prepared reference test** proving the day-level value:
   `smokingCalculator.test.js` → `"Option B contract (reference) …"` (the worked
   example yields `saved = €5` via `computeDayCredit` on the combined counts).

## 11. Historical-data classification (for the migration design)

| Class | Records | Repair |
|---|---|---|
| **Already correct** | every `days/{date}` credit; every single-log date | none |
| **Precisely reconstructible** | multiple logs on one date whose stamps share identical `(price, target, baseline)` per tracker | recompute once from combined counts |
| **Reconstructible with assumptions** | multiple logs on one date with *differing* stamps (config changed mid-day) | needs a rule (e.g. latest stamp, or day-doc snapshot) — must be stated |
| **Not reconstructible** | logs predating `aggregateCredit`, or with `count = 0` (price/target unrecoverable) | leave as stamped; never fabricate |

Note: from a stamp, `price = wasted ÷ count`, `target = count + saved ÷ price`,
`baseline = count + baselineSaved ÷ price` (for `count > 0`).

## 12. Migration & rollback (design only — do NOT run)

- **Dry-run first:** produce, per affected date, `{date, oldCredit, newCredit,
  delta}` and the totals, without writing.
- **Idempotency:** repair must recompute the authoritatively-derived lifetime
  from stamped history (see the read-only `expectedLifetimeAggregates` integrity
  primitive) rather than apply a delta, so re-running is a no-op.
- **Rollback:** the repair only rewrites `lifetimeAggregates` from preserved
  stamps; the original stamps are never destroyed, so the pre-repair value is
  recomputable. No day-doc counts are touched.
- **Compatibility:** old clients keep stamping per-entry credits during the
  rollout, so the mixed-client window must be defined and the repair re-run
  after the fleet is updated.
- **Never** recalculate historical money with current prices; never fabricate
  missing targets/baselines.

## 13. Approval decision (requested)

- **Recommendation:** adopt **Option B** — it is the only model consistent with
  the app's existing "one combined consumption total per day" semantics and with
  the day-document path that is authoritative going forward.
- **Approver:** Product owner + engineering lead.
- **On approval:** implement §10, run the §10 tests, then execute the §12
  dry-run repair against a copy before any production write.
- **Until then:** live behaviour stays Option A; this document + the pinning
  tests record the current contract.

---

## 14. Lifetime reconciliation primitive — completeness & safety

`expectedLifetimeAggregates(dayDocs, logs)` (JS + Kotlin) recomputes the
lifetime totals a correctly-reconciled account should hold = **Σ folded
day-doc `aggregateCredit` + Σ log `aggregateCredit`**. Verified:

- **Mathematically correct**: it matches `lifetimeAggregates` produced by the
  live write paths (`closeDay` folds day credit; manual/restore credit logs;
  delete/update debit/replace). Confirmed against the **real Firestore
  emulator** in `registryService.emulator.test.js`
  (*"lifetime reconciliation from a COMPLETE export snapshot matches the stored
  aggregate"*).
- **Only complete with complete input.** The live UI subscribes to bounded
  windows (`days` limit 400, `logs` limit 1200). A total derived from those
  **undercounts**. Reconciliation must therefore feed the **full paginated
  history** — `readCompleteExportSnapshot` (which uses `getAllDays`/`getAllLogs`)
  — never the bounded live subscriptions. A test pins this
  (*"is NOT complete from a bounded window"*).
- **Missing data is surfaced, not silently zeroed.** The test-only diagnostic
  reports `missingCreditRecords` (records with no `aggregateCredit`) and
  `hasDrift`, so a legacy record is never mistaken for a valid zero.
- **Read-only.** The primitive and the diagnostic never mutate; nothing replaces
  `lifetimeAggregates`. A test-only integrity report is the developer mechanism
  (per the brief: prefer a test-only mechanism initially).

**Old-client drift** (see §3): a new client applies only deltas, so a drift is
**not** self-healed; `expectedLifetimeAggregates` over complete history is the
basis of any future one-time repair (still requiring authorization).

---

## 15. Implementation status (Option B, local)

**Implemented (PREPARED layer, both platforms):**
- `calculateDailyFinancials(dayDoc, logsForDate, configs, defaultUnitPrice)` —
  the canonical per-date aggregator (§8): combines one date's consumption,
  de-duplicates a legacy archive against the day document, resolves historical
  config from day-doc `trackerSnapshots` or reconstructed log stamps, and returns
  the day-level `{spent, saved, baselineSaved, smokingUnits}` plus `ambiguous` /
  `missingConfig` flags. The Phase 3 example (day 3 + logs 2 + 1, target 10,
  baseline 15, €1) yields **spent €6, saved €4, baselineSaved €9, units 6** — asserted on
  both platforms.
- `optionBDailyDryRun(dayDocs, logs, defaultUnitPrice)` — read-only per-date
  reconciliation: legacy credit vs Option B credit, the difference, and a
  category (D already-correct / A difference / B ambiguous / C
  non-reconstructible). Never mutates.
- Full JS↔Kotlin parity tests + fixtures.

**NOT activated (the blocker):** the **persisted** write path is unchanged; live
financials remain Option A. Activating Option B requires a decision because:

1. **Data-model / UX:** a date's Option B day-level credit must live in exactly
   one place. Today `days/{date}` and `logs/{id}` are separate History rows; if a
   manual-log date also materialises a day document (to own the day-level credit)
   the same consumption is shown twice. Resolving this is a UX/model decision
   (migrate manual entries into day documents and drop the separate rows, **or**
   keep rows and store day-level credit on a dedicated per-date doc with display
   de-duplication), which also affects whether `logs` keep their own
   `aggregateCredit`.
2. **Old-client writes:** clients that predate Option B stamp **per-record**
   credit. Until they are retired, they would inject event-level credit into a
   day-level projection → drift. Mitigation needs a **minimum-client-version
   gate** (rules/schema/infra) or an accepted mixed-client window — a release
   decision, not a client-side warning.
3. **Historical migration:** only *Category A* dates can be repaired
   unambiguously; *B* needs a stated effective-config rule; *C* is not
   reconstructible (never fabricated). The `optionBDailyDryRun` output is the
   reviewable input for that authorized migration.

**Smallest safe next step (on approval):** run `optionBDailyDryRun` on a
production copy to size Categories A/B/C, decide the row/model question, then
implement §10 + the migration §12 behind the version gate.

---

## 16. Canonical daily ledger — persistence architecture (local)

**Decision: a dedicated `users/{uid}/dailyFinancials/{date}` document owns the
ONE day-level credit.** Not the existing `days/{date}` doc, because:

- `days/{date}` is already rendered as a History row. Folding manual-log counts
  into it would display the same consumption twice — explicitly forbidden.
- A Firestore **client** transaction cannot enumerate same-date logs, so
  correctness under concurrency requires each write to read exactly **one**
  authoritative per-date document and apply a delta. A dedicated doc is that
  single read point.
- The ledger is **not** a consumption source and is never rendered as an event.

Schema (`dailyFinancials/{date}`):

| field | purpose |
|---|---|
| `date` | `YYYY-MM-DD`; equals the doc id; immutable (rules) |
| `countsByTracker` | combined day consumption (day doc + manual logs, archives de-duplicated) |
| `snapshots` | historical config per tracker (from day doc or reconstructed stamps) |
| `canonicalCredit` | the day-level `{saved, wasted, smokingUnits, baselineSaved}` (ONE per date) |
| `ledgerSchemaVersion` | `2` |
| `ambiguous` / `missingConfig` | surfaced flags (never fabricated values) |
| `foldedIntoLifetime` | whether `canonicalCredit` has entered the lifetime rollup (one-way) |
| `createdAt` / `updatedAt` | timestamps |

`lifetimeAggregates` is folded **only** from `canonicalCredit` (exactly once per
date). `days.aggregateCredit` / `logs.aggregateCredit` become non-authoritative
(kept for legacy display/export).

**Transaction design (`webapp/src/services/dailyLedger.js`):**
`recordConsumption(uid, date, deltaCounts, {snapshots})` runs one transaction that
reads ONLY the ledger doc + the user profile and: applies the delta to
`countsByTracker`, recomputes `canonicalCredit` via `computeDayCredit`, and — if
the ledger is already folded — adjusts `lifetimeAggregates` by the exact
`new − old` day-level delta. `foldIntoLifetime(uid, date)` is idempotent
(`foldedIntoLifetime` one-way). Concurrency is safe because the delta is applied
to the ledger's own counts inside the transaction; no stale query is involved.

**Rules:** `match /dailyFinancials/{date}` (local) enforces ownership, date==id,
field allow-list, the day-doc count/snapshot bounds and the aggregate bounds, and
the one-way `foldedIntoLifetime`. Validated against the emulator.

**Status:** reference implementation — **not imported by the app**, so live
behaviour is unchanged and no mixed financial-write mode can occur. Kotlin has the
matching **domain** (`calculateDailyFinancials`/`optionBDailyDryRun`); the Kotlin
persisted ledger write path is remaining work.

## 17. Activation blocker (old-client protection)

Option B cannot be activated safely while clients that write **event-level**
credit are still able to mutate the same account:

- Rules can enforce the **shape** of the new `dailyFinancials` doc but cannot
  verify that a client computed the day-level delta correctly, nor stop an old
  client from stamping per-record `saved`/`baselineSaved` on `logs`/`days`.
- A client-supplied `ledgerSchemaVersion` is not a trustworthy gate.
- Enforcing a minimum client version needs a rules/infra decision that would
  reject legitimate old-client writes (effectively a forced update).

**Therefore activation remains BLOCKED pending:** (1) the manual-log/day-doc
model decision, (2) a minimum-client-version / compatibility-release strategy,
(3) an authorized historical migration (dry-run first). No production migration,
rules deploy, or release is performed here.

---

## 18. Atomic operations + request idempotency (local integration)

**Source + ledger + lifetime + receipt are ONE transaction.** Each public op in
`webapp/src/services/dailyLedger.js` reads (receipt, ledger, profile, source
doc) then writes (source doc, ledger, `lifetimeAggregates` when folded, receipt)
atomically — so a failure leaves nothing partial:

| op | source written | ledger | lifetime | receipt |
|---|---|---|---|---|
| `createManualLog` | `logs/{id}` (create) | ✔ | if folded | ✔ |
| `updateManualLog` | `logs/{id}` (counts) | ✔ (exact source delta) | if folded | ✔ |
| `deleteManualLog` | `logs/{id}` (delete) | ✔ (reverse) | if folded | ✔ |
| `restoreManualLog` | `logs/{id}` (recreate) | ✔ | if folded | ✔ |
| `adjustCounter` | `days/{date}` | ✔ | if folded | ✔ |
| `seedLedgerFromLegacy` | — | ✔ (migration) | net correction | — |
| `foldIntoLifetime` | — | `foldedIntoLifetime` | ✔ (idempotent) | — |

**Request idempotency (not transaction retries).** A stable `operationId` is
issued once per logical action and reused on retry. The receipt
(`users/{uid}/financialOperations/{operationId}`, immutable via rules) is read
**inside** the transaction: a matching `payloadFingerprint` returns the prior
result with **no** second delta; a different payload under the same id throws
`OPERATION_CONFLICT`. Emulator-verified: the same id twice changes nothing; a
conflicting payload is rejected; a rejected op (closed day) persists no ledger
and no receipt.

**Kotlin parity.** `FirebaseRegistryRepository.createManualLogAtomic(...)` mirrors
`createManualLog` (source + ledger + lifetime + receipt, one GitLive
transaction); the `dailyFinancials`/`financialOperations` collections and
receipt rules are shared. Compile-verified; on-device execution is reported in
the release report.

**Activation.** `OPTION_B_LEDGER_ENABLED` (`VITE_OPTION_B_LEDGER=1`, default
false) is a **local** switch — not a security boundary. Option B is not enabled
for production accounts; the reference service is not wired into the app flows.

---

## 19. Old-client write gate (rules-enforced, emulator-proven)

Account-level `users/{uid}.financialMode` ∈ {`LEGACY` (default) | `OPTION_B`},
allow-listed and **one-way** (`OPTION_B` → `LEGACY` is rejected).

While an account is `OPTION_B`, the `logs/{id}` and `days/{date}` rules require —
in the **same commit** — that the date's canonical ledger be written, detected
with `getAfter(dailyFinancials/{date}).data.updatedAt` changing vs `get(...)`
(`ledgerTouched(database, userId, date)`). An unmodified legacy client, which
never touches the ledger, is therefore **rejected**; a compliant atomic
source+ledger commit is accepted.

Emulator proof (`firestore.rules.test.js`):
- LEGACY account → legacy log write **accepted** (backward compatible);
- OPTION_B account → legacy log write **rejected**;
- OPTION_B account → atomic log + ledger commit **accepted**;
- OPTION_B account → legacy `days` write **rejected**; with the ledger **accepted**;
- a ledger write to a *different* date does **not** authorise the write;
- `financialMode` one-way transition enforced.

**Documented limitation:** rules prove the ledger was *touched*, not that its
arithmetic matches the source change — so this blocks **unmodified** legacy
clients, not a hand-crafted writer. Full enforcement needs a trusted server-side
boundary. `lifetimeAggregates`-only forgery on the profile doc remains the
pre-existing owner-forgeable residual.

---

## 20. Kotlin parity — complete ledger operations (runtime-verified)

`FirebaseRegistryRepository` now implements the full Option-B ledger lifecycle as
atomic GitLive transactions (source + ledger + lifetime + idempotency receipt),
mirroring the JS reference:

| Kotlin op | writes |
|---|---|
| `createManualLogAtomic` | `logs/{id}` + ledger + (folded) lifetime + receipt |
| `updateManualLogAtomic` | `logs/{id}` counts + ledger (exact source delta) + lifetime + receipt |
| `deleteManualLogAtomic` | delete `logs/{id}` + ledger (reverse) + lifetime + receipt |
| `restoreManualLogAtomic` | recreate `logs/{id}` + ledger + lifetime + receipt (no-op if present) |
| `adjustCounterAtomic` | `days/{date}` + ledger + lifetime + receipt (rejects closed days) |
| `foldLedgerIntoLifetime` | `foldedIntoLifetime=true` + lifetime (idempotent) |

Idempotency uses the same `financialOperations/{operationId}` receipt +
`payloadFingerprint` scheme; a reused id with a different payload throws
`OPERATION_CONFLICT`.

**Runtime-verified on an isolated AVD** (Firebase Auth + Firestore emulators):
- `testI_ledgerAtomicCreateAndIdempotency` — create writes source+ledger;
  same-id retry does not double.
- `testJ_ledgerLifecycleAtomic` — create → fold → edit → delete → restore +
  counter tap, asserting persisted source, ledger and the **lifetime delta**
  (create +€7, fold, edit 3→5, delete → full allowance, restore → back; counter
  tap 4 units; same-id retry applied once).

**On-device finding (fixed):** `testJ` exposed a genuine bug that compile-only
verification missed — Kotlin's `Map + Map` *replaces* duplicate keys, so the
first draft's `oldCounts + deltaCounts` produced `{tracker: delta}` instead of
`{tracker: old + delta}` (an edit of 3→5 wrongly yielded 2). The ledger arithmetic
is now a dedicated element-wise `addCounts(a, b) = max(0, a + b)`, matching the
JS `mergeCounts`/`applyDelta`. This proves the value of real runtime tests over
build-only checks.

**AVD environment fix:** the `google_apis_playstore` image stalled under
background Play Store updates. Enabling **airplane mode** and disabling
`com.android.vending` (the CI's approach) makes the on-device suite complete in
~2 min with 23/23 passing.

---

## 21. Trusted server boundary — DECISION

**Question:** can client-only Firestore rules guarantee source↔ledger financial
*arithmetic* integrity under an untrusted/modified client?

**Answer: NO.** Rules can enforce ownership, shape, correlation and legal
transitions — and (after the §23 hardening) that the ledger's financial *content*
actually changed — but they cannot sum a date's logs, recompute the canonical
credit, or compare a client-supplied credit to a trusted recomputation. A
hand-crafted client that writes a self-consistent-looking ledger, or that
directly mutates the profile's `lifetimeAggregates` (a dedicated mutation write,
ADV-9), can still misstate its **own** projections. Cross-user isolation and
shape bounds remain enforced.

**Verdict: full financial integrity against adversarial clients is BLOCKED on a
trusted server boundary.** Do NOT claim production-ready.

### Minimum viable trusted boundary (design only — NOT implemented/deployed)

The smallest component that closes the gap is a single **callable Cloud Function**
(Firebase's existing facility; this repo is Spark / client-only today, so
functions are a *new* dependency — that is the deployment cost to weigh):

- **Operations:** `applyMutation({ operationId, type, trackingDate, trackerId|logId, counts })`
  for `counterDelta | createManualLog | updateManualLog | deleteManualLog | restoreManualLog | closeDay | migrateDate`.
- **Auth:** the callable's `context.auth.uid` is the *only* trusted uid; ignore any uid in the payload.
- **Flow:** verify the operation receipt (idempotency), read the authoritative
  source + ledger + profile in one Admin-SDK transaction, **recompute** the
  canonical day credit with the *server's* copy of the tracker snapshot, then
  write source + ledger + lifetime + receipt atomically.
- **Mode:** refuse `OPTION_B` writes from any path other than this function;
  flip `financialMode` only inside the function (one-way).
- **Rules change:** on `OPTION_B`, deny client writes to `logs`/`days`/
  `dailyFinancials`/`lifetimeAggregates` entirely (`request.auth.token.fn == true`
  is not trustworthy — instead deny all client writes and let the function use
  the Admin SDK, which bypasses rules).
- **Migration:** the coordinator function reads a consistent snapshot inside a
  transaction, classifies dates A/B/C/D, migrates A idempotently, preserves
  B/C un-fabricated, then flips the mode.
- **Idempotency/concurrency:** receipt keyed by `operationId`; Admin transaction
  serialises concurrent attempts.
- **Emulator testing:** functions emulator + the existing Firestore/Auth emulators.

Until this exists, Option B must not activate on production accounts.

---

## 22. Real wiring (Phase 2/3)

**Web (`registryService.js`).** A routing helper `optionBLedgerActive(uid)` returns
true iff `isLedgerEnabled()` (build flag `VITE_OPTION_B_LEDGER=1`, default off)
**and** the live profile's `financialMode === 'OPTION_B'`. When true these real
handlers route to `dailyLedger.js`: `adjustCounter`, `createManualEntry`,
`updateHistoricalLog`, `deleteLog`, `restoreLog`. The hook (`useRegistry.js`)
passes a **stable `operationId`** (the pending-op id / a per-action id) so retries
dedupe. Fail-closed: a profile-read error propagates — never a silent legacy
fallback. Proven by emulator tests (`registryService.emulator.test.js`): flag-on +
OPTION_B routes to the ledger; flag-off + OPTION_B is **rejected by the gate**.

**Android (`RegistryViewModel.kt`).** `optionBLedgerEnabled` (default false) +
`registryRepository.getFinancialMode(uid)` gate the same routing for `increment`,
`decrement`, `createManualEntry`, `deleteLog`, `restoreLog` → the atomic Kotlin
ops with the pending-op id as `operationId`. Proven by ViewModel tests
(`increment_routesToLedger_*`). **Remaining legacy flows:** `endDay`/reconcile,
`updateLog` (needs the log's date), `updateHistoricalDay` — not yet routed.

---

## 23. Adversarial gate result (Phase 1)

`ledgerTouched` now requires the ledger's **financial content** to change
(`countsByTracker` / `canonicalCredit` / `foldedIntoLifetime` / `snapshots` /
`migratedFromLegacy`), not merely `updatedAt`. Emulator results:

| Attack | Result |
|---|---|
| Pre-existing unchanged ledger + source-only update/create/delete/counter | REJECTED |
| Source + identical ledger rewrite | REJECTED |
| Source + ledger **timestamp-only** forged touch | REJECTED (was the pre-fix bypass) |
| Source + schema-version-only change | REJECTED |
| Source + real counts/credit change | ACCEPTED (compliant) |
| OPTION_B → LEGACY | REJECTED |
| Direct `lifetimeAggregates` mutation | ACCEPTED — documented residual (§21) |

**Answer to the critical question:** a valid, existing-but-unchanged ledger does
**not** satisfy the gate — the legacy source-only write is rejected.

---

## 24. Trusted backend (Phase 1–3 of this session)

The client-only rules boundary is superseded by a **Firebase Callable** that is
the only writer of OPTION_B financial state:

- `functions/index.js` — `executeFinancialOperation` (COUNTER_INCREMENT/DECREMENT,
  MANUAL_CREATE/UPDATE/DELETE/RESTORE, DAY_CLOSE, ZERO_COUNT_DAY_CLOSE; explicitly
  `unimplemented` for HISTORICAL_DAY_UPDATE/STALE_DAY_RECONCILE) and
  `migrateAccount` (operator-only, `admin` claim; DRY-RUN by default).
- `functions/financial.js` — the server-authoritative `computeDayCredit` /
  `calculateDailyFinancials` (port of the Web calculator) + `migrationPlan`.
- The uid is taken ONLY from `request.auth`; the payload uid is never trusted.
  The account's `financialMode` is read server-side; non-OPTION_B is rejected.
- Every write is one Admin transaction: source + `dailyFinancials/{date}` +
  `lifetimeAggregates` (when folded) + `financialOperations/{operationId}`
  receipt, keyed by a payload fingerprint (idempotent; conflicting reuse →
  `OPERATION_CONFLICT`).
- **Snapshot precedence:** day-doc stamp (historical truth) → live config
  (current tracking) → log-derived (last resort). Consumption-only Option-B log
  stamps cannot reconstruct a target, so they never override the config.

**Rules lock (`firestore.rules`):** `financialLocked(mode ∈ {MIGRATING,
OPTION_B})` denies ALL client writes to `logs`/`days`/`dailyFinancials`/
`financialOperations` and to `lifetimeAggregates`; a client can never write
`financialMode` (the function owns LEGACY→MIGRATING→OPTION_B). LEGACY clients
keep the old protocol.

**Verified end-to-end** (`functions/emulator.integration.mjs`, against the
Functions+Auth+Firestore emulators): authenticated create → source+ledger+receipt
written; idempotent same-id retry; conflicting payload rejected; DAY_CLOSE folds
once; non-OPTION_B rejected; migration replaces legacy €15 with canonical €5
(applied once, repeat no-op); non-operator migration rejected.

**Remaining:** Android still writes via its own repository ops (not the callable);
the UI read-model switch to `dailyFinancials/{date}.canonicalCredit` is not wired.

---

## 25. Financial-defect fixes (this session)

**D1 — historical revaluation.** A historical date's money must never change
because the account's *current* config changed. Snapshot precedence is now:
1. the date's own day-doc `trackerSnapshots` (dated truth);
2. the log-derived stamp — but ONLY from a stamp that can reconstruct an
   allowance (`saved > 0` or `baselineSaved > 0`); a consumption-only stamp
   yields no snapshot (it would fabricate `target = count`);
3. the live config — allowed as a fallback, but for a *past* date this sets
   `ambiguous = true` (never a silently-confident historical value);
4. otherwise `missingConfig` (never invented).
Acceptance: a stamped €1 historical log stays €1 after the config moves to €2.

**D2 — phantom savings.** A date earns a daily allowance only when there is
evidence of tracking: `eligible = dayDocExists || anyLogHasConsumption`. An
empty date (e.g. after deleting its only log) is NOT eligible — the callable
removes the ledger and reverses its folded lifetime delta, so deleting records
can never manufacture savings. A day document (incl. a genuine zero day) stays
eligible.

Both are unit-tested (`functions/financial.test.js`) and emulator-verified
(`functions/emulator.integration.mjs`: delete-the-only-log removes the ledger).

**Android gateway (partial):** `shared/.../data/TrustedFinancial.kt` +
`RegistryViewModel.optionBGateway` route OPTION_B counter/manual ops through the
`executeFinancialOperation` callable (GitLive `firebase-functions`). ViewModel
routing is unit-tested; on-device callable instrumentation is not yet run.
