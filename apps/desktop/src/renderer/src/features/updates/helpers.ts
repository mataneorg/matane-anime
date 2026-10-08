import type { AutoDownloadMode, UpdateEntry } from '@matane-anime/shared';
import { dayKey, dayLabel } from '../../lib/dates';

export interface UpdateGroup {
  key: number;
  label: string;
  entries: UpdateEntry[];
}

/** One group per local day, in the order the list arrives (newest first). */
export function groupByDay(entries: UpdateEntry[], now: number, locale: string): UpdateGroup[] {
  const groups: UpdateGroup[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.fetchedAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, label: dayLabel(entry.fetchedAt, now, locale), entries: [entry] });
  }
  return groups;
}

/** The sidebar badge: nothing at 0, the number up to 99, then "99+" (UPD-8). */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** Clicking a category's box cycles: no mark → include → exclude → no mark (DL-11). */
export function nextAutoDownloadMode(mode: AutoDownloadMode | null): AutoDownloadMode | null {
  return mode === null ? 'include' : mode === 'include' ? 'exclude' : null;
}

/** `aria-checked` of the tri-state box: included is checked, excluded is "mixed" (the dash). */
export function ariaCheckedOf(mode: AutoDownloadMode | null): 'true' | 'false' | 'mixed' {
  return mode === 'include' ? 'true' : mode === 'exclude' ? 'mixed' : 'false';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function clock(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

/**
 * When an episode turned up (mockup 07): "12 minutes ago" and "3 hours ago" within the day, "yesterday, 21:40"
 * before that, then the date with the time.
 */
export function foundAt(timestamp: number, now: number, locale: string): string {
  const age = Math.max(0, now - timestamp);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (age < MINUTE) return relative.format(0, 'second');
  if (age < HOUR) return relative.format(-Math.floor(age / MINUTE), 'minute');
  if (age < 24 * HOUR && dayKey(timestamp) === dayKey(now)) return relative.format(-Math.floor(age / HOUR), 'hour');
  const days = Math.round((dayKey(now) - dayKey(timestamp)) / 86_400_000);
  if (days <= 1) return `${relative.format(-days, 'day')}, ${clock(timestamp, locale)}`;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

/** "today at 09:12", "yesterday at 21:40", or the date, for the "Last checked" line. */
export function checkedAt(timestamp: number, now: number, locale: string, at: (day: string, time: string) => string) {
  const days = Math.round((dayKey(now) - dayKey(timestamp)) / 86_400_000);
  if (days <= 1) {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.max(days, 0), 'day');
    return at(day, clock(timestamp, locale));
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

/** "Ep 12 · Name", unless the name already says which episode it is (same rule as the episode list). */
export function entryTitle(entry: UpdateEntry, label: (number: number) => string): string {
  if (entry.episodeNumber === null || /^\s*(ep(isode)?\b|#?\d)/i.test(entry.episodeName)) return entry.episodeName;
  return `${label(entry.episodeNumber)} · ${entry.episodeName}`;
}
