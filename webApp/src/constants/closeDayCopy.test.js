import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_DAY_CONFIRM_MESSAGE } from './ui';

/**
 * Audit 2026-11-12 TABAK-001: every tracker stays loggable after "Close day"
 * (an unstamped tracker is stamped on its first late tap), so the copy says
 * logging continues, identically on web and Android, and no longer points to
 * a manual entry.
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
  it('says every tracker stays loggable and totals follow', () => {
    expect(CLOSE_DAY_CONFIRM_MESSAGE).toMatch(/log any tracker today/);
    expect(CLOSE_DAY_CONFIRM_MESSAGE).toMatch(/totals update/);
    expect(CLOSE_DAY_CONFIRM_MESSAGE).not.toMatch(/manual entry|already logged/i);
  });

  it('matches the Android TrackScreen copy exactly', () => {
    expect(kotlinConstant()).toBe(CLOSE_DAY_CONFIRM_MESSAGE);
  });

  it('the Close-day button hint says logging stays open', () => {
    const banner = fs.readFileSync(path.join(here, '../components/dashboard/MetricBanner.jsx'), 'utf8');
    expect(banner).toMatch(/logging stays open/);
    expect(banner).not.toMatch(/logged trackers stay adjustable/);
  });
});
