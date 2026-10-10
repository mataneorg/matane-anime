import { describe, expect, it } from 'vitest';
import { STATUSES, TYPES, cleanDescription, coverOf, episodeUrl, splitEpisodeUrl } from '../src/text';

describe('text helpers', () => {
  it('maps AniList words', () => {
    expect(STATUSES['RELEASING']).toBe('ongoing');
    expect(STATUSES['FINISHED']).toBe('completed');
    expect(STATUSES['NOT_YET_RELEASED']).toBeUndefined();
    expect(TYPES['TV_SHORT']).toBe('tv');
    expect(TYPES['MOVIE']).toBe('movie');
  });
  it('reads covers given as an object or a string', () => {
    expect(coverOf({ extraLarge: 'a', large: 'b' })).toBe('a');
    expect(coverOf({ large: 'b' })).toBe('b');
    expect(coverOf('c')).toBe('c');
    expect(coverOf(null)).toBeUndefined();
  });
  it('cleans the synopsis', () => {
    expect(cleanDescription('A<br>B<br><br><br>C &quot;d&quot; &amp; <i>e</i>')).toBe('A\nB\n\nC "d" & e');
    expect(cleanDescription('  ')).toBeUndefined();
    expect(cleanDescription(null)).toBeUndefined();
  });
  it('builds and splits episode urls, fractions included', () => {
    expect(episodeUrl('x-1', 12.5, 'dub')).toBe('x-1/12.5/dub');
    expect(splitEpisodeUrl('x-1/12.5/dub')).toEqual({ id: 'x-1', number: '12.5', type: 'dub' });
    expect(splitEpisodeUrl('x-1')).toBeUndefined();
    expect(splitEpisodeUrl('x-1/3/raw')).toBeUndefined();
  });
});
