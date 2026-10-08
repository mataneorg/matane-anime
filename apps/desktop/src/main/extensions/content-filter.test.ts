import { describe, expect, it } from 'vitest';
import { allowsAnyLanguage, allowsLanguage, allowsNsfw } from './content-filter';

describe('content filter (EXT-15)', () => {
  it('lets every language through when none is chosen, and multi always', () => {
    expect(allowsLanguage([], 'ja')).toBe(true);
    expect(allowsLanguage(['id'], 'multi')).toBe(true);
    expect(allowsLanguage(['id'], 'en')).toBe(false);
    expect(allowsLanguage(['id', 'en'], 'en')).toBe(true);
  });

  it('matches the language of a regional code, ignoring case', () => {
    expect(allowsLanguage(['pt'], 'pt-BR')).toBe(true);
    expect(allowsLanguage(['pt-br'], 'pt-BR')).toBe(true);
    expect(allowsLanguage(['pt-BR'], 'pt')).toBe(false);
  });

  it('lets a list of languages through when any one is wanted', () => {
    expect(allowsAnyLanguage(['id'], ['en', 'id'])).toBe(true);
    expect(allowsAnyLanguage(['id'], ['en'])).toBe(false);
    expect(allowsAnyLanguage(['id'], ['multi'])).toBe(true);
    expect(allowsAnyLanguage([], [])).toBe(true);
    expect(allowsAnyLanguage(['id'], [])).toBe(false);
  });

  it('hides 18+ unless it is switched on', () => {
    expect(allowsNsfw({ showNsfw: false }, true)).toBe(false);
    expect(allowsNsfw({ showNsfw: false }, false)).toBe(true);
    expect(allowsNsfw({ showNsfw: true }, true)).toBe(true);
  });
});
