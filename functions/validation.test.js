import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCalendarDate, requireTrackingDate, requireId, sanitizeCounts, sanitizeHistoricalCounts, resolveDayStartHour,
  requireRecentLogin, resolveCurrentTrackingDate,
  isValidIanaTimeZone, getZonedDateTimeParts, computeTrackingDateForZone, resolveUserTrackingDate,
  requireCounterDate, COUNTER_GRACE_MS, counterGraceTrackingDate,
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
  const exactly25 = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`t${i}`, 1]));
  assert.equal(Object.keys(sanitizeCounts(exactly25)).length, 25);
  const exactly26 = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`t${i}`, 1]));
  assert.equal(code(() => sanitizeCounts(exactly26)), 'TOO_MANY_TRACKERS');
});

test('sanitizeHistoricalCounts distinguishes day limit (25) from historical input payload limit (50)', () => {
  assert.deepEqual(sanitizeHistoricalCounts({ cig: 0, rolls: 3 }), { cig: 0, rolls: 3 });
  assert.equal(code(() => sanitizeHistoricalCounts({ cig: 10001 })), 'INVALID_COUNT');
  const exactly50 = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`t${i}`, i % 2 === 0 ? 0 : 1]));
  assert.equal(Object.keys(sanitizeHistoricalCounts(exactly50)).length, 50);
  const exactly51 = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`t${i}`, 1]));
  assert.equal(code(() => sanitizeHistoricalCounts(exactly51)), 'TOO_MANY_TRACKERS');
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

test('resolveCurrentTrackingDate accepts the user\'s local "today", bounded to real timezones', () => {
  const now = new Date('2026-10-11T01:00:00Z'); // day start 06:00
  // Older client sends nothing: previous behaviour, evaluated in UTC (01:00 < 06:00).
  assert.equal(resolveCurrentTrackingDate(undefined, 6, now), '2026-10-10');
  // Berlin (UTC+2) at 03:00 local: still the 10th's tracking day.
  assert.equal(resolveCurrentTrackingDate('2026-10-10', 6, now), '2026-10-10');
  // Tokyo (UTC+9) at 10:00 local: already the 11th — UTC alone got this wrong.
  assert.equal(resolveCurrentTrackingDate('2026-10-11', 6, now), '2026-10-11');
  // No timezone is two days ahead or a day behind the window.
  assert.equal(code(() => resolveCurrentTrackingDate('2026-10-12', 6, now)), 'IMPLAUSIBLE_CURRENT_TRACKING_DATE');
  assert.equal(code(() => resolveCurrentTrackingDate('2026-10-09', 6, now)), 'IMPLAUSIBLE_CURRENT_TRACKING_DATE');
  assert.equal(code(() => resolveCurrentTrackingDate('2026-10-1', 6, now)), 'INVALID_CURRENT_TRACKING_DATE');
});

test('resolveCurrentTrackingDate applies a midnight (0) day start', () => {
  const now = new Date('2026-10-11T23:30:00Z');
  // UTC+1 at 00:30 local: the 12th has begun.
  assert.equal(resolveCurrentTrackingDate('2026-10-12', 0, now), '2026-10-12');
  // UTC fallback at 23:30 with a midnight start is still the 11th.
  assert.equal(resolveCurrentTrackingDate(null, 0, now), '2026-10-11');
});

test('isValidIanaTimeZone correctly identifies standard IANA zones and rejects invalid ones', () => {
  assert.equal(isValidIanaTimeZone('Europe/Berlin'), true);
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('America/New_York'), true);
  assert.equal(isValidIanaTimeZone('Asia/Tokyo'), true);
  assert.equal(isValidIanaTimeZone('Pacific/Kiritimati'), true);
  assert.equal(isValidIanaTimeZone('Pacific/Pago_Pago'), true);
  assert.equal(isValidIanaTimeZone('Invalid/Zone'), false);
  assert.equal(isValidIanaTimeZone(''), false);
  assert.equal(isValidIanaTimeZone(null), false);
  assert.equal(isValidIanaTimeZone(undefined), false);
  assert.equal(isValidIanaTimeZone(123), false);
});

test('Timezone correctness reproduction: Europe/Berlin at 2026-10-15T05:30:00Z with dayStartHour=6', () => {
  const now = new Date('2026-10-15T05:30:00Z');
  // In UTC server clock (05:30 < 06:00), the old UTC logic produced 2026-10-14 (yesterday):
  assert.equal(resolveCurrentTrackingDate(undefined, 6, now), '2026-10-14');

  // In Europe/Berlin (CEST, UTC+2), local time is 07:30 (07:30 >= 06:00):
  // The correct current tracking date is 2026-10-15:
  const berlinTrackingDate = computeTrackingDateForZone(now, 'Europe/Berlin', 6);
  assert.equal(berlinTrackingDate, '2026-10-15');

  // Earlier the same morning at 03:30Z (05:30 local, 05:30 < 06:00):
  const earlierNow = new Date('2026-10-15T03:30:00Z');
  assert.equal(computeTrackingDateForZone(earlierNow, 'Europe/Berlin', 6), '2026-10-14');
});

test('DST transition in Europe/Berlin (2026-10-25 autumn fall-back from UTC+2 to UTC+1)', () => {
  // Before fall-back: 2026-10-25T00:30:00Z is 02:30:00 CEST (UTC+2) -> before 06:00 day start -> 2026-10-24
  const preSwitch = new Date('2026-10-25T00:30:00Z');
  assert.equal(computeTrackingDateForZone(preSwitch, 'Europe/Berlin', 6), '2026-10-24');

  // After fall-back: 2026-10-25T06:00:00Z is 07:00:00 CET (UTC+1) -> after 06:00 day start -> 2026-10-25
  const postSwitch = new Date('2026-10-25T06:00:00Z');
  assert.equal(computeTrackingDateForZone(postSwitch, 'Europe/Berlin', 6), '2026-10-25');
});

test('UTC boundaries and multi-timezone tracking date derivations', () => {
  const instant = new Date('2026-10-15T10:00:00Z');

  // Pacific/Kiritimati (UTC+14): local time is 2026-10-16 00:00:00
  // With dayStartHour = 0 (midnight):
  assert.equal(computeTrackingDateForZone(instant, 'Pacific/Kiritimati', 0), '2026-10-16');
  // With dayStartHour = 6 (00:00 < 06:00):
  assert.equal(computeTrackingDateForZone(instant, 'Pacific/Kiritimati', 6), '2026-10-15');

  // Pacific/Pago_Pago (UTC-11): at 2026-10-15T05:00:00Z, local time is 2026-10-14 18:00:00
  const pacificInstant = new Date('2026-10-15T05:00:00Z');
  assert.equal(computeTrackingDateForZone(pacificInstant, 'Pacific/Pago_Pago', 6), '2026-10-14');

  // America/New_York (EDT, UTC-4):
  // At 2026-10-15T03:30:00Z, local time is 2026-10-14 23:30:00 (23 >= 6) -> 2026-10-14
  assert.equal(computeTrackingDateForZone(new Date('2026-10-15T03:30:00Z'), 'America/New_York', 6), '2026-10-14');
  // At 2026-10-15T11:00:00Z, local time is 2026-10-15 07:00:00 (7 >= 6) -> 2026-10-15
  assert.equal(computeTrackingDateForZone(new Date('2026-10-15T11:00:00Z'), 'America/New_York', 6), '2026-10-15');

  // Asia/Tokyo (JST, UTC+9):
  // At 2026-10-15T00:30:00Z, local time is 2026-10-15 09:30:00 (9 >= 6) -> 2026-10-15
  assert.equal(computeTrackingDateForZone(new Date('2026-10-15T00:30:00Z'), 'Asia/Tokyo', 6), '2026-10-15');
});

test('Day-start boundary rules (midnight 0 vs noon 12)', () => {
  // 11:59 local vs 12:01 local in UTC with dayStartHour=12
  const beforeNoon = new Date('2026-10-15T11:59:00Z');
  const afterNoon = new Date('2026-10-15T12:01:00Z');
  assert.equal(computeTrackingDateForZone(beforeNoon, 'UTC', 12), '2026-10-14');
  assert.equal(computeTrackingDateForZone(afterNoon, 'UTC', 12), '2026-10-15');

  // Midnight (dayStartHour=0)
  const justBeforeMidnight = new Date('2026-10-15T23:59:59Z');
  const atMidnight = new Date('2026-10-16T00:00:00Z');
  assert.equal(computeTrackingDateForZone(justBeforeMidnight, 'UTC', 0), '2026-10-15');
  assert.equal(computeTrackingDateForZone(atMidnight, 'UTC', 0), '2026-10-16');
});

test('resolveUserTrackingDate policy handles stored, requested, claimed, and missing timezones safely', () => {
  const now = new Date('2026-10-15T05:30:00Z');

  // 1. Valid stored profile timezone takes precedence
  const r1 = resolveUserTrackingDate({
    now,
    profileTimeZone: 'Europe/Berlin',
    requestTimeZone: 'America/New_York',
    dayStartHour: 6,
  });
  assert.equal(r1.trackingDate, '2026-10-15');
  assert.equal(r1.timeZone, 'Europe/Berlin');
  assert.equal(r1.shouldPersist, false);

  // 2. Profile timezone missing, but request supplies valid IANA zone -> adopt and persist
  const r2 = resolveUserTrackingDate({
    now,
    profileTimeZone: null,
    requestTimeZone: 'Europe/Berlin',
    dayStartHour: 6,
  });
  assert.equal(r2.trackingDate, '2026-10-15');
  assert.equal(r2.timeZone, 'Europe/Berlin');
  assert.equal(r2.shouldPersist, true);

  // 3. Both profile and request timezones missing, but client sends valid claimedDate
  const r3 = resolveUserTrackingDate({
    now,
    profileTimeZone: null,
    requestTimeZone: null,
    claimedDate: '2026-10-15',
    dayStartHour: 6,
  });
  assert.equal(r3.trackingDate, '2026-10-15');
  assert.equal(r3.timeZone, null);
  assert.equal(r3.shouldPersist, false);

  // 4. Implausible claimedDate is strictly rejected
  assert.throws(
    () => resolveUserTrackingDate({
      now,
      profileTimeZone: null,
      requestTimeZone: null,
      claimedDate: '2026-10-25',
      dayStartHour: 6,
    }),
    /IMPLAUSIBLE_CURRENT_TRACKING_DATE/
  );

  // 5. Everything missing falls back safely to UTC
  const r5 = resolveUserTrackingDate({
    now,
    profileTimeZone: null,
    requestTimeZone: null,
    claimedDate: null,
    dayStartHour: 6,
  });
  assert.equal(r5.trackingDate, '2026-10-14'); // UTC 05:30 < 06:00
  assert.equal(r5.timeZone, 'UTC');
  assert.equal(r5.shouldPersist, false);
});


test('requireCounterDate admits only the current date, or the date that just ended within the grace window', () => {
  // 06:02 Berlin (04:02Z): the tracking day rolled over two minutes ago.
  const now = new Date('2026-10-23T04:02:00Z');
  const current = computeTrackingDateForZone(now, 'Europe/Berlin', 6);
  const grace = computeTrackingDateForZone(new Date(now.getTime() - COUNTER_GRACE_MS), 'Europe/Berlin', 6);
  assert.equal(current, '2026-10-23');
  assert.equal(grace, '2026-10-22');
  assert.equal(requireCounterDate('2026-10-23', current, grace), '2026-10-23');
  assert.equal(requireCounterDate('2026-10-22', current, grace), '2026-10-22', 'a tap that raced the boundary still lands');
  assert.equal(code(() => requireCounterDate('2026-10-21', current, grace)), 'COUNTER_MUST_TARGET_CURRENT_DATE');
  // Outside the window the grace date IS the current date, so yesterday is rejected.
  const later = new Date('2026-10-23T09:00:00Z');
  const laterGrace = computeTrackingDateForZone(new Date(later.getTime() - COUNTER_GRACE_MS), 'Europe/Berlin', 6);
  assert.equal(code(() => requireCounterDate('2026-10-22', '2026-10-23', laterGrace)), 'COUNTER_MUST_TARGET_CURRENT_DATE');
  // No zone to evaluate the window in: only the current date.
  assert.equal(code(() => requireCounterDate('2026-10-22', '2026-10-23', null)), 'COUNTER_MUST_TARGET_CURRENT_DATE');
});

// ---- Counter date boundaries (M2). Every instant below is fixed: the server
// clock is the `now` argument, so no test depends on the real clock. ----

/** What executeFinancialOperation accepts for a counter tap at `now`. */
const counterDatesAt = (now, { profileTimeZone = null, requestTimeZone = null, claimedDate = null, dayStartHour = 6 } = {}) => {
  const r = resolveUserTrackingDate({ now, profileTimeZone, requestTimeZone, claimedDate, dayStartHour });
  return { current: r.trackingDate, grace: counterGraceTrackingDate(now, r.timeZone, dayStartHour) };
};
const accepts = (date, at) => code(() => requireCounterDate(date, at.current, at.grace)) === null;

test('counter boundary: midnight day start rolls over once, with grace for the day that just ended', () => {
  // 00:02 Berlin (CEST) on 2026-10-24, day starts at midnight.
  const just = counterDatesAt(new Date('2026-10-23T22:02:00Z'), { profileTimeZone: 'Europe/Berlin', dayStartHour: 0 });
  assert.deepEqual(just, { current: '2026-10-24', grace: '2026-10-23' });
  assert.ok(accepts('2026-10-24', just));
  assert.ok(accepts('2026-10-23', just), 'a tap sent at 23:59:59 that lands at 00:02 still counts');
  // Past the 5-minute window the previous day is closed to counters.
  const later = counterDatesAt(new Date('2026-10-23T22:06:00Z'), { profileTimeZone: 'Europe/Berlin', dayStartHour: 0 });
  assert.deepEqual(later, { current: '2026-10-24', grace: '2026-10-24' });
  assert.ok(!accepts('2026-10-23', later));
});

test('counter boundary: DST spring-forward and fall-back keep one rollover per day', () => {
  // 2026-03-29 Berlin jumps 02:00 CET -> 03:00 CEST at 01:00Z. Day start 03:00:
  // at 01:02Z it is 03:02 CEST (new day); 5 min earlier was 01:57 CET (old day).
  const spring = counterDatesAt(new Date('2026-03-29T01:02:00Z'), { profileTimeZone: 'Europe/Berlin', dayStartHour: 3 });
  assert.deepEqual(spring, { current: '2026-03-29', grace: '2026-03-28' });
  // 2026-10-25 Berlin repeats 02:00-03:00 (03:00 CEST -> 02:00 CET at 01:00Z).
  // Day start 02:00 is first reached at 00:00Z; the repeated 02:xx hour must
  // not roll the date back or forward a second time.
  const firstPass = counterDatesAt(new Date('2026-10-25T00:30:00Z'), { profileTimeZone: 'Europe/Berlin', dayStartHour: 2 });
  const repeat = counterDatesAt(new Date('2026-10-25T01:02:00Z'), { profileTimeZone: 'Europe/Berlin', dayStartHour: 2 });
  assert.equal(firstPass.current, '2026-10-25');
  assert.deepEqual(repeat, { current: '2026-10-25', grace: '2026-10-25' });
  assert.ok(!accepts('2026-10-24', repeat), 'the repeated hour gives no extra grace to the previous day');
  // Day start 03:00 on the same day is reached once, at 02:00Z (03:00 CET).
  const fall = counterDatesAt(new Date('2026-10-25T02:02:00Z'), { profileTimeZone: 'Europe/Berlin', dayStartHour: 3 });
  assert.deepEqual(fall, { current: '2026-10-25', grace: '2026-10-24' });
});

test('counter boundary: the stored zone decides "today", not the request zone or a claimed date', () => {
  // 12:00Z: Tokyo is on 2026-10-23 (21:00); New York is on 2026-10-23 (08:00).
  const at = counterDatesAt(new Date('2026-10-23T12:00:00Z'),
    { profileTimeZone: 'Asia/Tokyo', requestTimeZone: 'America/New_York', claimedDate: '2026-10-22' });
  assert.deepEqual(at, { current: '2026-10-23', grace: '2026-10-23' });
  assert.ok(!accepts('2026-10-22', at), 'a plausible but manipulated claimed date cannot move a zoned account to yesterday');
  // Same instant, UTC vs a zone already past midnight: 23:30Z is 08:30 next
  // day in Tokyo, so the account's zone wins over UTC.
  const tokyo = counterDatesAt(new Date('2026-10-23T23:30:00Z'), { profileTimeZone: 'Asia/Tokyo' });
  const utc = counterDatesAt(new Date('2026-10-23T23:30:00Z'), { profileTimeZone: 'UTC' });
  assert.equal(tokyo.current, '2026-10-24');
  assert.equal(utc.current, '2026-10-23');
});

test('counter boundary: accounts without a saved zone', () => {
  const now = new Date('2026-10-23T06:02:00Z');
  // The shipped clients always send their zone: it is validated and becomes the
  // account zone, with the same grace as a stored one.
  const firstCall = counterDatesAt(now, { requestTimeZone: 'UTC' });
  assert.deepEqual(firstCall, { current: '2026-10-23', grace: '2026-10-22' });
  // No zone at all (an older or raw caller): a plausible claimed date is
  // taken as "today" and there is NO grace date, so exactly one date is open.
  const claimOnly = counterDatesAt(now, { claimedDate: '2026-10-22' });
  assert.deepEqual(claimOnly, { current: '2026-10-22', grace: null });
  assert.ok(accepts('2026-10-22', claimOnly));
  assert.ok(!accepts('2026-10-23', claimOnly), 'only the one claimed date is open, not the server UTC date as well');
  // No zone and no claim: server UTC with the account's day start.
  assert.deepEqual(counterDatesAt(now), { current: '2026-10-23', grace: '2026-10-22' });
});

test('counter boundary: manipulated or skewed claimed dates are rejected before any date is chosen', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  // Malformed.
  assert.equal(code(() => counterDatesAt(now, { claimedDate: '2026-10-32' })), 'INVALID_CURRENT_TRACKING_DATE');
  assert.equal(code(() => counterDatesAt(now, { claimedDate: '23.10.2026' })), 'INVALID_CURRENT_TRACKING_DATE');
  // A client clock days off cannot claim a day no zone is on, and the claim is
  // bounds-checked even when the account has a stored zone.
  assert.equal(code(() => counterDatesAt(now, { claimedDate: '2026-10-20' })), 'IMPLAUSIBLE_CURRENT_TRACKING_DATE');
  assert.equal(code(() => counterDatesAt(now, { claimedDate: '2026-10-26', profileTimeZone: 'Europe/Berlin' })), 'IMPLAUSIBLE_CURRENT_TRACKING_DATE');
  // A client clock several hours behind (still plausible: UTC-12 is on the 22nd
  // at 00:00Z-12h) yields the server's date when the zone is known: the server
  // clock, not the client's, picks "today".
  const skewed = counterDatesAt(now, { claimedDate: '2026-10-22', profileTimeZone: 'Europe/Berlin' });
  assert.equal(skewed.current, '2026-10-23');
  assert.ok(!accepts('2026-10-22', skewed));
  // A claim one day ahead is already outside every zone at 12:00Z with a 06:00 day start.
  assert.equal(code(() => counterDatesAt(now, { claimedDate: '2026-10-24', profileTimeZone: 'Europe/Berlin' })), 'IMPLAUSIBLE_CURRENT_TRACKING_DATE');
});

test('counterGraceTrackingDate is null without a zone and the boundary date within COUNTER_GRACE_MS', () => {
  assert.equal(counterGraceTrackingDate(new Date('2026-10-23T06:02:00Z'), null, 6), null);
  assert.equal(counterGraceTrackingDate(new Date('2026-10-23T06:02:00Z'), 'UTC', 6), '2026-10-22');
  const edge = new Date(Date.parse('2026-10-23T06:00:00Z') + COUNTER_GRACE_MS);
  assert.equal(counterGraceTrackingDate(edge, 'UTC', 6), '2026-10-23', 'exactly COUNTER_GRACE_MS after the boundary the window has closed');
  assert.equal(counterGraceTrackingDate(new Date(edge.getTime() - 1), 'UTC', 6), '2026-10-22');
});
