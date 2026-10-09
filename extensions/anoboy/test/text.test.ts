import { describe, expect, it } from 'vitest';
import {
  entityPath,
  episodeName,
  fullCover,
  parseEpisodeDate,
  parseNumber,
  releaseYear,
  unpackPacked,
} from '../src/text';

describe('text helpers', () => {
  it('reduces links to paths, on any mirror', () => {
    expect(entityPath('https://anoboy.cc/anime/one-piece/?x=1', 'https://anoboy.be')).toBe('/anime/one-piece/');
    expect(entityPath('/anime/one-piece', 'https://anoboy.be')).toBe('/anime/one-piece/');
  });
  it('parses English dates', () => {
    expect(parseEpisodeDate('February 16, 2024')).toBe(Date.UTC(2024, 1, 16));
    expect(parseEpisodeDate('soon')).toBeUndefined();
  });
  it('reads numbers, years, covers and names', () => {
    expect(parseNumber('1180')).toBe(1180);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('Movie')).toBeUndefined();
    expect(releaseYear('1999')).toBe(1999);
    expect(releaseYear('?')).toBeUndefined();
    expect(fullCover('https://i1.wp.com/a.jpg?resize=247,350')).toBe('https://i1.wp.com/a.jpg');
    expect(episodeName('One Piece Episode 1180 Subtitle Indonesia', '1180')).toBe('Episode 1180');
  });
  it('unpacks a packed script without running it', () => {
    const src = "eval(function(p,a,c,k,e,d){}('0 1=\\'2\\';',3,3,'var|x|hi'.split('|')))";
    expect(unpackPacked(src)).toBe("var x='hi';");
  });
});
