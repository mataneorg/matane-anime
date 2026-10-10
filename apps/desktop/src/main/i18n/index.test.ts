import { LANGUAGES } from '@matane-anime/shared';
import { describe, expect, it } from 'vitest';
import { en, id } from './catalog';
import { mainT } from '.';

describe('the main-process catalogs', () => {
  it('have exactly the same keys in every language', () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
  });

  it('have no empty text, and the same placeholders in every language', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(id[key], key).not.toBe('');
      expect(placeholders(id[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('cover every language the app offers', () => {
    for (const language of LANGUAGES) expect(mainT(language, 'tray.quit')).not.toBe('tray.quit');
  });
});

describe('mainT', () => {
  it('fills in placeholders', () => {
    expect(mainT('en', 'notify.newEpisodes.fromMany', { count: 3, anime: 2 })).toBe('3 new episodes from 2 anime');
    expect(mainT('id', 'notify.newEpisodes.ofAnime', { count: 2, title: 'Frieren' })).toBe(
      '2 episode baru dari Frieren',
    );
  });

  it('picks the plural form by the language', () => {
    expect(mainT('en', 'notify.newEpisodes.ofAnime', { count: 1, title: 'X' })).toBe('1 new episode of X');
    expect(mainT('en', 'notify.newEpisodes.ofAnime', { count: 0, title: 'X' })).toBe('0 new episodes of X');
  });

  it('leaves a placeholder it has no value for, and does not touch values that look like placeholders', () => {
    expect(mainT('en', 'notify.newEpisodes.ofAnime', { count: 2 })).toBe('2 new episodes of {{title}}');
    expect(mainT('en', 'notify.newEpisodes.ofAnime', { count: 2, title: '{{count}}' })).toBe(
      '2 new episodes of {{count}}',
    );
  });

  it('answers a key without a plural form as it is', () => {
    expect(mainT('id', 'tray.pause')).toBe('Jeda unduhan');
  });
});
