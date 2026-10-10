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

const PROJECT = 'demo-takabpp-test';
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
const writeDoc = async (path, fields) => {
  const r = await fetch(`${FS}/${path}?currentDocument.exists=false`, {
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
  assert.ok(await readDoc(`users/${uid}/financialOperations/op1`), 'receipt not written');

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

  console.log('✅ integration: create, idempotency, conflict, close-once, mode-guard, phantom-savings, historical-no-fabrication, migration (€15→€5), interruption-resume, concurrency, historical-day-update, tracker-delete all passed');
};

main().catch((e) => { console.error('❌ integration failed:', e.message); process.exit(1); });
