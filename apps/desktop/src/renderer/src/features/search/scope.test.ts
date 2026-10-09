import { describe, expect, it } from 'vitest';
import { searchScope } from './scope';

const sources = [
  { id: 'a/en', lang: 'en' },
  { id: 'b/id', lang: 'id' },
  { id: 'c/en', lang: 'en' },
];
const ids = (list: readonly { id: string }[]): string[] => list.map((source) => source.id);

describe('searchScope', () => {
  it('is every source when nothing is picked', () => {
    expect(ids(searchScope(sources, null, 'all'))).toEqual(['a/en', 'b/id', 'c/en']);
  });
  it('is the picked sources, in the list order', () => {
    expect(ids(searchScope(sources, ['c/en', 'a/en'], 'all'))).toEqual(['a/en', 'c/en']);
  });
  it('falls back to every source when the picked ones are gone', () => {
    expect(ids(searchScope(sources, ['gone/en'], 'all'))).toEqual(['a/en', 'b/id', 'c/en']);
  });
  it('narrows to a language', () => {
    expect(ids(searchScope(sources, null, 'id'))).toEqual(['b/id']);
    expect(ids(searchScope(sources, ['a/en', 'b/id'], 'en'))).toEqual(['a/en']);
  });
  it('is empty when the language leaves no source', () => {
    expect(searchScope(sources, ['a/en'], 'id')).toEqual([]);
    expect(searchScope(sources, null, 'fr')).toEqual([]);
    expect(searchScope([], null, 'all')).toEqual([]);
  });
});
