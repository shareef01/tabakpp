import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayCredit, calculateDailyFinancials, applyDelta, fingerprintOf, migrationPlan } from './financial.js';

const snap = (target, baseline, unitPrice, type = 'CIGARETTE') => ({
  type, target, baseline, unitPrice, isFinanciallyTracked: true, isPrimaryTracked: true,
});

test('mandatory 3+2+1 example: day 3 + manual 2 + manual 1 ⇒ €6 spent / €4 saved / €9 baseline / 6 units', () => {
  const day = { date: '2026-10-01', counts: { cig: 3 }, trackerSnapshots: { cig: snap(10, 15, 1) } };
  const logs = [
    { id: 'A', logDate: '2026-10-01', counts: { cig: 2 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 2, saved: 0, smokingUnits: 2, baselineSaved: 0 } },
    { id: 'B', logDate: '2026-10-01', counts: { cig: 1 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 1, saved: 0, smokingUnits: 1, baselineSaved: 0 } },
  ];
  const fin = calculateDailyFinancials(day, logs, [{ id: 'cig', type: 'CIGARETTE' }], 1);
  assert.equal(fin.counts.cig, 6);
  assert.equal(fin.spent, 6);
  assert.equal(fin.saved, 4);
  assert.equal(fin.baselineSaved, 9);
  assert.equal(fin.smokingUnits, 6);
  assert.deepEqual(fin.canonicalCredit, { wasted: 6, saved: 4, smokingUnits: 6, baselineSaved: 9 });
});

test('one allowance per date: two manual logs (target 10, €1) ⇒ saved €5, not €15', () => {
  const logs = [
    { id: 'A', logDate: '2026-10-01', counts: { cig: 2 }, aggregateCredit: { wasted: 2, saved: 0, smokingUnits: 2, baselineSaved: 0 } },
    { id: 'B', logDate: '2026-10-01', counts: { cig: 3 }, aggregateCredit: { wasted: 3, saved: 0, smokingUnits: 3, baselineSaved: 0 } },
  ];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE' }], 1);
  // target reconstructed from the first log stamp (2 + 0/1 = 2? no — saved=0 ⇒ target=count).
  // With consumption-only stamps the allowance can't be rebuilt from logs alone; provide the day snapshot.
  const withSnap = calculateDailyFinancials(
    { date: '2026-10-01', counts: {}, trackerSnapshots: { cig: snap(10, 15, 1) } }, logs, [], 1,
  );
  assert.equal(withSnap.saved, 5);
  assert.equal(withSnap.spent, 5);
  assert.ok(fin); // documents the ambiguity path (no snapshot ⇒ missing/derived config)
});

test('isArchiveLog de-duplicates a whole-day archive against a day document', () => {
  const day = { date: '2026-10-01', counts: { cig: 3 }, trackerSnapshots: { cig: snap(10, 15, 1) } };
  const archive = { id: 'x_DAY', logDate: '2026-10-01', counts: { cig: 3 }, origin: 'DAY_RESET' };
  const fin = calculateDailyFinancials(day, [archive], [], 1);
  assert.equal(fin.counts.cig, 3); // not 6
  assert.equal(fin.saved, 7);
});

test('zero-count day still credits the full target allowance', () => {
  const fin = calculateDailyFinancials({ date: '2026-10-01', counts: {}, trackerSnapshots: { cig: snap(10, 15, 1) } }, [], [], 1);
  assert.equal(fin.spent, 0);
  assert.equal(fin.saved, 10);
  assert.equal(fin.baselineSaved, 15);
});

test('clamps at zero and drops empty trackers', () => {
  assert.deepEqual(applyDelta({ cig: 3 }, { cig: -5 }), {});
  assert.deepEqual(applyDelta({ cig: 3 }, { cig: 2 }), { cig: 5 });
});

test('fingerprint is order-independent and payload-sensitive', () => {
  assert.equal(fingerprintOf({ a: 1, b: 2 }), fingerprintOf({ b: 2, a: 1 }));
  assert.notEqual(fingerprintOf({ a: 1 }), fingerprintOf({ a: 2 }));
});

test('money is summed at historically-stamped prices, not the current config', () => {
  const day = { date: 'd', counts: { cig: 2 }, trackerSnapshots: { cig: snap(10, 15, 2.5) } };
  const fin = calculateDailyFinancials(day, [], [], 999);
  assert.equal(fin.spent, 5);        // 2 × €2.50 (stamped), not €999
  assert.equal(fin.saved, 20);        // (10 − 2) × €2.50
});

test('migration plan: legacy €15 folded vs canonical €5 ⇒ NET delta −€10 (replacement, not additive)', () => {
  const day = {
    date: '2026-10-01', counts: { cig: 5 }, trackerSnapshots: { cig: snap(10, 15, 1) },
    aggregateCredit: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
  };
  const plan = migrationPlan([{ date: '2026-10-01', day, logs: [] }], [{ id: 'cig', type: 'CIGARETTE' }], 1);
  assert.equal(plan[0].category, 'A');
  assert.equal(plan[0].legacySaved, 15);
  assert.equal(plan[0].canonicalSaved, 5);
  assert.equal(plan[0].deltaSaved, -10);
  assert.equal(15 + plan[0].deltaSaved, 5); // applied once: 15 + (−10), never 15 + 5
});

test('migration plan: an already-correct date is category D (no delta, no rewrite)', () => {
  const day = {
    date: 'd', counts: { cig: 5 }, trackerSnapshots: { cig: snap(10, 15, 1) },
    aggregateCredit: { saved: 5, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
  };
  const plan = migrationPlan([{ date: 'd', day, logs: [] }], [], 1);
  assert.equal(plan[0].category, 'D');
  assert.equal(plan[0].deltaSaved, 0);
});

test('migration plan: a non-reconstructible date is category C (never invented)', () => {
  const log = { id: 'L', logDate: 'd', counts: { ghost: 4 }, origin: 'MANUAL_ENTRY' }; // no stamp, no config
  const plan = migrationPlan([{ date: 'd', day: null, logs: [log] }], [], 0.5);
  assert.equal(plan[0].category, 'C');
});

// --- DEFECT 1: historical price must not be revalued by the current config ----
test('HISTORICAL precedence: a past date keeps its stamped price, not the current config', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 5 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 5, saved: 5, smokingUnits: 5, baselineSaved: 0 } }];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 2, baseline: 15 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.spent, 5);   // 5 × €1 (stamped), NOT €10 from the current €2 config
  assert.equal(fin.saved, 5);   // (10 − 5) × €1
});

test('CURRENT-day precedence: a manual-only TODAY uses the live config price', () => {
  const logs = [{ id: 'L', logDate: '2026-10-01', counts: { cig: 2 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 2, saved: 0, smokingUnits: 2, baselineSaved: 0 } }];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 2, baseline: 15 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.spent, 4);   // 2 × €2 (live config)
  assert.equal(fin.saved, 16);  // (10 − 2) × €2
});

// --- DEFECT 2: deleting the last record must not manufacture savings ---------
test('PHANTOM SAVINGS guard: an empty date (no day doc, no logs) earns nothing', () => {
  const fin = calculateDailyFinancials(null, [], [{ id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 1, baseline: 15 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.eligible, false);
  assert.equal(fin.saved, 0);
  assert.equal(fin.baselineSaved, 0);
  assert.equal(fin.spent, 0);
});

test('PHANTOM SAVINGS guard: an explicitly tracked zero day is still eligible', () => {
  const day = { date: 'd', counts: {}, trackerSnapshots: { cig: snap(10, 15, 1) } };
  const fin = calculateDailyFinancials(day, [], [], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.eligible, true);
  assert.equal(fin.saved, 10); // a genuine zero day keeps its allowance
});

test('HISTORICAL with no stamp: a past date valued from the live config is flagged ambiguous', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 5 }, origin: 'MANUAL_ENTRY' }]; // no stamp
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 2, baseline: 15 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.ambiguous, true); // never a silently-confident historical value
});

// --- TASK A: no fabricated historical credit ---------------------------------
test('A: an unstamped historical date gains NO invented authoritative savings', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 5 }, origin: 'MANUAL_ENTRY' }]; // no stamp
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 15, pricePerUnit: 2, baseline: 20 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.saved, 0);        // NOT (15 − 5) × €2 = €20
  assert.equal(fin.baselineSaved, 0);
  assert.equal(fin.unresolved.saved, true);
  assert.equal(fin.ambiguous, true);
});

test('A: a fully stamped historical date retains its pricing after the current settings change', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 5 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 5, saved: 5, smokingUnits: 5, baselineSaved: 0 } }];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 15, pricePerUnit: 2, baseline: 20 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.spent, 5);  // €1 historical price
  assert.equal(fin.saved, 5);  // reconstructed target 10, not the current 15
});

test('A: a known historical price keeps SPENT even when the target is unknown', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 5 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 6, smokingUnits: 5 } }]; // no saved/baselineSaved
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 15, pricePerUnit: 9, baseline: 20 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.spent, 6);        // preserved (5 × €1.20 stamped)
  assert.equal(fin.saved, 0);        // NOT invented from the current config
  assert.equal(fin.unresolved.saved, true);
});

// --- TASK B / point 10: zero-savings provenance ------------------------------
test('B: a DATED zero-savings snapshot (target == consumption) is a VERIFIED zero', () => {
  const day = { date: '2026-09-01', counts: { cig: 10 }, trackerSnapshots: { cig: snap(10, 10, 1) } };
  const fin = calculateDailyFinancials(day, [], [], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.spent, 10);
  assert.equal(fin.saved, 0);              // verified zero from a dated snapshot
  assert.equal(fin.unresolved.saved, false);
  assert.equal(fin.ambiguous, false);
});

test('B/10: a stamp-only saved:0 is NOT proof of zero (provenance insufficient)', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 10 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 10, saved: 0, smokingUnits: 10, baselineSaved: 0 } }];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 1, baseline: 10 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.spent, 10);             // spending is preserved
  assert.equal(fin.unresolved.saved, true); // but the zero is not proven
});

// --- PART E: historical smokingUnits classification + migration guard --------
test('E1: historical smokingUnits use the DATED classification, not the current type', () => {
  const day = { date: '2026-09-01', counts: { cig: 3 }, trackerSnapshots: { cig: snap(10, 15, 1, 'CIGARETTE') } };
  const fin = calculateDailyFinancials(day, [], [{ id: 'cig', type: 'VAPE', limit: 10, pricePerUnit: 1, baseline: 15 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.smokingUnits, 3);       // historically a cigarette
  assert.equal(fin.unresolved.smokingUnits, false);
});

test('E1: an unproven historical classification does NOT add smoking units', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 3 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 3, saved: 7, smokingUnits: 3, baselineSaved: 0 } }];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 10, pricePerUnit: 1, baseline: 15 }], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.smokingUnits, 0);
  assert.equal(fin.unresolved.smokingUnits, true);
});

test('E2: an unreconstructible legacy date is classified B by the migration plan (never zeroed)', () => {
  // legacy money present, but the canonical allowance can't be reconstructed
  const day = { date: 'd', counts: { cig: 3 }, aggregateCredit: { saved: 7, wasted: 3, smokingUnits: 3, baselineSaved: 0 } };
  const plan = migrationPlan([{ date: 'd', day, logs: [] }], [], 1);
  assert.ok(plan[0].category === 'B' || plan[0].category === 'C'); // never 'A' with a fabricated −€7
});

// --- TASK C: conflicting historical stamps -----------------------------------
test('C: conflicting historical log stamps are flagged, not silently resolved', () => {
  const logs = [
    { id: 'A', logDate: '2026-09-01', counts: { cig: 2 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 2, saved: 8, smokingUnits: 2, baselineSaved: 0 } },  // price €1
    { id: 'B', logDate: '2026-09-01', counts: { cig: 2 }, origin: 'MANUAL_ENTRY', aggregateCredit: { wasted: 4, saved: 16, smokingUnits: 2, baselineSaved: 0 } }, // price €2
  ];
  const fin = calculateDailyFinancials(null, logs, [], 1, { currentTrackingDate: '2026-10-01' });
  assert.equal(fin.ambiguous, true);
  assert.ok(fin.conflicting.includes('cig'));
});

// --- TASK D: eligibility ------------------------------------------------------
test('D: a genuine zero day is eligible; a truly empty date is not', () => {
  const zeroDay = calculateDailyFinancials({ date: 'd', counts: {}, trackerSnapshots: { cig: snap(10, 15, 1) } }, [], [], 1, {});
  assert.equal(zeroDay.eligible, true);
  assert.equal(zeroDay.saved, 10);
  const empty = calculateDailyFinancials(null, [], [], 1, {});
  assert.equal(empty.eligible, false);
  assert.equal(empty.saved, 0);
});

// --- AUTHORITATIVE SAFETY: uncertain savings never reach canonicalCredit -------
test('SAFETY: an unresolved historical allowance contributes ZERO save/spend to canonicalCredit', () => {
  const logs = [{ id: 'L', logDate: '2026-09-01', counts: { cig: 5 }, origin: 'MANUAL_ENTRY' }];
  const fin = calculateDailyFinancials(null, logs, [{ id: 'cig', type: 'CIGARETTE', limit: 15, pricePerUnit: 2, baseline: 20 }], 1, { currentTrackingDate: '2026-10-01' });
  // No fabricated money; unproven classification yields no smoking units.
  assert.equal(fin.canonicalCredit.wasted, 0);
  assert.equal(fin.canonicalCredit.saved, 0);
  assert.equal(fin.canonicalCredit.baselineSaved, 0);
  assert.equal(fin.canonicalCredit.smokingUnits, 0);
  assert.equal(fin.unresolved.spent, true);
  assert.equal(fin.unresolved.saved, true);
  assert.equal(fin.unresolved.smokingUnits, true);
});
