import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowRightLeft, Download, Globe, Loader2, Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { countEpisodes } from '@matane-anime/shared';
import { Cover } from '@renderer/components/Cover';
import { ErrorState } from '@renderer/components/ErrorState';
import { Badge } from '@renderer/components/ui/badge';
import { Button, buttonVariants } from '@renderer/components/ui/button';
import { Select } from '@renderer/components/ui/select';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { EpisodeList } from '@renderer/features/anime/EpisodeList';
import { LibraryButton } from '@renderer/features/anime/LibraryButton';
import { MigrateDialog } from '@renderer/features/anime/MigrateDialog';
import { DownloadMenu } from '@renderer/features/downloads/DownloadMenu';
import { call } from '@renderer/lib/api';
import { animeQuery, episodesQuery, refreshAnime } from '@renderer/lib/catalog';
import { useDownloadMap } from '@renderer/lib/downloads';
import { continueQuery } from '@renderer/lib/library';
import { describeError, isCloudflare } from '@renderer/lib/errors';
import { cn } from '@renderer/lib/utils';

export const Route = createFileRoute('/_app/anime/$animeId')({ component: AnimePage });

const STATUS_VARIANT = {
  ongoing: 'success',
  completed: 'info',
  hiatus: 'warning',
  cancelled: 'danger',
  unknown: 'outline',
} as const;

function AnimePage() {
  const { t } = useTranslation();
  const animeId = Number(Route.useParams().animeId);
  const queryClient = useQueryClient();
  const anime = useQuery(animeQuery(animeId));
  const episodes = useQuery(episodesQuery(animeId));
  const target = useQuery(continueQuery(animeId));
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [unwatchedOnly, setUnwatchedOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const downloads = useDownloadMap();
  const [migrating, setMigrating] = useState(false);

  const refresh = useMutation({
    // Joins a fetch started by hovering the card, and fills the query cache itself.
    mutationFn: () => refreshAnime(queryClient, animeId),
  });

  // The first time an anime is opened its details and episodes are fetched once, on their own (BRW-6).
  const autoRefreshed = useRef<number | null>(null);
  const { mutate: refreshNow } = refresh;
  useEffect(() => {
    if (anime.data && anime.data.detailsFetchedAt === null && autoRefreshed.current !== animeId) {
      autoRefreshed.current = animeId;
      refreshNow();
    }
  }, [anime.data, animeId, refreshNow]);

  const list = useMemo(() => {
    const rows = (episodes.data ?? []).filter(
      (episode) =>
        (!unwatchedOnly || (!episode.watched && !episode.sourceMissing)) &&
        (!downloadedOnly || downloads.get(episode.id)?.status === 'done'),
    );
    return sort === 'newest' ? rows : [...rows].reverse();
  }, [episodes.data, sort, unwatchedOnly, downloadedOnly, downloads]);
  const counts = useMemo(() => countEpisodes(episodes.data ?? []), [episodes.data]);

  if (anime.isError) {
    return (
      <ErrorState
        title={t('anime.loadFailed')}
        description={describeError(anime.error, t)}
        action={
          <Link to="/browse/sources" className={buttonVariants({ variant: 'secondary' })}>
            {t('nav.sources')}
          </Link>
        }
      />
    );
  }
  if (!anime.data) return <HeaderSkeleton />;
  const data = anime.data;
  // "Continue" when there is something to continue (PRG-6); otherwise the first episode, or the first again
  // when everything was watched.
  const oldest = episodes.data?.at(-1);
  const continuing = target.data ? episodes.data?.find((episode) => episode.id === target.data?.episodeId) : undefined;
  const playTarget = continuing ?? oldest;
  const playLabel =
    target.data && target.data.reason !== 'first'
      ? target.data.number !== null
        ? t('library.continueEpisode', { number: target.data.number })
        : t('library.continue')
      : counts.total > 0 && counts.unwatched === 0
        ? t('anime.watchAgain')
        : t('anime.start');
  const facts = [data.type?.toUpperCase(), data.year?.toString(), data.studio, data.sourceName].filter(
    (fact): fact is string => Boolean(fact),
  );

  return (
    <div className="flex flex-col">
      <header className="flex gap-8 border-b bg-card/40 px-6 py-6">
        <Cover
          sourceId={data.sourceId}
          url={data.thumbnailUrl}
          localAnimeId={data.inLibrary ? data.animeId : undefined}
          className="aspect-[2/3] w-52 shrink-0 self-start rounded-xl border shadow-2xl shadow-black/40"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {data.status !== 'unknown' || facts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.status !== 'unknown' ? (
                <Badge variant={STATUS_VARIANT[data.status]}>{t(`anime.status.${data.status}`)}</Badge>
              ) : null}
              {facts.map((fact) => (
                <Badge key={fact} variant="outline">
                  {fact}
                </Badge>
              ))}
            </div>
          ) : null}
          <div>
            <h1 className="text-3xl leading-tight font-bold tracking-tight select-text">{data.title}</h1>
            {data.altTitles.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground select-text">{data.altTitles.join(' · ')}</p>
            ) : null}
          </div>
          {data.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.genres.map((genre) => (
                <span key={genre} className="rounded-md border border-input px-2 py-0.5 text-xs">
                  {genre}
                </span>
              ))}
            </div>
          ) : null}
          {data.description ? (
            <p className="line-clamp-4 max-w-4xl leading-relaxed text-muted-foreground select-text">
              {data.description}
            </p>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            {playTarget ? (
              <Link
                to="/watch/$episodeId"
                params={{ episodeId: String(playTarget.id) }}
                className={buttonVariants({ size: 'lg' })}
              >
                <Play className="size-4" strokeWidth={1.75} aria-hidden />
                {playLabel}
              </Link>
            ) : (
              <Button size="lg" disabled>
                <Play className="size-4" strokeWidth={1.75} aria-hidden />
                {t('anime.start')}
              </Button>
            )}
            <LibraryButton anime={data} />
            {episodes.data && episodes.data.length > 0 ? (
              <DownloadMenu episodes={episodes.data} />
            ) : (
              <Button variant="secondary" size="lg" disabled>
                <Download className="size-4" strokeWidth={1.75} aria-hidden />
                {t('anime.download')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon"
              className="size-10"
              aria-label={t('anime.refresh')}
              title={t('anime.refresh')}
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="size-10"
              aria-label={t('anime.openInBrowser')}
              title={t('anime.openInBrowser')}
              disabled={!data.webUrl}
              onClick={() => data.webUrl && void call('app.openExternal', data.webUrl)}
            >
              <Globe className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="size-10"
              aria-label={t('migrate.title')}
              title={t('migrate.title')}
              onClick={() => setMigrating(true)}
            >
              <ArrowRightLeft className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <section className="flex flex-col" aria-labelledby="episodes-title">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-6 py-2.5 backdrop-blur">
          <h2 id="episodes-title" className="flex items-center gap-2 font-semibold">
            {t('anime.episodes')}
            <span className="rounded-md bg-primary/15 px-1.5 text-xs font-normal text-primary-text">
              {t('anime.total', { count: counts.total })}
              {counts.unwatched > 0 ? ` · ${t('anime.unwatchedCount', { count: counts.unwatched })}` : ''}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={unwatchedOnly}
              onClick={() => setUnwatchedOnly((on) => !on)}
              className={cn(
                'inline-flex h-8 items-center rounded-lg border border-input px-3 text-xs transition-colors hover:border-foreground/40',
                unwatchedOnly && 'border-primary bg-primary/15 text-primary-text',
              )}
            >
              {t('anime.unwatched')}
            </button>
            <button
              type="button"
              aria-pressed={downloadedOnly}
              onClick={() => setDownloadedOnly((on) => !on)}
              className={cn(
                'inline-flex h-8 items-center rounded-lg border border-input px-3 text-xs transition-colors hover:border-foreground/40',
                downloadedOnly && 'border-primary bg-primary/15 text-primary-text',
              )}
            >
              {t('anime.downloaded')}
            </button>
            <Select
              aria-label={t('anime.sort.newest')}
              value={sort}
              onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}
              className="h-8 text-xs"
            >
              <option value="newest">{t('anime.sort.newest')}</option>
              <option value="oldest">{t('anime.sort.oldest')}</option>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 pt-3 pb-6">
          {refresh.isError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-ctp-red/40 bg-ctp-red/10 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground">{t('anime.refreshFailed')}</div>
                <div className="text-xs text-muted-foreground">
                  {describeError(refresh.error, t)}{' '}
                  {episodes.data && episodes.data.length > 0 ? t('anime.showingSaved') : ''}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => refresh.mutate()}>
                {isCloudflare(refresh.error) ? t('browse.verify') : t('browse.retry')}
              </Button>
            </div>
          ) : null}

          {refresh.isPending && list.length === 0 ? (
            <RowSkeletons />
          ) : list.length === 0 && !refresh.isError ? (
            <p className="py-10 text-center text-muted-foreground">
              {downloadedOnly ? t('downloads.noneDownloaded') : t('anime.noEpisodes')}
            </p>
          ) : (
            <EpisodeList
              episodes={list}
              sourceId={data.sourceId}
              thumbnailUrl={data.thumbnailUrl}
              localCoverId={data.inLibrary ? data.animeId : undefined}
            />
          )}
        </div>
      </section>
      <MigrateDialog anime={data} open={migrating} onOpenChange={setMigrating} />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex gap-8 p-6" aria-hidden>
      <Skeleton className="aspect-[2/3] w-52 rounded-xl" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full max-w-3xl" />
      </div>
    </div>
  );
}

function RowSkeletons() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
