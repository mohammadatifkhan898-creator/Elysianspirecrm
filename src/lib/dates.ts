/* ═══════════════════════════════════════════════════════════════
   Dates — single source of truth for calendar/date-time display.

   The restaurant operates in Asia/Kolkata. All calendar-layer dates
   (today, YYYY-MM-DD selectors, reservation date filtering, header)
   must use this fixed timezone so a user anywhere in the world sees the
   same "today" as the restaurant floor. We deliberately avoid
   `toISOString()` (which forces UTC) and `Date` getters that use the
   browser's local zone.

   All calendar-date helpers here are TIMEZONE-AWARE. Wall-clock time
   formatting (convertTime/to12) stays in lib/utils.ts.
   ═══════════════════════════════════════════════════════════════ */

export const RESTAURANT_TZ = 'Asia/Kolkata';

function part(zone: string, fmt: string, d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(d)
    .find((p) => p.type === fmt)?.value ?? '';
}

export interface KolkataDate {
  y: number;
  m: number; // 0-11
  d: number;
}

/** "Today" in Asia/Kolkata as a zero-padded "YYYY-MM-DD" string. */
export function todayKolkataISO(date: Date = new Date()): string {
  return (
    part(RESTAURANT_TZ, 'year', date) +
    '-' +
    part(RESTAURANT_TZ, 'month', date) +
    '-' +
    part(RESTAURANT_TZ, 'day', date)
  );
}

/** "Today" in Asia/Kolkata as { y, m (0-11), d }. */
export function todayKolkata(date: Date = new Date()): KolkataDate {
  return {
    y: Number(part(RESTAURANT_TZ, 'year', date)),
    m: Number(part(RESTAURANT_TZ, 'month', date)) - 1,
    d: Number(part(RESTAURANT_TZ, 'day', date)),
  };
}

/** Format "YYYY-MM-DD" (or {y,m,d}) as "27 Aug 2026" in the restaurant zone. */
export function formatISODate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return formatYMD(y, m - 1, d);
}

/** Format { y, m (0-11), d } as "27 Aug 2026". */
export function formatYMD(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m, d, 12, 0, 0));
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Mon", "Tue", ... weekday short for a "YYYY-MM-DD" string (calendar labels). */
export function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

/** Build "YYYY-MM-DD" from a zero-indexed month (0-11). */
export function fmtYMDParts(y: number, m: number, d: number): string {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** Number of days in a given month (0-11) for a year. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
}
