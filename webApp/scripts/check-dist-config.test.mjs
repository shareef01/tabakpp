import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDistConfig } from './check-dist-config.mjs';

const FAKE_KEY = 'AIza' + 'x'.repeat(35);
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
  it('passes a build with an inlined Firebase config for the target project', () => {
    const dist = makeDist(['vendor()', `const c={apiKey:"${FAKE_KEY}",projectId:"tabakpp-ff036"}`]);
    expect(checkDistConfig(dist, 'tabakpp-ff036')).toEqual({ ok: true });
  });

  it('blocks a build made without .env.local (the outage case)', () => {
    const dist = makeDist(['const c={apiKey:void 0,projectId:void 0};console.error("Missing Firebase config")']);
    const result = checkDistConfig(dist, 'tabakpp-ff036');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no Firebase config/);
  });

  it('blocks a build configured for a different project', () => {
    const dist = makeDist([`const c={apiKey:"${FAKE_KEY}",projectId:"some-other-project"}`]);
    const result = checkDistConfig(dist, 'tabakpp-ff036');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not for project "tabakpp-ff036"/);
  });

  it('skips the project check when the target project is unknown', () => {
    const dist = makeDist([`const c={apiKey:"${FAKE_KEY}"}`]);
    expect(checkDistConfig(dist, null)).toEqual({ ok: true });
  });

  it('blocks when there is no build at all', () => {
    const dist = makeDist([], { withIndex: false });
    expect(checkDistConfig(dist).reason).toMatch(/No build found/);
  });
});
