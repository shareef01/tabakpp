#!/usr/bin/env node
/**
 * tabak++ Staging-Only Migration CLI
 *
 * Genuinely executable CLI for executing and validating account migrations
 * to Option-B trusted canonical financials.
 *
 * Usage:
 *   node scripts/migrate-staging.mjs --project <CONFIRMED_STAGING_PROJECT> --target-uid <UID> [--dry-run]
 *   node scripts/migrate-staging.mjs --project <CONFIRMED_STAGING_PROJECT> --target-uid <UID> --live [--yes]
 *
 * Options:
 *   --project <id>       REQUIRED. Staging Firebase project ID (e.g. demo-takabpp-test, tabakpp-staging).
 *                        Production project IDs are strictly rejected.
 *   --target-uid <uid>   REQUIRED. The UID of the account to migrate.
 *   --dry-run            Simulate migration and print four-metric reconciliation table (DEFAULT: true).
 *   --live               Execute live migration against the staging project.
 *   --yes                Skip confirmation prompt when running --live.
 *   --service-account <path> Optional path to a service account JSON file.
 *   --help               Show this help message.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

let fbAdmin;
try {
  fbAdmin = (await import('firebase-admin')).default;
} catch {
  fbAdmin = (await import('../functions/node_modules/firebase-admin/lib/index.js')).default;
}

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    project: null,
    targetUid: null,
    dryRun: true,
    yes: false,
    serviceAccount: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--project') {
      options.project = args[++i];
    } else if (arg === '--target-uid') {
      options.targetUid = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--live' || arg === '--no-dry-run') {
      options.dryRun = false;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--service-account') {
      options.serviceAccount = args[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      options.help = true;
    }
  }
  return options;
};

const PROD_PROJECT_PATTERNS = [/prod/i, /tabakpp-app\b/i, /production/i];

const printUsage = () => {
  console.log(`
tabak++ Staging-Only Migration CLI

Usage:
  node scripts/migrate-staging.mjs --project <STAGING_PROJECT> --target-uid <UID> [options]

Options:
  --project <id>       REQUIRED. Explicit staging project ID (e.g., demo-takabpp-test).
  --target-uid <uid>   REQUIRED. The target user UID to migrate.
  --dry-run            Validate migration & print reconciliation table (default: true).
  --live               Perform live migration against staging environment.
  --yes                Bypass interactive confirmation prompt on --live.
  --service-account    Path to service account JSON credentials.
  --help               Display this help text.
`);
};

const confirm = async (message) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
};

const formatCurrency = (amount) => {
  const n = Number(amount || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const parts = String(abs).split('e');
  const shifted = Number(parts[0] + 'e' + (parts[1] ? Number(parts[1]) + 2 : '2'));
  const cents = Math.round(shifted);
  return `${sign}${(Math.floor(cents / 100))},${String(cents % 100).padStart(2, '0')} €`;
};

const printReconciliationTable = (summary = []) => {
  if (summary.length === 0) {
    console.log('No historical dates found for user.');
    return;
  }
  console.log('\n--- Historical Four-Metric Reconciliation Table ---');
  console.log(
    'Date'.padEnd(12) +
    'Cat'.padEnd(6) +
    'Legacy (Sav/Wst/Base/Unit)'.padEnd(30) +
    'Canonical (Sav/Wst/Base/Unit)'.padEnd(32) +
    'Net Deltas (Sav/Wst/Base/Unit)'
  );
  console.log('='.repeat(110));

  summary.forEach((s) => {
    const legacyStr = `${formatCurrency(s.legacySaved)} / ${formatCurrency(s.legacyWasted)} / ${formatCurrency(s.legacyBaselineSaved)} / ${s.legacySmokingUnits}`;
    const canonStr = `${formatCurrency(s.canonicalSaved)} / ${formatCurrency(s.canonicalWasted)} / ${formatCurrency(s.canonicalBaselineSaved)} / ${s.canonicalSmokingUnits}`;
    const deltaStr = `${formatCurrency(s.deltaSaved)} / ${formatCurrency(s.deltaWasted)} / ${formatCurrency(s.deltaBaselineSaved)} / ${s.deltaSmokingUnits}`;
    console.log(
      s.date.padEnd(12) +
      s.category.padEnd(6) +
      legacyStr.padEnd(30) +
      canonStr.padEnd(32) +
      deltaStr
    );
  });
  console.log('='.repeat(110));
  console.log('Category Meanings:');
  console.log('  [A] Reconstructible discrepancy (delta will be folded into lifetime aggregates)');
  console.log('  [B] Ambiguous historical stamps (needs human operator interpretation)');
  console.log('  [C] Non-reconstructible historical stamps (missing config, preserved without fabrication)');
  console.log('  [D] Already correct (canonical ledger materialized with foldedIntoLifetime: true)');
  console.log('');
};

async function main() {
  const opts = parseArgs();
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  if (!opts.project) {
    console.error('❌ ERROR: Missing required option: --project <STAGING_PROJECT>');
    printUsage();
    process.exit(1);
  }

  // Staging project sanity check
  for (const pat of PROD_PROJECT_PATTERNS) {
    if (pat.test(opts.project)) {
      console.error(`❌ CRITICAL SECURITY ERROR: "${opts.project}" matches a production pattern.`);
      console.error('This migration CLI is strictly STAGING-ONLY. Aborting immediately.');
      process.exit(1);
    }
  }

  if (!opts.targetUid) {
    console.error('❌ ERROR: Missing required option: --target-uid <UID>');
    printUsage();
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`tabak++ Staging Migration CLI`);
  console.log(`Target Project: ${opts.project}`);
  console.log(`Target UID:     ${opts.targetUid}`);
  console.log(`Mode:           ${opts.dryRun ? 'DRY-RUN (Simulation only)' : 'LIVE EXECUTION'}`);
  console.log(`========================================\n`);

  if (!opts.dryRun && !opts.yes) {
    const proceed = await confirm(`⚠️ Are you sure you want to execute a LIVE migration on staging project "${opts.project}" for UID "${opts.targetUid}"?`);
    if (!proceed) {
      console.log('Operation cancelled by operator.');
      process.exit(0);
    }
  }

  // Initialize Firebase Admin
  const adminConfig = { projectId: opts.project };
  if (opts.serviceAccount) {
    if (!existsSync(opts.serviceAccount)) {
      console.error(`❌ Service account file not found: ${opts.serviceAccount}`);
      process.exit(1);
    }
    const sa = JSON.parse(readFileSync(opts.serviceAccount, 'utf8'));
    adminConfig.credential = fbAdmin.credential.cert(sa);
  } else if (!process.env.FIRESTORE_EMULATOR_HOST) {
    adminConfig.credential = fbAdmin.credential.applicationDefault();
  }

  if (!fbAdmin.apps.length) {
    fbAdmin.initializeApp(adminConfig);
  }

  const db = fbAdmin.firestore();
  const auth = fbAdmin.auth();

  // Verify target user exists
  console.log(`Verifying target user: ${opts.targetUid}...`);
  const userDocRef = db.collection('users').doc(opts.targetUid);
  const userSnap = await userDocRef.get();
  if (!userSnap.exists) {
    console.error(`❌ Target user "${opts.targetUid}" not found in Firestore.`);
    process.exit(1);
  }

  const currentMode = userSnap.get('financialMode') || 'LEGACY';
  console.log(`Current financialMode: ${currentMode}`);
  if (currentMode === 'OPTION_B') {
    console.log(`Account is already migrated to OPTION_B. No migration required.`);
    process.exit(0);
  }

  // Obtain an admin operator token or call internal migration logic
  // If running against emulator or functions HTTP:
  const emulatorHost = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
  const url = `http://${emulatorHost}/${opts.project}/europe-west1/migrateAccount`;

  let adminToken;
  try {
    // Generate custom token for an operator identity and swap for ID token, or use admin auth
    const customToken = await auth.createCustomToken('staging-migration-operator', { admin: true });
    // In emulator, exchange custom token for idToken
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    const tokRes = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (tokRes.ok) {
      const tokData = await tokRes.json();
      adminToken = tokData.idToken;
    }
  } catch {
    // Non-emulator fallback if using ADC
    adminToken = 'admin-service-account';
  }

  console.log(`Invoking migrateAccount callable (dryRun: ${opts.dryRun})...`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      data: {
        targetUid: opts.targetUid,
        dryRun: opts.dryRun,
      },
    }),
  });

  const resBody = await response.json();
  if (!response.ok || resBody.error) {
    console.error(`❌ Migration callable failed:`, resBody.error || resBody);
    process.exit(1);
  }

  const result = resBody.result;
  console.log(`\nCallable executed successfully.`);
  console.log(`Result: ${JSON.stringify({ dryRun: result.dryRun, currentMode: result.currentMode, canCutOver: result.canCutOver, migrated: result.migrated })}`);

  if (result.summary) {
    printReconciliationTable(result.summary);
  }

  if (result.unresolved && result.unresolved.length > 0) {
    console.warn(`⚠️ Warning: Found ${result.unresolved.length} unresolved date(s):`);
    result.unresolved.forEach((u) => {
      console.warn(`  - ${u.date} [Category ${u.category}]`);
    });
    console.warn(`These dates require operator investigation before full cutover.`);
  }

  if (opts.dryRun) {
    if (result.canCutOver) {
      console.log('✅ DRY RUN PASSED: Account is 100% clean and ready for live migration.');
      console.log(`To execute live migration, run:\n  node scripts/migrate-staging.mjs --project ${opts.project} --target-uid ${opts.targetUid} --live`);
    } else {
      console.log('⚠️ DRY RUN COMPLETED: Account has unresolved dates. Cannot cut over automatically.');
    }
  } else {
    console.log(`✅ LIVE MIGRATION COMPLETE: Migrated ${result.migrated || 0} date(s). Account status is now: ${result.currentMode}`);
  }
}

main().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
