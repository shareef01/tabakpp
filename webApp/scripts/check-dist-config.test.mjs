import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDistConfig, PROD_PROJECT_ID, PROD_SITE_ID } from './check-dist-config.mjs';

const FAKE_KEY = 'AIza' + 'x'.repeat(35);
const VALID_STAGING_CONFIG = `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-staging",authDomain:"tabakpp-staging.firebaseapp.com",storageBucket:"tabakpp-staging.firebasestorage.app",messagingSenderId:"123456789",appId:"1:123456789:web:abcdef"};`;
const VALID_PROD_CONFIG = `const c={apiKey:"${FAKE_KEY}",projectId:"${PROD_PROJECT_ID}",authDomain:"${PROD_SITE_ID}.firebaseapp.com",storageBucket:"${PROD_PROJECT_ID}.appspot.com",messagingSenderId:"987654321",appId:"1:987654321:web:fedcba"};`;

const VALID_STAGING_FIREBASE_RC = {
  projects: {
    default: PROD_PROJECT_ID,
    staging: 'tabakpp-staging',
  },
  targets: {
    'tabakpp-staging': {
      hosting: {
        'staging-app': ['tabakpp-staging'],
      },
    },
  },
};

const dirs = [];

const makeDist = (chunks, { withIndex = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-check-'));
  dirs.push(dir);
  if (withIndex) writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  mkdirSync(join(dir, 'assets'));
  chunks.forEach((c, i) => writeFileSync(join(dir, 'assets', `chunk-${i}.js`), c));
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('checkDistConfig (hosting predeploy guard)', () => {
  describe('Production Compatibility & Regression Guard', () => {
    it('passes a valid production build with inlined config for tabakpp-ff036', () => {
      const dist = makeDist(['vendor()', VALID_PROD_CONFIG]);
      expect(checkDistConfig(dist, PROD_PROJECT_ID)).toEqual({ ok: true });
    });

    it('passes when GCLOUD_PROJECT matches production project', () => {
      const dist = makeDist(['vendor()', VALID_PROD_CONFIG]);
      expect(checkDistConfig(dist, {
        actualProject: PROD_PROJECT_ID,
        expectedProject: PROD_PROJECT_ID,
      })).toEqual({ ok: true });
    });

    it('blocks a production build made without .env.local (missing API key)', () => {
      const dist = makeDist(['const c={apiKey:void 0,projectId:void 0};console.error("Missing Firebase config")']);
      const result = checkDistConfig(dist, PROD_PROJECT_ID);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/no Firebase config/);
    });

    it('blocks a build configured for a different project', () => {
      const dist = makeDist([`const c={apiKey:"${FAKE_KEY}",projectId:"some-other-project"}`]);
      const result = checkDistConfig(dist, PROD_PROJECT_ID);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/not for project "tabakpp-ff036"/);
    });

    it('skips the project check when target project is unknown', () => {
      const dist = makeDist([`const c={apiKey:"${FAKE_KEY}"}`]);
      expect(checkDistConfig(dist, null)).toEqual({ ok: true });
    });

    it('blocks when there is no build directory or index.html at all', () => {
      const dist = makeDist([], { withIndex: false });
      expect(checkDistConfig(dist).reason).toMatch(/No build found/);
    });
  });

  describe('Staging Safeguards — 7 Core Staging Build Scenarios (Requirement 3)', () => {
    it('1. passes a valid isolated staging configuration with verified CLI identity and target', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
        expectedAuthDomain: 'tabakpp-staging.firebaseapp.com',
      });
      expect(result).toEqual({ ok: true });
    });

    it('2. rejects a build configured for production when checking staging deployment', () => {
      const dist = makeDist([VALID_PROD_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Cross-contamination detected|not for project "tabakpp-staging"/);
    });

    it('3. rejects a staging build with missing API key (no VITE_FIREBASE_API_KEY inlined)', () => {
      const dist = makeDist(['const c={apiKey:void 0,projectId:"tabakpp-staging"}']);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/no Firebase config/);
    });

    it('4. rejects a staging build with incorrect authDomain', () => {
      const dist = makeDist([
        `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-staging",authDomain:"unexpected-domain.firebaseapp.com"}`
      ]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
        expectedAuthDomain: 'tabakpp-staging.firebaseapp.com',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/authDomain does not match expected/);
    });

    it('5. rejects a build with mixed staging/production variables (cross-contamination)', () => {
      const dist = makeDist([
        `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-staging",authDomain:"tabakpp-staging.firebaseapp.com"}`,
        `const prodStorage="${PROD_PROJECT_ID}.appspot.com";`,
      ]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Cross-contamination detected.*tabakpp-ff036/);
    });

    it('6. rejects a staging build referencing forbidden production Cloud Functions endpoint', () => {
      const dist = makeDist([
        `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-staging"}`,
        'const fn="https://europe-west1-tabakpp-ff036.cloudfunctions.net";',
      ]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
        forbidEndpoints: ['europe-west1-tabakpp-ff036.cloudfunctions.net'],
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Forbidden endpoint detected/);
    });

    it('7. rejects when actual CLI target mismatch occurs or target is not defined in .firebaserc', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'unregistered-target',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Hosting target "unregistered-target" is not defined/);
    });
  });

  describe('Staging Deployment CLI Identity & Negative Regression Scenarios (Requirement 2)', () => {
    it('rejects deployment when actual project is missing or cannot be verified (omitted --project)', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: null,
        requireActualProject: true,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Actual deployment project is missing or cannot be verified/);
    });

    it('rejects deployment when incorrect alias or wrong project is resolved by CLI', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'some-other-project',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Deployment project mismatch: expected "tabakpp-staging", but actual CLI project is "some-other-project"/);
    });

    it('rejects deployment when CLI falls back to default production project tabakpp-ff036', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: PROD_PROJECT_ID,
        forbidProjectId: PROD_PROJECT_ID,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Actual deployment project "tabakpp-ff036" is forbidden for this deployment/);
    });

    it('rejects when environment variable GCLOUD_PROJECT conflicts with expected staging project', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: PROD_PROJECT_ID,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Actual deployment project "tabakpp-ff036" is forbidden|Deployment project mismatch/);
    });

    it('rejects deployment when hosting target in .firebaserc maps to production site tabakpp', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const badRc = {
        projects: { default: PROD_PROJECT_ID, staging: 'tabakpp-staging' },
        targets: {
          'tabakpp-staging': {
            hosting: {
              'staging-app': [PROD_SITE_ID], // CRITICAL FAILURE CASE: MAPS TO PROD SITE!
            },
          },
        },
      };
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        firebaserc: badRc,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/maps to production site "tabakpp". Staging target must not map to production/);
    });

    it('rejects deployment when hosting target maps to unexpected site ID', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        target: 'staging-app',
        expectedTargetSite: 'verified-future-staging-site',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/maps to unexpected site.*expected "verified-future-staging-site"/);
    });

    it('rejects deployment when hosting target is required but omitted', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        requireTarget: true,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Hosting target is required for this deployment but none was specified/);
    });

    it('rejects staging-app target when evaluated against production project tabakpp-ff036', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      // Layer 1: Staging target forbids production project
      const resultA = checkDistConfig(dist, {
        expectedProject: PROD_PROJECT_ID,
        actualProject: PROD_PROJECT_ID,
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(resultA.ok).toBe(false);
      expect(resultA.reason).toMatch(/Actual deployment project "tabakpp-ff036" is forbidden/);

      // Layer 2: Even if forbidden-project guard was bypassed, target is not defined for production
      const resultB = checkDistConfig(dist, {
        expectedProject: PROD_PROJECT_ID,
        actualProject: PROD_PROJECT_ID,
        forbidProjectId: null,
        target: 'staging-app',
        firebaserc: VALID_STAGING_FIREBASE_RC,
      });
      expect(resultB.ok).toBe(false);
      expect(resultB.reason).toMatch(/Hosting target "staging-app" is not defined for project "tabakpp-ff036"/);
    });

    it('rejects conflicting authDomain pointing to production on staging project', () => {
      const dist = makeDist([
        `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-staging",authDomain:"tabakpp-ff036.firebaseapp.com"}`
      ]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        forbidProjectId: null, // test consistency check directly
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Conflicting authDomain/);
    });

    it('accepts Firebase API keys of varying non-arbitrary lengths matching standard format', () => {
      // 28-char and 42-char keys
      const key28 = 'AIza' + 'y'.repeat(24);
      const key42 = 'AIza' + 'z'.repeat(38);
      const dist28 = makeDist([`const c={apiKey:"${key28}",projectId:"tabakpp-staging"}`]);
      const dist42 = makeDist([`const c={apiKey:"${key42}",projectId:"tabakpp-staging"}`]);

      expect(checkDistConfig(dist28, { expectedProject: 'tabakpp-staging', actualProject: 'tabakpp-staging' }).ok).toBe(true);
      expect(checkDistConfig(dist42, { expectedProject: 'tabakpp-staging', actualProject: 'tabakpp-staging' }).ok).toBe(true);
    });

    it('accepts authentic config even when other bundle code contains placeholder-like words', () => {
      // Real bundles contain input `placeholder` props, Firebase SDK `mockUserToken`, `__dummy__`, long zero runs.
      const realConfig = 'var Te={apiKey:`AIzaSyD4kQ7rLmN2pX9vB3cF6hJ8tW1yZ5sE0uA`,projectId:`tabakpp-staging`,appId:`1:812345678901:web:9f3c2a7b1e4d6c80`};';
      const noise = 'jsx(b,{placeholder:`Full Name...`});throw Error(`mockUserToken`);var r={__dummy__:0},u=1.0000000000001;';
      const dist = makeDist([realConfig, noise]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        disallowPlaceholders: true,
      });
      expect(result.ok).toBe(true);
    });

    it('fails closed when disallowPlaceholders is true but no apiKey config value can be located', () => {
      const dist = makeDist([`const k="AIza${'q'.repeat(35)}";`]);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        disallowPlaceholders: true,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Could not locate the inlined Firebase config/);
    });

    it('rejects the committed google-services.json.example key as a placeholder', () => {
      const dist = makeDist(['const c={apiKey:"AIzaSy_STAGING_KEY_FROM_FIREBASE_CONSOLE",projectId:"tabakpp-staging"};']);
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        disallowPlaceholders: true,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Synthetic or placeholder/);
    });

    it('rejects synthetic/placeholder credentials when disallowPlaceholders is true', () => {
      const placeholderConfig = 'const c={apiKey:"AIzaSyB_stagingKeyValidationQA001234567",projectId:"tabakpp-staging",appId:"1:100000000001:web:abcdef1234567890"};';
      const dist = makeDist([placeholderConfig]);

      // When disallowPlaceholders is false (default shape-only check), shape check passes
      expect(checkDistConfig(dist, { expectedProject: 'tabakpp-staging', actualProject: 'tabakpp-staging' }).ok).toBe(true);

      // When disallowPlaceholders is true (live deployment preflight), placeholder is blocked
      const result = checkDistConfig(dist, {
        expectedProject: 'tabakpp-staging',
        actualProject: 'tabakpp-staging',
        disallowPlaceholders: true,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Synthetic or placeholder Firebase configuration detected/);
    });
  });
});

