#!/usr/bin/env node
/**
 * tabak++ Staging-Only Migration CLI
 *
 * Genuinely executable CLI for executing and validating account migrations
 * to Option-B trusted canonical financials.
 *
 * Usage:
 *   node scripts/migrate-staging.mjs --mode emulator --project demo-takabpp-test --target-uid <UID> [--dry-run]
 *   node scripts/migrate-staging.mjs --mode staging --project tabakpp-staging --target-uid <UID> [--dry-run]
 *   node scripts/migrate-staging.mjs --mode staging --project tabakpp-staging --target-uid <UID> --live [--yes]
 *
 * Options:
 *   --mode <emulator|staging> Explicit execution mode (default: emulator if emulator host detected, else required).
 *   --project <id>            REQUIRED. Approved staging project ID (demo-takabpp-test, tabakpp-staging).
 *   --target-uid <uid>        REQUIRED. The UID of the account to migrate.
 *   --dry-run                 Simulate migration and print four-metric reconciliation table (DEFAULT: true).
 *   --live                    Execute live migration against the staging project.
 *   --yes                     Skip confirmation prompt when running --live.
 *   --service-account <path>  Optional path to a service account JSON file.
 *   --operator-token <token>  Legitimate Firebase Auth ID token with operator claims.
 *   --web-api-key <key>       Firebase Web API Key for staging custom token exchange.
 *   --help                    Show this help message.
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
    mode: null,
    project: null,
    targetUid: null,
    dryRun: true,
    yes: false,
    serviceAccount: null,
    operatorToken: process.env.OPERATOR_ID_TOKEN || null,
    webApiKey: process.env.FIREBASE_WEB_API_KEY || null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--mode') {
      options.mode = args[++i]?.toLowerCase();
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
    } else if (arg === '--operator-token') {
      options.operatorToken = args[++i];
    } else if (arg === '--web-api-key') {
      options.webApiKey = args[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      options.help = true;
    }
  }
  return options;
};

// Strict explicit allowlist of authorized staging projects (no broad regex or prefixes)
const APPROVED_STAGING_PROJECTS = new Set([
  'demo-takabpp-test',
  'demo-tabakpp-test',
  'tabakpp-staging',
]);

const PROD_PROJECT_PATTERNS = [/prod/i, /tabakpp-app\b/i, /production/i, /tabakpp-web/i];

const isAllowedStagingProject = (projectId) => {
  if (!projectId || typeof projectId !== 'string') return false;
  for (const pat of PROD_PROJECT_PATTERNS) {
    if (pat.test(projectId)) return false;
  }
  return APPROVED_STAGING_PROJECTS.has(projectId);
};

const printUsage = () => {
  console.log(`
tabak++ Staging-Only Migration CLI

Usage:
  node scripts/migrate-staging.mjs --mode <emulator|staging> --project <STAGING_PROJECT> --target-uid <UID> [options]

Options:
  --mode <emulator|staging> Explicit execution mode:
                              emulator: local Firebase Emulator suite
                              staging:  real Firebase staging project (tabakpp-staging)
  --project <id>            REQUIRED. Explicit approved staging project ID (${[...APPROVED_STAGING_PROJECTS].join(', ')}).
  --target-uid <uid>        REQUIRED. The target user UID to migrate.
  --dry-run                 Validate migration & print reconciliation table (default: true).
  --live                    Perform live migration against staging environment.
  --yes                     Bypass interactive confirmation prompt on --live.
  --service-account <file>  Path to service account JSON credentials.
  --operator-token <token>  Verified Firebase Auth ID token with operator claims.
  --web-api-key <key>       Firebase Web API Key for custom-to-ID token exchange in staging.
  --help                    Display this help text.
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

  // Explicit staging project allowlist and production pattern defense
  if (!isAllowedStagingProject(opts.project)) {
    console.error(`❌ CRITICAL SECURITY ERROR: "${opts.project}" is not an authorized staging project.`);
    console.error(`Allowed staging projects: ${[...APPROVED_STAGING_PROJECTS].join(', ')}.`);
    process.exit(1);
  }

  // Resolve explicit execution mode
  const mode = opts.mode || (process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : null);
  if (!mode || (mode !== 'emulator' && mode !== 'staging')) {
    console.error(`❌ ERROR: Missing or invalid execution mode: "${opts.mode}". Specify --mode emulator or --mode staging.`);
    printUsage();
    process.exit(1);
  }

  if (!opts.targetUid || typeof opts.targetUid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(opts.targetUid)) {
    console.error(`❌ ERROR: Invalid or missing target UID: "${opts.targetUid}". Must be an alphanumeric ID without path separators.`);
    printUsage();
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`tabak++ Staging Migration CLI`);
  console.log(`Mode:           ${mode.toUpperCase()}`);
  console.log(`Target Project: ${opts.project}`);
  console.log(`Target UID:     ${opts.targetUid}`);
  console.log(`Action:         ${opts.dryRun ? 'DRY-RUN (Simulation only)' : 'LIVE EXECUTION'}`);
  console.log(`========================================\n`);

  if (!opts.dryRun && !opts.yes) {
    const proceed = await confirm(`⚠️ Are you sure you want to execute a LIVE migration on ${mode.toUpperCase()} project "${opts.project}" for UID "${opts.targetUid}"?`);
    if (!proceed) {
      console.log('Operation cancelled by operator.');
      process.exit(0);
    }
  }

  // Initialize Firebase Admin with credential-project identity verification
  const adminConfig = { projectId: opts.project };
  if (opts.serviceAccount) {
    if (!existsSync(opts.serviceAccount)) {
      console.error(`❌ Service account file not found: ${opts.serviceAccount}`);
      process.exit(1);
    }
    const sa = JSON.parse(readFileSync(opts.serviceAccount, 'utf8'));
    if (sa.project_id && sa.project_id !== opts.project) {
      console.error(`❌ CRITICAL CREDENTIAL MISMATCH: Service account credentials are for project "${sa.project_id}", but target project is "${opts.project}". Aborting.`);
      process.exit(1);
    }
    adminConfig.credential = fbAdmin.credential.cert(sa);
  } else if (mode === 'staging') {
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

  // Resolve target endpoint & authenticate legitimate operator
  let url;
  let adminToken;

  if (mode === 'emulator') {
    const emulatorHost = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    url = `http://${emulatorHost}/${opts.project}/europe-west1/migrateAccount`;

    try {
      const customToken = await auth.createCustomToken('staging-migration-operator', { admin: true });
      const tokRes = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      });
      if (tokRes.ok) {
        const tokData = await tokRes.json();
        adminToken = tokData.idToken;
      } else {
        throw new Error(`Emulator token exchange returned HTTP ${tokRes.status}`);
      }
    } catch (err) {
      console.error('❌ Failed to acquire operator ID token from Auth emulator:', err.message);
      process.exit(1);
    }
  } else {
    // Mode === 'staging'
    url = `https://europe-west1-${opts.project}.cloudfunctions.net/migrateAccount`;

    if (opts.operatorToken) {
      adminToken = opts.operatorToken;
    } else if (opts.webApiKey) {
      try {
        const customToken = await auth.createCustomToken('staging-migration-operator', { admin: true });
        const tokRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${opts.webApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        });
        if (tokRes.ok) {
          const tokData = await tokRes.json();
          adminToken = tokData.idToken;
        } else {
          const errData = await tokRes.json().catch(() => ({}));
          throw new Error(`Identity Toolkit token exchange failed: ${JSON.stringify(errData)}`);
        }
      } catch (err) {
        console.error('❌ Failed to exchange operator custom token for ID token:', err.message);
        process.exit(1);
      }
    } else {
      console.error('❌ ERROR: Staging migration requires verified operator credentials.');
      console.error('Provide --operator-token <ID_TOKEN> or provide --web-api-key <KEY> with service account.');
      process.exit(1);
    }
  }

  if (!adminToken || typeof adminToken !== 'string') {
    console.error('❌ CRITICAL ERROR: Legitimate Firebase Authentication ID token was not obtained.');
    process.exit(1);
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
      console.log(`To execute live migration, run:\n  node scripts/migrate-staging.mjs --mode ${mode} --project ${opts.project} --target-uid ${opts.targetUid} --live`);
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
