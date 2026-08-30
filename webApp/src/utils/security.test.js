import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  sanitizeTrackerName,
  MAX_DISPLAY_NAME,
  MAX_TRACKER_NAME,
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
