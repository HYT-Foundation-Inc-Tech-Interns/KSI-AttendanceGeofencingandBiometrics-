/*
 * Presentation-only formatters shared across pages.
 *
 * `formatLate` lived as a private copy inside the attendance page. The
 * dashboard's "Checked In Today" hover needs the identical string, and two
 * copies of a formatter is two answers to the same question the first time one
 * of them is tweaked.
 */

/**
 * Minutes late, as a compact label: `12m`, `1h`, `2h 17m`.
 *
 * Callers are responsible for only rendering this for a genuinely late punch --
 * zero minutes means on time, and "Late 0m" would be a contradiction.
 */
export function formatLate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
