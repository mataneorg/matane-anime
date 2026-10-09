import { DEFAULT_LIBRARY_SETTINGS } from '@matane-anime/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeBlock, takeLegacyLibraryView } from './viewSettingsCore';

function stubStorage(entries: Record<string, string>): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}
afterEach(() => vi.unstubAllGlobals());

describe('takeLegacyLibraryView', () => {
  it('turns the old sort and reversed order into settings and removes the old keys', () => {
    const store = stubStorage({ 'matane-anime.librarySort': 'title', 'matane-anime.libraryOrder': 'reversed' });
    expect(takeLegacyLibraryView()).toEqual({ sort: 'title', descending: true });
    expect(store.size).toBe(0);
  });
  it('takes one value without the other', () => {
    stubStorage({ 'matane-anime.libraryOrder': 'reversed' });
    expect(takeLegacyLibraryView()).toEqual({ descending: true });
  });
  it('ignores a sort it does not know and the natural order', () => {
    const store = stubStorage({ 'matane-anime.librarySort': 'popularity', 'matane-anime.libraryOrder': 'natural' });
    expect(takeLegacyLibraryView()).toBeNull();
    expect(store.size).toBe(0);
  });
  it('is null when there is nothing left to take, and never throws when storage does', () => {
    stubStorage({});
    expect(takeLegacyLibraryView()).toBeNull();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(takeLegacyLibraryView()).toBeNull();
  });
});

describe('mergeBlock', () => {
  it('builds on the cached block, so quick changes stack', () => {
    const first = mergeBlock(undefined, DEFAULT_LIBRARY_SETTINGS, { display: 'list' });
    const second = mergeBlock(first, DEFAULT_LIBRARY_SETTINGS, { coverSize: 200 });
    expect(second).toEqual({ ...DEFAULT_LIBRARY_SETTINGS, display: 'list', coverSize: 200 });
  });
  it('falls back to the block of the render when nothing is cached, and changes nothing else', () => {
    const fallback = { ...DEFAULT_LIBRARY_SETTINGS, sort: 'title' as const };
    expect(mergeBlock(undefined, fallback, { descending: true })).toEqual({ ...fallback, descending: true });
    expect(fallback.descending).toBe(false);
  });
});
