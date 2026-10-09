import { describe, expect, it } from 'vitest';
import { entityPath, hasPageLink, numberOfPath, parseNumber, seriesOfEpisode } from '../src/text';

describe('text helpers', () => {
  it('keeps paths with a trailing slash and no host or query', () => {
    expect(entityPath('https://anime-indo.lol/anime/one-piece/', 'https://anime-indo.lol')).toBe('/anime/one-piece/');
    expect(entityPath('/anime/one-piece?x=1', 'https://anime-indo.lol')).toBe('/anime/one-piece/');
  });
  it('finds the series of an episode path', () => {
    expect(seriesOfEpisode('/one-piece-episode-1151/')).toBe('/anime/one-piece/');
    expect(seriesOfEpisode('/kingdom-season-6-episode-000/')).toBe('/anime/kingdom-season-6/');
    expect(seriesOfEpisode('/anime/one-piece/')).toBeNull();
  });
  it('reads episode numbers', () => {
    expect(parseNumber(' 011')).toBe(11);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('Special')).toBeUndefined();
    expect(numberOfPath('/x-episode-05/')).toBe(5);
    expect(numberOfPath('/x-episode-4-5/')).toBe(4.5);
    expect(numberOfPath('/x/')).toBeUndefined();
  });
  it('finds the next page link', () => {
    expect(hasPageLink(['https://a/page/2/', 'https://a/page/10/'], 1)).toBe(true);
    expect(hasPageLink(['https://a/page/2/', 'https://a/page/10/'], 2)).toBe(false);
    expect(hasPageLink([], 1)).toBe(false);
  });
});
