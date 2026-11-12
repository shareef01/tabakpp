import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_DAY_CONFIRM_MESSAGE } from './ui';

/**
 * Audit 2026-11-12 TABAK-001: the close-day dialog promised "You can continue
 * logging anytime today", but after closing, a tracker not yet logged that day
 * is refused (DAY_CLOSED_NO_SNAPSHOT — closed-day snapshots are frozen by
 * firestore.rules). The copy must state the limitation, identically on web and
 * Android.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const trackScreenKt = fs.readFileSync(
  path.join(here, '../../../composeApp/src/commonMain/kotlin/com/tabakpp/app/composeapp/ui/screens/TrackScreen.kt'),
  'utf8',
);

/** Joins the Kotlin `"…" + "…"` literal of CLOSE_DAY_CONFIRM_MESSAGE. */
const kotlinConstant = () => {
  const m = trackScreenKt.match(/CLOSE_DAY_CONFIRM_MESSAGE\s*=\s*([\s\S]*?)\n\s*\n/);
  if (!m) return null;
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join('');
};

describe('close-day confirmation copy', () => {
  it('does not promise unrestricted logging after closing', () => {
    expect(CLOSE_DAY_CONFIRM_MESSAGE).not.toMatch(/continue logging anytime|keep logging today/i);
    expect(CLOSE_DAY_CONFIRM_MESSAGE).toMatch(/already logged today/);
    expect(CLOSE_DAY_CONFIRM_MESSAGE).toMatch(/manual entry in History/);
  });

  it('matches the Android TrackScreen copy exactly', () => {
    expect(kotlinConstant()).toBe(CLOSE_DAY_CONFIRM_MESSAGE);
  });

  it('the Close-day button hint does not promise unrestricted logging either', () => {
    const banner = fs.readFileSync(path.join(here, '../components/dashboard/MetricBanner.jsx'), 'utf8');
    expect(banner).not.toMatch(/you can keep logging/i);
    expect(banner).toMatch(/logged trackers stay adjustable/);
  });
});
