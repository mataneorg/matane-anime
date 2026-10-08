import type { UpdateEntry } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { ariaCheckedOf, badgeText, checkedAt, entryTitle, foundAt, groupByDay, nextAutoDownloadMode } from './helpers';

const HOUR = 3_600_000;
const NOW = new Date(2026, 5, 15, 14, 0).getTime();

const entry = (episodeId: number, fetchedAt: number): UpdateEntry => ({
  episodeId,
  animeId: 1,
  sourceId: 'example/en',
  sourceName: 'Example (EN)',
  animeTitle: 'Alpha',
  thumbnailUrl: null,
  hasLocalCover: false,
  episodeNumber: episodeId,
  episodeName: `Episode ${episodeId}`,
  variant: null,
  fetchedAt,
  download: null,
});

describe('groupByDay', () => {
  it('groups by local day and labels Today and Yesterday', () => {
    const groups = groupByDay(
      [entry(4, NOW - HOUR), entry(3, NOW - 2 * HOUR), entry(2, NOW - 20 * HOUR), entry(1, NOW - 30 * HOUR)],
      NOW,
      'en',
    );
    expect(groups.map((group) => [group.label, group.entries.map((e) => e.episodeId)])).toEqual([
      ['Today', [4, 3]],
      ['Yesterday', [2, 1]],
    ]);
  });

  it('is empty without entries and falls back to dates for older days', () => {
    expect(groupByDay([], NOW, 'en')).toEqual([]);
    const [group] = groupByDay([entry(1, NOW - 20 * 24 * HOUR)], NOW, 'en');
    expect(group?.label).toMatch(/2026/);
  });
});

describe('badgeText', () => {
  it('hides at zero and caps at 99+', () => {
    expect([0, 1, 99, 100, 5000].map(badgeText)).toEqual([null, '1', '99', '99+', '99+']);
    expect(badgeText(-1)).toBeNull();
  });
});

describe('the auto-download tri-state', () => {
  it('cycles no mark → include → exclude → no mark', () => {
    expect(nextAutoDownloadMode(null)).toBe('include');
    expect(nextAutoDownloadMode('include')).toBe('exclude');
    expect(nextAutoDownloadMode('exclude')).toBeNull();
  });

  it('maps to aria-checked', () => {
    expect([null, 'include', 'exclude'].map((mode) => ariaCheckedOf(mode as never))).toEqual([
      'false',
      'true',
      'mixed',
    ]);
  });
});

describe('foundAt and checkedAt', () => {
  it('uses relative words within the day and the day name before', () => {
    expect(foundAt(NOW - 10_000, NOW, 'en')).toBe('now');
    expect(foundAt(NOW - 12 * 60_000, NOW, 'en')).toBe('12 minutes ago');
    expect(foundAt(NOW - 3 * HOUR, NOW, 'en')).toBe('3 hours ago');
    expect(foundAt(new Date(2026, 5, 14, 21, 40).getTime(), NOW, 'en')).toMatch(/^yesterday, /);
    expect(foundAt(new Date(2026, 5, 1, 21, 40).getTime(), NOW, 'en')).toMatch(/2026/);
  });

  it('says when the last check was', () => {
    const at = (day: string, time: string) => `${day} at ${time}`;
    expect(checkedAt(NOW - HOUR, NOW, 'en', at)).toMatch(/^today at /);
    expect(checkedAt(NOW - 20 * HOUR, NOW, 'en', at)).toMatch(/^yesterday at /);
    expect(checkedAt(NOW - 10 * 24 * HOUR, NOW, 'en', at)).toMatch(/2026/);
  });
});

describe('entryTitle', () => {
  const label = (number: number) => `Ep ${number}`;
  it('adds the number unless the name already carries it', () => {
    expect(entryTitle({ ...entry(14, 0), episodeName: 'The Last Lantern' }, label)).toBe('Ep 14 · The Last Lantern');
    expect(entryTitle({ ...entry(14, 0), episodeName: 'Episode 14' }, label)).toBe('Episode 14');
    expect(entryTitle({ ...entry(1, 0), episodeNumber: null, episodeName: 'Special' }, label)).toBe('Special');
  });
});
