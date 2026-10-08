import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { episodeLabel, episodePath, sanitizeName, tempPath, uniquePath } from './layout';

describe('sanitizeName', () => {
  it('replaces what Windows, macOS or Linux refuse', () => {
    expect(sanitizeName('Re:Zero / Season 2? <TV>')).toBe('Re_Zero _ Season 2_ _TV_');
    expect(sanitizeName('a\\b|c*d"e')).toBe('a_b_c_d_e');
    expect(sanitizeName('tab\there\u0000x')).toBe('tab_here_x');
  });

  it('drops trailing dots and spaces, and defuses leading dots', () => {
    expect(sanitizeName('Title...  ')).toBe('Title');
    expect(sanitizeName('..')).toBe('__');
    expect(sanitizeName('.hidden')).toBe('_hidden');
    expect(sanitizeName('   ')).toBe('_');
    expect(sanitizeName('', 'Anime')).toBe('Anime');
  });

  it('prefixes reserved Windows names, with or without an extension', () => {
    for (const name of ['CON', 'nul', 'COM1', 'lpt9', 'aux.txt', 'Prn']) {
      expect(sanitizeName(name)).toBe(`_${name}`);
    }
    expect(sanitizeName('Console')).toBe('Console');
    expect(sanitizeName('COM10')).toBe('COM10');
  });

  it('keeps unicode, normalizes it, and collapses whitespace', () => {
    expect(sanitizeName('進撃の巨人   The Final')).toBe('進撃の巨人 The Final');
    expect(sanitizeName('é')).toBe('é');
  });

  it('cuts long names to a byte budget without breaking a character', () => {
    const long = sanitizeName('あ'.repeat(200));
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(120);
    expect([...long].every((c) => c === 'あ')).toBe(true);
    const emoji = sanitizeName(`${'a'.repeat(119)}😀tail`);
    expect(emoji).toBe('a'.repeat(119));
    expect(sanitizeName(`${'x'.repeat(118)}. . .tail`)).toBe('x'.repeat(118));
  });
});

describe('episode paths', () => {
  const base = { root: join('/dl'), source: 'Example (EN)', anime: 'Frieren: Beyond Journey', kind: 'hls' as const };

  it('puts HLS in a folder and MP4 in a file, under source and anime', () => {
    expect(episodePath({ ...base, episode: { number: 3, name: 'Episode 3' } })).toBe(
      join('/dl', 'Example (EN)', 'Frieren_ Beyond Journey', 'Episode 3'),
    );
    expect(episodePath({ ...base, kind: 'mp4', episode: { number: 3, name: 'Episode 3' } })).toBe(
      join('/dl', 'Example (EN)', 'Frieren_ Beyond Journey', 'Episode 3.mp4'),
    );
  });

  it('labels an episode without a name by its number, and tells variants apart', () => {
    expect(episodeLabel({ number: 7, name: ' ' })).toBe('Episode 7');
    expect(episodeLabel({ number: null, name: '' })).toBe('Episode');
    expect(episodeLabel({ number: 1, name: 'Episode 1', variant: 'Dub' })).toBe('Episode 1 [Dub]');
    expect(episodeLabel({ number: 1, name: 'Episode 1 (Dub)', variant: 'Dub' })).toBe('Episode 1 (Dub)');
  });

  it('cannot escape the download folder', () => {
    const path = episodePath({ ...base, anime: '../../etc', episode: { number: 1, name: '../passwd' } });
    expect(path.startsWith(join('/dl', 'Example (EN)') + '/')).toBe(true);
    expect(path.split('/')).not.toContain('..');
  });

  it('numbers a name that is taken', () => {
    const taken = new Set(['/a/Episode 1', '/a/Episode 1 (2)', '/a/Episode 1.mp4']);
    expect(uniquePath('/a/Episode 1', (p) => taken.has(p))).toBe('/a/Episode 1 (3)');
    expect(uniquePath('/a/Episode 1.mp4', (p) => taken.has(p))).toBe('/a/Episode 1 (2).mp4');
    expect(uniquePath('/a/Episode 2', (p) => taken.has(p))).toBe('/a/Episode 2');
  });

  it('keeps unfinished data beside the final path', () => {
    expect(tempPath('/a/Episode 1', 'hls')).toBe('/a/Episode 1.tmp');
    expect(tempPath('/a/Episode 1.mp4', 'mp4')).toBe('/a/Episode 1.mp4.part');
  });
});
