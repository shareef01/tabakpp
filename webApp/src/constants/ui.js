/**
 * TABAK++ UI & Branding Constants
 * Standardized design tokens for consistent high-fidelity presentation.
 */

/**
 * "Close tracking day?" confirmation copy. Must match the Android
 * CLOSE_DAY_CONFIRM_MESSAGE (composeApp/.../ui/screens/TrackScreen.kt).
 *
 * It used to promise "You can continue logging anytime today", but a closed
 * day's tracker snapshots are frozen by firestore.rules, so only trackers
 * already logged that day can still be adjusted; any other tracker is refused
 * with DAY_CLOSED_NO_SNAPSHOT (audit 2026-11-12 TABAK-001).
 */
export const CLOSE_DAY_CONFIRM_MESSAGE =
  "Your counts are already saved. Closing adds today to your lifetime totals now. "
  + "You can still adjust trackers you've already logged today; any other tracker needs a manual entry in History.";

export const BRAND = {
  NAME: "tabak",
  SUFFIX: "++",
  SUB_LABEL: "Registry",
  VERSION: "TITAN-ARCH-V1"
};

/**
 * Accent swatches — must stay in lock-step with the Kotlin AccentPalette in
 * composeApp/.../ui/screens/SettingsScreen.kt.
 *
 * The web list previously held six colors of its own, only three of which
 * overlapped Android's. That left the shipped default (#FF5F5F, UserProfile.accent)
 * absent from the picker, so a brand-new account showed "Custom" with nothing
 * selected and could never get back to the default from the web; and an accent
 * chosen on the phone rendered as an unselected "Custom" on the web.
 * All ten clear WCAG AA both as accent text on the card surface and as black
 * text on an accent fill (worst case #EC4899 at 5.54:1 / 5.95:1).
 */
export const ACCENTS = [
  { n: 'Signal red', v: '#FF5F5F' },
  { n: 'Amber', v: '#F59E0B' },
  { n: 'Yellow', v: '#FACC15' },
  { n: 'Emerald', v: '#10B981' },
  { n: 'Teal', v: '#14B8A6' },
  { n: 'Cyan', v: '#00D1FF' },
  { n: 'Cobalt', v: '#3B82F6' },
  { n: 'Violet', v: '#8B5CF6' },
  { n: 'Magenta', v: '#EC4899' },
  { n: 'Zinc', v: '#E4E4E7' }
];

export const SCALING_OPTIONS = ['SMALL', 'MEDIUM', 'LARGE'];

/**
 * The accent a brand-new account starts with (the UserProfile.accent default).
 * Single source of truth: index.css's `:root --accent`, its `--accent-rgb`
 * fallback, and App.jsx's pre-hydration/ensureUserDocument default are all
 * checked against this by src/theme.tokens.test.js.
 */
export const DEFAULT_ACCENT = ACCENTS[0].v;

export const COUNTER_TYPES = [
  { id: 'CIGARETTE', label: 'Cigarette' },
  { id: 'RYO_ROLL', label: 'RYO' },
  { id: 'SIMPLE', label: 'Custom' }
];
