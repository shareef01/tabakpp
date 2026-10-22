import { describe, expect, it } from 'vitest';
import { checkRulesProject } from './check-rules-project.mjs';
import { PROD_PROJECT_ID, STAGING_PROJECT_ID } from './check-dist-config.mjs';

describe('checkRulesProject (Firestore rules predeploy guard)', () => {
  it('passes when actual CLI project is verified staging project tabakpp-staging', () => {
    const result = checkRulesProject({
      actualProject: STAGING_PROJECT_ID,
      expectedProject: STAGING_PROJECT_ID,
      forbidProjectId: PROD_PROJECT_ID,
    });
    expect(result.ok).toBe(true);
    expect(result.project).toBe(STAGING_PROJECT_ID);
  });

  it('rejects deployment when actual project is production tabakpp-ff036', () => {
    const result = checkRulesProject({
      actualProject: PROD_PROJECT_ID,
      expectedProject: STAGING_PROJECT_ID,
      forbidProjectId: PROD_PROJECT_ID,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Actual deployment project "tabakpp-ff036" is forbidden for staging Firestore Rules/);
  });

  it('rejects deployment when actual project is missing or cannot be verified', () => {
    const result = checkRulesProject({
      actualProject: null,
      expectedProject: STAGING_PROJECT_ID,
      env: {},
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Actual deployment project is missing or cannot be verified/);
  });

  it('rejects deployment when actual project mismatches expected staging project', () => {
    const result = checkRulesProject({
      actualProject: 'unrelated-project-id',
      expectedProject: STAGING_PROJECT_ID,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Deployment project mismatch: Expected staging project "tabakpp-staging", but actual CLI project is "unrelated-project-id"/);
  });

  it('rejects deployment when firestore.rules file is missing', () => {
    const result = checkRulesProject({
      actualProject: STAGING_PROJECT_ID,
      rulesPath: 'non-existent-rules-file.rules',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Firestore security rules file not found/);
  });
});
