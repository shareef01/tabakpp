/**
 * Input validation for the trusted financial callables.
 *
 * The Admin SDK bypasses Firestore rules, so every bound the rules enforce on a
 * direct client write (date shape, id charset, count range, map size) has to be
 * re-enforced here — otherwise the "trusted" boundary is looser than the
 * untrusted one it replaces.
 */
import { HttpsError } from 'firebase-functions/v2/https';

export const DEFAULT_DAY_START_HOUR = 6;
export const MAX_COUNT = 10000;            // rules: validCountValue
export const MAX_DAY_TRACKERS = 25;        // rules: validDayCountMap
export const MAX_HISTORICAL_TRACKERS = 50; // rules: validCountMap

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// The furthest ahead any timezone's calendar date can be from UTC (UTC+14).
const MAX_ZONE_LEAD_MS = 14 * 60 * 60 * 1000;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export const isCalendarDate = (v) => {
  if (typeof v !== 'string') return false;
  const m = DATE_PATTERN.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
};

/**
 * A tracking date that is not in the future for ANY timezone. The server does
 * not know the user's zone, so this is the tightest bound it can enforce
 * without rejecting a legitimate "today" east of UTC.
 */
export const requireTrackingDate = (v, now = new Date()) => {
  if (!isCalendarDate(v)) throw new HttpsError('invalid-argument', 'INVALID_DATE');
  const latest = new Date(now.getTime() + MAX_ZONE_LEAD_MS).toISOString().slice(0, 10);
  if (v > latest) throw new HttpsError('invalid-argument', 'FUTURE_DATE');
  return v;
};

/**
 * A Firestore document id safe to use as a single path segment. A `/` would
 * otherwise address a nested document the rules never validated.
 */
export const requireId = (v, code, maxLen = 128) => {
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen || !ID_PATTERN.test(v)) {
    throw new HttpsError('invalid-argument', code);
  }
  return v;
};

const validCount = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_COUNT;

/**
 * Validate a counts map. Keys must be tracker ids (rules' validCountKey) and
 * values whole numbers within the rules' bounds; anything else is rejected
 * rather than silently dropped, so a malformed client fails loudly.
 */
const sanitize = (counts, { keepZero, maxEntries }) => {
  if (counts == null) return {};
  if (typeof counts !== 'object' || Array.isArray(counts)) {
    throw new HttpsError('invalid-argument', 'INVALID_COUNTS');
  }
  const out = {};
  for (const [id, v] of Object.entries(counts)) {
    if (!ID_PATTERN.test(id) || id.length > 64) throw new HttpsError('invalid-argument', 'INVALID_TRACKER_ID');
    const n = Number(v);
    if (!validCount(n)) throw new HttpsError('invalid-argument', 'INVALID_COUNT');
    if (n > 0 || keepZero) out[id] = n;
  }
  if (Object.keys(out).length > maxEntries) throw new HttpsError('invalid-argument', 'TOO_MANY_TRACKERS');
  return out;
};

/** Manual-log counts: zero entries are dropped. */
export const sanitizeCounts = (counts) =>
  sanitize(counts, { keepZero: false, maxEntries: MAX_DAY_TRACKERS });

/** Historical-day edit counts: a zero clears that tracker's counter, so keep it. */
export const sanitizeHistoricalCounts = (counts) =>
  sanitize(counts, { keepZero: true, maxEntries: MAX_HISTORICAL_TRACKERS });

/** How recently the caller must have signed in for a destructive operation. */
export const RECENT_LOGIN_MAX_AGE_SEC = 5 * 60;

/**
 * Require that the ID token comes from a sign-in (or reauthentication) within
 * the last few minutes — the server-side twin of the client's reauth step, so a
 * leaked hour-long ID token alone cannot wipe an account.
 */
export const requireRecentLogin = (token, nowSec = Math.floor(Date.now() / 1000)) => {
  const authTime = Number(token?.auth_time);
  if (!Number.isFinite(authTime) || nowSec - authTime > RECENT_LOGIN_MAX_AGE_SEC) {
    throw new HttpsError('unauthenticated', 'RECENT_LOGIN_REQUIRED');
  }
};

// The westernmost zone in use (UTC-12); MAX_ZONE_LEAD_MS is the easternmost.
const MAX_ZONE_LAG_MS = 12 * 60 * 60 * 1000;

/** The tracking date for wall-clock `ms` (already shifted into a zone), day-start aware. */
const trackingDateAt = (ms, dayStartHour) =>
  new Date(ms - dayStartHour * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * The user's CURRENT tracking date. The server has no timezone for the user,
 * so the client sends the date its device computes (same day-start rule both
 * apps use); the server accepts it only if it is the current tracking date
 * somewhere on Earth right now (UTC-12 … UTC+14). A client that omits it (an
 * older build) gets the previous behaviour: the date evaluated in UTC.
 *
 * Bounding is all the server can do — a stored profile timezone would allow
 * the same window, since any valid zone could be chosen.
 */
export const resolveCurrentTrackingDate = (claimed, dayStartHour, now = new Date()) => {
  const start = resolveDayStartHour(dayStartHour);
  const t = now.getTime();
  if (claimed == null) return trackingDateAt(t, start);
  if (!isCalendarDate(claimed)) throw new HttpsError('invalid-argument', 'INVALID_CURRENT_TRACKING_DATE');
  const earliest = trackingDateAt(t - MAX_ZONE_LAG_MS, start);
  const latest = trackingDateAt(t + MAX_ZONE_LEAD_MS, start);
  if (claimed < earliest || claimed > latest) {
    throw new HttpsError('invalid-argument', 'IMPLAUSIBLE_CURRENT_TRACKING_DATE');
  }
  return claimed;
};

/** The profile's day-start hour; 0 (midnight) is a valid setting, not "unset". */
export const resolveDayStartHour = (v) => {
  const n = Number(v);
  return v == null || !Number.isInteger(n) || n < 0 || n > 23 ? DEFAULT_DAY_START_HOUR : n;
};
