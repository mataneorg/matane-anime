import { describe, expect, it } from 'vitest';
import { animePath, isAdultTag, isEpisodeKey, parseAge, parseNumber, pickSource, readYear } from '../src/text';

describe('text helpers', () => {
  it('reads the anime id from links', () => {
    expect(animePath('anime.php?ugyek', 'https://animeheaven.me')).toBe('/anime.php?ugyek');
    expect(animePath('https://animeheaven.me/anime.php?t2py4', 'https://animeheaven.me')).toBe('/anime.php?t2py4');
    expect(animePath('new.php', 'https://animeheaven.me')).toBeUndefined();
  });

  it('recognises episode keys', () => {
    expect(isEpisodeKey('2ed532e1010005afeed2d9725c144bfd')).toBe(true);
    expect(isEpisodeKey('gate.php')).toBe(false);
  });

  it('turns ages into durations', () => {
    expect(parseAge('18 min ago')).toBe(18 * 60_000);
    expect(parseAge('3 h ago')).toBe(3 * 3_600_000);
    expect(parseAge('11 d ago')).toBe(11 * 86_400_000);
    expect(parseAge('2 y ago')).toBe(2 * 365 * 86_400_000);
    expect(parseAge('soon')).toBeUndefined();
  });

  it('parses numbers and years', () => {
    expect(parseNumber('01')).toBe(1);
    expect(parseNumber('1150.5 ')).toBe(1150.5);
    expect(parseNumber('2raw')).toBeUndefined();
    expect(readYear('1999-?')).toBe(1999);
    expect(readYear('?')).toBeUndefined();
  });

  it('flags adult tags', () => {
    expect(isAdultTag('Hentai')).toBe(true);
    expect(isAdultTag('Ecchi')).toBe(false);
  });

  it('picks the first mp4 source that is not a fallback', () => {
    const page = `<source src='https://cz.x.me/video.mp4?k&t&error' type='video/mp4'><source src='https://cz.x.me/video.mp4?k&t' type='video/mp4'>`;
    expect(pickSource(page)).toBe('https://cz.x.me/video.mp4?k&t');
    expect(pickSource('<html>404</html>')).toBeUndefined();
  });
});
