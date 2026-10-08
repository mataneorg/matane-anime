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
import { EpisodeList } from '@renderer/features/anime/EpisodeList';
import { LibraryButton } from '@renderer/features/anime/LibraryButton';
import { MigrateDialog } from '@renderer/features/anime/MigrateDialog';
import { call } from '@renderer/lib/api';
import { animeQuery, episodesQuery } from '@renderer/lib/catalog';
import { continueQuery } from '@renderer/lib/library';
import { describeError, isCloudflare } from '@renderer/lib/errors';
import { cn } from '@renderer/lib/utils';

export const Route = createFileRoute('/_app/anime/$animeId')({ component: AnimePage });

function AnimePage() {
  const { t } = useTranslation();
  const animeId = Number(Route.useParams().animeId);
  const queryClient = useQueryClient();
  const anime = useQuery(animeQuery(animeId));
  const episodes = useQuery(episodesQuery(animeId));
  const target = useQuery(continueQuery(animeId));
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [unwatchedOnly, setUnwatchedOnly] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const refresh = useMutation({
    mutationFn: () => call('anime.refresh', { animeId }),
    onSuccess: (result) => {
      queryClient.setQueryData(animeQuery(animeId).queryKey, result.anime);
      queryClient.setQueryData(episodesQuery(animeId).queryKey, result.episodes);
    },
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
      (episode) => !unwatchedOnly || (!episode.watched && !episode.sourceMissing),
    );
    return sort === 'newest' ? rows : [...rows].reverse();
  }, [episodes.data, sort, unwatchedOnly]);
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
  const facts = [
    data.type?.toUpperCase(),
    data.year?.toString(),
    data.status !== 'unknown' ? t(`anime.status.${data.status}`) : null,
    data.studio,
    data.sourceName,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="flex flex-col">
      <header className="flex gap-6 bg-card/40 p-6">
        <Cover
          sourceId={data.sourceId}
          url={data.thumbnailUrl}
          localAnimeId={data.inLibrary ? data.animeId : undefined}
          className="aspect-[2/3] w-48 shrink-0 rounded-xl"
        />
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <h1 className="text-2xl leading-8 font-bold tracking-tight">{data.title}</h1>
            {data.altTitles.length > 0 ? <p className="text-xs leading-4">{data.altTitles.join(' · ')}</p> : null}
          </div>
          {facts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {facts.map((fact) => (
                <span
                  key={fact}
                  className="rounded-lg border border-border-strong px-2.5 py-0.5 text-xs leading-5 text-foreground"
                >
                  {fact}
                </span>
              ))}
            </div>
          ) : null}
          {data.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.genres.map((genre) => (
                <Badge key={genre}>{genre}</Badge>
              ))}
            </div>
          ) : null}
          {data.description ? <p className="line-clamp-4 max-w-3xl">{data.description}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="secondary" size="lg" disabled title={t('anime.comingSoon')}>
              <Download className="size-4" strokeWidth={1.75} aria-hidden />
              {t('anime.download')}
            </Button>
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

      <section className="flex flex-col gap-3 p-6" aria-labelledby="episodes-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="episodes-title" className="text-lg leading-6 font-semibold">
            {t('anime.episodes')}{' '}
            <span className="font-mono text-xs leading-4 font-normal">
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
                'h-9 rounded-full border border-border-strong px-3 text-[13px] transition-colors',
                unwatchedOnly && 'border-accent bg-accent/16 font-semibold text-foreground',
              )}
            >
              {t('anime.unwatched')}
            </button>
            <button
              type="button"
              disabled
              title={t('anime.comingSoon')}
              className="h-9 cursor-not-allowed rounded-full border border-border-strong px-3 text-[13px] opacity-50"
            >
              {t('anime.downloaded')}
            </button>
            <Select
              aria-label={t('anime.sort.newest')}
              value={sort}
              onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}
            >
              <option value="newest">{t('anime.sort.newest')}</option>
              <option value="oldest">{t('anime.sort.oldest')}</option>
            </Select>
          </div>
        </div>

        {refresh.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-foreground">{t('anime.refreshFailed')}</div>
              <div className="text-xs leading-4">
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
          <p>{t('anime.noEpisodes')}</p>
        ) : (
          <EpisodeList
            episodes={list}
            sourceId={data.sourceId}
            thumbnailUrl={data.thumbnailUrl}
            localCoverId={data.inLibrary ? data.animeId : undefined}
          />
        )}
      </section>
      <MigrateDialog anime={data} open={migrating} onOpenChange={setMigrating} />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex animate-pulse gap-6 p-6" aria-hidden>
      <div className="aspect-[2/3] w-48 rounded-xl bg-card" />
      <div className="flex flex-1 flex-col gap-3">
        <div className="h-8 w-1/2 rounded bg-card" />
        <div className="h-4 w-1/3 rounded bg-card" />
        <div className="h-16 w-3/4 rounded bg-card" />
      </div>
    </div>
  );
}

function RowSkeletons() {
  return (
    <div className="flex animate-pulse flex-col gap-2" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-16 rounded-xl bg-card" />
      ))}
    </div>
  );
}
