/**
 * TABAK++ UI & Branding Constants
 * Standardized design tokens for consistent high-fidelity presentation.
 */

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

export const COUNTER_TYPES = [
  { id: 'CIGARETTE', label: 'Cigarette' },
  { id: 'RYO_ROLL', label: 'RYO' },
  { id: 'SIMPLE', label: 'Custom' }
];
