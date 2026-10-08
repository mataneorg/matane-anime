const DAY_MS = 86_400_000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The heading of a day in the history (mockup 09): "Today", "Yesterday", the weekday for the days before in
 * the past week, then the date. Words come from `Intl`, so they follow the app language.
 */
export function dayLabel(timestamp: number, now: number, locale: string): string {
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 1) {
    const label = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.max(days, 0), 'day');
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  }
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(timestamp);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp);
}

/** A key that is the same for every moment of one local day, to group by. */
export function dayKey(timestamp: number): number {
  return startOfDay(timestamp);
}

/** `12:43` or `1:02:03`, for a position in milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * DAY_MS],
  ['month', 30 * DAY_MS],
  ['day', DAY_MS],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "2 hours ago", "yesterday", "just now": how long ago something happened, in the app language. */
export function relativeTime(timestamp: number, now: number, locale: string): string {
  const elapsed = Math.max(0, now - timestamp);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit);
  }
  return format.format(0, 'second');
}
