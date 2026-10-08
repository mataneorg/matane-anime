import { type CatalogAnime, type SourceInfo } from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Loader2, ScanSearch, Search, TriangleAlert, WifiOff } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { EmptyState } from '@renderer/components/EmptyState';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { MAX_PARALLEL, type SourceResult, useGlobalSearch } from '@renderer/features/search/useGlobalSearch';
import { networkStatusQuery, sourcesQuery } from '@renderer/lib/catalog';
import { describeError, isCloudflare } from '@renderer/lib/errors';

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
  const [language, setLanguage] = useState('all');

  // Main already leaves out 18+ sources and languages the user did not choose (EXT-15).
  const searchable = useMemo(() => sources.filter((source) => source.available), [sources]);
  const languages = useMemo(() => [...new Set(searchable.map((source) => source.lang))].sort(), [searchable]);
  const scope = useMemo(
    () => searchable.filter((source) => language === 'all' || source.lang === language),
    [searchable, language],
  );
  const online = network?.online ?? true;
  const { results, retry, done } = useGlobalSearch(scope, query, online);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void navigate({ to: '/browse/global-search', search: { q: draft.trim() || undefined }, replace: true });
  };

  if (!isPending && searchable.length === 0) {
    return (
      <EmptyState icon={ScanSearch} title={t('empty.globalSearch.title')} description={t('globalSearch.noSources')} />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('globalSearch.title')}</h1>
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
      </header>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-4">
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
            className="h-11 pl-9"
          />
        </div>
        {query !== '' && online ? (
          <span role="status" className="flex items-center gap-2 text-xs leading-4">
            {done < scope.length ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {t('globalSearch.progress', { done, total: scope.length })}
          </span>
        ) : null}
      </form>

      {!online ? (
        <EmptyState icon={WifiOff} title={t('browse.offline.title')} description={t('globalSearch.offline')} />
      ) : query === '' ? (
        <p>{t('globalSearch.hint')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {scope.map((source) => (
            <SourceSection
              key={source.id}
              source={source}
              query={query}
              result={results[source.id]}
              onRetry={() => retry(source)}
            />
          ))}
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
      <li className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
        {avatar}
        <span className="font-semibold text-foreground">{source.name}</span>
        <TriangleAlert className="size-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
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
      <li className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
        {avatar}
        <span className="font-semibold text-foreground">{source.name}</span>
        <span>{t('globalSearch.none', { query })}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-card p-4">
      <div className="flex items-center gap-3">
        {avatar}
        <span className="font-semibold text-foreground">{source.name}</span>
        {result ? (
          <Badge>{t('globalSearch.results', { count: result.items.length })}</Badge>
        ) : (
          <span className="flex items-center gap-1.5 text-xs leading-4">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t('globalSearch.searchingSource')}
          </span>
        )}
        {result?.status === 'done' ? (
          <Link
            to="/browse/sources/$sourceId"
            params={{ sourceId: source.id }}
            search={{ q: query }}
            className="ml-auto flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
          >
            {t('globalSearch.viewAll')}
            <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-hidden">
        {result?.status === 'done'
          ? result.items.slice(0, SHOWN).map((anime) => <Result key={anime.animeId} anime={anime} />)
          : Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex w-24 shrink-0 animate-pulse flex-col gap-2" aria-hidden>
                <div className="aspect-[2/3] rounded-lg bg-input" />
                <div className="h-3 w-3/4 rounded bg-input" />
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
      className="flex w-24 shrink-0 flex-col gap-1.5"
      title={anime.title}
    >
      <Cover sourceId={anime.sourceId} url={anime.thumbnailUrl} className="aspect-[2/3] w-full rounded-lg" />
      <span className="line-clamp-2 text-xs leading-4 font-semibold text-foreground">{anime.title}</span>
    </Link>
  );
}
