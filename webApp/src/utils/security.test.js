import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  sanitizeTrackerName,
  MAX_DISPLAY_NAME,
  MAX_TRACKER_NAME,
  MAX_AVATAR_INPUT_BYTES,
  looksLikeImage,
  compressAvatarFile,
} from './security';

describe('sanitizeInput', () => {
  it('strips control characters and angle brackets', () => {
    expect(sanitizeInput('  Alice<script>\u0000  ')).toBe('Alicescript');
  });

  it('preserves dollar signs in tracker names', () => {
    expect(sanitizeTrackerName('$5 pack')).toBe('$5 pack');
  });

  it('truncates to the display-name cap', () => {
    expect(sanitizeInput('x'.repeat(MAX_DISPLAY_NAME + 20)).length).toBe(MAX_DISPLAY_NAME);
  });

  it('truncates tracker names to 80 chars', () => {
    expect(sanitizeTrackerName('y'.repeat(MAX_TRACKER_NAME + 10)).length).toBe(MAX_TRACKER_NAME);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeInput(null)).toBe('');
    expect(sanitizeInput(undefined)).toBe('');
  });
});

describe('avatar security hardening', () => {
  it('rejects SVG files with script injection vectors', () => {
    expect(looksLikeImage({ type: 'image/svg+xml', name: 'avatar.svg' })).toBe(false);
    expect(looksLikeImage({ type: '', name: 'avatar.svg' })).toBe(false);
  });

  it('accepts valid raster image formats', () => {
    expect(looksLikeImage({ type: 'image/jpeg', name: 'avatar.jpg' })).toBe(true);
    expect(looksLikeImage({ type: 'image/png', name: 'avatar.png' })).toBe(true);
    expect(looksLikeImage({ type: 'image/webp', name: 'avatar.webp' })).toBe(true);
  });

  it('rejects files exceeding MAX_AVATAR_INPUT_BYTES before decoding', async () => {
    const fakeOversizedFile = {
      type: 'image/jpeg',
      name: 'huge.jpg',
      size: MAX_AVATAR_INPUT_BYTES + 1,
    };
    await expect(compressAvatarFile(fakeOversizedFile)).rejects.toThrow('AVATAR_TOO_LARGE');
  });
});
