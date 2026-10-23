import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENTS, DEFAULT_ACCENT } from './constants/ui';
import { hexToRgbValues } from './utils/formatters';
import tailwindConfig from '../tailwind.config.js';

/**
 * Design tokens were defined four times and had drifted:
 *
 *   index.css   --accent #D4FF5C   --surface-base #020202   --danger #f43f5e
 *   tailwind    accent var(--accent)  bg-base #000000        danger #FF1111
 *   App.jsx     FIRESTORE_ACCENT_DEFAULT #FF5F5F
 *   constants   ACCENTS[0] #FF5F5F
 *
 * The CSS values are what the app paints with BEFORE the profile listener
 * hydrates (the loading spinner, the pre-mount body), so a mismatch is a
 * visible colour shift on OLED screens rather than a theoretical concern.
 * These assertions are cheap and make the drift impossible to reintroduce.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, 'index.css'), 'utf8');

const cssVar = (name) => {
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};

describe('design-token parity', () => {
  it('CSS :root accent matches the default accent swatch', () => {
    expect(DEFAULT_ACCENT).toBe(ACCENTS[0].v);
    expect(cssVar('--accent').toUpperCase()).toBe(ACCENTS[0].v.toUpperCase());
  });

  it('CSS --accent-rgb matches the CSS --accent', () => {
    // Without this, `rgba(var(--accent-rgb), …)` fills and glows disagree with
    // accent text before hydration (formatters.js documents the same class of
    // bug for 3-digit accents).
    expect(cssVar('--accent-rgb')).toBe(hexToRgbValues(ACCENTS[0].v));
  });

  it('CSS surface + danger tokens match their Tailwind counterparts', () => {
    const colors = tailwindConfig.theme.extend.colors;
    expect(cssVar('--surface-base').toUpperCase()).toBe(colors['bg-base'].toUpperCase());
    expect(cssVar('--danger').toUpperCase()).toBe(colors.danger.toUpperCase());
  });

  it('declares no surface token that nothing consumes', () => {
    // --surface-panel/--surface-card used to exist here with values that
    // matched neither Tailwind nor Color.kt, and were referenced by nothing.
    const declared = [...css.matchAll(/--(surface-[a-z-]+):/g)].map((m) => m[1]);
    expect(declared).toEqual(['surface-base']);
  });

  it('every accent swatch is a 6-digit hex (rules reject anything else)', () => {
    for (const accent of ACCENTS) {
      expect(accent.v).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(accent.n).toBeTruthy();
    }
  });
});
