/**
 * End-to-end emulator integration test for the trusted financial boundary.
 *
 * Requires: `firebase emulators:start --only functions,firestore,auth`.
 * Run: `node emulator.integration.mjs` from `functions/`.
 *
 * Proves the success criterion: an authenticated callable invocation makes the
 * backend validate, recompute the canonical credit, and persist source + ledger
 * + lifetime + receipt atomically — and that a direct client write is denied.
 */
import assert from 'node:assert/strict';
import fbAdmin from 'firebase-admin';

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-takabpp-test';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake';
const CALL = `http://127.0.0.1:5001/${PROJECT}/europe-west1/executeFinancialOperation`;

const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const toFs = (v) => {
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
};
const fromFs = (f) => {
  if (!f) return undefined;
  if ('doubleValue' in f) return f.doubleValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('stringValue' in f) return f.stringValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]));
  return undefined;
};
const readDoc = async (path) => {
  const r = await fetch(`${FS}/${path}`, { headers: owner });
  if (r.status === 404) return null;
  const j = await r.json();
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, x]) => [k, fromFs(x)]));
};
const writeDoc = async (path, fields, upsert = false) => {
  const query = upsert ? '' : '?currentDocument.exists=false';
  const r = await fetch(`${FS}/${path}${query}`, {
    method: 'PATCH', headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toFs(v)])) }),
  });
  assert.ok(r.ok, `seed ${path} failed: ${r.status}`);
};

const call = async (token, data, name = 'executeFinancialOperation') => {
  const url = `http://127.0.0.1:5001/${PROJECT}/europe-west1/${name}`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
  const j = await r.json();
  return { ok: r.ok && !j.error, status: r.status, body: j };
};

const signIn = async () => (await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
const seedOptionB = async (uid) => {
  await writeDoc(`users/${uid}`, { name: '', financialMode: 'OPTION_B', unitPrice: 1, lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 } });
  await writeDoc(`users/${uid}/configs/cig`, { name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1, isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15 });
};
// The server derives the tracking date from its clock (day-start 6, UTC).
const _now = new Date();
if (_now.getUTCHours() < 6) _now.setUTCDate(_now.getUTCDate() - 1);
const TODAY = _now.toISOString().slice(0, 10);

const main = async () => {
  const a = await (await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  const uid = a.localId; const token = a.idToken;
  assert.ok(uid && token, 'anonymous sign-in failed');

  await writeDoc(`users/${uid}`, {
    name: '', financialMode: 'OPTION_B',
    lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 },
    unitPrice: 1,
  });
  await writeDoc(`users/${uid}/configs/cig`, {
    name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1,
    isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15,
  });

  // 1) MANUAL_CREATE 2 units → canonical saved (10−2)×€1 = €8
  let r = await call(token, { operationId: 'op1', type: 'MANUAL_CREATE', date: TODAY, logId: 'L1', counts: { cig: 2 }, defaultUnitPrice: 1 });
  assert.ok(r.ok, `create failed: ${JSON.stringify(r.body)}`);
  assert.ok(await readDoc(`users/${uid}/logs/L1`), 'source log not written');
  let led = await readDoc(`users/${uid}/dailyFinancials/${TODAY}`);
  assert.equal(led.countsByTracker.cig, 2);
  assert.equal(led.canonicalCredit.saved, 8);
  assert.ok(await readDoc(`users/${uid}/trustedOperations/op1`), 'receipt not written');

  // 2) MANUAL_CREATE 1 unit → ledger counts 3, saved €7
  r = await call(token, { operationId: 'op2', type: 'MANUAL_CREATE', date: TODAY, logId: 'L2', counts: { cig: 1 }, defaultUnitPrice: 1 });
  assert.ok(r.ok);
  led = await readDoc(`users/${uid}/dailyFinancials/${TODAY}`);
  assert.equal(led.countsByTracker.cig, 3);
  assert.equal(led.canonicalCredit.saved, 7);

  // 3) IDEMPOTENT retry of op2 (same payload) → applied:false, ledger unchanged
  r = await call(token, { operationId: 'op2', type: 'MANUAL_CREATE', date: TODAY, logId: 'L2', counts: { cig: 1 }, defaultUnitPrice: 1 });
  assert.ok(r.ok && r.body.result.applied === false, 'retry must be idempotent');
  led = await readDoc(`users/${uid}/dailyFinancials/${TODAY}`);
  assert.equal(led.countsByTracker.cig, 3, 'idempotent retry must not double');

  // 4) Reusing op id with a DIFFERENT payload → rejected
  r = await call(token, { operationId: 'op2', type: 'MANUAL_CREATE', date: TODAY, logId: 'L3', counts: { cig: 9 }, defaultUnitPrice: 1 });
  assert.ok(!r.ok, 'conflicting payload must be rejected');

  // 5) DAY_CLOSE folds the canonical credit into lifetime exactly once
  r = await call(token, { operationId: 'op3', type: 'DAY_CLOSE', date: TODAY, defaultUnitPrice: 1 });
  assert.ok(r.ok, `close failed: ${JSON.stringify(r.body)}`);
  const prof = await readDoc(`users/${uid}`);
  assert.equal(prof.lifetimeAggregates.saved, 7);
  assert.equal((await readDoc(`users/${uid}/dailyFinancials/${TODAY}`)).foldedIntoLifetime, true);
  // closing again must not re-credit
  r = await call(token, { operationId: 'op4', type: 'DAY_CLOSE', date: TODAY, defaultUnitPrice: 1 });
  assert.ok(r.ok);
  assert.equal((await readDoc(`users/${uid}`)).lifetimeAggregates.saved, 7);

  // 6) A LEGACY account cannot use the trusted writer
  const b = await (await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  await writeDoc(`users/${b.localId}`, { name: '', lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 } });
  r = await call(b.idToken, { operationId: 'x1', type: 'MANUAL_CREATE', date: TODAY, logId: 'L1', counts: { cig: 1 } });
  assert.ok(!r.ok, 'non-OPTION_B account must be rejected by the writer');

  // 6b) AUD-016: a FORGED LEGACY-gateway receipt must not buy a trusted response.
  // The receipt lives in the client-writable `financialOperations` namespace and
  // carries a fingerprint that exactly matches the request below — pre-fix, the
  // dedupe path returned the forged `result` without any mode check.
  const { fingerprintOf } = await import('./financial.js');
  const forgedFp = fingerprintOf({ type: 'MANUAL_CREATE', date: TODAY, trackerId: undefined, logId: 'L1', counts: { cig: 1 }, delta: undefined });
  await writeDoc(`users/${b.localId}/financialOperations/x1`, {
    operationId: 'x1', operationType: 'createManualLog', sourceDocumentPath: `users/${b.localId}/logs/L1`,
    trackingDate: TODAY, payloadFingerprint: forgedFp, resultStatus: 'OK',
    result: { canonicalCredit: { saved: 999999, wasted: 0, smokingUnits: 0, baselineSaved: 0 }, counts: {} },
    createdAt: new Date().toISOString(),
  });
  r = await call(b.idToken, { operationId: 'x1', type: 'MANUAL_CREATE', date: TODAY, logId: 'L1', counts: { cig: 1 } });
  assert.ok(!r.ok, `forged legacy receipt must not produce a trusted response: ${JSON.stringify(r.body)}`);
  // A rejected call must mutate NOTHING: no source document, no ledger/day doc,
  // no lifetime aggregates, and no trusted receipt in either namespace.
  assert.equal(await readDoc(`users/${b.localId}/logs/L1`), null, 'no source mutation may occur for a rejected call');
  assert.equal(await readDoc(`users/${b.localId}/days/${TODAY}`), null, 'no ledger/day mutation may occur for a rejected call');
  assert.equal(await readDoc(`users/${b.localId}/dailyFinancials/${TODAY}`), null, 'no trusted-ledger mutation may occur for a rejected call');
  assert.equal((await readDoc(`users/${b.localId}`)).lifetimeAggregates.saved, 0, 'lifetime aggregates must be untouched by a rejected call');
  assert.equal(await readDoc(`users/${b.localId}/trustedOperations/x1`), null, 'no trusted receipt may be created from a forged one');

  // 6c) AUD-016: MIGRATING accounts are equally locked out — replay included.
  const mg = await (await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  await writeDoc(`users/${mg.localId}`, { name: '', financialMode: 'MIGRATING', lifetimeAggregates: { saved: 0, wasted: 0, smokingUnits: 0, baselineSaved: 0 } });
  await writeDoc(`users/${mg.localId}/financialOperations/mg1`, {
    operationId: 'mg1', operationType: 'adjustCounter', trackingDate: TODAY,
    payloadFingerprint: forgedFp, resultStatus: 'OK', createdAt: new Date().toISOString(),
  });
  r = await call(mg.idToken, { operationId: 'mg1', type: 'MANUAL_CREATE', date: TODAY, logId: 'L1', counts: { cig: 1 } });
  assert.ok(!r.ok, 'MIGRATING account must be rejected even with a planted receipt');
  assert.equal((await readDoc(`users/${mg.localId}`)).lifetimeAggregates.saved, 0, 'MIGRATING rejection must not touch lifetime aggregates');
  assert.equal(await readDoc(`users/${mg.localId}/trustedOperations/mg1`), null, 'MIGRATING rejection must not create a trusted receipt');

  // 6d) AUD-016: concurrent requests with the same operationId apply exactly once.
  const cc = await signIn();
  await seedOptionB(cc.localId);
  const [c1, c2] = await Promise.all([
    call(cc.idToken, { operationId: 'cc1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 }),
    call(cc.idToken, { operationId: 'cc1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 }),
  ]);
  assert.ok(c1.ok && c2.ok, `concurrent same-id calls must both succeed: ${JSON.stringify([c1.body, c2.body])}`);
  const appliedCount = [c1, c2].filter((x) => x.body.result?.applied === true).length;
  assert.equal(appliedCount, 1, 'exactly one of two concurrent same-id requests may apply');
  assert.equal((await readDoc(`users/${cc.localId}/days/${TODAY}`)).counts.cig, 1, 'counter applied exactly once');

  // 8) PHANTOM SAVINGS: deleting the only manual log must remove the day's credit.
  // A fresh OPTION_B account with no day document, so the date's only evidence
  // is the single log being deleted.
  const pc = await signIn();
  await seedOptionB(pc.localId);
  r = await call(pc.idToken, { operationId: 'p1', type: 'MANUAL_CREATE', date: TODAY, logId: 'P1', counts: { cig: 4 }, defaultUnitPrice: 1 });
  assert.ok(r.ok, `phantom create failed: ${JSON.stringify(r.body)}`);
  assert.equal((await readDoc(`users/${pc.localId}/dailyFinancials/${TODAY}`)).canonicalCredit.saved, 6);
  r = await call(pc.idToken, { operationId: 'p2', type: 'MANUAL_DELETE', date: TODAY, logId: 'P1', defaultUnitPrice: 1 });
  assert.ok(r.ok, `phantom delete failed: ${JSON.stringify(r.body)}`);
  assert.equal(await readDoc(`users/${pc.localId}/dailyFinancials/${TODAY}`), null, 'deleting the only log must not leave a phantom allowance');

  // 9) TASK A: a HISTORICAL backfill gains NO invented savings (unresolved)
  r = await call(token, { operationId: 'h1', type: 'MANUAL_CREATE', date: '2020-01-05', logId: 'H1', counts: { cig: 5 }, defaultUnitPrice: 1 });
  assert.ok(r.ok, `backfill failed: ${JSON.stringify(r.body)}`);
  const hl = await readDoc(`users/${uid}/dailyFinancials/2020-01-05`);
  assert.equal(hl.canonicalCredit.saved, 0, 'no invented historical savings');
  assert.equal(hl.canonicalCredit.wasted, 0, 'no invented historical spend');
  assert.equal(hl.unresolvedComponents.saved, true);
  assert.equal(hl.ambiguous, true);

  // 7) Phase-8 migration: legacy folded €15 → canonical €5, applied ONCE (never €20)
  const adminUser = await (await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json();
  fbAdmin.initializeApp({ projectId: PROJECT });
  await fbAdmin.auth().setCustomUserClaims(adminUser.localId, { admin: true });
  // Exchange the refresh token for a fresh idToken carrying the new claim.
  const tokRes = await (await fetch('http://127.0.0.1:9099/securetoken.googleapis.com/v1/token?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(adminUser.refreshToken)}`,
  })).json();
  const adminToken = tokRes.id_token || tokRes.access_token;
  const muid = adminUser.localId;
  assert.ok(adminToken && adminToken.split('.').length === 3, `admin token failed: ${JSON.stringify(tokRes)}`);
  await writeDoc(`users/${muid}`, { name: '', financialMode: 'LEGACY', unitPrice: 1, lifetimeAggregates: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 } });
  await writeDoc(`users/${muid}/configs/cig`, { name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1, isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15 });
  await writeDoc(`users/${muid}/days/${TODAY}`, {
    date: TODAY, counts: { cig: 5 }, status: 'closed', foldedIntoLifetime: true,
    trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true } },
    aggregateCredit: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
  });
  // AUD-016: plant a forged LEGACY-gateway receipt BEFORE migration. Post-fix
  // the callable consults only `trustedOperations`, so this receipt must be
  // ignored after cutover — the operation it names must still APPLY.
  const ignFp = fingerprintOf({ type: 'MANUAL_CREATE', date: '2026-01-09', trackerId: undefined, logId: 'IGN1', counts: { cig: 3 }, delta: undefined });
  await writeDoc(`users/${muid}/financialOperations/ign1`, {
    operationId: 'ign1', operationType: 'createManualLog', sourceDocumentPath: `users/${muid}/logs/IGN1`,
    trackingDate: '2026-01-09', payloadFingerprint: ignFp, resultStatus: 'OK',
    result: { canonicalCredit: { saved: 777, wasted: 0, smokingUnits: 0, baselineSaved: 0 }, counts: {} },
    createdAt: new Date().toISOString(),
  });

  let m = await call(adminToken, { targetUid: muid, dryRun: true }, 'migrateAccount');
  assert.ok(m.ok, `migrate dry-run failed: ${JSON.stringify(m.body)}`);

  m = await call(adminToken, { targetUid: muid, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok, `migrate failed: ${JSON.stringify(m.body)}`);
  assert.equal((await readDoc(`users/${muid}`)).financialMode, 'OPTION_B');
  assert.equal((await readDoc(`users/${muid}`)).lifetimeAggregates.saved, 5, 'must be 15−15+5=5, not 15+5=20');
  assert.equal((await readDoc(`users/${muid}/dailyFinancials/${TODAY}`)).canonicalCredit.saved, 5);

  // idempotent re-run: still €5, never €−5
  m = await call(adminToken, { targetUid: muid, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok);
  assert.equal((await readDoc(`users/${muid}`)).lifetimeAggregates.saved, 5, 'repeat migration must not re-apply the delta');

  // AUD-016: the pre-migration forged legacy receipt is IGNORED — the same
  // operationId now applies fresh and writes a trusted receipt; the legacy
  // receipt keeps its forged content and is never consulted again.
  r = await call(adminToken, { operationId: 'ign1', type: 'MANUAL_CREATE', date: '2026-01-09', logId: 'IGN1', counts: { cig: 3 } });
  assert.ok(r.ok && r.body.result.applied === true, `post-migration op must apply despite the planted legacy receipt: ${JSON.stringify(r.body)}`);
  assert.notEqual(r.body.result.result?.canonicalCredit?.saved, 777, 'the forged result must never be replayed');
  assert.ok(await readDoc(`users/${muid}/trustedOperations/ign1`), 'a trusted receipt must be written in the trusted namespace');
  const legacyIgn = await readDoc(`users/${muid}/financialOperations/ign1`);
  assert.equal(legacyIgn.result.canonicalCredit.saved, 777, 'the legacy receipt is left untouched (never rewritten by the callable)');

  // a non-admin cannot migrate
  const na = await call(token, { targetUid: muid, dryRun: true }, 'migrateAccount');
  assert.ok(!na.ok, 'migration must reject a non-operator');

  // 8) W1C — interruption / resume across dates.
  //    The pre-fix loop wrote EVERY ledger and then applied one combined
  //    `lifetimeAggregates` write afterwards, so a crash in between left a date
  //    marked `migratedFromLegacy` whose delta was never applied; a rerun skipped
  //    it by marker and silently lost the delta (reproduced: saved stayed 15
  //    instead of 5). The loop now commits each date's ledger AND its delta in
  //    ONE transaction, so a partially-migrated account resumes correctly.
  const _y = new Date(_now); _y.setUTCDate(_y.getUTCDate() - 1);
  const YDAY = _y.toISOString().slice(0, 10);
  const crashUser = await signIn();
  const cuid = crashUser.localId;
  const dayFixture = (date) => ({
    date, counts: { cig: 5 }, status: 'closed', foldedIntoLifetime: true,
    trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true } },
    aggregateCredit: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
  });
  await writeDoc(`users/${cuid}`, {
    name: '', financialMode: 'LEGACY', unitPrice: 1,
    // D1 + D2 legacy folded savings (15 each). After D1's date-unit ran the
    // total was already corrected to 30 − 10 = 20; D2 is still pending.
    lifetimeAggregates: { saved: 20, wasted: 10, smokingUnits: 10, baselineSaved: 0 },
  });
  await writeDoc(`users/${cuid}/configs/cig`, {
    name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1,
    isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15,
  });
  await writeDoc(`users/${cuid}/days/${YDAY}`, dayFixture(YDAY));
  await writeDoc(`users/${cuid}/days/${TODAY}`, dayFixture(TODAY));
  // D1 already migrated atomically (ledger + delta), so it must be skipped.
  await writeDoc(`users/${cuid}/dailyFinancials/${YDAY}`, {
    date: YDAY, countsByTracker: { cig: 5 },
    snapshots: { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true } },
    canonicalCredit: { saved: 5, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
    ledgerSchemaVersion: 2, foldedIntoLifetime: true, migratedFromLegacy: true,
  });

  m = await call(adminToken, { targetUid: cuid, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok, `interrupted resume failed: ${JSON.stringify(m.body)}`);
  const resumed = await readDoc(`users/${cuid}`);
  assert.equal(resumed.financialMode, 'OPTION_B');
  assert.equal(
    resumed.lifetimeAggregates.saved, 10,
    `resume must apply only the pending date's delta, keeping the migrated one (got ${resumed.lifetimeAggregates.saved}, expected 20 + (5 − 15) = 10)`,
  );
  // Re-running must not re-apply anything.
  m = await call(adminToken, { targetUid: cuid, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok);
  assert.equal((await readDoc(`users/${cuid}`)).lifetimeAggregates.saved, 10, 'repeat resume must be a no-op');

  // 9) W1C — concurrent migration workers on the same account must not
  //    double-apply any date's delta.
  const raceUser = await signIn();
  const ruid = raceUser.localId;
  await writeDoc(`users/${ruid}`, {
    name: '', financialMode: 'LEGACY', unitPrice: 1,
    lifetimeAggregates: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
  });
  await writeDoc(`users/${ruid}/configs/cig`, {
    name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1,
    isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15,
  });
  await writeDoc(`users/${ruid}/days/${TODAY}`, dayFixture(TODAY));

  const [r1, r2] = await Promise.all([
    call(adminToken, { targetUid: ruid, dryRun: false }, 'migrateAccount'),
    call(adminToken, { targetUid: ruid, dryRun: false }, 'migrateAccount'),
  ]);
  assert.ok(r1.ok && r2.ok, `concurrent migration failed: ${JSON.stringify([r1.body, r2.body])}`);
  const raced = await readDoc(`users/${ruid}`);
  assert.equal(
    raced.lifetimeAggregates.saved, 5,
    `concurrent workers must not double-apply the delta (got ${raced.lifetimeAggregates.saved}, expected 15 − 10 = 5)`,
  );

  // 9b) No MIGRATING dead end. A past closed day WITHOUT tracker snapshots can
  //     only be priced from today's config, so it classifies B (unresolved).
  //     Previously the account was frozen first and then HELD in MIGRATING —
  //     no client path (rules lock) and no trusted path (OPTION_B only).
  const unresolvedDay = (date) => ({
    date, counts: { cig: 5 }, status: 'closed', foldedIntoLifetime: true,
    aggregateCredit: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
  });
  const legacyProfile = { name: '', unitPrice: 1, lifetimeAggregates: { saved: 15, wasted: 5, smokingUnits: 5, baselineSaved: 0 } };
  const cigCfg = { name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1, isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15 };

  //   (i) LEGACY + B date → never frozen; nothing written; dates reported.
  const bUser = await signIn();
  await writeDoc(`users/${bUser.localId}`, { ...legacyProfile, financialMode: 'LEGACY' });
  await writeDoc(`users/${bUser.localId}/configs/cig`, cigCfg);
  await writeDoc(`users/${bUser.localId}/days/${YDAY}`, unresolvedDay(YDAY));
  m = await call(adminToken, { targetUid: bUser.localId, dryRun: true }, 'migrateAccount');
  assert.ok(m.ok && m.body.result.canCutOver === false, `dry run must flag the B date: ${JSON.stringify(m.body)}`);
  m = await call(adminToken, { targetUid: bUser.localId, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok, `B-date migration call failed: ${JSON.stringify(m.body)}`);
  assert.equal(m.body.result.started, false);
  assert.deepEqual(m.body.result.unresolved.map((u) => u.date), [YDAY]);
  const bProfile = await readDoc(`users/${bUser.localId}`);
  assert.equal(bProfile.financialMode, 'LEGACY', 'an account with unresolved dates must never be frozen');
  assert.equal(bProfile.lifetimeAggregates.saved, 15, 'nothing may be applied');
  assert.equal(await readDoc(`users/${bUser.localId}/dailyFinancials/${YDAY}`), null);

  //   (ii) Left MIGRATING by an older run, B date, NO applied marker → rolled
  //        back to LEGACY (safe: no delta was ever applied).
  const stuckUser = await signIn();
  await writeDoc(`users/${stuckUser.localId}`, { ...legacyProfile, financialMode: 'MIGRATING' });
  await writeDoc(`users/${stuckUser.localId}/configs/cig`, cigCfg);
  await writeDoc(`users/${stuckUser.localId}/days/${YDAY}`, unresolvedDay(YDAY));
  m = await call(adminToken, { targetUid: stuckUser.localId, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok && m.body.result.rolledBack === true, `stuck account must roll back: ${JSON.stringify(m.body)}`);
  const unstuck = await readDoc(`users/${stuckUser.localId}`);
  assert.equal(unstuck.financialMode, 'LEGACY');
  assert.equal(unstuck.lifetimeAggregates.saved, 15);

  //   (iii) MIGRATING with an already-applied date AND a B date → refuse loudly
  //         (rolling back would leave a migrated delta in LEGACY totals).
  const partUser = await signIn();
  await writeDoc(`users/${partUser.localId}`, { ...legacyProfile, financialMode: 'MIGRATING' });
  await writeDoc(`users/${partUser.localId}/configs/cig`, cigCfg);
  await writeDoc(`users/${partUser.localId}/days/${YDAY}`, unresolvedDay(YDAY));
  await writeDoc(`users/${partUser.localId}/days/${TODAY}`, dayFixture(TODAY));
  await writeDoc(`users/${partUser.localId}/dailyFinancials/${TODAY}`, {
    date: TODAY, countsByTracker: { cig: 5 }, canonicalCredit: { saved: 5, wasted: 5, smokingUnits: 5, baselineSaved: 0 },
    ledgerSchemaVersion: 2, foldedIntoLifetime: true, migratedFromLegacy: true,
  });
  m = await call(adminToken, { targetUid: partUser.localId, dryRun: false }, 'migrateAccount');
  assert.ok(!m.ok && m.body.error?.message === 'PARTIAL_MIGRATION_UNRESOLVED', `expected PARTIAL_MIGRATION_UNRESOLVED: ${JSON.stringify(m.body)}`);
  assert.equal((await readDoc(`users/${partUser.localId}`)).financialMode, 'MIGRATING');

  //   (iv) Rerunning on an OPTION_B account is a no-op — it is never
  //        downgraded to MIGRATING, even briefly.
  m = await call(adminToken, { targetUid: muid, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok && m.body.result.alreadyMigrated === true, `OPTION_B rerun must no-op: ${JSON.stringify(m.body)}`);
  assert.equal((await readDoc(`users/${muid}`)).financialMode, 'OPTION_B');

  // 10) HISTORICAL_DAY_UPDATE — recompute canonical credit + lifetime delta from
  //     the day's FROZEN snapshots (no fabrication from today's settings).
  r = await call(adminToken, { operationId: 'hist1', type: 'HISTORICAL_DAY_UPDATE', date: TODAY, counts: { cig: 2 } });
  assert.ok(r.ok, `HISTORICAL_DAY_UPDATE failed: ${JSON.stringify(r.body)}`);
  let histLed = await readDoc(`users/${muid}/dailyFinancials/${TODAY}`);
  assert.equal(histLed.countsByTracker.cig, 2, 'historical edit must update the ledger counts');
  assert.equal(histLed.canonicalCredit.saved, 8, '(10−2)×€1 = €8 saved');
  assert.equal(histLed.canonicalCredit.wasted, 2);
  const histAgg = await readDoc(`users/${muid}`);
  assert.equal(histAgg.lifetimeAggregates.saved, 8, 'saved must net-adjust 5 + (8−5)');
  assert.equal(histAgg.lifetimeAggregates.wasted, 2, 'wasted must net-adjust 5 + (2−5)');

  // 11) TRACKER_DELETE — delete the config + drop the tracker from the open day + ledger.
  const delUser = await signIn();
  const duid = delUser.localId;
  await seedOptionB(duid);
  r = await call(delUser.idToken, { operationId: 'delc1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1, defaultUnitPrice: 1 });
  assert.ok(r.ok, `seed increment failed: ${JSON.stringify(r.body)}`);
  assert.ok(await readDoc(`users/${duid}/configs/cig`), 'config should exist before delete');
  r = await call(delUser.idToken, { operationId: 'del1', type: 'TRACKER_DELETE', date: TODAY, trackerId: 'cig' });
  assert.ok(r.ok, `TRACKER_DELETE failed: ${JSON.stringify(r.body)}`);
  assert.equal(await readDoc(`users/${duid}/configs/cig`), null, 'config must be deleted');
  const delDay = await readDoc(`users/${duid}/days/${TODAY}`);
  assert.equal(delDay.counts.cig, undefined, 'tracker must be dropped from the day counts');
  const delLed = await readDoc(`users/${duid}/dailyFinancials/${TODAY}`);
  assert.equal(delLed.countsByTracker.cig, undefined, 'tracker must be dropped from the ledger counts');

  // 11b) currentTrackingDate — the client's local "today" (the server has no
  //      timezone for the user). A plausible date is used; one that is not
  //      "today" anywhere on Earth is rejected; it is not part of the
  //      operation's identity, so a retry that crosses midnight is still the
  //      same operation (no OPERATION_CONFLICT).
  const tzUser = await signIn();
  await seedOptionB(tzUser.localId);
  r = await call(tzUser.idToken, { operationId: 'tz1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', currentTrackingDate: TODAY });
  assert.ok(r.ok, `a plausible currentTrackingDate must be accepted: ${JSON.stringify(r.body)}`);
  const far = new Date(`${TODAY}T00:00:00Z`); far.setUTCDate(far.getUTCDate() - 5);
  r = await call(tzUser.idToken, { operationId: 'tz2', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', currentTrackingDate: far.toISOString().slice(0, 10) });
  assert.ok(!r.ok && r.body.error?.message === 'IMPLAUSIBLE_CURRENT_TRACKING_DATE', `implausible date must be rejected: ${JSON.stringify(r.body)}`);
  r = await call(tzUser.idToken, { operationId: 'tz1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', currentTrackingDate: YDAY });
  assert.ok(r.ok && r.body.result.applied === false, `a retry with a different currentTrackingDate must be the same operation: ${JSON.stringify(r.body)}`);
  assert.equal((await readDoc(`users/${tzUser.localId}/days/${TODAY}`)).counts.cig, 1, 'applied exactly once');

  // 12) deleteAccountData — a locked (OPTION_B) account cannot client-wipe, so
  //     the trusted function deletes the caller's whole users/{uid} tree.
  const goneUser = await signIn();
  const guid = goneUser.localId;
  await seedOptionB(guid);
  r = await call(goneUser.idToken, { operationId: 'g1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 });
  assert.ok(r.ok, `seed increment failed: ${JSON.stringify(r.body)}`);
  r = await call(goneUser.idToken, { operationId: 'g2', type: 'MANUAL_CREATE', date: TODAY, logId: 'GL1', counts: { cig: 2 } });
  assert.ok(r.ok, `seed manual log failed: ${JSON.stringify(r.body)}`);
  await writeDoc(`users/${guid}/meta/profile`, { avatar: 'x' });
  const goneDocs = [
    `users/${guid}`, `users/${guid}/configs/cig`, `users/${guid}/days/${TODAY}`, `users/${guid}/logs/GL1`,
    `users/${guid}/meta/profile`, `users/${guid}/dailyFinancials/${TODAY}`,
    `users/${guid}/trustedOperations/g1`, `users/${guid}/trustedOperations/g2`,
  ];
  for (const p of goneDocs) assert.ok(await readDoc(p), `seed missing ${p}`);

  const noAuth = await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west1/deleteAccountData`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }),
  });
  assert.ok(!noAuth.ok, 'deleteAccountData must reject an unauthenticated call');

  r = await call(goneUser.idToken, {}, 'deleteAccountData');
  assert.ok(r.ok && r.body.result.deleted === true, `deleteAccountData failed: ${JSON.stringify(r.body)}`);
  for (const p of goneDocs) assert.equal(await readDoc(p), null, `${p} must be deleted`);
  // Only the caller's tree: another OPTION_B user's data is untouched.
  assert.ok(await readDoc(`users/${duid}/days/${TODAY}`), 'another user\'s data must survive');

  // 13) Double counting & 2 → 3 → 2 sequence with distinct operationIds
  const seqUser = await signIn();
  const suid = seqUser.localId;
  await seedOptionB(suid);
  // Increment: 0 -> 1 (seqA)
  r = await call(seqUser.idToken, { operationId: 'seqA', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 });
  assert.ok(r.ok && r.body.result?.applied === true);
  // Increment: 1 -> 2 (seqB)
  r = await call(seqUser.idToken, { operationId: 'seqB', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 });
  assert.ok(r.ok && r.body.result?.applied === true);
  // Decrement: 2 -> 1 (seqC)
  r = await call(seqUser.idToken, { operationId: 'seqC', type: 'COUNTER_DECREMENT', date: TODAY, trackerId: 'cig', delta: -1 });
  assert.ok(r.ok && r.body.result?.applied === true);
  assert.equal((await readDoc(`users/${suid}/days/${TODAY}`)).counts.cig, 1);
  // Increment: 1 -> 2 (seqD) - distinct operationId, same target count
  r = await call(seqUser.idToken, { operationId: 'seqD', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 });
  assert.ok(r.ok && r.body.result?.applied === true);
  assert.equal((await readDoc(`users/${suid}/days/${TODAY}`)).counts.cig, 2);
  let seqLedger = await readDoc(`users/${suid}/dailyFinancials/${TODAY}`);
  assert.equal(seqLedger.countsByTracker.cig, 2);
  assert.equal(seqLedger.canonicalCredit.saved, 8); // (10 - 2) * 1 = 8

  // Idempotent retry of seqD returns applied: false and does not double count
  r = await call(seqUser.idToken, { operationId: 'seqD', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 1 });
  assert.ok(r.ok && r.body.result?.applied === false, 'retry must be idempotent');
  assert.equal((await readDoc(`users/${suid}/days/${TODAY}`)).counts.cig, 2, 'retry must not increment count');

  // 14) P0 Concern D: MANUAL_RESTORE preserves original snapshot economic values even after active tracker price change
  const undoUser = await signIn();
  const uuid = undoUser.localId;
  await seedOptionB(uuid); // cig: limit 10, price 1, baseline 15
  const originalSnap = { cig: { target: 10, baseline: 15, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true, isPrimaryTracked: true } };
  const originalCredit = { saved: 8, wasted: 2, smokingUnits: 2, baselineSaved: 13 };

  // Step 1: Seed closed day and manual log on historical date YDAY
  await writeDoc(`users/${uuid}/days/${YDAY}`, {
    date: YDAY, counts: {}, status: 'closed', foldedIntoLifetime: false,
    trackerSnapshots: originalSnap,
  });
  await writeDoc(`users/${uuid}/logs/ULOG1`, {
    id: 'ULOG1', logDate: YDAY, counts: { cig: 2 }, isManual: true, origin: 'MANUAL_ENTRY',
    trackerSnapshots: originalSnap, aggregateCredit: originalCredit,
  });

  // Step 2: Delete manual log on historical date
  r = await call(undoUser.idToken, { operationId: 'u_del', type: 'MANUAL_DELETE', date: YDAY, logId: 'ULOG1' });
  assert.ok(r.ok, `undo delete failed: ${JSON.stringify(r.body)}`);
  assert.equal(await readDoc(`users/${uuid}/logs/ULOG1`), null);

  // Step 3: Now the active tracker price changes from €1.00 to €5.00!
  await writeDoc(`users/${uuid}/configs/cig`, {
    name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 5,
    isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15,
  }, true);

  // Step 4: Restore the deleted historical log via MANUAL_RESTORE with its original snapshot { unitPrice: 1 }
  r = await call(undoUser.idToken, {
    operationId: 'u_res', type: 'MANUAL_RESTORE', date: YDAY, logId: 'ULOG1',
    counts: { cig: 2 },
    trackerSnapshots: originalSnap,
    aggregateCredit: originalCredit,
  });
  assert.ok(r.ok, `undo restore failed: ${JSON.stringify(r.body)}`);
  const restoredLog = await readDoc(`users/${uuid}/logs/ULOG1`);
  assert.ok(restoredLog, 'restored log must exist');
  assert.equal(restoredLog.trackerSnapshots.cig.unitPrice, 1, 'restored snapshot must preserve €1 price');

  // Step 5: Verify the daily ledger credit uses the original €1 price, NOT the new €5 price!
  const undoLed = await readDoc(`users/${uuid}/dailyFinancials/${YDAY}`);
  assert.equal(undoLed.canonicalCredit.saved, 8, 'canonical saved must be (10-2)*1=€8, NEVER (10-2)*5=€40');
  assert.equal(undoLed.canonicalCredit.wasted, 2, 'canonical wasted must be 2*1=€2, NEVER 2*5=€10');
  assert.equal(undoLed.canonicalCredit.baselineSaved, 13, 'baseline saved must be (15-2)*1=€13, NEVER 13*5=€65');

  // 15) P0 Concern C & Task 4: Category D migration and Four-Metric Reconciliation
  const catDUser = await signIn();
  const cduid = catDUser.localId;
  await writeDoc(`users/${cduid}`, {
    name: '', financialMode: 'LEGACY', unitPrice: 1.5,
    lifetimeAggregates: { saved: 20, wasted: 10, smokingUnits: 10, baselineSaved: 25 },
  });
  await writeDoc(`users/${cduid}/configs/cig`, {
    name: 'Cigarettes', limit: 10, order: 0, type: 'CIGARETTE', pricePerUnit: 1.5,
    isFinanciallyTracked: true, isPrimaryTracked: true, baseline: 15,
  });
  // Category D day: Closed day with trackerSnapshots (unitPrice 1.5), legacy aggregateCredit
  await writeDoc(`users/${cduid}/days/${YDAY}`, {
    date: YDAY, counts: { cig: 5 }, status: 'closed', foldedIntoLifetime: true,
    trackerSnapshots: { cig: { target: 10, baseline: 15, unitPrice: 1.5, type: 'CIGARETTE', isFinanciallyTracked: true } },
    aggregateCredit: { saved: 20, wasted: 10, smokingUnits: 10, baselineSaved: 25 },
  });
  // Run migration with targetUid as admin
  m = await call(adminToken, { targetUid: cduid, dryRun: false }, 'migrateAccount');
  assert.ok(m.ok, `Category D migration failed: ${JSON.stringify(m.body)}`);
  const catDProfile = await readDoc(`users/${cduid}`);
  assert.equal(catDProfile.financialMode, 'OPTION_B');
  const catDLedger = await readDoc(`users/${cduid}/dailyFinancials/${YDAY}`);
  assert.ok(catDLedger, 'canonical ledger must be created for Category D date');
  assert.equal(catDLedger.foldedIntoLifetime, true, 'Category D ledger must be foldedIntoLifetime: true');
  // Recomputed canonical values:
  // count 5, target 10, baseline 15, unitPrice 1.5
  // wasted: 5 * 1.5 = 7.5
  // saved: (10 - 5) * 1.5 = 7.5
  // baselineSaved: (15 - 5) * 1.5 = 15.0
  // smokingUnits: 5
  assert.equal(catDLedger.canonicalCredit.saved, 7.5);
  assert.equal(catDLedger.canonicalCredit.wasted, 7.5);
  assert.equal(catDLedger.canonicalCredit.baselineSaved, 15.0);
  assert.equal(catDLedger.canonicalCredit.smokingUnits, 5);

  // Four-metric reconciliation: all 4 lifetime totals match their canonical contributions
  assert.equal(catDProfile.lifetimeAggregates.saved, 7.5, 'lifetime saved reconciled');
  assert.equal(catDProfile.lifetimeAggregates.wasted, 7.5, 'lifetime wasted reconciled');
  assert.equal(catDProfile.lifetimeAggregates.baselineSaved, 15.0, 'lifetime baselineSaved reconciled');
  assert.equal(catDProfile.lifetimeAggregates.smokingUnits, 5, 'lifetime smokingUnits reconciled');

  // 16) P0 Concern E: Option B Firestore security rules verification
  const optBUser = await signIn();
  const obuid = optBUser.localId;
  await seedOptionB(obuid);
  const userAuth = { Authorization: `Bearer ${optBUser.idToken}`, 'Content-Type': 'application/json' };

  // (a) Option B user directly writes configs/vape -> ALLOWED
  const cfgWrite = await fetch(`${FS}/users/${obuid}/configs/vape?currentDocument.exists=false`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries({ name: 'Vape', limit: 20, order: 1, type: 'SIMPLE', pricePerUnit: 0.5 }).map(([k, v]) => [k, toFs(v)])) }),
  });
  assert.ok(cfgWrite.ok, `Option B direct config create must be allowed by rules: ${cfgWrite.status}`);

  // (b) Option B user directly writes meta/profile (avatar) -> ALLOWED
  const avatarWrite = await fetch(`${FS}/users/${obuid}/meta/profile`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: { avatar: { stringValue: 'new-avatar' } } }),
  });
  assert.ok(avatarWrite.ok, `Option B avatar update must be allowed by rules: ${avatarWrite.status}`);

  // (c) Option B user directly deletes configs/vape -> DENIED by rules (must use TRACKER_DELETE)
  const cfgDel = await fetch(`${FS}/users/${obuid}/configs/vape`, {
    method: 'DELETE', headers: userAuth,
  });
  assert.equal(cfgDel.status, 403, 'Option B direct config delete must be denied by rules');

  // (d) Option B user directly writes days/ -> DENIED by rules (fail-closed)
  const dayDirect = await fetch(`${FS}/users/${obuid}/days/${TODAY}`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: { date: { stringValue: TODAY }, counts: { mapValue: { fields: { cig: { integerValue: 5 } } } } } }),
  });
  assert.equal(dayDirect.status, 403, 'Option B direct day write must be denied by rules');

  // (e) Option B user directly writes logs/ -> DENIED by rules (fail-closed)
  const logDirect = await fetch(`${FS}/users/${obuid}/logs/direct1`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: { logDate: { stringValue: TODAY }, counts: { mapValue: { fields: { cig: { integerValue: 5 } } } } } }),
  });
  assert.equal(logDirect.status, 403, 'Option B direct log write must be denied by rules');

  // (f) Option B user directly writes dailyFinancials/ -> DENIED by rules
  const ledDirect = await fetch(`${FS}/users/${obuid}/dailyFinancials/${TODAY}`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: { date: { stringValue: TODAY }, canonicalCredit: { mapValue: { fields: { saved: { doubleValue: 100 } } } } } }),
  });
  assert.equal(ledDirect.status, 403, 'Option B direct dailyFinancials write must be denied by rules');

  // (g) Option B user directly modifies lifetimeAggregates on users/{uid} -> DENIED by rules
  const aggDirect = await fetch(`${FS}/users/${obuid}?updateMask.fieldPaths=lifetimeAggregates`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: { lifetimeAggregates: { mapValue: { fields: { saved: { doubleValue: 9999 } } } } } }),
  });
  assert.equal(aggDirect.status, 403, 'Option B direct lifetimeAggregates write must be denied by rules');

  // (h) Option B user directly updates user settings (dayStartHour, name) -> ALLOWED by rules
  const settingsDirect = await fetch(`${FS}/users/${obuid}?updateMask.fieldPaths=dayStartHour&updateMask.fieldPaths=name`, {
    method: 'PATCH', headers: userAuth,
    body: JSON.stringify({ fields: { dayStartHour: { integerValue: 8 }, name: { stringValue: 'Test User' } } }),
  });
  assert.ok(settingsDirect.ok, `Option B settings update must be allowed by rules: ${settingsDirect.status}`);

  console.log('✅ integration: create, idempotency, conflict, close-once, mode-guard, phantom-savings, historical-no-fabrication, migration (€15→€5), interruption-resume, concurrency, no-migrating-dead-end, historical-day-update, tracker-delete, current-tracking-date, delete-account-data, 2->3->2-idempotency, undo-restore-snapshot-preservation, category-D-4-metric-reconciliation, option-b-rules-compatibility ALL 16 TEST SUITES PASSED');
};

main().catch((e) => { console.error('❌ integration failed:', e.message, e.stack); process.exit(1); });
