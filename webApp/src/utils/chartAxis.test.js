import { describe, it, expect } from 'vitest';
import { niceAxis } from './chartAxis';

describe('niceAxis', () => {
  it('rounds a monthly total to whole hundreds instead of uneven ticks', () => {
    expect(niceAxis(292).ticks).toEqual([0, 100, 200, 300, 400]);
  });

  it('keeps small daily counts on whole-number steps', () => {
    expect(niceAxis(7).ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceAxis(20).ticks).toEqual([0, 5, 10, 15, 20, 25]);
  });

  it('uses a minimum top of 4 for empty or zero data', () => {
    expect(niceAxis(0).ticks).toEqual([0, 1, 2, 3, 4]);
    expect(niceAxis(undefined).ticks).toEqual([0, 1, 2, 3, 4]);
  });

  it('widens the axis for labels with four or more digits', () => {
    expect(niceAxis(292).width).toBe(32);
    expect(niceAxis(1234).width).toBe(36);
    expect(niceAxis(12000).width).toBe(43);
  });

  it('never steps by a fraction', () => {
    for (const max of [1, 3, 9, 13, 48, 99, 101, 250, 999, 1234]) {
      const { ticks, domain } = niceAxis(max);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(domain[1]).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });
});
