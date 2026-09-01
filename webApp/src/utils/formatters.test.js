import { describe, it, expect } from 'vitest';
import { formatDateDisplay, hexToRgbValues } from './formatters';

describe('formatDateDisplay', () => {
  it('formats YYYY-MM-DD without timezone day shift', () => {
    // Local parse of "2024-01-01" can become Dec 31 in US timezones; UTC path stays Jan 1.
    const label = formatDateDisplay('2024-01-01');
    expect(label).toMatch(/1/);
    expect(label).toMatch(/JAN/);
    expect(label).not.toMatch(/DEC/);
  });

  it('returns placeholder for empty input', () => {
    expect(formatDateDisplay('')).toBe('---');
    expect(formatDateDisplay(null)).toBe('---');
  });
});

describe('hexToRgbValues', () => {
  it('converts 6-digit hex', () => {
    expect(hexToRgbValues('#FF5F5F')).toBe('255, 95, 95');
    expect(hexToRgbValues('#10B981')).toBe('16, 185, 129');
  });

  // firestore.rules allows the 3-digit form, so a stored "#0af" must not fall
  // back to the cyan default while --accent keeps the user's actual color.
  it('expands 3-digit hex instead of falling back', () => {
    expect(hexToRgbValues('#0af')).toBe('0, 170, 255');
    expect(hexToRgbValues('#FFF')).toBe('255, 255, 255');
  });

  it('falls back for genuinely invalid input', () => {
    expect(hexToRgbValues('not-a-color')).toBe('0, 210, 255');
    expect(hexToRgbValues('#12345')).toBe('0, 210, 255');
  });
});
