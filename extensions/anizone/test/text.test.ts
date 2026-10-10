import { describe, expect, it } from 'vitest';
import {
  altTitles,
  bestTitle,
  decodeCursor,
  entityPath,
  parseAirDate,
  parseStatus,
  parseType,
  readJson,
  readPaging,
  readPlayer,
  unescapeHtml,
  unescapeJs,
} from '../src/text';

describe('text helpers', () => {
  it('undoes the escapes of the JS string literal the pages embed', () => {
    expect(unescapeJs(String.raw`{"a":"x\\\/y"}`)).toBe('{"a":"x\\/y"}');
    expect(unescapeJs(String.raw`a\'b\\n`)).toBe("a'b\\n");
    expect(unescapeHtml('&quot;a&quot; &amp; &#039;b&#039;')).toBe('"a" & \'b\'');
  });
  it('reads a JSON.parse value of an x-data attribute, also when it contains quotes and long text', () => {
    const value = String.raw`[{"t":"It\'s \\u0022q\\u0022"}]`;
    const page = `x-data="{ items: JSON.parse('${value}'), nextCursor: 'abc', hasMore: true }"`;
    expect(readJson<{ t: string }[]>(page, 'items')).toEqual([{ t: 'It\'s "q"' }]);
    expect(readJson(page, 'nope')).toBeUndefined();
    expect(readJson("x: JSON.parse('{bad')", 'x')).toBeUndefined();
    expect(readPaging(page)).toEqual({ nextCursor: 'abc', hasMore: true });
    expect(readPaging('nextCursor: null, hasMore: false')).toEqual({ nextCursor: null, hasMore: false });
    expect(readPaging('nextCursor: null, hasMore: true')).toEqual({ nextCursor: null, hasMore: false });
  });
  it('reads the player value', () => {
    expect(readPlayer(String.raw`vidstackPlayer(JSON.parse('{"src":"https:\\\/\\\/c.test\\\/m.m3u8"}'))`)).toEqual({
      src: 'https://c.test/m.m3u8',
    });
    expect(readPlayer('<html></html>')).toBeUndefined();
  });
  it('picks English, then romaji titles', () => {
    expect(bestTitle({ '1': 'English', '5': 'Romaji', '8': '日本語' })).toBe('English');
    expect(bestTitle({ '5': 'Romaji', '8': '日本語' })).toBe('Romaji');
    expect(bestTitle(undefined, 'Main')).toBe('Main');
    expect(altTitles({ '1': 'English', '5': 'Romaji', '8': '日本語' }, 'English')).toEqual(['Romaji', '日本語']);
  });
  it('maps type, status, dates and cursors', () => {
    expect(parseType('TV Series')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Music Video')).toBeUndefined();
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Completed')).toBe('completed');
    expect(parseAirDate('2026-10-12')).toBe(Date.UTC(2026, 9, 12));
    expect(parseAirDate('soon')).toBeUndefined();
    expect(decodeCursor('eyJzb3J0IjoyNH0=', (t) => atob(t))).toEqual({ sort: 24 });
    expect(decodeCursor('%%%', (t) => atob(t))).toBeUndefined();
    expect(entityPath('https://anizone.to/anime/x/1/', 'https://anizone.to')).toBe('/anime/x/1');
  });
});
