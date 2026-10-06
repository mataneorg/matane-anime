// Catppuccin names shared by main (settings validation) and renderer (theming). See docs/PRD.md UI-3, UI-11.
export const THEME_FLAVORS = ['mocha', 'macchiato', 'frappe', 'latte'] as const;
export type ThemeFlavor = (typeof THEME_FLAVORS)[number];

/** `system` follows the OS: Mocha when it is dark, Latte when it is light. */
export const THEME_MODES = ['system', ...THEME_FLAVORS] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const ACCENTS = [
  'rosewater',
  'flamingo',
  'pink',
  'mauve',
  'red',
  'maroon',
  'peach',
  'yellow',
  'green',
  'teal',
  'sky',
  'sapphire',
  'blue',
  'lavender',
] as const;
export type Accent = (typeof ACCENTS)[number];

export const LANGUAGES = ['en', 'id'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The flavor that is actually painted for a mode, given whether the OS prefers a dark scheme. */
export function resolveFlavor(mode: ThemeMode, systemPrefersDark: boolean): ThemeFlavor {
  if (mode === 'system') return systemPrefersDark ? 'mocha' : 'latte';
  return mode;
}

/** AMOLED (pure black surfaces) only exists for the dark flavors; Latte ignores it. */
export function isAmoledActive(flavor: ThemeFlavor, amoled: boolean): boolean {
  return amoled && flavor !== 'latte';
}

/** Picks the UI language for `system` from an OS locale such as `id-ID` or `en_US`. */
export function languageFromLocale(locale: string): Language {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return (LANGUAGES as readonly string[]).includes(base ?? '') ? (base as Language) : 'en';
}
