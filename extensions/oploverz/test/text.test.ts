import { describe, expect, it } from 'vitest';
import { airYear, cleanText, episodeTime, splitEpisodeUrl } from '../src/text';

describe('text helpers', () => {
  it('splits an episode url at its last slash', () => {
    expect(splitEpisodeUrl('one-piece/1180')).toEqual({ slug: 'one-piece', number: '1180' });
    expect(() => splitEpisodeUrl('one-piece')).toThrow();
  });

  it('prefers the season year, falls back to the release date', () => {
    expect(airYear('Fall 1999', '2026-01-01T00:00:00.000Z')).toBe(1999);
    expect(airYear(undefined, '2024-05-01T00:00:00.000Z')).toBe(2024);
    expect(airYear(null, null)).toBeUndefined();
  });

  it('drops 1970 release dates for the creation date', () => {
    expect(episodeTime('1970-01-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z')).toBe(
      Date.parse('2025-03-01T00:00:00.000Z'),
    );
    expect(episodeTime('2026-01-01T00:00:00.000Z', null)).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(episodeTime('1970-01-01T00:00:00.000Z', null)).toBeUndefined();
  });

  it('cleans carriage returns from descriptions', () => {
    expect(cleanText('a\r\n\r\n\r\n\r\nb ')).toBe('a\n\nb');
    expect(cleanText(null)).toBeUndefined();
  });
});
