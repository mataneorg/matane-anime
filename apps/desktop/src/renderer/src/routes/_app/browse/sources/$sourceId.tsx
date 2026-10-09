import type { Filter, FilterState } from '@matane-anime/extension-sdk';
import type { LibraryDisplay } from '@matane-anime/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2, Search, SlidersHorizontal, WifiOff } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverViewControls } from '@renderer/components/CoverViewControls';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { AnimeCard, AnimeCardSkeleton, gridStyle } from '@renderer/features/browse/AnimeCard';
import { FilterPanel, cleanFilters } from '@renderer/features/browse/FilterPanel';
import {
  browseCachedQuery,
  browseQuery,
  capabilitiesQuery,
  filtersQuery,
  networkStatusQuery,
  sourcesQuery,
} from '@renderer/lib/catalog';
import { describeError, isCloudflare } from '@renderer/lib/errors';
import { useScrollRestoration } from '@renderer/lib/scroll';
import { cn } from '@renderer/lib/utils';
import { usePageCrumbs } from '@renderer/stores/crumbs';
import { useNetworkStore } from '@renderer/stores/network';
import { useBrowseView } from '@renderer/lib/viewSettings';

export const Route = createFileRoute('/_app/browse/sources/$sourceId')({
  // The tab, the search and the filters live in the address: Back from an anime brings the same listing back, and
  // `?q=` opens the source already searched (the "View all" of global search).
  validateSearch: (search: Record<string, unknown>): { q?: string; tab?: 'latest'; filters?: FilterState } => {
    const filters = search['filters'];
    return {
      q: typeof search['q'] === 'string' && search['q'] !== '' ? search['q'] : undefined,
      tab: search['tab'] === 'latest' ? 'latest' : undefined,
      filters:
        typeof filters === 'object' && filters !== null && !Array.isArray(filters) && Object.keys(filters).length > 0
          ? (filters as FilterState)
          : undefined,
    };
  },
  component: BrowsePage,
});

type Kind = 'popular' | 'latest';

function BrowsePage() {
  const { sourceId } = Route.useParams();
  // A different source starts from scratch: the key remounts the view with fresh state.
  return <BrowseView key={sourceId} sourceId={sourceId} />;
}

function BrowseView({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: sources = [] } = useQuery(sourcesQuery);
  const source = sources.find((candidate) => candidate.id === sourceId);
  const { data: capabilities } = useQuery({ ...capabilitiesQuery(sourceId), enabled: source?.available === true });
  const { data: network } = useQuery(networkStatusQuery);
  const online = network?.online ?? true;
  const [{ display, coverSize }, updateView] = useBrowseView();

  const search = Route.useSearch();
  const query = search.q ?? '';
  const filters = useMemo<FilterState>(() => search.filters ?? {}, [search.filters]);
  // What the address says is applied; the box and the panel hold what is typed until it is submitted.
  const [draft, setDraft] = useState(query);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterState>(filters);
  const show = (patch: {
    q?: string | undefined;
    tab?: 'latest' | undefined;
    filters?: FilterState | undefined;
  }): void =>
    void navigate({
      to: '/browse/sources/$sourceId',
      params: { sourceId },
      search: { q: search.q, tab: search.tab, filters: search.filters, ...patch },
      replace: true,
    });

  const searching = query.trim() !== '' || Object.keys(filters).length > 0;
  // A source without a Latest listing shows Popular, whatever the address says.
  const tab: Kind = search.tab === 'latest' && capabilities?.latest !== false ? 'latest' : 'popular';
  const kind = searching ? 'search' : tab;
  const params = { sourceId, kind, query: query.trim(), filters } as const;
  const feed = useInfiniteQuery(browseQuery(params, source?.available === true && online));
  // What the source showed last time, on screen until the real page arrives (or when it cannot: offline, a failure).
  const { data: remembered } = useQuery(browseCachedQuery(params, source?.available === true));
  const { data: filterList = [] } = useQuery({
    ...filtersQuery(sourceId),
    enabled: source?.available === true && capabilities?.filters === true,
  });

  const showingRemembered = feed.data === undefined && remembered != null;
  const items = useMemo(
    () => (feed.data ? feed.data.pages.flatMap((page) => page.items) : (remembered?.items ?? [])),
    [feed.data, remembered],
  );

  useScrollRestoration(items.length > 0);
  usePageCrumbs(source?.name);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = feed;
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage && !isError) {
        void fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isError, items.length]);

  const verifying = useNetworkStore((state) => {
    const status = state.cloudflare[source?.extensionId ?? ''];
    return status === 'solving' || status === 'visible';
  });

  const submitSearch = (event: FormEvent): void => {
    event.preventDefault();
    show({ q: draft.trim() === '' ? undefined : draft });
  };
  const chooseTab = (next: Kind): void => {
    setDraft('');
    setFilterDraft({});
    show({ tab: next === 'latest' ? 'latest' : undefined, q: undefined, filters: undefined });
  };

  if (sources.length > 0 && !source?.available) {
    return <EmptyState icon={WifiOff} title={t('errors.not_found')} description={t('browse.sources.notInstalled')} />;
  }

  const latestSupported = capabilities?.latest === true;
  const filtersSupported = capabilities?.filters === true;

  return (
    <div className="flex min-h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-6 pt-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label={t('browse.picker')}
              value={sourceId}
              onChange={(event) =>
                void navigate({ to: '/browse/sources/$sourceId', params: { sourceId: event.target.value } })
              }
              className="min-w-56 text-base font-semibold"
            >
              {sources
                .filter((candidate) => candidate.available)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </Select>

            <div className="ml-auto flex items-center gap-2">
              <CoverViewControls display={display} coverSize={coverSize} onChange={updateView} />
            </div>

            <form onSubmit={submitSearch} className="flex w-full max-w-sm items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <Input
                  type="search"
                  value={draft}
                  disabled={!online}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t('browse.search')}
                  aria-label={t('browse.search')}
                  className="pl-9"
                />
              </div>
              {filtersSupported ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="size-9"
                  aria-pressed={panelOpen}
                  aria-label={t('browse.filters.toggle')}
                  title={t('browse.filters.toggle')}
                  onClick={() => setPanelOpen((open) => !open)}
                >
                  <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
                </Button>
              ) : null}
            </form>
          </div>

          <div role="tablist" className="mt-3 flex gap-6">
            {(['popular', ...(latestSupported ? (['latest'] as const) : [])] as Kind[]).map((name) => (
              <button
                key={name}
                role="tab"
                type="button"
                aria-selected={tab === name && !searching}
                onClick={() => chooseTab(name)}
                className={cn(
                  '-mb-px h-9 border-b-2 border-transparent px-1 text-muted-foreground transition-colors hover:text-foreground',
                  tab === name && !searching && 'border-primary font-semibold text-foreground',
                )}
              >
                {t(`browse.tabs.${name}`)}
              </button>
            ))}
          </div>
        </header>

        <div className="flex flex-col gap-5 p-6">
          {verifying ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg border border-ctp-blue/40 bg-ctp-blue/10 px-3 py-2"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('browse.verifying')}
            </p>
          ) : null}

          {!online && !showingRemembered ? (
            <EmptyState
              icon={WifiOff}
              title={t('browse.offline.title')}
              description={t('browse.offline.description')}
            />
          ) : feed.isPending && !showingRemembered ? (
            <Grid display={display} coverSize={coverSize}>
              {Array.from({ length: 12 }, (_, index) => (
                <AnimeCardSkeleton key={index} display={display} />
              ))}
            </Grid>
          ) : feed.isError && items.length === 0 ? (
            <ErrorState
              title={t('errors.title')}
              description={describeError(feed.error, t)}
              action={
                <Button onClick={() => void feed.refetch()}>
                  {isCloudflare(feed.error) ? t('browse.verify') : t('browse.retry')}
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState icon={Search} title={t('browse.empty.title')} description={t('browse.empty.description')} />
          ) : (
            <>
              <Grid display={display} coverSize={coverSize}>
                {items.map((anime) => (
                  <AnimeCard key={anime.animeId} anime={anime} display={display} />
                ))}
              </Grid>
              <div ref={sentinel} className="flex min-h-10 items-center justify-center gap-2">
                {showingRemembered && feed.isFetching ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t('browse.refreshing')}
                  </>
                ) : isFetchingNextPage ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t('browse.loadingMore')}
                  </>
                ) : feed.isError ? (
                  <Button variant="secondary" size="sm" onClick={() => void fetchNextPage()}>
                    {t('browse.retry')}
                  </Button>
                ) : !hasNextPage ? (
                  <span className="text-xs text-muted-foreground">{t('browse.end')}</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {panelOpen && filtersSupported ? (
        <FilterPanel
          filters={filterList as Filter[]}
          value={filterDraft}
          onChange={setFilterDraft}
          onApply={() => {
            const applied = cleanFilters(filterDraft);
            show({ filters: Object.keys(applied).length > 0 ? applied : undefined });
          }}
          onReset={() => {
            setFilterDraft({});
            show({ filters: undefined });
          }}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Grid({
  display,
  coverSize,
  children,
}: {
  display: LibraryDisplay;
  coverSize: number;
  children: React.ReactNode;
}) {
  return (
    <div className="grid" style={gridStyle(display, coverSize)}>
      {children}
    </div>
  );
}
