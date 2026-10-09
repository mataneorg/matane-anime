import { type CatalogAnime, type SourceInfo } from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Loader2, ScanSearch, Search, TriangleAlert, WifiOff, X } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { EmptyState } from '@renderer/components/EmptyState';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { SourcePicker } from '@renderer/features/search/SourcePicker';
import { searchScope } from '@renderer/features/search/scope';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { MAX_PARALLEL, type SourceResult, useGlobalSearch } from '@renderer/features/search/useGlobalSearch';
import { networkStatusQuery, sourcesQuery } from '@renderer/lib/catalog';
import { describeError, isCloudflare } from '@renderer/lib/errors';
import { useScrollRestoration } from '@renderer/lib/scroll';
import { useGlobalSearchSettings } from '@renderer/lib/viewSettings';

export const Route = createFileRoute('/_app/browse/global-search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search['q'] === 'string' && search['q'] !== '' ? search['q'] : undefined,
  }),
  component: GlobalSearchPage,
});

const hue = (text: string): number => [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
const SHOWN = 10;

function GlobalSearchPage() {
  const { t } = useTranslation();
  // The query lives in the URL, so going back from a result brings the same search back.
  const query = Route.useSearch().q?.trim() ?? '';
  const navigate = useNavigate();
  const { data: sources = [], isPending } = useQuery(sourcesQuery);
  const { data: network } = useQuery(networkStatusQuery);
  const [draft, setDraft] = useState(query);
  // The address can change under the field (the palette, Back and Forward): the field follows it.
  const [shownQuery, setShownQuery] = useState(query);
  if (shownQuery !== query) {
    setShownQuery(query);
    setDraft(query);
  }
  const [language, setLanguage] = useState('all');
  const [prefs, updatePrefs] = useGlobalSearchSettings();

  // Main already leaves out 18+ sources and languages the user did not choose (EXT-15).
  const searchable = useMemo(() => sources.filter((source) => source.available), [sources]);
  const languages = useMemo(() => [...new Set(searchable.map((source) => source.lang))].sort(), [searchable]);
  // The sources asked: the chosen ones (kept across restarts; none chosen means all), in the chosen language.
  const scope = useMemo(
    () => searchScope(searchable, prefs.sourceIds, language),
    [searchable, prefs.sourceIds, language],
  );
  const online = network?.online ?? true;
  const { results, retry, done } = useGlobalSearch(scope, query, online);

  // A source that answered with nothing can be left out; one still searching or failed stays (it may need a retry).
  const shown = prefs.onlyWithResults
    ? scope.filter((source) => {
        const result = results[source.id];
        return result?.status !== 'done' || result.items.length > 0;
      })
    : scope;

  useScrollRestoration(query === '' || scope.length === 0 || done > 0);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void navigate({ to: '/browse/global-search', search: { q: draft.trim() || undefined }, replace: true });
  };

  const clear = (): void => {
    setDraft('');
    void navigate({ to: '/browse/global-search', search: {}, replace: true });
  };

  if (!isPending && searchable.length === 0) {
    return (
      <EmptyState icon={ScanSearch} title={t('empty.globalSearch.title')} description={t('globalSearch.noSources')} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-5">
        <h1 className="text-xl font-semibold">{t('globalSearch.title')}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={prefs.onlyWithResults}
              onChange={(event) => updatePrefs({ onlyWithResults: event.target.checked })}
            />
            {t('globalSearch.onlyWithResults')}
          </label>
          <SourcePicker
            sources={searchable}
            selected={prefs.sourceIds}
            onChange={(sourceIds) => updatePrefs({ sourceIds })}
          />
          {languages.length > 1 ? (
            <Select
              aria-label={t('globalSearch.scope')}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="all">{t('globalSearch.allLanguages')}</option>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {code.toUpperCase()}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full max-w-xl">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              autoFocus
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('globalSearch.placeholder')}
              aria-label={t('globalSearch.placeholder')}
              className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
            {draft !== '' ? (
              <button
                type="button"
                aria-label={t('globalSearch.clear')}
                title={t('globalSearch.clear')}
                onClick={clear}
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
          </div>
          {query !== '' && online && scope.length > 0 ? (
            <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              {done < scope.length ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {t('globalSearch.progress', { done, total: scope.length })}
            </span>
          ) : null}
        </div>
        {query !== '' && online && scope.length > 0 ? (
          <div
            role="progressbar"
            aria-label={t('globalSearch.title')}
            aria-valuemin={0}
            aria-valuemax={scope.length}
            aria-valuenow={done}
            className="h-1 w-full max-w-xl overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.min(100, (done / scope.length) * 100)}%` }}
            />
          </div>
        ) : null}
      </form>

      {!online ? (
        <EmptyState icon={WifiOff} title={t('browse.offline.title')} description={t('globalSearch.offline')} />
      ) : query === '' ? (
        <p className="py-10 text-center text-muted-foreground">{t('globalSearch.hint')}</p>
      ) : scope.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t('globalSearch.noScope')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((source) => (
            <SourceSection
              key={source.id}
              source={source}
              query={query}
              result={results[source.id]}
              onRetry={() => retry(source)}
            />
          ))}
          {shown.length === 0 && done >= scope.length ? (
            <li className="py-10 text-center text-muted-foreground">{t('globalSearch.noneWithResults')}</li>
          ) : null}
        </ul>
      )}
      <span className="sr-only">{t('globalSearch.searching', { count: MAX_PARALLEL })}</span>
    </div>
  );
}

function SourceSection({
  source,
  query,
  result,
  onRetry,
}: {
  source: SourceInfo;
  query: string;
  result: SourceResult | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const avatar = (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-black"
      style={{ background: `hsl(${hue(source.extensionId)} 65% 75%)` }}
    >
      {source.name.charAt(0).toUpperCase()}
    </span>
  );

  if (result?.status === 'error') {
    const verify = isCloudflare(result.error);
    return (
      <li className="flex items-center gap-3 rounded-xl border bg-card/40 px-4 py-3.5">
        {avatar}
        <span className="font-semibold text-foreground">{source.name}</span>
        <TriangleAlert className="size-4 shrink-0 text-ctp-peach" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {verify ? t('globalSearch.verify') : describeError(result.error, t)}
        </span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {verify ? t('globalSearch.solve') : t('globalSearch.retry')}
        </Button>
      </li>
    );
  }
  if (result?.status === 'done' && result.items.length === 0) {
    return (
      <li className="flex items-center gap-3 rounded-xl border bg-card/40 px-4 py-3.5">
        {avatar}
        <span className="font-semibold text-foreground">{source.name}</span>
        <span className="text-muted-foreground">{t('globalSearch.none', { query })}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card/40 px-4 py-3.5">
      <div className="flex items-center gap-3">
        {avatar}
        <span className="font-semibold text-foreground">{source.name}</span>
        {result ? (
          <Badge>{t('globalSearch.results', { count: result.items.length })}</Badge>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t('globalSearch.searchingSource')}
          </span>
        )}
        {result?.status === 'done' ? (
          <Link
            to="/browse/sources/$sourceId"
            params={{ sourceId: source.id }}
            search={{ q: query }}
            className="ml-auto flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline"
          >
            {t('globalSearch.viewAll')}
            <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="-m-1 flex gap-3 overflow-hidden p-1">
        {result?.status === 'done'
          ? result.items.slice(0, SHOWN).map((anime) => <Result key={anime.animeId} anime={anime} />)
          : Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex w-24 shrink-0 flex-col gap-2" aria-hidden>
                <Skeleton className="aspect-[2/3] rounded-lg" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
      </div>
    </li>
  );
}

function Result({ anime }: { anime: CatalogAnime }) {
  return (
    <Link
      to="/anime/$animeId"
      params={{ animeId: String(anime.animeId) }}
      className="group flex w-24 shrink-0 flex-col gap-1.5"
      title={anime.title}
    >
      <div className="overflow-hidden rounded-lg border transition-colors group-hover:border-primary">
        <Cover sourceId={anime.sourceId} url={anime.thumbnailUrl} className="aspect-[2/3] w-full" />
      </div>
      <span className="line-clamp-2 text-xs leading-snug font-semibold text-foreground transition-colors group-hover:text-primary-text">
        {anime.title}
      </span>
    </Link>
  );
}
