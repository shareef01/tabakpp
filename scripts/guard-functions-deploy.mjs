#!/usr/bin/env node
/**
 * Functions predeploy guard (firebase.json → functions.predeploy).
 *
 * Production runs on Spark and the Option-B functions are deliberately not
 * deployed. firebase.json keeps the `functions` block so the emulators (CI and
 * local) can load them, which means a bare `firebase deploy` would also try to
 * ship them. Firebase runs every target's predeploy hook before uploading
 * anything, so failing here aborts the whole deploy before it touches any
 * target.
 *
 * Use `firebase deploy --only firestore:rules` / `--only hosting` for normal
 * deploys. Deploying functions (Blaze only) is an explicit opt-in:
 *   TABAKPP_DEPLOY_FUNCTIONS=1 firebase deploy --only functions
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
      + `To deploy functions deliberately (Blaze), set ${OPT_IN_ENV}=1 and use --only functions.`,
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
