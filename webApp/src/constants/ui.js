import { Strings } from './strings';

/**
 * TABAK++ UI & Branding Constants
 * Standardized design tokens for consistent high-fidelity presentation.
 */

export const BRAND = {
  NAME: Strings.BRAND_NAME,
  SUFFIX: Strings.BRAND_SUFFIX,
  SUB_LABEL: Strings.BRAND_SUB_LABEL,
  VERSION: "1.0"
};

export const ACCENTS = [
  { n: 'Cobalt', v: '#3B82F6' },
  { n: 'Emerald', v: '#10B981' },
  { n: 'Amber', v: '#FBBF24' },
  { n: 'Violet', v: '#8B5CF6' },
  { n: 'Cyan', v: '#06B6D4' },
  { n: 'Rose', v: '#F43F5E' }
];

export const SCALING_OPTIONS = ['SMALL', 'MEDIUM', 'LARGE'];

export const COUNTER_TYPES = [
  { id: 'CIGARETTE', label: Strings.CIGARETTE },
  { id: 'RYO_ROLL', label: Strings.RYO },
  { id: 'SIMPLE', label: Strings.CUSTOM }
];
