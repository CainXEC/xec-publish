// =============================================================================
//  lib/powRewards/isoWeek.ts
//  ISO-8601 week helpers (UTC, Monday-start). The reward epoch key is 'YYYY-Www'
//  (e.g. '2026-W37'), and each week is the half-open UTC interval
//  [Monday 00:00, next Monday 00:00). Weekly rewards tally the LAST COMPLETE week,
//  so a week is only ever paid after it has fully ended.
// =============================================================================

const DAY_MS = 86_400_000;

export interface WeekBounds {
  isoWeek: string; // 'YYYY-Www'
  startUtc: Date; // inclusive
  endUtc: Date; // exclusive
}

/** Monday 00:00:00.000 UTC of the ISO week containing `d`. */
function isoWeekStart(d: Date): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); // 0=Sun … 6=Sat
  const shiftToMonday = dow === 0 ? -6 : 1 - dow;
  t.setUTCDate(t.getUTCDate() + shiftToMonday);
  return t;
}

/** ISO year + week number for a date (Thursday rule). */
function isoWeekParts(d: Date): { year: number; week: number } {
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const monIdx = (thursday.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  thursday.setUTCDate(thursday.getUTCDate() - monIdx + 3); // Thursday of this week
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4MonIdx = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = new Date(jan4);
  week1Thursday.setUTCDate(jan4.getUTCDate() - jan4MonIdx + 3);
  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * DAY_MS));
  return { year: isoYear, week };
}

/** The ISO week (key + UTC bounds) that contains `d`. */
export function weekBoundsFor(d: Date): WeekBounds {
  const startUtc = isoWeekStart(d);
  const endUtc = new Date(startUtc.getTime() + 7 * DAY_MS);
  const { year, week } = isoWeekParts(startUtc);
  return { isoWeek: `${year}-W${String(week).padStart(2, '0')}`, startUtc, endUtc };
}

/** The most recent COMPLETE ISO week relative to `now` (i.e. "last week"). */
export function lastCompleteWeek(now: Date = new Date()): WeekBounds {
  return weekBoundsFor(new Date(now.getTime() - 7 * DAY_MS));
}

export interface DayBounds {
  date: string; // 'YYYY-MM-DD' (UTC)
  startUtc: Date; // inclusive
  endUtc: Date; // exclusive
}

/** The most recent COMPLETE UTC day relative to `now` (i.e. "yesterday"):
 *  [yesterday 00:00, today 00:00). The herald's daily post reads this. */
export function lastCompleteDay(now: Date = new Date()): DayBounds {
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // today 00:00
  const startUtc = new Date(endUtc.getTime() - DAY_MS);
  return { date: startUtc.toISOString().slice(0, 10), startUtc, endUtc };
}

/** Parse a 'YYYY-Www' key back to its UTC bounds (for re-running a named week). */
export function weekBoundsForKey(isoWeek: string): WeekBounds {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) throw new Error(`bad ISO week key: ${isoWeek}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // Week 1 contains Jan 4; find that week's Monday, then add (week-1) weeks.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = isoWeekStart(jan4);
  const startUtc = new Date(monday.getTime() + (week - 1) * 7 * DAY_MS);
  const endUtc = new Date(startUtc.getTime() + 7 * DAY_MS);
  return { isoWeek, startUtc, endUtc };
}
