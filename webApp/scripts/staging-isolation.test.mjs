import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateStagingDeployment, deployStaging } from './deploy-staging.mjs';
import { PROD_PROJECT_ID, STAGING_PROJECT_ID } from './check-dist-config.mjs';

const rootDir = resolve(__dirname, '../..');
const FAKE_KEY = 'AIza' + 'x'.repeat(35);
const VALID_STAGING_CONFIG = `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-staging",authDomain:"tabakpp-staging.firebaseapp.com",storageBucket:"tabakpp-staging.firebasestorage.app",messagingSenderId:"123456789",appId:"1:123456789:web:abcdef"};`;
const PROD_CONFIG_LEAK = `const c={apiKey:"${FAKE_KEY}",projectId:"${PROD_PROJECT_ID}",authDomain:"tabakpp.firebaseapp.com"};`;

const makeDist = (chunks) => {
  const dir = mkdtempSync(join(tmpdir(), 'staging-iso-dist-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  mkdirSync(join(dir, 'assets'));
  chunks.forEach((c, i) => writeFileSync(join(dir, 'assets', `chunk-${i}.js`), c));
  return dir;
};

describe('Staging vs Production Configuration Isolation (Phase 5.2)', () => {
  describe('File-Level Decoupling & Configuration Isolation', () => {
    it('preserves production firebase.json targeting tabakpp site', () => {
      const prodConfigPath = join(rootDir, 'firebase.json');
      expect(existsSync(prodConfigPath)).toBe(true);
      const prodConfig = JSON.parse(readFileSync(prodConfigPath, 'utf8'));

      expect(prodConfig.hosting.site).toBe('tabakpp');
      expect(prodConfig.hosting.target).toBeUndefined();
      expect(prodConfig.hosting.public).toBe('webApp/dist');
      expect(prodConfig.firestore.rules).toBe('firestore.rules');
      expect(prodConfig.hosting.predeploy).toEqual([
        'node webApp/scripts/check-dist-config.mjs'
      ]);
    });

    it('ensures firebase.staging.json is strictly Hosting-only (no firestore rules property)', () => {
      const stagingConfigPath = join(rootDir, 'firebase.staging.json');
      expect(existsSync(stagingConfigPath)).toBe(true);
      const stagingConfig = JSON.parse(readFileSync(stagingConfigPath, 'utf8'));

      // 1. MUST NOT define firestore rules — preventing rules deployment via hosting config
      expect(stagingConfig.firestore).toBeUndefined();

      // 2. MUST use target "staging-app" and MUST NOT define a default site
      expect(stagingConfig.hosting.target).toBe('staging-app');
      expect(stagingConfig.hosting.site).toBeUndefined();
      expect(JSON.stringify(stagingConfig)).not.toContain('"site":"tabakpp"');

      // 3. MUST NOT deploy Cloud Functions to staging (Spark parity)
      expect(stagingConfig.functions).toBeUndefined();

      // 4. CSP MUST NOT allow production Cloud Functions in connect-src
      const headers = stagingConfig.hosting.headers || [];
      const catchAll = headers.find((h) => h.source === '/**');
      expect(catchAll).toBeDefined();
      const cspHeader = catchAll.headers.find((h) => h.key === 'Content-Security-Policy');
      expect(cspHeader).toBeDefined();
      expect(cspHeader.value).not.toContain('tabakpp-ff036');
      expect(cspHeader.value).not.toContain('europe-west1-tabakpp-ff036.cloudfunctions.net');
    });

    it('defines dedicated, isolated firebase.staging.firestore.json for Firestore Rules', () => {
      const firestoreStagingPath = join(rootDir, 'firebase.staging.firestore.json');
      expect(existsSync(firestoreStagingPath)).toBe(true);
      const firestoreConfig = JSON.parse(readFileSync(firestoreStagingPath, 'utf8'));

      // 1. MUST define firestore rules
      expect(firestoreConfig.firestore).toBeDefined();
      expect(firestoreConfig.firestore.rules).toBe('firestore.rules');
      expect(firestoreConfig.firestore.predeploy).toEqual([
        'node webApp/scripts/check-rules-project.mjs --expected-project tabakpp-staging --forbid-project tabakpp-ff036'
      ]);

      // 2. MUST NOT define hosting or functions
      expect(firestoreConfig.hosting).toBeUndefined();
      expect(firestoreConfig.functions).toBeUndefined();
    });

    it('configures .firebaserc with staging alias and exclusive target mapping', () => {
      const firebasercPath = join(rootDir, '.firebaserc');
      expect(existsSync(firebasercPath)).toBe(true);
      const firebaserc = JSON.parse(readFileSync(firebasercPath, 'utf8'));

      expect(firebaserc.projects.default).toBe(PROD_PROJECT_ID);
      expect(firebaserc.projects.staging).toBe(STAGING_PROJECT_ID);

      expect(firebaserc.targets).toBeDefined();
      expect(firebaserc.targets[STAGING_PROJECT_ID]).toBeDefined();
      expect(firebaserc.targets[STAGING_PROJECT_ID].hosting['staging-app']).toBeDefined();

      const mappedSites = firebaserc.targets[STAGING_PROJECT_ID].hosting['staging-app'];
      expect(mappedSites).not.toContain('tabakpp');
      expect(mappedSites).not.toContain(PROD_PROJECT_ID);

      // Target must NOT exist on default production project
      expect(firebaserc.targets[PROD_PROJECT_ID]).toBeUndefined();
    });
  });

  describe('Guarded Deployment Entrypoint — Negative Regression Tests (Task 3)', () => {
    it('1. rejects a staging Hosting deployment targeting production', () => {
      const result = validateStagingDeployment('hosting', {
        project: PROD_PROJECT_ID,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Production project "tabakpp-ff036" is strictly rejected/);
    });

    it('2. rejects a staging Firestore Rules deployment targeting production', () => {
      const result = validateStagingDeployment('firestore:rules', {
        project: PROD_PROJECT_ID,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Production project "tabakpp-ff036" is strictly rejected/);
    });

    it('3. rejects omitted project arguments with no default fallback (Hosting)', () => {
      const result = validateStagingDeployment('hosting', {
        project: null,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Omitted project argument.*does not fall back to default project/);
    });

    it('3b. rejects omitted project arguments with no default fallback (Firestore Rules)', () => {
      const result = validateStagingDeployment('firestore:rules', {
        project: null,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Omitted project argument.*does not fall back to default project/);
    });

    it('4. rejects incorrect Firebase project aliases or unknown projects', () => {
      const result = validateStagingDeployment('hosting', {
        project: 'incorrect-staging-alias',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Project mismatch: Expected staging project "tabakpp-staging"/);
    });

    it('5. rejects missing or incorrect Hosting target mappings in .firebaserc', () => {
      const emptyRc = { projects: { staging: STAGING_PROJECT_ID }, targets: {} };
      const dist = makeDist([VALID_STAGING_CONFIG]);
      try {
        const result = validateStagingDeployment('hosting', {
          project: STAGING_PROJECT_ID,
          target: 'staging-app',
          distDir: dist,
          firebaserc: emptyRc,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/Hosting target "staging-app" is not defined for project "tabakpp-staging" in .firebaserc/);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });

    it('5b. rejects Hosting target mapped to production site tabakpp', () => {
      const badRc = {
        projects: { staging: STAGING_PROJECT_ID },
        targets: {
          [STAGING_PROJECT_ID]: {
            hosting: {
              'staging-app': ['tabakpp'], // MISMAPPED TO PROD SITE
            },
          },
        },
      };
      const dist = makeDist([VALID_STAGING_CONFIG]);
      try {
        const result = validateStagingDeployment('hosting', {
          project: STAGING_PROJECT_ID,
          target: 'staging-app',
          distDir: dist,
          firebaserc: badRc,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/maps to production site "tabakpp"/);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });

    it('6. rejects production JavaScript bundles passed to staging', () => {
      const dist = makeDist([PROD_CONFIG_LEAK]);
      try {
        const result = validateStagingDeployment('hosting', {
          project: STAGING_PROJECT_ID,
          distDir: dist,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/Cross-contamination detected/);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });

    it('7. rejects mixed staging and production Firebase environment variables', () => {
      const result = validateStagingDeployment('firestore:rules', {
        project: STAGING_PROJECT_ID,
        env: { GCLOUD_PROJECT: PROD_PROJECT_ID },
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Conflicting environment variable: GCLOUD_PROJECT is set to production "tabakpp-ff036"/);
    });

    it('7b. rejects conflicting environment variable not matching staging project', () => {
      const result = validateStagingDeployment('hosting', {
        project: STAGING_PROJECT_ID,
        env: { GCLOUD_PROJECT: 'unrelated-project-id' },
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Conflicting environment variable: GCLOUD_PROJECT is set to "unrelated-project-id"/);
    });
  });

  describe('Guarded Deployment Entrypoint — Valid Executions (Local Mocks)', () => {
    it('generates the exact safe command for staging Hosting deployment', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      try {
        const result = validateStagingDeployment('hosting', {
          project: STAGING_PROJECT_ID,
          distDir: dist,
        });
        expect(result.ok).toBe(true);
        expect(result.command).toEqual([
          'firebase',
          'deploy',
          '--config',
          'firebase.staging.json',
          '--only',
          'hosting:staging-app',
          '--project',
          STAGING_PROJECT_ID,
        ]);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });

    it('generates the exact safe command for staging Firestore Rules deployment', () => {
      const result = validateStagingDeployment('firestore:rules', {
        project: STAGING_PROJECT_ID,
      });
      expect(result.ok).toBe(true);
      expect(result.command).toEqual([
        'firebase',
        'deploy',
        '--config',
        'firebase.staging.firestore.json',
        '--only',
        'firestore:rules',
        '--project',
        STAGING_PROJECT_ID,
      ]);
    });

    it('executes dry-run without executing external network commands', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      try {
        const result = deployStaging('hosting', {
          project: STAGING_PROJECT_ID,
          distDir: dist,
          dryRun: true,
        });
        expect(result.ok).toBe(true);
        expect(result.executed).toBe(false);
        expect(result.command).toBeDefined();
        expect(result.reason).toMatch(/Dry run: pre-flight checks passed/);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });

    it('invokes mock executor with verified staging CLI environment', () => {
      const dist = makeDist([VALID_STAGING_CONFIG]);
      let capturedCmd = null;
      let capturedOpts = null;
      const mockExecutor = (cmd, opts) => {
        capturedCmd = cmd;
        capturedOpts = opts;
        return { status: 0, stdout: 'Deploy complete!' };
      };

      try {
        const result = deployStaging('hosting', {
          project: STAGING_PROJECT_ID,
          distDir: dist,
          executor: mockExecutor,
        });
        expect(result.ok).toBe(true);
        expect(result.executed).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(capturedCmd).toEqual([
          'firebase',
          'deploy',
          '--config',
          'firebase.staging.json',
          '--only',
          'hosting:staging-app',
          '--project',
          STAGING_PROJECT_ID,
        ]);
        expect(capturedOpts.env.GCLOUD_PROJECT).toBe(STAGING_PROJECT_ID);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });
  });

  describe('Staging Environment Configuration Template', () => {
    it('provides complete .env.staging.example template with Spark parity', () => {
      const envStagingExamplePath = join(rootDir, 'webApp/.env.staging.example');
      expect(existsSync(envStagingExamplePath)).toBe(true);
      const content = readFileSync(envStagingExamplePath, 'utf8');

      expect(content).toContain('VITE_FIREBASE_API_KEY=');
      expect(content).toContain('VITE_FIREBASE_AUTH_DOMAIN=tabakpp-staging.firebaseapp.com');
      expect(content).toContain('VITE_FIREBASE_PROJECT_ID=tabakpp-staging');
      expect(content).toContain('VITE_FIREBASE_STORAGE_BUCKET=tabakpp-staging.firebasestorage.app');
      expect(content).toContain('VITE_FIREBASE_MESSAGING_SENDER_ID=');
      expect(content).toContain('VITE_FIREBASE_APP_ID=');

      // Option-B and production cross-references must NOT be active
      expect(content).not.toMatch(/^VITE_OPTION_B_LEDGER=[^#\n]+/m);
      expect(content).not.toContain(PROD_PROJECT_ID);
    });
  });
});
