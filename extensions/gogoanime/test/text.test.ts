import { describe, expect, it } from 'vitest';
import { entityPath, fullCover, isDub, parseNumber, parseStatus, parseType, releaseYear } from '../src/text';

describe('text helpers', () => {
  it('keeps paths with a trailing slash and no host', () => {
    expect(entityPath('https://gogoanime.by/series/one-piece/?x=1', 'https://gogoanime.by')).toBe('/series/one-piece/');
    expect(entityPath('/x-episode-1-english-subbed', 'https://gogoanime.by')).toBe('/x-episode-1-english-subbed/');
  });
  it('strips the thumbnail query of covers', () => {
    expect(fullCover('https://i2.wp.com/a.jpg?resize=246,350')).toBe('https://i2.wp.com/a.jpg');
    expect(fullCover(undefined)).toBeUndefined();
  });
  it('maps status, type and year', () => {
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Completed')).toBe('completed');
    expect(parseStatus('?')).toBe('unknown');
    expect(parseType('Anime')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Drama')).toBeUndefined();
    expect(releaseYear('Mar 19, 2026 to ?')).toBe(2026);
  });
  it('finds dubs and episode numbers', () => {
    expect(isDub('/one-piece-episode-1123-english-dubbed/')).toBe(true);
    expect(isDub('/series/bleach-dubbed/')).toBe(true);
    expect(isDub('/one-piece-episode-1-english-subbed/')).toBe(false);
    expect(parseNumber('/x-episode-12-english-subbed/')).toBe(12);
    expect(parseNumber('Episode 3.5')).toBe(3.5);
    expect(parseNumber('Movie')).toBeUndefined();
  });
});
