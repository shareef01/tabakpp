#!/usr/bin/env node
/**
 * Hosting predeploy guard: refuse to deploy a web build that has no Firebase
 * config baked in.
 *
 * Vite inlines VITE_FIREBASE_* at build time. A build made without
 * webApp/.env.local (for example in a git worktree, where the gitignored file
 * is absent) still succeeds but renders only "CONFIG MISSING". That build was
 * deployed once and took tabakpp.web.app down, so `firebase deploy` now runs
 * this first (firebase.json → hosting.predeploy).
 *
 * Passes when some JS chunk in dist/assets contains a Firebase web API key and,
 * when the deploy target is known (GCLOUD_PROJECT, set by the Firebase CLI for
 * predeploy hooks, or --project), that project id. Builds made for CI or
 * screenshots never reach this: only `firebase deploy` runs it.
 *
 * Usage: node webApp/scripts/check-dist-config.mjs [distDir] [--project id]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_KEY = /AIza[0-9A-Za-z_-]{35}/;

/**
 * @param {string} distDir
 * @param {string|null} [projectId]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkDistConfig(distDir, projectId = null) {
  if (!existsSync(join(distDir, 'index.html'))) {
    return { ok: false, reason: `No build found at ${distDir}. Run \`npm run build\` in webApp/ first.` };
  }
  const assetsDir = join(distDir, 'assets');
  const chunks = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assetsDir, f), 'utf8'))
    : [];
  const withKey = chunks.filter((c) => API_KEY.test(c));
  if (withKey.length === 0) {
    return {
      ok: false,
      reason: 'The build has no Firebase config (no VITE_FIREBASE_API_KEY was inlined). '
        + 'Build from a checkout that has webApp/.env.local, not from a worktree, then deploy again.',
    };
  }
  if (projectId && !withKey.some((c) => c.includes(projectId))) {
    return {
      ok: false,
      reason: `The build's Firebase config is not for project "${projectId}". `
        + 'Check VITE_FIREBASE_PROJECT_ID in webApp/.env.local and rebuild.',
    };
  }
  return { ok: true };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const projectFlag = args.indexOf('--project');
  const projectId = projectFlag >= 0 ? args[projectFlag + 1] : (process.env.GCLOUD_PROJECT || null);
  const positional = args.filter((a, i) => !a.startsWith('--') && (projectFlag < 0 || i !== projectFlag + 1));
  const distDir = resolve(positional[0] || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));

  const result = checkDistConfig(distDir, projectId);
  if (!result.ok) {
    console.error(`\n✖ Hosting deploy blocked: ${result.reason}\n`);
    process.exit(1);
  }
  console.log(`✔ Web build has Firebase config${projectId ? ` for ${projectId}` : ''}.`);
}
