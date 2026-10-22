#!/usr/bin/env node
/**
 * Staging Firestore Rules predeploy guard:
 * Validates that direct or wrapped Firebase CLI deployments targeting
 * firebase.staging.firestore.json strictly deploy to the verified staging project.
 *
 * Firebase CLI sets GCLOUD_PROJECT during lifecycle hooks.
 * This guard ensures:
 * 1. GCLOUD_PROJECT is present and verifiable.
 * 2. GCLOUD_PROJECT is NOT production (tabakpp-ff036).
 * 3. GCLOUD_PROJECT matches the expected staging project (tabakpp-staging).
 * 4. firestore.rules exists and is valid.
 *
 * Usage:
 *   node webApp/scripts/check-rules-project.mjs [--expected-project id] [--forbid-project id]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_PROJECT_ID, STAGING_PROJECT_ID } from './check-dist-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');

/**
 * @param {{
 *   actualProject?: string|null,
 *   expectedProject?: string|null,
 *   forbidProjectId?: string|null,
 *   rulesPath?: string|null,
 *   env?: Record<string, string|undefined>|null,
 * }} [options]
 * @returns {{ ok: boolean, reason?: string, project?: string }}
 */
export function checkRulesProject(options = {}) {
  const env = options.env !== undefined ? options.env : process.env;
  const actualProject = options.actualProject !== undefined
    ? options.actualProject
    : (env?.GCLOUD_PROJECT || env?.PROJECT_ID || null);

  const expectedProject = options.expectedProject || STAGING_PROJECT_ID;
  const forbidProjectId = options.forbidProjectId !== undefined
    ? options.forbidProjectId
    : PROD_PROJECT_ID;

  if (!actualProject) {
    return {
      ok: false,
      reason: 'Actual deployment project is missing or cannot be verified (GCLOUD_PROJECT is not set). Specify --project when deploying.',
    };
  }

  if (actualProject === forbidProjectId) {
    return {
      ok: false,
      reason: `Actual deployment project "${actualProject}" is forbidden for staging Firestore Rules (production project detected).`,
    };
  }

  if (actualProject !== expectedProject) {
    return {
      ok: false,
      reason: `Deployment project mismatch: Expected staging project "${expectedProject}", but actual CLI project is "${actualProject}".`,
    };
  }

  const rulesPath = options.rulesPath || join(REPO_ROOT, 'firestore.rules');
  if (!existsSync(rulesPath)) {
    return {
      ok: false,
      reason: `Firestore security rules file not found at ${rulesPath}.`,
    };
  }

  const rulesContent = readFileSync(rulesPath, 'utf8');
  if (!rulesContent.trim()) {
    return {
      ok: false,
      reason: `Firestore security rules file at ${rulesPath} is empty.`,
    };
  }

  return { ok: true, project: actualProject };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = process.argv.slice(2);
  const getFlag = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const expectedProject = getFlag('--expected-project') || STAGING_PROJECT_ID;
  const forbidProjectId = getFlag('--forbid-project') || PROD_PROJECT_ID;
  const actualProject = getFlag('--actual-project') || (process.env.GCLOUD_PROJECT || null);

  const result = checkRulesProject({
    expectedProject,
    forbidProjectId,
    actualProject,
  });

  if (!result.ok) {
    console.error(`\n✖ Staging Firestore Rules deploy blocked: ${result.reason}\n`);
    process.exit(1);
  }
  console.log(`✔ Validated staging Firestore Rules deployment for project "${result.project}".`);
}
