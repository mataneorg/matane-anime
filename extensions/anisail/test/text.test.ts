import { describe, expect, it } from 'vitest';
import {
  entityPath,
  labelHeight,
  parseNumber,
  parseStatus,
  parseType,
  parseYear,
  seriesOfEpisode,
  seriesTitle,
  titleOfEpisode,
} from '../src/text';

describe('text helpers', () => {
  it('keeps paths with a trailing slash', () => {
    expect(entityPath('https://anisail.com/anime/one-piece/?x=1', 'https://anisail.com')).toBe('/anime/one-piece/');
    expect(entityPath('/one-piece-episode-3', 'https://anisail.com')).toBe('/one-piece-episode-3/');
  });
  it('cleans titles', () => {
    expect(seriesTitle('Tokyo Revengers Subtitle Indonesia')).toBe('Tokyo Revengers');
    expect(titleOfEpisode('Tokyo Revengers Episode 24 Subtitle Indonesia')).toBe('Tokyo Revengers');
    expect(titleOfEpisode('Movie Subtitle Indonesia')).toBe('Movie');
  });
  it('finds the series and number of an episode', () => {
    expect(seriesOfEpisode('/kuang-wang-2-episode-5/')).toBe('/anime/kuang-wang-2/');
    expect(seriesOfEpisode('/anime/one-piece/')).toBeNull();
    expect(parseNumber('Tokyo Revengers Episode 24 Subtitle Indonesia')).toBe(24);
    expect(parseNumber('Special Subtitle Indonesia')).toBeUndefined();
  });
  it('maps status, type, year and quality labels', () => {
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Completed')).toBe('completed');
    expect(parseStatus('?')).toBe('unknown');
    expect(parseType('TV')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Music')).toBeUndefined();
    expect(parseYear('2021')).toBe(2021);
    expect(labelHeight('pixel 720p')).toBe(720);
    expect(labelHeight('vikingfile')).toBeUndefined();
  });
});
