/*
 * Manila wall-clock arithmetic, in one place.
 *
 * Manila has been a fixed UTC+8 offset with no daylight saving since 1978, so
 * the shift is a constant and none of this needs a timezone database.
 *
 * Why shared rather than per-service: the day boundary has to be computed
 * identically everywhere. The one-punch-a-day rule, the lateness comparison and
 * the dashboard's "checked in today" all have to agree about which day a punch
 * belongs to, and a second copy of this arithmetic is a second answer.
 */

export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The half-open window covering one Asia/Manila calendar day.
 *
 * Attendance days are counted in the site's local date, not in UTC and not over
 * a rolling 24 hours. A punch at 07:00 Manila on the 30th and another at 23:30
 * Manila on the 30th are the same day; 00:30 on the 31st is not.
 *
 * Deliberately **not** the server's local midnight. On a host running UTC
 * (Render, most containers) `setHours(0,0,0,0)` is 08:00 Manila, so the day
 * would begin eight hours into the working day -- and the dashboard would
 * disagree with the check-in rule about whose punch counts as today's.
 */
export function manilaDayWindow(at: Date): { start: Date; end: Date } {
  const manila = new Date(at.getTime() + MANILA_OFFSET_MS);
  const start = new Date(
    Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate()) -
      MANILA_OFFSET_MS,
  );

  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Minutes since midnight in Asia/Manila, e.g. 08:30 Manila -> 510. */
export function manilaMinutesOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + MANILA_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Read a Postgres `time` column ("08:00:00") as minutes since midnight.
 *
 * Returns null for anything unset or unparseable rather than throwing: a site
 * with no shift start is a valid configuration (nobody is measured against a
 * clock), and a malformed value must not take down a whole list.
 */
export function parseShiftStartMinutes(
  value: string | null | undefined,
): number | null {
  if (!value) return null;

  const match = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * `HH:mm:ss` (what Postgres returns for TIME) down to `HH:mm`, or null.
 *
 * An HTML time input round-trips `HH:mm`, and feeding it `08:00:00` makes the
 * field render as empty on some browsers -- so a saved shift start would look
 * unsaved the next time the form was opened.
 */
export function toHhMm(value?: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(String(value));
  return match ? `${match[1]}:${match[2]}` : null;
}
