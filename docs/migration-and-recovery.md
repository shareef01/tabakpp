# tabak++ Migration, Backup & Disaster Recovery Guide

> [!IMPORTANT]
> This runbook is the authoritative guide for executing account cutover to Option-B trusted canonical financials and managing disaster recovery.
> Under no circumstances should live migrations be executed against production without completing a certified dry-run on a confirmed staging project.

---

## 1. Staging-Only Migration Architecture

The tabak++ financial migration cutover transitions accounts from unverified client-side accounting (`LEGACY`) to server-authoritative canonical financials (`OPTION_B`).

### 1.1 The Callable Contract (`migrateAccount`)

All migrations execute through the server-authoritative Firebase Callable Cloud Function `migrateAccount` (located in [`functions/index.js`](file:///c:/Users/shareef01/AndroidStudioProjects/tabakpp/functions/index.js)):

- **Authentication & Authorization**: The caller **must** present a valid Firebase Auth ID Token carrying the custom claim `admin === true`. Regular users or unauthenticated clients receive `permission-denied (403)`.
- **Idempotency & Safety**:
  - `dryRun: true` (default): Performs full four-metric historical reconstruction, computes net deltas, and validates categorization without writing or mutating any document.
  - `dryRun: false` (live execution): Requires all dates to be resolvable (no Category B or C dates). If any date is ambiguous or unresolved, the account is never frozen and remains `LEGACY`.
- **Mode Transition State Machine**:
  ```mermaid
  stateDiagram-v2
      [*] --> LEGACY
      LEGACY --> MIGRATING: Pre-validation Clean (dryRun=false)
      MIGRATING --> OPTION_B: All Dates Migrated Successfully
      MIGRATING --> LEGACY: Rollback on Unresolved Conflict (Zero Deltas Applied)
      MIGRATING --> MIGRATING: Interrupted / Partial Run (Resumable)
      OPTION_B --> [*]: Terminal Migrated State
  ```

### 1.2 The Staging CLI (`scripts/migrate-staging.mjs`)

The CLI [`scripts/migrate-staging.mjs`](file:///c:/Users/shareef01/AndroidStudioProjects/tabakpp/scripts/migrate-staging.mjs) provides an executable, operator-friendly tool for staging cutovers.

#### Required Flags
- `--project <CONFIRMED_STAGING_PROJECT_ID>`: Mandatory. Projects matching production naming patterns (`prod`, `production`, `tabakpp-app`) are rejected by hard-coded security guards.
- `--target-uid <UID>`: Mandatory. Target user account UID.
- `--dry-run`: Default behavior. Generates the full four-metric reconciliation table without writing data.
- `--live`: Executes the real cutover on staging. Prompts for explicit operator confirmation unless `--yes` is specified.

#### Example Commands
```bash
# 1. Run dry-run reconciliation on staging project
node scripts/migrate-staging.mjs --project demo-takabpp-test --target-uid user_staging_123 --dry-run

# 2. Run live migration on staging project after operator review
node scripts/migrate-staging.mjs --project demo-takabpp-test --target-uid user_staging_123 --live --yes
```

---

## 2. Four-Metric Historical Reconciliation

Unlike simplistic implementations that only reconcile a single `saved` balance, tabak++ enforces **simultaneous four-metric reconciliation** across:
1. `saved`: Net money saved vs limits (€)
2. `wasted`: Net money spent on consumption (€)
3. `baselineSaved`: Net money saved vs baseline (€)
4. `smokingUnits`: Actual unit count avoided / logged

### 2.1 Categorization Rules

Every tracking date with activity is classified by the pure domain planner `migrationPlan()`:

| Category | Definition | Action During Cutover |
| :--- | :--- | :--- |
| **A** | Reconstructible discrepancy (`delta != 0`) | Materializes `dailyFinancials/{date}` with `foldedIntoLifetime: true`, applies net replacement delta `(canonical - legacy)` to `users/{uid}.lifetimeAggregates`. |
| **B** | Ambiguous historical stamps (conflicting log stamps) | Halts migration. Requires human operator decision before account can freeze. |
| **C** | Missing historical config (irrecoverable) | Preserved without fabricating phantom savings or default prices. Halts migration. |
| **D** | Already correct (`canonical == legacy`) | Materializes `dailyFinancials/{date}` with `foldedIntoLifetime: true` to prevent historical drift without altering lifetime aggregates. |

---

## 3. Managed Exports vs Continuous Backups (PITR)

Firebase Firestore provides two distinct backup and recovery mechanisms. They serve completely different operational purposes and must never be conflated.

### 3.1 Comparison Matrix

| Property | Cloud Firestore Managed Export / Import | Cloud Firestore Continuous Backups (PITR) |
| :--- | :--- | :--- |
| **Primary Use Case** | Bulk disaster recovery, offline compliance archival, analytics export to BigQuery | Point-in-time recovery from accidental data corruption, migration failures, or software bugs |
| **Granularity** | Coarse (only at the exact scheduled export execution time) | Continuous (minute-by-minute recovery to any timestamp within 7 days) |
| **Recovery Target** | Overwrites or inserts documents in the existing database | Restores to a **brand-new database** (or isolated staging database) |
| **Orphan Handling** | **Does NOT delete new documents!** If documents were added between export and import, they remain in the database unless explicitly wiped. | Clean recovery of the exact historical database state at target timestamp. |
| **Trigger Command** | `gcloud firestore export gs://[BUCKET]/[PATH]` | `gcloud firestore databases restore --source-database=... --restore-time=...` |

### 3.2 Scheduled Export Procedure
```bash
# Weekly / daily snapshot export to Cloud Storage
gcloud firestore export gs://tabakpp-staging-backups/exports/$(date +%Y%m%d_%H%M%S) \
  --project=tabakpp-staging \
  --collection-ids=users,configs,days,logs,dailyFinancials,meta
```

### 3.3 Continuous Backup (PITR) Restore Procedure
To restore staging from a timestamp immediately preceding an erroneous migration:
```bash
# 1. Inspect existing backup schedules and retention
gcloud firestore backups schedules list --database='(default)' --project=tabakpp-staging

# 2. Restore to a new isolated recovery database at the exact minute before migration
gcloud firestore databases restore \
  --source-database='(default)' \
  --destination-database='tabakpp-staging-restored' \
  --restore-time='2026-10-15T02:00:00Z' \
  --project=tabakpp-staging
```

---

## 4. Disaster Recovery & Interruption Procedures

### 4.1 Fatal Anti-Pattern: The "Security-Rules Revert" Fallacy

> [!CAUTION]
> **NEVER ATTEMPT TO ROLL BACK A FINANCIAL MIGRATION BY REVERTING FIRESTORE SECURITY RULES.**
>
> Reverting `firestore.rules` from Option-B rules back to Legacy rules does **NOT** undo database mutations:
> 1. `users/{uid}.lifetimeAggregates` has already had net replacement deltas applied.
> 2. `users/{uid}/dailyFinancials/{date}` documents have already been written.
> 3. `users/{uid}.financialMode` would remain `'OPTION_B'` or `'MIGRATING'`.
>
> If security rules are reverted, legacy client software will read mutated aggregates and write legacy stamps, resulting in double-crediting, permanent monetary skew, and completely unresolvable phantom money.

### 4.2 Handling Interrupted Migrations (Automatic Resumption)

If a migration process terminates unexpectedly (e.g., Cloud Functions timeout, network disruption during multi-date loop):

1. The account is left in `financialMode: 'MIGRATING'`.
2. Client writes remain safely locked out by `firestore.rules` (`match /users/{userId} { ... !isMigrating(userId) }`).
3. Each migrated date was committed inside its own atomic Firestore transaction alongside its specific `p.delta` update and marked with `migratedFromLegacy: true`.
4. **Tested Recovery Step**: Re-run the migration CLI for the user:
   ```bash
   node scripts/migrate-staging.mjs --project demo-takabpp-test --target-uid <UID> --live --yes
   ```
   The server skips all dates already marked `migratedFromLegacy: true`, applies the remaining pending dates, and cleanly transitions `financialMode` from `MIGRATING` to `OPTION_B`.

### 4.3 Full Rollback to Legacy (Compensating Reversal)

If an operator determines that an account was migrated erroneously or against corrupted source logs, perform the following tested compensating procedure:

1. **Lock Account**: Set `financialMode: 'MIGRATING'` to immediately freeze all client transactions:
   ```bash
   gcloud firestore documents update "projects/tabakpp-staging/databases/(default)/documents/users/<UID>" \
     --update-fields="financialMode=MIGRATING"
   ```
2. **Restore Document State via PITR or Compensating Reversal**:
   - Query all `dailyFinancials` documents where `migratedFromLegacy == true`.
   - In an atomic batch or transaction:
     - Subtract each date's `deltaSaved`, `deltaWasted`, `deltaBaselineSaved`, `deltaSmokingUnits` from `users/<UID>.lifetimeAggregates`.
     - Delete the corresponding `dailyFinancials/{date}` document.
     - Reset `users/<UID>.financialMode = 'LEGACY'`.
3. **Verify Integrity**: Run the dry-run CLI to verify that the account is restored to clean legacy state:
   ```bash
   node scripts/migrate-staging.mjs --project demo-takabpp-test --target-uid <UID> --dry-run
   ```
