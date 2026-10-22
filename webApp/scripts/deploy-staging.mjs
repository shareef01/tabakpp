#!/usr/bin/env node
/**
 * TABAK++ — Guarded Staging Deployment Entrypoint
 *
 * Provides dedicated, isolated deployment operations for:
 * 1. Hosting: `node deploy-staging.mjs hosting --project tabakpp-staging`
 * 2. Firestore Rules: `node deploy-staging.mjs firestore:rules --project tabakpp-staging`
 *
 * Pre-flight safeguards:
 * - Requires explicit --project argument matching the expected staging project.
 * - Rejects missing project arguments with NO fallback to default (production) project.
 * - Rejects any argument or environment variable referencing production (tabakpp-ff036).
 * - Enforces hosting target mapping in .firebaserc and verifies target does not map to production.
 * - Verifies dist build artifacts via checkDistConfig (no leaked prod vars, valid API key).
 * - Verifies firestore.rules file existence for rules deployments.
 * - Uses dedicated single-purpose configs (firebase.staging.json for hosting, firebase.staging.firestore.json for rules).
 *
 * Limitation Notice:
 * These safeguards protect the approved deployment paths. Operators who bypass these scripts
 * and directly execute raw Firebase CLI commands outside approved scripts bypass these entrypoint
 * checks (although Hosting target resolution and configuration isolation still fail-closed).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkDistConfig, PROD_PROJECT_ID, PROD_SITE_ID, STAGING_PROJECT_ID, STAGING_TARGET_NAME } from './check-dist-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');

/**
 * Validates a staging deployment request.
 * Pure validation logic separated for rigorous unit testing.
 *
 * @param {'hosting'|'firestore:rules'|'rules'|'firestore'} operation
 * @param {{
 *   project?: string|null,
 *   target?: string|null,
 *   distDir?: string|null,
 *   firebasercPath?: string|null,
 *   firebaserc?: object|null,
 *   stagingConfigPath?: string|null,
 *   rulesConfigPath?: string|null,
 *   rulesFilePath?: string|null,
 *   env?: Record<string, string|undefined>|null,
 * }} options
 * @returns {{ ok: boolean, reason?: string, command?: string[], normalizedOp?: string }}
 */
export function validateStagingDeployment(operation, options = {}) {
  const normOp = operation === 'rules' || operation === 'firestore' ? 'firestore:rules' : operation;
  if (normOp !== 'hosting' && normOp !== 'firestore:rules') {
    return {
      ok: false,
      reason: `Invalid deployment operation "${operation}". Allowed operations: "hosting", "firestore:rules".`,
    };
  }

  const env = options.env !== undefined ? options.env : process.env;
  const project = options.project || null;

  // 1. Project argument validation
  if (!project) {
    return {
      ok: false,
      reason: 'Omitted project argument: staging deployment requires an explicit --project tabakpp-staging argument and does not fall back to default project.',
    };
  }

  if (project === PROD_PROJECT_ID) {
    return {
      ok: false,
      reason: `Forbidden deployment project: Production project "${project}" is strictly rejected for staging operations.`,
    };
  }

  if (project !== STAGING_PROJECT_ID) {
    return {
      ok: false,
      reason: `Project mismatch: Expected staging project "${STAGING_PROJECT_ID}", but received "${project}".`,
    };
  }

  // 1b. Project provisioning validation
  if (options.availableProjects && Array.isArray(options.availableProjects)) {
    if (!options.availableProjects.includes(STAGING_PROJECT_ID)) {
      return {
        ok: false,
        reason: `Staging project "${STAGING_PROJECT_ID}" has not been provisioned in the authenticated Firebase account. Cloud deployment is BLOCKED.`,
      };
    }
  }

  // 2. Environment variable validation (GCLOUD_PROJECT / PROJECT_ID)
  const envProject = env?.GCLOUD_PROJECT || env?.PROJECT_ID || null;
  if (envProject) {
    if (envProject === PROD_PROJECT_ID) {
      return {
        ok: false,
        reason: `Conflicting environment variable: GCLOUD_PROJECT is set to production "${envProject}". Staging deployment aborted.`,
      };
    }
    if (envProject !== STAGING_PROJECT_ID) {
      return {
        ok: false,
        reason: `Conflicting environment variable: GCLOUD_PROJECT is set to "${envProject}", expected "${STAGING_PROJECT_ID}".`,
      };
    }
  }

  // 3. Operation-specific validation
  if (normOp === 'hosting') {
    const target = options.target || STAGING_TARGET_NAME;
    const stagingConfigPath = options.stagingConfigPath || join(REPO_ROOT, 'firebase.staging.json');
    if (!existsSync(stagingConfigPath)) {
      return {
        ok: false,
        reason: `Missing staging configuration file at ${stagingConfigPath}.`,
      };
    }

    let stagingConfig;
    try {
      stagingConfig = JSON.parse(readFileSync(stagingConfigPath, 'utf8'));
    } catch (e) {
      return {
        ok: false,
        reason: `Failed to parse ${stagingConfigPath}: ${e.message}`,
      };
    }

    // Ensure firebase.staging.json is Hosting-only
    if (stagingConfig.firestore) {
      return {
        ok: false,
        reason: 'firebase.staging.json contains firestore configuration. Staging hosting config must be Hosting-only.',
      };
    }

    // Verify target in .firebaserc
    let firebaserc = options.firebaserc || null;
    if (!firebaserc) {
      const rcPath = options.firebasercPath || join(REPO_ROOT, '.firebaserc');
      if (existsSync(rcPath)) {
        try {
          firebaserc = JSON.parse(readFileSync(rcPath, 'utf8'));
        } catch (e) {
          return {
            ok: false,
            reason: `Failed to parse .firebaserc at ${rcPath}: ${e.message}`,
          };
        }
      }
    }

    if (!firebaserc?.targets?.[STAGING_PROJECT_ID]?.hosting?.[target]) {
      return {
        ok: false,
        reason: `Hosting target "${target}" is not defined for project "${STAGING_PROJECT_ID}" in .firebaserc.`,
      };
    }

    const mappedSites = firebaserc.targets[STAGING_PROJECT_ID].hosting[target];
    if (!Array.isArray(mappedSites) || mappedSites.length === 0) {
      return {
        ok: false,
        reason: `Hosting target "${target}" has no mapped sites in .firebaserc.`,
      };
    }

    if (mappedSites.includes(PROD_SITE_ID) || mappedSites.includes(PROD_PROJECT_ID)) {
      return {
        ok: false,
        reason: `Hosting target "${target}" in .firebaserc maps to production site "${PROD_SITE_ID}". Staging target must not map to production.`,
      };
    }

    // Verify build artifacts using checkDistConfig
    const distDir = options.distDir || join(REPO_ROOT, 'webApp/dist');
    const distCheck = checkDistConfig(distDir, {
      expectedProject: STAGING_PROJECT_ID,
      actualProject: STAGING_PROJECT_ID,
      target,
      firebaserc,
      forbidProjectId: PROD_PROJECT_ID,
      disallowPlaceholders: options.allowPlaceholders !== true,
    });

    if (!distCheck.ok) {
      return {
        ok: false,
        reason: `Staging build verification failed: ${distCheck.reason}`,
      };
    }

    return {
      ok: true,
      normalizedOp: normOp,
      command: [
        'firebase',
        'deploy',
        '--config',
        'firebase.staging.json',
        '--only',
        `hosting:${target}`,
        '--project',
        STAGING_PROJECT_ID,
      ],
    };
  }

  if (normOp === 'firestore:rules') {
    const rulesConfigPath = options.rulesConfigPath || join(REPO_ROOT, 'firebase.staging.firestore.json');
    if (!existsSync(rulesConfigPath)) {
      return {
        ok: false,
        reason: `Missing staging firestore configuration file at ${rulesConfigPath}.`,
      };
    }

    let rulesConfig;
    try {
      rulesConfig = JSON.parse(readFileSync(rulesConfigPath, 'utf8'));
    } catch (e) {
      return {
        ok: false,
        reason: `Failed to parse ${rulesConfigPath}: ${e.message}`,
      };
    }

    if (rulesConfig.hosting) {
      return {
        ok: false,
        reason: 'firebase.staging.firestore.json contains hosting configuration. Rules config must be Firestore-only.',
      };
    }

    const rulesFilePath = options.rulesFilePath || join(REPO_ROOT, rulesConfig.firestore?.rules || 'firestore.rules');
    if (!existsSync(rulesFilePath)) {
      return {
        ok: false,
        reason: `Security rules file does not exist at ${rulesFilePath}.`,
      };
    }

    return {
      ok: true,
      normalizedOp: normOp,
      command: [
        'firebase',
        'deploy',
        '--config',
        'firebase.staging.firestore.json',
        '--only',
        'firestore:rules',
        '--project',
        STAGING_PROJECT_ID,
      ],
    };
  }

  return { ok: false, reason: 'Unhandled operation.' };
}

/**
 * Runs a staging deployment with pre-flight safety validation.
 *
 * @param {'hosting'|'firestore:rules'|'rules'|'firestore'} operation
 * @param {{
 *   project?: string|null,
 *   target?: string|null,
 *   dryRun?: boolean,
 *   executor?: (cmd: string[], opts: object) => { status: number, stdout?: string, stderr?: string },
 *   [key: string]: any,
 * }} options
 * @returns {{ ok: boolean, reason?: string, executed?: boolean, exitCode?: number, command?: string[] }}
 */
export function deployStaging(operation, options = {}) {
  const validation = validateStagingDeployment(operation, options);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  if (options.dryRun) {
    return {
      ok: true,
      executed: false,
      command: validation.command,
      reason: 'Dry run: pre-flight checks passed; command not executed.',
    };
  }

  const executor = options.executor || ((cmd, spawnOpts) => spawnSync(cmd[0], cmd.slice(1), spawnOpts));
  const spawnOpts = {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      GCLOUD_PROJECT: STAGING_PROJECT_ID,
    },
  };

  const result = executor(validation.command, spawnOpts);
  const exitCode = result.status ?? 0;
  return {
    ok: exitCode === 0,
    executed: true,
    exitCode,
    command: validation.command,
    reason: exitCode === 0 ? 'Deployment succeeded.' : `Deployment failed with exit code ${exitCode}.`,
  };
}

/**
 * Retrieves the list of active Firebase project IDs from the Firebase CLI.
 * Returns null if CLI query fails or times out.
 *
 * @returns {string[]|null}
 */
export function getFirebaseProjects() {
  try {
    const proc = spawnSync('firebase', ['projects:list', '--json'], {
      encoding: 'utf8',
      timeout: 15000,
      shell: process.platform === 'win32',
    });
    if (proc.status === 0 && proc.stdout) {
      const parsed = JSON.parse(proc.stdout);
      if (Array.isArray(parsed.result)) {
        return parsed.result.map((p) => p.projectId);
      }
    }
  } catch {
    // CLI query failed or timed out
  }
  return null;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = process.argv.slice(2);
  const operation = args[0];
  const getFlag = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  const hasFlag = (flag) => args.includes(flag);

  const project = getFlag('--project');
  const target = getFlag('--target');
  const dryRun = hasFlag('--dry-run');
  const allowPlaceholders = hasFlag('--allow-placeholders');
  const skipProjectCheck = hasFlag('--skip-project-check');

  if (!operation) {
    console.error('\n✖ Usage: node webApp/scripts/deploy-staging.mjs <hosting|firestore:rules> --project tabakpp-staging [--dry-run]\n');
    process.exit(1);
  }

  console.log(`\n🔍 Verifying staging deployment prerequisites for [${operation}]...`);

  // Query authenticated projects from Firebase CLI if not skipped
  const availableProjects = skipProjectCheck ? null : getFirebaseProjects();

  const result = deployStaging(operation, {
    project,
    target,
    dryRun,
    allowPlaceholders,
    availableProjects,
  });

  if (!result.ok) {
    console.error(`\n✖ Deployment rejected: ${result.reason}\n`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n✔ Dry run successful: Validated command: ${result.command.join(' ')}\n`);
  } else {
    console.log(`\n✔ Deployment completed successfully.\n`);
  }
}
