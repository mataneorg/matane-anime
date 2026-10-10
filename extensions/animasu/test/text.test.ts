import { describe, expect, it } from 'vitest';
import { cleanTitle, entityPath, parseNumber, parseStatus, parseType, releaseYear } from '../src/text';

describe('text helpers', () => {
  it('keeps paths with a trailing slash', () => {
    expect(entityPath('https://animasu.me/anime/one-piece/?x=1', 'https://animasu.love')).toBe('/anime/one-piece/');
    expect(entityPath('/anime/one-piece', 'https://animasu.love')).toBe('/anime/one-piece/');
  });
  it('reads Indonesian status and type words', () => {
    expect(parseStatus('Sedang Tayang 🔥')).toBe('ongoing');
    expect(parseStatus('Selesai')).toBe('completed');
    expect(parseStatus('?')).toBe('unknown');
    expect(parseType('Serial TV')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Drama Jepang')).toBeUndefined();
  });
  it('reads years, numbers and titles', () => {
    expect(releaseYear('Okt 1, 2026')).toBe(2026);
    expect(releaseYear(undefined)).toBeUndefined();
    expect(parseNumber('Episode 12')).toBe(12);
    expect(parseNumber('Episode 12.5')).toBe(12.5);
    expect(parseNumber('Movie')).toBeUndefined();
    expect(cleanTitle('Koori no Jouheki Season 2 Sub Indo')).toBe('Koori no Jouheki Season 2');
    expect(cleanTitle('Sub Zero')).toBe('Sub Zero');
  });
});
