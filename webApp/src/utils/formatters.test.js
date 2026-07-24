import { describe, it, expect } from 'vitest';
import { formatDateDisplay } from './formatters';

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
