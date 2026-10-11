import type { CatalogAnime, CatalogPage } from '@matane-anime/shared';
import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { patchPage, patchPages } from './inLibraryCache';

const anime = (animeId: number, inLibrary = false): CatalogAnime => ({
  animeId,
  sourceId: 'example/en',
  url: `/a/${animeId}`,
  title: `Anime ${animeId}`,
  thumbnailUrl: null,
  inLibrary,
  detailsFetched: false,
});
const page = (...items: CatalogAnime[]): CatalogPage => ({ items, hasNextPage: true });
const infinite = (...list: CatalogPage[]): InfiniteData<CatalogPage> => ({
  pages: list,
  pageParams: list.map((_, index) => index + 1),
});

describe('patchPage', () => {
  it('sets the flag of one anime and leaves the others', () => {
    const next = patchPage(page(anime(1), anime(2, true)), 1, true);
    expect(next.items.map((item) => item.inLibrary)).toEqual([true, true]);
    expect(next.hasNextPage).toBe(true);
  });

  it('clears the flag on removal', () => {
    expect(patchPage(page(anime(1, true)), 1, false).items[0]?.inLibrary).toBe(false);
  });

  it('returns the same page when the anime is absent or already as asked', () => {
    const before = page(anime(1, true), anime(2));
    expect(patchPage(before, 3, true)).toBe(before);
    expect(patchPage(before, 1, true)).toBe(before);
  });
});

describe('patchPages', () => {
  it('patches only the page that holds the anime', () => {
    const before = infinite(page(anime(1)), page(anime(2)));
    const next = patchPages(before, 2, true);
    expect(next?.pages[0]).toBe(before.pages[0]);
    expect(next?.pages[1]?.items[0]?.inLibrary).toBe(true);
    expect(next?.pageParams).toBe(before.pageParams);
  });

  it('keeps the data object when nothing changes, and passes undefined through', () => {
    const before = infinite(page(anime(1)));
    expect(patchPages(before, 9, true)).toBe(before);
    expect(patchPages(undefined, 1, true)).toBeUndefined();
  });
});
