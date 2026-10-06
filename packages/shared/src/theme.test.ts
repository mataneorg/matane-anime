import { describe, expect, it } from 'vitest';
import { ACCENTS, THEME_FLAVORS, THEME_MODES, isAmoledActive, languageFromLocale, resolveFlavor } from './theme';

describe('theme', () => {
  it('knows the four Catppuccin flavors, `system`, and the 14 accents', () => {
    expect(THEME_FLAVORS).toEqual(['mocha', 'macchiato', 'frappe', 'latte']);
    expect(THEME_MODES).toEqual(['system', 'mocha', 'macchiato', 'frappe', 'latte']);
    expect(ACCENTS).toHaveLength(14);
    expect(new Set(ACCENTS).size).toBe(14);
  });

  it('resolves `system` to Mocha in a dark OS and Latte in a light one', () => {
    expect(resolveFlavor('system', true)).toBe('mocha');
    expect(resolveFlavor('system', false)).toBe('latte');
    expect(resolveFlavor('frappe', false)).toBe('frappe');
    expect(resolveFlavor('latte', true)).toBe('latte');
  });

  it('turns AMOLED on only for the dark flavors', () => {
    expect(isAmoledActive('mocha', true)).toBe(true);
    expect(isAmoledActive('macchiato', true)).toBe(true);
    expect(isAmoledActive('latte', true)).toBe(false);
    expect(isAmoledActive('mocha', false)).toBe(false);
  });

  it('picks the app language from an OS locale and falls back to English', () => {
    expect(languageFromLocale('id-ID')).toBe('id');
    expect(languageFromLocale('id')).toBe('id');
    expect(languageFromLocale('en_US')).toBe('en');
    expect(languageFromLocale('ja-JP')).toBe('en');
    expect(languageFromLocale('')).toBe('en');
  });
});
