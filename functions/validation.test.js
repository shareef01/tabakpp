import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCalendarDate, requireTrackingDate, requireId, sanitizeCounts, sanitizeHistoricalCounts, resolveDayStartHour,
  requireRecentLogin,
} from './validation.js';

const code = (fn) => {
  try { fn(); } catch (e) { return e.message; }
  return null;
};

test('isCalendarDate rejects impossible and malformed dates', () => {
  assert.equal(isCalendarDate('2026-02-28'), true);
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2026-02-31'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('2026-1-01'), false);
  assert.equal(isCalendarDate('2026-01-01/x/y'), false);
  assert.equal(isCalendarDate(20260101), false);
});

test('requireTrackingDate allows "today" in any timezone but not later', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  assert.equal(requireTrackingDate('2026-10-11', now), '2026-10-11');
  assert.equal(requireTrackingDate('2020-01-05', now), '2020-01-05');
  // UTC+14 is already on the 12th from 10:00Z.
  assert.equal(requireTrackingDate('2026-10-12', now), '2026-10-12');
  assert.equal(code(() => requireTrackingDate('2026-10-13', now)), 'FUTURE_DATE');
  assert.equal(code(() => requireTrackingDate('../x', now)), 'INVALID_DATE');
});

test('requireId rejects path separators and oversize ids', () => {
  assert.equal(requireId('1739999_3_ab12c', 'bad'), '1739999_3_ab12c');
  assert.equal(requireId('2026-10-01_M1739999_ab12cd34', 'bad'), '2026-10-01_M1739999_ab12cd34');
  assert.equal(code(() => requireId('a/b/c', 'bad')), 'bad');
  assert.equal(code(() => requireId('', 'bad')), 'bad');
  assert.equal(code(() => requireId('x'.repeat(65), 'bad', 64)), 'bad');
  assert.equal(code(() => requireId(42, 'bad')), 'bad');
});

test('sanitizeCounts enforces the rules bounds instead of trusting the payload', () => {
  assert.deepEqual(sanitizeCounts({ cig: 2, rolls: 0 }), { cig: 2 });
  assert.deepEqual(sanitizeCounts(undefined), {});
  assert.equal(code(() => sanitizeCounts({ cig: 1e300 })), 'INVALID_COUNT');
  assert.equal(code(() => sanitizeCounts({ cig: 1.5 })), 'INVALID_COUNT');
  assert.equal(code(() => sanitizeCounts({ cig: -1 })), 'INVALID_COUNT');
  assert.equal(code(() => sanitizeCounts({ 'a.b': 1 })), 'INVALID_TRACKER_ID');
  assert.equal(code(() => sanitizeCounts([1])), 'INVALID_COUNTS');
  const many = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`t${i}`, 1]));
  assert.equal(code(() => sanitizeCounts(many)), 'TOO_MANY_TRACKERS');
});

test('sanitizeHistoricalCounts keeps zeros (they clear a counter)', () => {
  assert.deepEqual(sanitizeHistoricalCounts({ cig: 0, rolls: 3 }), { cig: 0, rolls: 3 });
  assert.equal(code(() => sanitizeHistoricalCounts({ cig: 10001 })), 'INVALID_COUNT');
});

test('resolveDayStartHour treats 0 (midnight) as a real setting', () => {
  assert.equal(resolveDayStartHour(0), 0);
  assert.equal(resolveDayStartHour(4), 4);
  assert.equal(resolveDayStartHour(undefined), 6);
  assert.equal(resolveDayStartHour(null), 6);
  assert.equal(resolveDayStartHour(24), 6);
  assert.equal(resolveDayStartHour('abc'), 6);
});

test('requireRecentLogin accepts a fresh sign-in and rejects a stale or missing one', () => {
  const now = 1_800_000_000;
  assert.equal(code(() => requireRecentLogin({ auth_time: now - 60 }, now)), null);
  assert.equal(code(() => requireRecentLogin({ auth_time: now - 301 }, now)), 'RECENT_LOGIN_REQUIRED');
  assert.equal(code(() => requireRecentLogin({}, now)), 'RECENT_LOGIN_REQUIRED');
  assert.equal(code(() => requireRecentLogin(undefined, now)), 'RECENT_LOGIN_REQUIRED');
});
