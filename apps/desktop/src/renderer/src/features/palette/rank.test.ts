import { describe, expect, it } from 'vitest';
import {
  LIBRARY_LIMIT,
  type PaletteEntry,
  buildSections,
  flattenSections,
  matchScore,
  moveActive,
  normalize,
  rankEntries,
} from './rank';

const entry = (id: string, group: PaletteEntry['group'], label: string, keywords?: string): PaletteEntry<string> => ({
  id,
  group,
  label,
  ...(keywords !== undefined && { keywords }),
  action: id,
});

describe('normalize', () => {
  it('drops accents and case', () => {
    expect(normalize('Frappé')).toBe('frappe');
    expect(normalize('POKÉMON')).toBe('pokemon');
  });
});

describe('matchScore', () => {
  it('ranks exact over prefix over word start over substring over letters in order', () => {
    const scores = [
      matchScore('tsuki', 'Tsuki'),
      matchScore('tsu', 'Tsuki no Shiori'),
      matchScore('shi', 'Tsuki no Shiori'),
      matchScore('uki', 'Tsuki no Shiori'),
      matchScore('tki', 'Tsuki no Shiori'),
    ];
    expect(scores.every((score) => score > 0)).toBe(true);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('needs every word of the query', () => {
    expect(matchScore('tsuki shiori', 'Tsuki no Shiori')).toBeGreaterThan(0);
    expect(matchScore('tsuki xyz', 'Tsuki no Shiori')).toBe(0);
  });

  it('does not match two letters out of order or too short for a typo match', () => {
    expect(matchScore('zq', 'Library')).toBe(0);
    expect(matchScore('lb', 'Library')).toBe(0);
  });

  it('finds an entry by its keywords, below the label', () => {
    expect(matchScore('sync', 'Check for updates', 'refresh sync')).toBeGreaterThan(0);
    expect(matchScore('check', 'Check for updates', 'refresh sync')).toBeGreaterThan(
      matchScore('refresh', 'Check for updates', 'refresh sync'),
    );
  });

  it('matches everything for an empty query', () => {
    expect(matchScore('  ', 'Anything')).toBeGreaterThan(0);
  });
});

describe('rankEntries', () => {
  const entries = [
    entry('a', 'navigate', 'Global search'),
    entry('b', 'navigate', 'Library'),
    entry('c', 'navigate', 'Downloads'),
  ];

  it('drops what does not match and puts the best first', () => {
    expect(rankEntries('lib', entries).map((item) => item.id)).toEqual(['b']);
    expect(rankEntries('s', entries).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('keeps the given order for equal scores', () => {
    expect(rankEntries('', entries).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildSections', () => {
  const base = {
    continueWatching: [entry('continue', 'continue', 'Tsuki no Shiori')],
    library: [entry('l1', 'library', 'Another Tsuki'), entry('l2', 'library', 'Tsuki no Shiori')],
    navigate: [entry('n1', 'navigate', 'Library'), entry('n2', 'navigate', 'History')],
    actions: [entry('a1', 'actions', 'Check for updates'), entry('a2', 'actions', 'Pause all downloads')],
    searchSources: (query: string) => entry('sources', 'sources', `Search "${query}"`),
  };

  it('shows continue, pages and actions for an empty query, without the sources search', () => {
    const sections = buildSections({ ...base, query: '' });
    expect(sections.map((section) => section.group)).toEqual(['continue', 'navigate', 'actions']);
  });

  it('filters by the query, keeps the library as given but best first, and ends with the sources search', () => {
    const sections = buildSections({ ...base, query: 'tsuki' });
    expect(sections.map((section) => section.group)).toEqual(['continue', 'library', 'sources']);
    expect(sections[1]?.entries.map((item) => item.id)).toEqual(['l2', 'l1']);
    expect(sections.at(-1)?.entries[0]?.label).toBe('Search "tsuki"');
  });

  it('trims the query it passes on', () => {
    const sections = buildSections({ ...base, library: [], query: '  hist ' });
    expect(sections.map((section) => section.group)).toEqual(['navigate', 'sources']);
    expect(sections.at(-1)?.entries[0]?.label).toBe('Search "hist"');
  });

  it('caps the library list', () => {
    const library = Array.from({ length: 20 }, (_, index) => entry(`l${index}`, 'library', `Show ${index}`));
    const sections = buildSections({ ...base, library, query: 'show' });
    expect(sections.find((section) => section.group === 'library')?.entries).toHaveLength(LIBRARY_LIMIT);
  });

  it('lists at most five continue targets, newest first', () => {
    const continueWatching = Array.from({ length: 8 }, (_, index) => entry(`c${index}`, 'continue', `Show ${index}`));
    const sections = buildSections({ ...base, continueWatching, query: '' });
    expect(sections[0]?.entries.map((item) => item.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });

  it('still offers the sources search when nothing else matches', () => {
    const sections = buildSections({ ...base, continueWatching: [], library: [], query: 'zzzz' });
    expect(flattenSections(sections).map((item) => item.id)).toEqual(['sources']);
  });

  it('flattens in drawing order', () => {
    const sections = buildSections({ ...base, query: '' });
    expect(flattenSections(sections).map((item) => item.id)).toEqual(['continue', 'n1', 'n2', 'a1', 'a2']);
  });
});

describe('moveActive', () => {
  it('wraps at both ends', () => {
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, 1, 3)).toBe(1);
  });

  it('has no row to highlight when the list is empty', () => {
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
