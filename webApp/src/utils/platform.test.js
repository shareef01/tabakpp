import { describe, it, expect, afterEach, vi } from 'vitest';
import { isIosLike, isStandalonePwa, prefersAuthRedirect } from './platform';

describe('platform helpers', () => {
  const originalNavigator = global.navigator;
  const originalWindow = global.window;

  afterEach(() => {
    vi.stubGlobal('navigator', originalNavigator);
    vi.stubGlobal('window', originalWindow);
  });

  it('detects iPhone user agents', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(isIosLike()).toBe(true);
    expect(prefersAuthRedirect()).toBe(true);
  });

  it('detects iPadOS desktop-mode user agents', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(isIosLike()).toBe(true);
  });

  it('treats installed PWAs as redirect-first', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      standalone: true,
    });
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
      navigator: { standalone: true },
    });
    expect(isStandalonePwa()).toBe(true);
    expect(prefersAuthRedirect()).toBe(true);
  });

  it('defaults to popup auth on desktop Chrome', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      platform: 'Win32',
      maxTouchPoints: 0,
    });
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
      navigator: {},
    });
    expect(isIosLike()).toBe(false);
    expect(isStandalonePwa()).toBe(false);
    expect(prefersAuthRedirect()).toBe(false);
  });
});
