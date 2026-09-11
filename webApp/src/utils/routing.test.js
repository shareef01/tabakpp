import { describe, it, expect } from 'vitest';
import { pathForTab, tabForPath } from './routing';

describe('routing (item 8 — URL-addressable tabs)', () => {
  it('maps each tab to a real path', () => {
    expect(pathForTab('track')).toBe('/track');
    expect(pathForTab('history')).toBe('/history');
    expect(pathForTab('settings')).toBe('/settings');
  });

  it('falls back to /track for an unknown tab', () => {
    expect(pathForTab('nope')).toBe('/track');
  });

  it('maps a path back to its tab', () => {
    expect(tabForPath('/history')).toBe('history');
    expect(tabForPath('/settings')).toBe('settings');
    expect(tabForPath('/track')).toBe('track');
  });

  it('treats root and unrecognized paths as track, not a dead end', () => {
    expect(tabForPath('/')).toBe('track');
    expect(tabForPath('')).toBe('track');
    expect(tabForPath('/nonsense')).toBe('track');
  });

  it('tolerates a trailing slash', () => {
    expect(tabForPath('/history/')).toBe('history');
  });

  it('round-trips every known tab through path and back', () => {
    for (const tab of ['track', 'history', 'settings']) {
      expect(tabForPath(pathForTab(tab))).toBe(tab);
    }
  });
});
