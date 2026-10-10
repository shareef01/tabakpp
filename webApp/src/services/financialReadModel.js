/**
 * Mode-aware financial read model (Part A).
 *
 * Decides which source OWNS a date's financial result so screens never blend
 * incompatible contributions (legacy day/log stamps + canonical ledger) and
 * never present an unknown amount as a verified zero.
 *
 *   LEGACY        → the legacy derivation owns the date (unchanged behaviour).
 *   OPTION_B      → `dailyFinancials/{date}.canonicalCredit` owns the date.
 *   MIGRATING     → per-date: a date WITH a ledger is canonical; a date WITHOUT
 *                   one is still LEGACY-owned (partial migration).
 *   missing ledger→ an OPTION_B date with source activity but no ledger is
 *                   UNAVAILABLE (never a silent legacy fallback, never zero).
 *
 * The Kotlin side mirrors this contract (`resolveDateFinancial`); the trusted
 * backend stays authoritative for persisted Option-B values.
 */
export const FinancialSource = {
  LEGACY: 'LEGACY_FINANCIAL_SOURCE',
  CANONICAL: 'OPTION_B_CANONICAL_SOURCE',
  MISSING_LEDGER: 'MISSING_CANONICAL_LEDGER',
  NO_ACTIVITY: 'NO_FINANCIAL_ACTIVITY',
};

const ZERO = { spent: 0, saved: 0, baselineSaved: 0, smokingUnits: 0 };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * @returns {{
 *   source: string, available: boolean,
 *   canonical: {spent,saved,baselineSaved,smokingUnits}|null,
 *   unresolved: {spent,saved,baselineSaved,smokingUnits}|null,
 *   ambiguous: boolean, eligible: boolean
 * }}
 */
export function resolveDateFinancial({ financialMode = 'LEGACY', ledger = null, hasSourceActivity = false } = {}) {
  const mode = financialMode || 'LEGACY';

  if (mode === 'LEGACY') {
    return { source: FinancialSource.LEGACY, available: false, canonical: null, unresolved: null, ambiguous: false, eligible: true };
  }

  if (ledger && ledger.canonicalCredit) {
    const u = ledger.unresolvedComponents || {};
    const unresolved = {
      spent: !!u.spent, saved: !!u.saved, baselineSaved: !!u.baselineSaved, smokingUnits: !!u.smokingUnits,
    };
    return {
      source: FinancialSource.CANONICAL,
      available: true,
      canonical: {
        spent: num(ledger.canonicalCredit.wasted),
        saved: num(ledger.canonicalCredit.saved),
        baselineSaved: num(ledger.canonicalCredit.baselineSaved),
        smokingUnits: num(ledger.canonicalCredit.smokingUnits),
      },
      unresolved,
      ambiguous: !!ledger.ambiguous || Object.values(unresolved).some(Boolean),
      eligible: ledger.eligible !== false,
    };
  }

  // No ledger for this date.
  if (mode === 'MIGRATING') {
    // Not yet migrated → still legacy-owned (partial migration is expected).
    return { source: FinancialSource.LEGACY, available: false, canonical: null, unresolved: null, ambiguous: false, eligible: true };
  }

  // OPTION_B with no ledger.
  if (hasSourceActivity) {
    return { source: FinancialSource.MISSING_LEDGER, available: false, canonical: null, unresolved: null, ambiguous: true, eligible: true };
  }
  return { source: FinancialSource.NO_ACTIVITY, available: true, canonical: { ...ZERO }, unresolved: null, ambiguous: false, eligible: false };
}

/**
 * Completeness-aware aggregation. Only independently-known components are
 * summed; any unknown component makes `complete = false` and the corresponding
 * subtotal is reported as `partial` rather than an unqualified total.
 */
export function aggregateFinancials(resolutions = []) {
  let spent = 0; let saved = 0; let baselineSaved = 0; let smokingUnits = 0;
  let complete = true; let unavailableDates = 0; let unresolvedDates = 0;
  const known = { spent: true, saved: true, baselineSaved: true, smokingUnits: true };

  for (const r of resolutions) {
    if (!r.available) { complete = false; unavailableDates += 1; continue; }
    const u = r.unresolved || {};
    if (u.spent) { known.spent = false; complete = false; } else spent += r.canonical.spent;
    if (u.saved) { known.saved = false; complete = false; } else saved += r.canonical.saved;
    if (u.baselineSaved) { known.baselineSaved = false; complete = false; } else baselineSaved += r.canonical.baselineSaved;
    if (u.smokingUnits) { known.smokingUnits = false; complete = false; } else smokingUnits += r.canonical.smokingUnits;
    if (Object.values(u).some(Boolean)) unresolvedDates += 1;
  }
  return { spent, saved, baselineSaved, smokingUnits, complete, unavailableDates, unresolvedDates, known };
}

/**
 * Presentation contract (Part B): a known value formats as a number; an unknown
 * one must NOT render as a confident €0.00.
 */
export function presentFinancial(value, unresolved, formatMoney) {
  if (unresolved) return { text: 'Unknown', unresolved: true };
  const n = num(value);
  return { text: formatMoney ? formatMoney(n) : String(n), unresolved: false };
}
