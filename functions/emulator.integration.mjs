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

  // 11) TRACKER_DELETE date integrity, historical immutability, and cleanup
  const delUser = await signIn();
  const duid = delUser.localId;
  await seedOptionB(duid);

  // Seed counts on current open day TODAY
  r = await call(delUser.idToken, { operationId: 'delc1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', delta: 2, defaultUnitPrice: 1 });
  assert.ok(r.ok, `seed increment failed: ${JSON.stringify(r.body)}`);
  assert.ok(await readDoc(`users/${duid}/configs/cig`), 'config should exist before delete');

  // Seed an immutable historical day on YDAY with frozen snapshot
  await writeDoc(`users/${duid}/days/${YDAY}`, {
    date: YDAY,
    counts: { cig: 5 },
    trackerSnapshots: { cig: { target: 10, unitPrice: 1, baseline: 15 } },
    status: 'closed',
    foldedIntoLifetime: true,
  });

  // (a) Specifying an old/mismatched date must be REJECTED to prevent historical corruption
  // and dangling unconfigured counts on current open day
  r = await call(delUser.idToken, { operationId: 'del_mismatch', type: 'TRACKER_DELETE', date: YDAY, trackerId: 'cig' });
  assert.equal(r.status, 400, `TRACKER_DELETE with mismatched date must be rejected: ${r.status}`);
  assert.equal(r.body.error?.message, 'TRACKER_DELETE_MUST_TARGET_CURRENT_DATE');
  assert.ok(await readDoc(`users/${duid}/configs/cig`), 'config must NOT be deleted on mismatched date');
  const untouchedHistDay = await readDoc(`users/${duid}/days/${YDAY}`);
  assert.equal(untouchedHistDay.counts.cig, 5, 'historical counts must remain immutable');

  // (b) Current open day cleanup: TRACKER_DELETE targeting TODAY (or omitting date) succeeds
  r = await call(delUser.idToken, { operationId: 'del1', type: 'TRACKER_DELETE', date: TODAY, trackerId: 'cig' });
  assert.ok(r.ok, `TRACKER_DELETE failed: ${JSON.stringify(r.body)}`);
  assert.equal(await readDoc(`users/${duid}/configs/cig`), null, 'config must be deleted');
  const delDay = await readDoc(`users/${duid}/days/${TODAY}`);
  assert.equal(delDay.counts.cig, undefined, 'tracker must be dropped from open day counts');
  assert.equal(delDay.trackerSnapshots.cig, undefined, 'tracker must be dropped from open day snapshots');
  const delLed = await readDoc(`users/${duid}/dailyFinancials/${TODAY}`);
  assert.equal(delLed.countsByTracker.cig, undefined, 'tracker must be dropped from the ledger counts');
  assert.equal((delLed.missingConfigs || []).includes('cig'), false, 'financial state must not have missing config for deleted tracker');

  // Historical closed day still retains its frozen counts and snapshots intact
  const verifiedHistDay = await readDoc(`users/${duid}/days/${YDAY}`);
  assert.equal(verifiedHistDay.counts.cig, 5, 'historical day counts preserved');
  assert.equal(verifiedHistDay.trackerSnapshots.cig.target, 10, 'historical snapshots preserved');

  // (c) Concurrent operations: concurrent increment and deletion for tracker 'vape'
  const concUser = await signIn();
  const concUid = concUser.localId;
  await seedOptionB(concUid);
  const [incRes, delRes] = await Promise.all([
    call(concUser.idToken, { operationId: 'conc_inc', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'vape', delta: 1, defaultUnitPrice: 1 }),
    call(concUser.idToken, { operationId: 'conc_del', type: 'TRACKER_DELETE', date: TODAY, trackerId: 'vape' }),
  ]);
  // One of them ordered first: either increment succeeded then delete cleaned it up,
  // or delete removed the config first and increment failed with CONFIG_NOT_FOUND.
  assert.ok(delRes.ok, `concurrent TRACKER_DELETE must succeed: ${JSON.stringify(delRes.body)}`);
  assert.equal(await readDoc(`users/${concUid}/configs/vape`), null, 'vape config must be deleted');
  const concDay = await readDoc(`users/${concUid}/days/${TODAY}`);
  assert.equal(concDay?.counts?.vape, undefined, 'current day must not retain dangling counts for deleted tracker');

  // 11b) Timezone policy and currentTrackingDate resolution
  const tzUser = await signIn();
  const tzUid = tzUser.localId;
  await seedOptionB(tzUid);

  // Passing a valid IANA timeZone persists to the account profile
  r = await call(tzUser.idToken, { operationId: 'tz_init', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', timeZone: 'Europe/Berlin', currentTrackingDate: TODAY });
  assert.ok(r.ok, `call with IANA timeZone must succeed: ${JSON.stringify(r.body)}`);
  const tzProfile = await readDoc(`users/${tzUid}`);
  assert.equal(tzProfile.timeZone, 'Europe/Berlin', 'valid IANA timeZone must be persisted to profile');

  // Subsequent call without timeZone uses stored profile timezone
  r = await call(tzUser.idToken, { operationId: 'tz1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', currentTrackingDate: TODAY });
  assert.ok(r.ok, `a plausible currentTrackingDate must be accepted: ${JSON.stringify(r.body)}`);
  const far = new Date(`${TODAY}T00:00:00Z`); far.setUTCDate(far.getUTCDate() - 5);
  r = await call(tzUser.idToken, { operationId: 'tz2', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', currentTrackingDate: far.toISOString().slice(0, 10) });
  assert.ok(!r.ok && r.body.error?.message === 'IMPLAUSIBLE_CURRENT_TRACKING_DATE', `implausible date must be rejected: ${JSON.stringify(r.body)}`);
  r = await call(tzUser.idToken, { operationId: 'tz1', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 'cig', currentTrackingDate: YDAY });
  assert.ok(r.ok && r.body.result.applied === false, `a retry with a different currentTrackingDate must be the same operation: ${JSON.stringify(r.body)}`);
  assert.equal((await readDoc(`users/${tzUid}/days/${TODAY}`)).counts.cig, 2, 'applied exactly twice (tz_init + tz1)');

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
  await writeDoc(`users/${guid}/trustedDeletedLogs/del1`, { logId: 'del1', counts: { cig: 1 } });
  const goneDocs = [
    `users/${guid}`, `users/${guid}/configs/cig`, `users/${guid}/days/${TODAY}`, `users/${guid}/logs/GL1`,
    `users/${guid}/meta/profile`, `users/${guid}/dailyFinancials/${TODAY}`,
    `users/${guid}/trustedOperations/g1`, `users/${guid}/trustedOperations/g2`,
    `users/${guid}/trustedDeletedLogs/del1`,
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

  // 17) Release Gate Item 1: Day document tracker limits (25 allowed, 26 rejected, 50 rejected)
  const limitUser = await signIn();
  const luid = limitUser.localId;
  await seedOptionB(luid);
  const lToken = limitUser.idToken;

  // Create 26 configs (t1 to t26)
  for (let i = 1; i <= 26; i++) {
    await writeDoc(`users/${luid}/configs/t${i}`, {
      name: `T${i}`, limit: 10, order: i, type: 'CIGARETTE', pricePerUnit: 1, isFinanciallyTracked: true,
    }, true);
  }

  // Pre-seed day document with 24 trackers (t1 to t24)
  const counts24 = {};
  for (let i = 1; i <= 24; i++) counts24[`t${i}`] = 1;
  await writeDoc(`users/${luid}/days/${TODAY}`, {
    date: TODAY, counts: counts24, status: 'open', foldedIntoLifetime: false,
    trackerSnapshots: Object.fromEntries(Object.keys(counts24).map((k) => [k, { target: 10, unitPrice: 1, type: 'CIGARETTE', isFinanciallyTracked: true }])),
  }, true);

  // Increment tracker 25: 24 + 1 = 25 entries -> SUCCEEDS
  let limRes = await call(lToken, {
    operationId: 'lim_25', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 't25',
    delta: 1, defaultUnitPrice: 1,
  });
  assert.ok(limRes.ok, `Incrementing to 25 entries must succeed: ${JSON.stringify(limRes.body)}`);
  let dayDoc25 = await readDoc(`users/${luid}/days/${TODAY}`);
  assert.equal(Object.keys(dayDoc25.counts).length, 25, 'Day doc must contain exactly 25 entries');

  // Increment tracker 26: 25 + 1 = 26 entries -> REJECTED by server validation
  limRes = await call(lToken, {
    operationId: 'lim_26', type: 'COUNTER_INCREMENT', date: TODAY, trackerId: 't26',
    delta: 1, defaultUnitPrice: 1,
  });
  assert.equal(limRes.ok, false, 'Incrementing to 26 entries must be rejected by server validation');
  assert.match(JSON.stringify(limRes.body), /TOO_MANY_TRACKERS|failed-precondition/i);

  // Attempting 50 entries in a single day document payload -> REJECTED
  const counts50 = {};
  for (let i = 1; i <= 50; i++) counts50[`t${i}`] = 1;
  limRes = await call(lToken, {
    operationId: 'lim_50', type: 'MANUAL_CREATE', date: TODAY, logId: 'L_50',
    counts: counts50, defaultUnitPrice: 1,
  });
  assert.equal(limRes.ok, false, 'Submitting 50 day-trackers in a single day doc must be rejected');

  // 18) Release Gate Item 2: Trusted snapshot provenance and adversarial restore
  const advUser = await signIn();
  const advUid = advUser.localId;
  const advToken = advUser.idToken;
  await seedOptionB(advUid);

  // Step 1: Create a manual log L_ADV on TODAY with 2 units (€1/unit)
  let advRes = await call(advToken, {
    operationId: 'adv_create', type: 'MANUAL_CREATE', date: TODAY, logId: 'L_ADV',
    counts: { cig: 2 }, defaultUnitPrice: 1,
  });
  assert.ok(advRes.ok, `adv create failed: ${JSON.stringify(advRes.body)}`);

  // Step 2: Delete L_ADV -> writes server tombstone to trustedDeletedLogs/L_ADV
  advRes = await call(advToken, {
    operationId: 'adv_del', type: 'MANUAL_DELETE', date: TODAY, logId: 'L_ADV',
  });
  assert.ok(advRes.ok, `adv delete failed: ${JSON.stringify(advRes.body)}`);
  assert.equal(await readDoc(`users/${advUid}/logs/L_ADV`), null);

  // Step 3: Adversarial restore attempt with forged economic values
  // Client attempts to claim unitPrice = €9999 and huge target/saved numbers
  advRes = await call(advToken, {
    operationId: 'adv_restore_forged', type: 'MANUAL_RESTORE', date: TODAY, logId: 'L_ADV',
    counts: { cig: 2 },
    trackerSnapshots: { cig: { unitPrice: 9999, target: 50000, baseline: 50000, type: 'CIGARETTE' } },
    aggregateCredit: { saved: 49998, wasted: 19998, baselineSaved: 49998, smokingUnits: 2 },
  });
  assert.ok(advRes.ok, `adv restore must succeed using server tombstone: ${JSON.stringify(advRes.body)}`);

  // Step 4: Verify server IGNORED the forged values and used server tombstone evidence (€1)
  const restoredAdvLog = await readDoc(`users/${advUid}/logs/L_ADV`);
  assert.ok(restoredAdvLog, 'restored log must exist');
  assert.equal(restoredAdvLog.trackerSnapshots.cig.unitPrice, 1, 'server must ignore client-forged unit price');

  const advLedger = await readDoc(`users/${advUid}/dailyFinancials/${TODAY}`);
  assert.equal(advLedger.canonicalCredit.saved, 8, 'canonical saved must be 8 (from €1 price), NEVER client-forged 49998');
  assert.equal(advLedger.canonicalCredit.wasted, 2, 'canonical wasted must be 2, NEVER client-forged 19998');

  // Step 5: Adversarial restore without restoration evidence (fabricated ghost log ID)
  advRes = await call(advToken, {
    operationId: 'adv_restore_no_evidence', type: 'MANUAL_RESTORE', date: TODAY, logId: 'FABRICATED_GHOST_LOG',
    counts: { cig: 2 },
  });
  assert.equal(advRes.ok, false, 'Restore without server tombstone evidence must fail');
  assert.match(JSON.stringify(advRes.body), /NO_RESTORATION_EVIDENCE|not-found/i);

  // 19) Direct client write to trustedDeletedLogs blocked by rules
  const tombstoneDirect = await fetch(`${FS}/users/${advUid}/trustedDeletedLogs/FAKE_TOMBSTONE`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${advToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { logId: { stringValue: 'FAKE' } } }),
  });
  assert.equal(tombstoneDirect.status, 403, 'Direct client write to trustedDeletedLogs must be denied 403 by Firestore rules');

  // 20) Phase 3 & Phase 5: Restoration Backward Compatibility & Financial Invariants
  const p3User = await signIn();
  const p3Uid = p3User.localId;
  const p3Token = p3User.idToken;
  await seedOptionB(p3Uid);

  // Scenario A: New deletion and restoration preserves server-stored snapshots & economics
  const dateHist = '2026-08-10';
  let p3Res = await call(p3Token, {
    operationId: 'b_create_A', type: 'MANUAL_CREATE', date: dateHist, logId: 'LOG_A',
    counts: { cig: 3 }, defaultUnitPrice: 1,
  });
  assert.ok(p3Res.ok, `seed LOG_A: ${JSON.stringify(p3Res.body)}`);

  // Delete LOG_A -> writes tombstone in trustedDeletedLogs
  p3Res = await call(p3Token, {
    operationId: 'b_del_A', type: 'MANUAL_DELETE', date: dateHist, logId: 'LOG_A',
  });
  assert.ok(p3Res.ok, `delete LOG_A: ${JSON.stringify(p3Res.body)}`);
  assert.equal(await readDoc(`users/${p3Uid}/logs/LOG_A`), null);
  const tombstoneA = await readDoc(`users/${p3Uid}/trustedDeletedLogs/LOG_A`);
  assert.ok(tombstoneA, 'server tombstone must exist in trustedDeletedLogs');

  // Restore LOG_A
  p3Res = await call(p3Token, {
    operationId: 'b_res_A', type: 'MANUAL_RESTORE', date: dateHist, logId: 'LOG_A',
    counts: { cig: 3 },
  });
  assert.ok(p3Res.ok, `restore LOG_A: ${JSON.stringify(p3Res.body)}`);
  const restoredLogA = await readDoc(`users/${p3Uid}/logs/LOG_A`);
  assert.ok(restoredLogA, 'LOG_A must be restored');
  assert.equal(restoredLogA.restorationMode, 'VERIFIED');
  assert.equal(await readDoc(`users/${p3Uid}/trustedDeletedLogs/LOG_A`), null, 'tombstone must be cleaned up on restore');

  // Scenario B: Unsupported restore lacking reliable provenance
  // Attempting MANUAL_RESTORE for a non-existent tombstone must fail closed even with allowUnresolved: true
  const legacyDate = '2026-07-20';
  p3Res = await call(p3Token, {
    operationId: 'b_res_legacy_fail', type: 'MANUAL_RESTORE', date: legacyDate, logId: 'LOG_LEGACY_1',
    counts: { cig: 4 },
  });
  assert.equal(p3Res.ok, false, 'Legacy restore without tombstone must fail closed');
  assert.match(JSON.stringify(p3Res.body), /NO_RESTORATION_EVIDENCE/);

  p3Res = await call(p3Token, {
    operationId: 'b_res_legacy_allow_unres', type: 'MANUAL_RESTORE', date: legacyDate, logId: 'LOG_LEGACY_1',
    counts: { cig: 4 },
    allowUnresolved: true,
  });
  assert.equal(p3Res.ok, false, 'MANUAL_RESTORE cannot invent restored record without server tombstone');
  assert.match(JSON.stringify(p3Res.body), /NO_RESTORATION_EVIDENCE/);

  // Explicit new historical entry with unresolved economics must use MANUAL_CREATE
  p3Res = await call(p3Token, {
    operationId: 'b_create_legacy_explicit', type: 'MANUAL_CREATE', date: legacyDate, logId: 'LOG_LEGACY_1',
    counts: { cig: 4 },
    defaultUnitPrice: 1,
  });
  assert.ok(p3Res.ok, `Explicit historical create must succeed: ${JSON.stringify(p3Res.body)}`);
  const explicitLegacy = await readDoc(`users/${p3Uid}/logs/LOG_LEGACY_1`);
  assert.ok(explicitLegacy, 'LOG_LEGACY_1 must exist as explicit manual entry');
  assert.equal(explicitLegacy.origin, 'MANUAL_ENTRY');
  assert.equal(explicitLegacy.unresolvedEconomics, true);
  assert.equal(explicitLegacy.counts.cig, 4);

  // Verify financial ledger marks economics as unresolved without inventing savings (Invariant 7 & 8)
  const legacyLedger = await readDoc(`users/${p3Uid}/dailyFinancials/${legacyDate}`);
  assert.ok(legacyLedger, 'dailyFinancials must exist');
  assert.equal(legacyLedger.unresolvedComponents.spent, true, 'spent must be unresolved');
  assert.equal(legacyLedger.unresolvedComponents.saved, true, 'saved must be unresolved');
  assert.equal(legacyLedger.canonicalCredit.saved, 0, 'authoritative savings must NOT be invented');

  // Scenario C: Malicious restoration with forged financial overrides or non-existent tombstone
  p3Res = await call(p3Token, {
    operationId: 'b_res_malicious', type: 'MANUAL_RESTORE', date: legacyDate, logId: 'LOG_MALICIOUS',
    counts: { cig: 2 },
    trackerSnapshots: { cig: { unitPrice: 500, target: 1000 } },
    aggregateCredit: { saved: 99999, wasted: 1000 },
  });
  assert.equal(p3Res.ok, false, 'Malicious restore without server tombstone must be rejected');
  assert.match(JSON.stringify(p3Res.body), /NO_RESTORATION_EVIDENCE/);
  assert.equal(await readDoc(`users/${p3Uid}/logs/LOG_MALICIOUS`), null, 'no malicious log created');

  // Tampered restoration: client attempts to change counts from server tombstone
  await call(p3Token, {
    operationId: 'tamper_seed', type: 'MANUAL_CREATE', date: legacyDate, logId: 'LOG_TAMPER',
    counts: { cig: 2 }, defaultUnitPrice: 1,
  });
  await call(p3Token, {
    operationId: 'tamper_del', type: 'MANUAL_DELETE', date: legacyDate, logId: 'LOG_TAMPER',
  });
  p3Res = await call(p3Token, {
    operationId: 'tamper_res', type: 'MANUAL_RESTORE', date: legacyDate, logId: 'LOG_TAMPER',
    counts: { cig: 99 }, // tampered!
  });
  assert.equal(p3Res.ok, false, 'Restoration with tampered counts must be rejected');
  assert.match(JSON.stringify(p3Res.body), /RESTORATION_TAMPERED/);

  // Scenario D: Repeated restoration (idempotent replay vs second restore) (Invariant 4)
  const userBeforeRepeat = await readDoc(`users/${p3Uid}`);
  const aggBeforeRepeat = { ...userBeforeRepeat.lifetimeAggregates };
  // Replaying with identical operationId returns cached receipt without double credit
  p3Res = await call(p3Token, {
    operationId: 'b_res_A', type: 'MANUAL_RESTORE', date: dateHist, logId: 'LOG_A',
    counts: { cig: 3 },
  });
  assert.ok(p3Res.ok, 'identical operationId replay must succeed idempotently');
  assert.equal(p3Res.body.result?.applied ?? false, false);
  const userAfterRepeat = await readDoc(`users/${p3Uid}`);
  assert.deepEqual(userAfterRepeat.lifetimeAggregates, aggBeforeRepeat, 'lifetime aggregates must never double credit');

  // Second restore with different operationId must reject because log is already active
  p3Res = await call(p3Token, {
    operationId: 'b_res_A_duplicate', type: 'MANUAL_RESTORE', date: dateHist, logId: 'LOG_A',
    counts: { cig: 3 },
  });
  assert.equal(p3Res.ok, false, 'restoring already active log must fail');
  assert.match(JSON.stringify(p3Res.body), /LOG_ALREADY_ACTIVE/);

  // Scenario E: Failed restoration and retry atomicity
  p3Res = await call(p3Token, {
    operationId: 'b_res_invalid', type: 'MANUAL_RESTORE', date: 'invalid-date', logId: 'LOG_INVALID',
    counts: { cig: 1 },
  });
  assert.equal(p3Res.ok, false, 'Invalid calendar date must fail validation');
  assert.equal(await readDoc(`users/${p3Uid}/logs/LOG_INVALID`), null, 'atomic transaction leaves no partial log');

  // Item 1: Cross-date manual log ID collisions & concurrency protections
  const dateOne = '2026-08-01';
  const dateTwo = '2026-08-02';
  // Step 1: Create LOG_CROSS on dateOne
  let crossRes = await call(p3Token, {
    operationId: 'cross_1', type: 'MANUAL_CREATE', date: dateOne, logId: 'LOG_CROSS',
    counts: { cig: 2 }, defaultUnitPrice: 1,
  });
  assert.ok(crossRes.ok, `create LOG_CROSS on dateOne: ${JSON.stringify(crossRes.body)}`);

  // Step 2: Attempt to create LOG_CROSS on dateTwo -> Must fail with LOG_EXISTS
  crossRes = await call(p3Token, {
    operationId: 'cross_2', type: 'MANUAL_CREATE', date: dateTwo, logId: 'LOG_CROSS',
    counts: { cig: 5 }, defaultUnitPrice: 1,
  });
  assert.equal(crossRes.ok, false, 'Cross-date collision must be rejected with LOG_EXISTS');
  assert.match(JSON.stringify(crossRes.body), /LOG_EXISTS/);

  // Step 3: Verify dateOne source doc and ledger remain unchanged
  const crossLog = await readDoc(`users/${p3Uid}/logs/LOG_CROSS`);
  assert.equal(crossLog.logDate, dateOne, 'LOG_CROSS must retain original logDate');
  assert.equal(crossLog.counts.cig, 2, 'LOG_CROSS counts must not be overwritten');

  // Step 4: Concurrent creation test across dates
  const [cRes1, cRes2] = await Promise.all([
    call(p3Token, {
      operationId: 'conc_1', type: 'MANUAL_CREATE', date: dateOne, logId: 'LOG_CONCURRENT',
      counts: { cig: 1 }, defaultUnitPrice: 1,
    }),
    call(p3Token, {
      operationId: 'conc_2', type: 'MANUAL_CREATE', date: dateTwo, logId: 'LOG_CONCURRENT',
      counts: { cig: 3 }, defaultUnitPrice: 1,
    }),
  ]);
  const succeededCount = [cRes1.ok, cRes2.ok].filter(Boolean).length;
  const failedCount = [cRes1.ok, cRes2.ok].filter((x) => !x).length;
  assert.equal(succeededCount, 1, 'Exactly one concurrent create must succeed');
  assert.equal(failedCount, 1, 'The colliding concurrent create must fail');

  // Step 5: Cross-date MANUAL_UPDATE and MANUAL_DELETE rejection
  const wrongUpdate = await call(p3Token, {
    operationId: 'cross_up', type: 'MANUAL_UPDATE', date: dateTwo, logId: 'LOG_CROSS',
    counts: { cig: 10 },
  });
  assert.equal(wrongUpdate.ok, false, 'MANUAL_UPDATE with mismatched date must fail');
  assert.match(JSON.stringify(wrongUpdate.body), /LOG_DATE_MISMATCH/);

  const wrongDelete = await call(p3Token, {
    operationId: 'cross_del', type: 'MANUAL_DELETE', date: dateTwo, logId: 'LOG_CROSS',
  });
  assert.equal(wrongDelete.ok, false, 'MANUAL_DELETE with mismatched date must fail');
  assert.match(JSON.stringify(wrongDelete.body), /LOG_DATE_MISMATCH/);

  // Item 4: Strengthened idempotency fingerprints against conflicting semantic arguments
  // Test conflicting allowUnresolved
  const fpRes1 = await call(p3Token, {
    operationId: 'fp_sem_1', type: 'MANUAL_CREATE', date: dateOne, logId: 'LOG_FP_1',
    counts: { cig: 1 }, allowUnresolved: false,
  });
  assert.ok(fpRes1.ok, `first call with allowUnresolved: false: ${JSON.stringify(fpRes1.body)}`);

  const fpConflict1 = await call(p3Token, {
    operationId: 'fp_sem_1', type: 'MANUAL_CREATE', date: dateOne, logId: 'LOG_FP_1',
    counts: { cig: 1 }, allowUnresolved: true,
  });
  assert.equal(fpConflict1.ok, false, 'Reuse of operationId with conflicting allowUnresolved must be rejected');
  assert.match(JSON.stringify(fpConflict1.body), /OPERATION_CONFLICT/);

  // Test conflicting counts on reused operationId
  const fpRes2 = await call(p3Token, {
    operationId: 'fp_sem_2', type: 'MANUAL_CREATE', date: dateOne, logId: 'LOG_FP_2',
    counts: { cig: 1 },
  });
  assert.ok(fpRes2.ok, `first call with counts 1: ${JSON.stringify(fpRes2.body)}`);

  const fpConflict2 = await call(p3Token, {
    operationId: 'fp_sem_2', type: 'MANUAL_CREATE', date: dateOne, logId: 'LOG_FP_2',
    counts: { cig: 5 },
  });
  assert.equal(fpConflict2.ok, false, 'Reuse of operationId with conflicting counts must be rejected');
  assert.match(JSON.stringify(fpConflict2.body), /OPERATION_CONFLICT/);

  console.log('✅ integration: ALL 20 TEST SUITES PASSED (including cross-date collision prevention, strict server-authoritative restoration, strengthened idempotency fingerprints, and all 10 financial integrity invariants)');
};

main().catch((e) => { console.error('❌ integration failed:', e.message, e.stack); process.exit(1); });
