#!/usr/bin/env node
/**
 * Hosting predeploy guard: refuse to deploy a web build that has missing,
 * incorrect, or cross-contaminated Firebase configuration.
 *
 * Vite inlines VITE_FIREBASE_* at build time.
 * This guard ensures:
 * 1. A valid Firebase web API key is inlined in the dist chunks.
 * 2. When projectId is known (via CLI --project or GCLOUD_PROJECT), the config
 *    explicitly belongs to that target project.
 * 3. When expectedAuthDomain is provided, the inlined authDomain matches it.
 * 4. When forbidProjectId is set (or automatically inferred when targeting staging),
 *    the build contains NO references to the forbidden project (e.g. tabakpp-ff036).
 * 5. When forbidEndpoints is set, no forbidden endpoints (e.g. production Cloud Functions)
 *    are referenced.
 * 6. Validates actual deployment project identity (GCLOUD_PROJECT) against expected project.
 * 7. Validates that hosting target (e.g. staging-app) is explicitly mapped in .firebaserc
 *    to a non-production site.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_KEY = /AIza[0-9A-Za-z_-]{20,}/;
export const PLACEHOLDER_KEY_PATTERN = /(?:stagingKeyValidation|placeholder|dummy|mock|testKey|fakeKey|FROM_FIREBASE_CONSOLE|0000000000|abcdef1234567890|abcdef0123456789)/i;
// Firebase config fields whose literal values are inspected for placeholders. Only these values are
// scanned: bundles legitimately contain words like "placeholder" (input props) or "mock" (SDK internals).
export const CONFIG_VALUE_FIELDS = ['apiKey', 'appId'];

/**
 * Extracts the inlined string values of the given Firebase config fields from a bundle chunk,
 * e.g. apiKey:"AIza..." or appId:`1:123:web:abc`.
 *
 * @param {string} chunk
 * @param {string[]} [fields]
 * @returns {string[]}
 */
export function extractConfigValues(chunk, fields = CONFIG_VALUE_FIELDS) {
  const values = [];
  for (const field of fields) {
    const re = new RegExp(String.raw`["']?\b${field}["']?\s*:\s*(["'\x60])([^"'\x60]+)\1`, 'g');
    for (const m of chunk.matchAll(re)) values.push(m[2]);
  }
  return values;
}
export const PROD_PROJECT_ID = 'tabakpp-ff036';
export const PROD_SITE_ID = 'tabakpp';
export const PROD_FUNCTION_ENDPOINT = 'europe-west1-tabakpp-ff036.cloudfunctions.net';
export const STAGING_TARGET_NAME = 'staging-app';
export const STAGING_PROJECT_ID = 'tabakpp-staging';

/**
 * @param {string} distDir
 * @param {string|{
 *   projectId?: string|null,
 *   expectedProject?: string|null,
 *   actualProject?: string|null,
 *   requireActualProject?: boolean,
 *   expectedAuthDomain?: string|null,
 *   forbidProjectId?: string|null,
 *   forbidEndpoints?: string[]|null,
 *   disallowPlaceholders?: boolean,
 *   target?: string|null,
 *   requireTarget?: boolean,
 *   expectedTargetSite?: string|null,
 *   firebaserc?: object|null,
 *   firebasercPath?: string|null,
 * }|null} [options]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkDistConfig(distDir, options = null) {
  let opts = {};
  if (typeof options === 'string') {
    opts = { expectedProject: options, projectId: options };
  } else if (options && typeof options === 'object') {
    opts = { ...options };
  }

  const expectedProject = opts.expectedProject || opts.projectId || null;
  const actualProject = opts.actualProject !== undefined
    ? opts.actualProject
    : (process.env.GCLOUD_PROJECT || null);

  const isStaging = Boolean(
    (expectedProject && expectedProject.includes('staging')) ||
    (opts.target && opts.target.includes('staging'))
  );

  const disallowPlaceholders = Boolean(
    opts.disallowPlaceholders !== undefined
      ? opts.disallowPlaceholders
      : false
  );

  const requireActualProject = Boolean(
    opts.requireActualProject !== undefined
      ? opts.requireActualProject
      : isStaging
  );

  const forbidProjectId = opts.forbidProjectId !== undefined
    ? opts.forbidProjectId
    : (isStaging ? PROD_PROJECT_ID : null);

  const forbidEndpoints = opts.forbidEndpoints !== undefined
    ? opts.forbidEndpoints
    : (isStaging ? [PROD_FUNCTION_ENDPOINT] : []);

  // 1. Validate actual deployment project identity (GCLOUD_PROJECT)
  if (requireActualProject && !actualProject) {
    return {
      ok: false,
      reason: 'Actual deployment project is missing or cannot be verified (GCLOUD_PROJECT is not set). Specify --project when deploying.',
    };
  }

  if (actualProject && forbidProjectId && actualProject === forbidProjectId) {
    return {
      ok: false,
      reason: `Actual deployment project "${actualProject}" is forbidden for this deployment (production project detected).`,
    };
  }

  if (expectedProject && actualProject && expectedProject !== actualProject) {
    return {
      ok: false,
      reason: `Deployment project mismatch: expected "${expectedProject}", but actual CLI project is "${actualProject}".`,
    };
  }

  const effectiveProject = expectedProject || actualProject;

  // 2. Validate hosting target and target mapping in .firebaserc
  if (opts.requireTarget && !opts.target) {
    return {
      ok: false,
      reason: 'Hosting target is required for this deployment but none was specified.',
    };
  }

  if (opts.target) {
    let firebaserc = opts.firebaserc || null;
    if (!firebaserc) {
      const rcPath = opts.firebasercPath || resolve(distDir, '../../.firebaserc');
      if (existsSync(rcPath)) {
        try {
          firebaserc = JSON.parse(readFileSync(rcPath, 'utf8'));
        } catch (err) {
          return {
            ok: false,
            reason: `Failed to read or parse .firebaserc at ${rcPath}: ${err.message}`,
          };
        }
      } else {
        const cwdRc = resolve(process.cwd(), '.firebaserc');
        if (existsSync(cwdRc)) {
          try {
            firebaserc = JSON.parse(readFileSync(cwdRc, 'utf8'));
          } catch (err) {
            return {
              ok: false,
              reason: `Failed to read or parse .firebaserc at ${cwdRc}: ${err.message}`,
            };
          }
        }
      }
    }

    if (!firebaserc || !firebaserc.targets) {
      return {
        ok: false,
        reason: `Hosting target "${opts.target}" specified, but no targets configured in .firebaserc.`,
      };
    }

    const targetProject = effectiveProject;
    if (!targetProject) {
      return {
        ok: false,
        reason: `Cannot verify hosting target "${opts.target}" without a verified deployment project.`,
      };
    }

    const projectTargets = firebaserc.targets[targetProject];
    if (!projectTargets || !projectTargets.hosting || !projectTargets.hosting[opts.target]) {
      return {
        ok: false,
        reason: `Hosting target "${opts.target}" is not defined for project "${targetProject}" in .firebaserc.`,
      };
    }

    const mappedSites = projectTargets.hosting[opts.target];
    if (!Array.isArray(mappedSites) || mappedSites.length === 0) {
      return {
        ok: false,
        reason: `Hosting target "${opts.target}" for project "${targetProject}" has no mapped sites in .firebaserc.`,
      };
    }

    if (mappedSites.includes(PROD_SITE_ID) || (forbidProjectId && mappedSites.includes(forbidProjectId))) {
      return {
        ok: false,
        reason: `Hosting target "${opts.target}" in .firebaserc maps to production site "${PROD_SITE_ID}". Staging target must not map to production.`,
      };
    }

    if (opts.expectedTargetSite && !mappedSites.includes(opts.expectedTargetSite)) {
      return {
        ok: false,
        reason: `Hosting target "${opts.target}" maps to unexpected site(s) [${mappedSites.join(', ')}], expected "${opts.expectedTargetSite}".`,
      };
    }
  }

  // 3. Validate dist build artifacts
  if (!distDir || !existsSync(join(distDir, 'index.html'))) {
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
        + 'Build from a checkout that has webApp/.env.local or webApp/.env.staging.local, then deploy again.',
    };
  }

  // Check for synthetic/placeholder credentials when disallowPlaceholders is active
  if (disallowPlaceholders) {
    const configValues = chunks.flatMap((c) => extractConfigValues(c));
    if (!configValues.some((v) => API_KEY.test(v))) {
      return {
        ok: false,
        reason: 'Could not locate the inlined Firebase config (apiKey) in build chunks, so placeholder '
          + 'credentials cannot be ruled out. Refusing to deploy.',
      };
    }
    const hasPlaceholder = configValues.some((v) => PLACEHOLDER_KEY_PATTERN.test(v));
    if (hasPlaceholder) {
      return {
        ok: false,
        reason: 'Synthetic or placeholder Firebase configuration detected in build chunks. '
          + 'Live staging deployment requires authentic configuration issued from a registered Firebase Web App.',
      };
    }
  }

  // Check for forbidden endpoints (more specific than project ID)
  if (forbidEndpoints && forbidEndpoints.length > 0) {
    for (const endpoint of forbidEndpoints) {
      if (chunks.some((c) => c.includes(endpoint))) {
        return {
          ok: false,
          reason: `Forbidden endpoint detected in build: "${endpoint}". Ensure environment variables do not reference forbidden services.`,
        };
      }
    }
  }

  // Check for forbidden project ID (e.g. production credentials leaking into a staging build)
  if (forbidProjectId) {
    const hasForbidden = chunks.some((c) => c.includes(forbidProjectId));
    if (hasForbidden) {
      return {
        ok: false,
        reason: `Cross-contamination detected: The build contains forbidden project reference "${forbidProjectId}". `
          + 'Ensure production environment variables are not leaking into staging.',
      };
    }
  }

  // Verify target project ID
  if (effectiveProject && !withKey.some((c) => c.includes(effectiveProject))) {
    return {
      ok: false,
      reason: `The build's Firebase config is not for project "${effectiveProject}". `
        + 'Check VITE_FIREBASE_PROJECT_ID in webApp/.env.local or webApp/.env.staging.local and rebuild.',
    };
  }

  // Verify expected auth domain
  if (opts.expectedAuthDomain && !withKey.some((c) => c.includes(opts.expectedAuthDomain))) {
    return {
      ok: false,
      reason: `The build's Firebase authDomain does not match expected "${opts.expectedAuthDomain}". `
        + 'Check VITE_FIREBASE_AUTH_DOMAIN and rebuild.',
    };
  }

  // Basic configuration consistency check
  if (effectiveProject) {
    const configChunk = withKey.find((c) => c.includes(effectiveProject));
    if (configChunk) {
      const authDomainPattern = /authDomain:\s*["']([^"']+)["']/;
      const match = configChunk.match(authDomainPattern);
      if (match && match[1]) {
        const domain = match[1];
        if (domain.includes('tabakpp-ff036') && effectiveProject !== 'tabakpp-ff036') {
          return {
            ok: false,
            reason: `Conflicting authDomain "${domain}" found in config for project "${effectiveProject}".`,
          };
        }
      }
    }
  }

  return { ok: true };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const getFlag = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  const hasFlag = (flag) => args.includes(flag);

  const expectedProject = getFlag('--expected-project') || getFlag('--project') || null;
  const actualProject = getFlag('--actual-project') || (process.env.GCLOUD_PROJECT || null);
  const expectedAuthDomain = getFlag('--expected-auth-domain');
  const forbidProjectId = getFlag('--forbid-project');
  const forbidEndpoint = getFlag('--forbid-endpoint');
  const target = getFlag('--target');
  const expectedTargetSite = getFlag('--expected-target-site');
  const firebasercPath = getFlag('--firebaserc');
  const requireActualProject = hasFlag('--require-actual-project');
  const requireTarget = hasFlag('--require-target');
  const disallowPlaceholders = hasFlag('--disallow-placeholders');

  const flagsWithVal = new Set([
    '--project',
    '--expected-project',
    '--actual-project',
    '--expected-auth-domain',
    '--forbid-project',
    '--forbid-endpoint',
    '--target',
    '--expected-target-site',
    '--firebaserc',
  ]);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (flagsWithVal.has(args[i])) {
      i++;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }
  const distDir = resolve(positional[0] || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));

  const result = checkDistConfig(distDir, {
    expectedProject,
    actualProject,
    requireActualProject,
    expectedAuthDomain,
    forbidProjectId,
    forbidEndpoints: forbidEndpoint ? [forbidEndpoint] : undefined,
    disallowPlaceholders,
    target,
    requireTarget,
    expectedTargetSite,
    firebasercPath,
  });

  if (!result.ok) {
    console.error(`\n✖ Hosting deploy blocked: ${result.reason}\n`);
    process.exit(1);
  }
  const displayProject = actualProject || expectedProject;
  console.log(`✔ Web build has valid Firebase config${displayProject ? ` for ${displayProject}` : ''}.`);
}
