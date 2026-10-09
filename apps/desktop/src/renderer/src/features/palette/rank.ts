// The command palette's matching, ranking and grouping as plain functions (docs/PRD.md UI-8), so they test without
// React. The component hands in entries with their text already translated and gets back the sections to draw.

export type PaletteGroup = 'continue' | 'library' | 'navigate' | 'actions' | 'sources';

/** The order the groups are drawn in. */
export const GROUP_ORDER: readonly PaletteGroup[] = ['continue', 'library', 'navigate', 'actions', 'sources'];

/** How many library matches are listed; the Library page is the place for the rest. */
export const LIBRARY_LIMIT = 6;

export interface PaletteEntry<A = unknown> {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Extra words that find the entry (the palette matches the label first). */
  keywords?: string;
  /** What to do when it is chosen; opaque here. */
  action: A;
}

export interface PaletteSection<A = unknown> {
  group: PaletteGroup;
  entries: PaletteEntry<A>[];
}

/** Lower case without accents, so "frappe" finds "Frappé" and "Pokemon" finds "Pokémon". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Whether the letters of `needle` appear in `text` in order (not necessarily next to each other). */
function isSubsequence(needle: string, text: string): boolean {
  let at = 0;
  for (const char of text) {
    if (char === needle[at] && ++at === needle.length) return true;
  }
  return needle.length === 0;
}

/** 0 when `token` does not match `text`; higher is better. Both are already normalized. */
function tokenScore(token: string, text: string): number {
  if (text === token) return 100;
  if (text.startsWith(token)) return 80;
  if (text.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(token))) return 60;
  const at = text.indexOf(token);
  // The earlier in the text, the better.
  if (at >= 0) return 40 - Math.min(at, 20) / 2;
  // A typo-friendly last resort, only for tokens long enough to mean something.
  if (token.length >= 3 && isSubsequence(token, text)) return 10;
  return 0;
}

/**
 * How well `query` matches an entry: every word of the query has to match, and the score is their average.
 * The label counts fully, the keywords at 70%. An empty query matches everything equally.
 */
export function matchScore(query: string, label: string, keywords = ''): number {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const text = normalize(label);
  const extra = normalize(keywords);
  let total = 0;
  for (const token of tokens) {
    const score = Math.max(tokenScore(token, text), extra ? tokenScore(token, extra) * 0.7 : 0);
    if (score === 0) return 0;
    total += score;
  }
  return total / tokens.length;
}

/** The matching entries, best first; entries with the same score keep their order. */
export function rankEntries<A>(query: string, entries: readonly PaletteEntry<A>[]): PaletteEntry<A>[] {
  return entries
    .map((entry, index) => ({ entry, index, score: matchScore(query, entry.label, entry.keywords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}

export interface PaletteSources<A> {
  query: string;
  /** The top history entry's "continue" target, when there is one. */
  continueWatching: PaletteEntry<A> | null;
  /** Library anime the search already found; it also matches alternative titles, so they are not filtered here. */
  library: readonly PaletteEntry<A>[];
  navigate: readonly PaletteEntry<A>[];
  actions: readonly PaletteEntry<A>[];
  /** "Search in sources for <query>", built by the caller because the text is translated. */
  searchSources: (query: string) => PaletteEntry<A>;
}

/** Everything the palette lists for a query, grouped in `GROUP_ORDER`, without empty groups. */
export function buildSections<A>(input: PaletteSources<A>): PaletteSection<A>[] {
  const query = input.query.trim();
  const byGroup: Record<PaletteGroup, PaletteEntry<A>[]> = {
    continue: input.continueWatching ? rankEntries(query, [input.continueWatching]) : [],
    // Titles the search found come first when the typed text is most of the title.
    library: (query === '' ? [] : [...input.library])
      .map((entry, index) => ({ entry, index, score: matchScore(query, entry.label) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.entry)
      .slice(0, LIBRARY_LIMIT),
    navigate: rankEntries(query, input.navigate),
    actions: rankEntries(query, input.actions),
    sources: query === '' ? [] : [input.searchSources(query)],
  };
  return GROUP_ORDER.filter((group) => byGroup[group].length > 0).map((group) => ({
    group,
    entries: byGroup[group],
  }));
}

export const flattenSections = <A>(sections: readonly PaletteSection<A>[]): PaletteEntry<A>[] =>
  sections.flatMap((section) => section.entries);

/** Moves the highlighted row by `delta`, wrapping around at both ends. `-1` for no rows. */
export function moveActive(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}
