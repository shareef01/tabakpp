import { describe, it, expect } from 'vitest';
import { defaultPouchPrice } from './SettingsScreen';

// F-10: `settings.pouchPrice || 6.50` replaced a deliberately saved 0 with 6.50
// on every load, and the next economics save persisted the 6.50.
describe('defaultPouchPrice', () => {
  it('keeps a saved zero pouch price for a POUCH account (reload + resave stays 0)', () => {
    expect(defaultPouchPrice({ purchaseType: 'POUCH', pouchPrice: 0 })).toBe(0);
  });
  it('keeps any saved POUCH price', () => {
    expect(defaultPouchPrice({ purchaseType: 'POUCH', pouchPrice: 9.2 })).toBe(9.2);
  });
  it('suggests 6.50 only when POUCH economics were never saved', () => {
    // A PACK save writes pouchPrice: 0 — that is "not configured", not a price.
    expect(defaultPouchPrice({ purchaseType: 'PACK', pouchPrice: 0 })).toBe(6.5);
    expect(defaultPouchPrice({ purchaseType: 'POUCH' })).toBe(6.5);
    expect(defaultPouchPrice(undefined)).toBe(6.5);
  });
});
