// EXT-15 in one place: what the user chose to see (18+ content, content languages) is enforced in main, not
// only drawn by the renderer. The Installed list is never filtered, so every extension can be removed.

export interface ContentPreferences {
  showNsfw: boolean;
  /** Empty means every language. */
  contentLanguages: readonly string[];
}

/** `multi` always passes; an empty selection means "all"; `pt` also matches `pt-BR`. */
export function allowsLanguage(selected: readonly string[], lang: string): boolean {
  if (selected.length === 0 || lang === 'multi') return true;
  const wanted = new Set(selected.map((code) => code.toLowerCase()));
  const lower = lang.toLowerCase();
  return wanted.has(lower) || wanted.has(lower.split('-')[0] ?? lower);
}

/** An entry or extension with several languages passes when any of them is wanted. */
export function allowsAnyLanguage(selected: readonly string[], langs: readonly string[]): boolean {
  return selected.length === 0 || langs.some((lang) => allowsLanguage(selected, lang));
}

export function allowsNsfw(preferences: Pick<ContentPreferences, 'showNsfw'>, nsfw: boolean): boolean {
  return preferences.showNsfw || !nsfw;
}
