import type { Filter, FilterState } from '@matane-anime/extension-sdk';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2, Search, SlidersHorizontal, WifiOff } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { AnimeCard, AnimeCardSkeleton } from '@renderer/features/browse/AnimeCard';
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
import { cn } from '@renderer/lib/utils';
import { useNetworkStore } from '@renderer/stores/network';

export const Route = createFileRoute('/_app/browse/sources/$sourceId')({
  // `?q=` opens the source already searched (the "View all" of global search).
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search['q'] === 'string' && search['q'] !== '' ? search['q'] : undefined,
  }),
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

  const [tab, setTab] = useState<Kind>('popular');
  const initialQuery = Route.useSearch().q ?? '';
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterState>({});
  const [filters, setFilters] = useState<FilterState>({});

  const searching = query.trim() !== '' || Object.keys(filters).length > 0;
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
    setQuery(draft);
  };
  const chooseTab = (next: Kind): void => {
    setTab(next);
    setDraft('');
    setQuery('');
    setFilterDraft({});
    setFilters({});
  };

  if (sources.length > 0 && !source?.available) {
    return <EmptyState icon={WifiOff} title={t('errors.not_found')} description={t('browse.sources.notInstalled')} />;
  }

  const latestSupported = capabilities?.latest === true;
  const filtersSupported = capabilities?.filters === true;

  return (
    <div className="flex min-h-full">
      <div className="flex min-w-0 flex-1 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Select
            aria-label={t('browse.picker')}
            value={sourceId}
            onChange={(event) =>
              void navigate({ to: '/browse/sources/$sourceId', params: { sourceId: event.target.value } })
            }
            className="h-10 min-w-56 font-semibold"
          >
            {sources
              .filter((candidate) => candidate.available)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </Select>

          <div role="tablist" className="flex gap-1">
            {(['popular', ...(latestSupported ? (['latest'] as const) : [])] as Kind[]).map((name) => (
              <button
                key={name}
                role="tab"
                type="button"
                aria-selected={tab === name && !searching}
                onClick={() => chooseTab(name)}
                className={cn(
                  'h-10 border-b-2 border-transparent px-3 text-muted-foreground transition-colors hover:text-foreground',
                  tab === name && !searching && 'border-accent font-semibold text-foreground',
                )}
              >
                {t(`browse.tabs.${name}`)}
              </button>
            ))}
          </div>

          <form onSubmit={submitSearch} className="ml-auto flex w-full max-w-sm items-center gap-2">
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
                className="h-10 pl-9"
              />
            </div>
            {filtersSupported ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-10"
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

        {verifying ? (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-info/16 px-3 py-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('browse.verifying')}
          </p>
        ) : null}

        {!online && !showingRemembered ? (
          <EmptyState icon={WifiOff} title={t('browse.offline.title')} description={t('browse.offline.description')} />
        ) : feed.isPending && !showingRemembered ? (
          <Grid>
            {Array.from({ length: 12 }, (_, index) => (
              <AnimeCardSkeleton key={index} />
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
            <Grid>
              {items.map((anime) => (
                <AnimeCard key={anime.animeId} anime={anime} />
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
                <span className="text-xs leading-4">{t('browse.end')}</span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {panelOpen && filtersSupported ? (
        <FilterPanel
          filters={filterList as Filter[]}
          value={filterDraft}
          onChange={setFilterDraft}
          onApply={() => setFilters(cleanFilters(filterDraft))}
          onReset={() => {
            setFilterDraft({});
            setFilters({});
          }}
        />
      ) : null}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-5">{children}</div>;
}
