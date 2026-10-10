import { describe, expect, it } from 'vitest';
import {
  FinancialSource, resolveDateFinancial, aggregateFinancials, presentFinancial,
} from './financialReadModel';

const ledger = (over = {}) => ({
  date: '2026-10-01',
  canonicalCredit: { wasted: 6, saved: 4, smokingUnits: 6, baselineSaved: 9 },
  ledgerSchemaVersion: 2,
  eligible: true,
  unresolvedComponents: { spent: false, saved: false, baselineSaved: false, smokingUnits: false },
  ambiguous: false,
  ...over,
});

describe('resolveDateFinancial — ownership', () => {
  it('LEGACY: the legacy derivation owns the date (unchanged)', () => {
    const r = resolveDateFinancial({ financialMode: 'LEGACY', ledger: null });
    expect(r.source).toBe(FinancialSource.LEGACY);
    expect(r.available).toBe(false);
  });

  it('OPTION_B + ledger: the canonical ledger owns the date', () => {
    const r = resolveDateFinancial({ financialMode: 'OPTION_B', ledger: ledger() });
    expect(r.source).toBe(FinancialSource.CANONICAL);
    expect(r.canonical).toEqual({ spent: 6, saved: 4, baselineSaved: 9, smokingUnits: 6 });
    expect(r.ambiguous).toBe(false);
  });

  it('Scenario H — OPTION_B, source activity, MISSING ledger ⇒ UNAVAILABLE (not zero, not legacy)', () => {
    const r = resolveDateFinancial({ financialMode: 'OPTION_B', ledger: null, hasSourceActivity: true });
    expect(r.source).toBe(FinancialSource.MISSING_LEDGER);
    expect(r.available).toBe(false);
    expect(r.canonical).toBeNull();
  });

  it('OPTION_B, no activity, no ledger ⇒ a genuine (eligible-scope) empty date', () => {
    const r = resolveDateFinancial({ financialMode: 'OPTION_B', ledger: null, hasSourceActivity: false });
    expect(r.source).toBe(FinancialSource.NO_ACTIVITY);
    expect(r.canonical).toEqual({ spent: 0, saved: 0, baselineSaved: 0, smokingUnits: 0 });
  });

  it('Scenario G — MIGRATING: a date WITH a ledger is canonical; one WITHOUT is still legacy', () => {
    expect(resolveDateFinancial({ financialMode: 'MIGRATING', ledger: ledger() }).source).toBe(FinancialSource.CANONICAL);
    expect(resolveDateFinancial({ financialMode: 'MIGRATING', ledger: null, hasSourceActivity: true }).source).toBe(FinancialSource.LEGACY);
  });

  it('Scenario A — unresolved savings: known spend kept, savings flagged unknown', () => {
    const r = resolveDateFinancial({
      financialMode: 'OPTION_B',
      ledger: ledger({
        canonicalCredit: { wasted: 6, saved: 0, smokingUnits: 6, baselineSaved: 0 },
        unresolvedComponents: { spent: false, saved: true, baselineSaved: true, smokingUnits: false },
        ambiguous: true,
      }),
    });
    expect(r.canonical.spent).toBe(6);
    expect(r.unresolved.saved).toBe(true);
    expect(r.ambiguous).toBe(true);
  });
});

describe('aggregateFinancials — completeness-aware totals', () => {
  it('sums a fully-known canonical date once', () => {
    const a = aggregateFinancials([resolveDateFinancial({ financialMode: 'OPTION_B', ledger: ledger() })]);
    expect(a).toMatchObject({ spent: 6, saved: 4, baselineSaved: 9, smokingUnits: 6, complete: true });
  });

  it('a partial date makes the total incomplete and is not counted twice', () => {
    const known = resolveDateFinancial({ financialMode: 'OPTION_B', ledger: ledger() });
    const partial = resolveDateFinancial({
      financialMode: 'OPTION_B',
      ledger: ledger({
        canonicalCredit: { wasted: 6, saved: 0, smokingUnits: 6, baselineSaved: 0 },
        unresolvedComponents: { spent: false, saved: true, baselineSaved: true, smokingUnits: false },
      }),
    });
    const a = aggregateFinancials([known, partial]);
    expect(a.complete).toBe(false);
    expect(a.spent).toBe(12); // spending is known for both
    expect(a.saved).toBe(4);  // only the known date's savings are summed
    expect(a.unresolvedDates).toBe(1);
  });

  it('Scenario H — an unavailable date blocks completeness (never treated as zero)', () => {
    const a = aggregateFinancials([resolveDateFinancial({ financialMode: 'OPTION_B', ledger: null, hasSourceActivity: true })]);
    expect(a.complete).toBe(false);
    expect(a.unavailableDates).toBe(1);
  });
});

describe('presentFinancial — never show unknown as a confident zero', () => {
  const money = (n) => `€${n.toFixed(2)}`;
  it('a known zero renders as a zero amount', () => {
    expect(presentFinancial(0, false, money).text).toBe('€0.00');
  });
  it('an unresolved value renders as Unknown', () => {
    expect(presentFinancial(0, true, money)).toEqual({ text: 'Unknown', unresolved: true });
  });
});
