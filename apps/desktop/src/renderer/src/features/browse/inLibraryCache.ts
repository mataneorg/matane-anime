import type { CatalogPage } from '@matane-anime/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

// A listing of a source says per anime whether it is in the library. Adding or removing one from a card changes
// that answer, and fetching the listing again would be a round trip to the site: the cached pages are patched.

/** The page with one anime's flag set; the same object when nothing in it changes. */
export function patchPage(page: CatalogPage, animeId: number, inLibrary: boolean): CatalogPage {
  if (!page.items.some((item) => item.animeId === animeId && item.inLibrary !== inLibrary)) return page;
  return {
    ...page,
    items: page.items.map((item) => (item.animeId === animeId ? { ...item, inLibrary } : item)),
  };
}

/** Every loaded page of a browse query, patched; the same object when nothing changes. */
export function patchPages(
  data: InfiniteData<CatalogPage> | undefined,
  animeId: number,
  inLibrary: boolean,
): InfiniteData<CatalogPage> | undefined {
  if (!data) return data;
  const pages = data.pages.map((page) => patchPage(page, animeId, inLibrary));
  return pages.some((page, index) => page !== data.pages[index]) ? { ...data, pages } : data;
}

/** Updates the open listings and the remembered first pages (`browse-cached`) after an add or a removal. */
export function setInLibraryInCache(queryClient: QueryClient, animeId: number, inLibrary: boolean): void {
  queryClient.setQueriesData<InfiniteData<CatalogPage>>({ queryKey: ['browse'] }, (data) =>
    patchPages(data, animeId, inLibrary),
  );
  queryClient.setQueriesData<CatalogPage | null>({ queryKey: ['browse-cached'] }, (page) =>
    page ? patchPage(page, animeId, inLibrary) : page,
  );
}
