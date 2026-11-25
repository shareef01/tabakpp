#!/usr/bin/env node
/**
 * Functions predeploy guard (firebase.functions.json → functions.predeploy).
 *
 * Production runs on Spark and the Option-B functions are deliberately not
 * deployed. The production firebase.json has no `functions` block at all; the
 * experimental firebase.functions.json carries it so the emulators (CI and
 * local) can load the functions. That config is the only one that could ship
 * them, so it keeps this guard as a second barrier. Firebase runs every
 * target's predeploy hook before uploading anything, so failing here aborts
 * the whole deploy before it touches any target.
 *
 * Use `firebase deploy --only firestore:rules` / `--only hosting` (default
 * firebase.json) for normal deploys. Deploying functions (Blaze only) is an
 * explicit opt-in:
 *   TABAKPP_DEPLOY_FUNCTIONS=1 firebase deploy --config firebase.functions.json --only functions
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPT_IN_ENV = 'TABAKPP_DEPLOY_FUNCTIONS';

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkFunctionsDeploy(env) {
  if (env[OPT_IN_ENV] === '1') return { ok: true };
  return {
    ok: false,
    reason: 'Cloud Functions are not deployed on the Spark plan (Option B is parked). '
      + 'This deploy includes functions, so it was stopped before anything was uploaded. '
      + 'Use `firebase deploy --only firestore:rules` or `--only hosting`. '
      + `To deploy functions deliberately (Blaze), set ${OPT_IN_ENV}=1 and use --config firebase.functions.json --only functions.`,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = checkFunctionsDeploy(process.env);
  if (!result.ok) {
    console.error(`\n✖ Functions deploy blocked: ${result.reason}\n`);
    process.exit(1);
  }
  console.log(`✔ ${OPT_IN_ENV}=1 set: functions deploy explicitly allowed.`);
}
