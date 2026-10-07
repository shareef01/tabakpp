import { describe, it, expect } from 'vitest';
import { clearAppStorage, importWithRecovery } from './appRecovery';

describe('app recovery', () => {
  it('preserves unrelated storage and removes app state', () => {
    localStorage.setItem('another_app', 'keep');
    localStorage.setItem('tabak_accent_last', 'red');
    clearAppStorage();
    expect(localStorage.getItem('another_app')).toBe('keep');
    expect(localStorage.getItem('tabak_accent_last')).toBeNull();
  });
  it('reloads at most once for each build even after an intervening successful import', async () => {
    sessionStorage.clear();
    let reloads = 0;
    const fail = async () => { throw new Error('chunk missing'); };
    await importWithRecovery(fail, 'build1', sessionStorage, () => reloads++);
    await importWithRecovery(async () => ({ default: null }), 'build1');
    await expect(importWithRecovery(fail, 'build1', sessionStorage, () => reloads++)).rejects.toThrow('chunk missing');
    expect(reloads).toBe(1);
  });
});
