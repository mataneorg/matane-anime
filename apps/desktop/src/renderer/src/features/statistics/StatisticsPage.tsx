import { STATS_RANGES, type StatsOverview, type StatsRange } from '@matane-anime/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChartColumn, Clock, EyeOff, Flame, LibraryBig, type LucideIcon, Table2, Trophy, Tv } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Button } from '@renderer/components/ui/button';
import { Segmented } from '@renderer/components/ui/segmented';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { statsQuery } from '@renderer/lib/stats';
import { cn } from '@renderer/lib/utils';
import { ColumnChart } from './ColumnChart';
import { duration, percentOf, timeScale } from './format';
import { useColorScheme } from './useColorScheme';

/**
 * Categorical colors for the sources breakdown: the first four slots of the validated reference palette (adjacent CVD
 * ΔE ≥ 8 on the Catppuccin surfaces, light and dark steps); the rest folds into a grey "Other". The names and shares
 * are always printed next to the bar, so identity never rests on color alone.
 */
const SOURCE_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500'],
} as const;
const MAX_SOURCES = 4;

/** Statistics: how much was watched, when, and what. */
export function StatisticsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<StatsRange>('month');
  // The previous period stays on screen while the next one loads (no flash, view state kept).
  const { data, error, refetch, isPending } = useQuery({ ...statsQuery(range), placeholderData: keepPreviousData });
  // Nothing recorded at all (in any period) shows the empty state instead of a page of zeros.
  const nothing = data && !data.hasData;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-xl leading-7 font-semibold">{t('nav.statistics')}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
            <EyeOff className="size-3.5" aria-hidden />
            {t('stats.incognitoNote')}
          </p>
        </div>
        <Segmented
          label={t('stats.range.label')}
          options={STATS_RANGES}
          value={range}
          onChange={setRange}
          format={(value) => t(`stats.range.${value}`)}
        />
      </header>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : nothing ? (
        <div className="rounded-xl border">
          <EmptyState icon={ChartColumn} title={t('stats.empty.title')} description={t('stats.empty.description')} />
        </div>
      ) : isPending || !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
          <Skeleton className="col-span-2 h-72 lg:col-span-4" />
        </div>
      ) : (
        <Overview data={data} />
      )}
    </div>
  );
}

function Overview({ data }: { data: StatsOverview }) {
  const { t, i18n } = useTranslation();
  const number = (value: number, digits = 0): string =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const formatDuration = (ms: number): string => {
    const { value, unit } = duration(ms);
    return `${number(value, unit === 'h' ? 1 : 0)} ${t(unit === 'h' ? 'stats.hoursShort' : 'stats.minutesShort')}`;
  };
  const time = duration(data.watchMs);
  const perDay = Math.round(data.watchMs / 60_000 / data.days);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="stats-tiles">
        <Tile icon={Tv} label={t('stats.tiles.episodes')} value={number(data.episodesWatched)}>
          {t(`stats.tiles.in.${data.range}`)}
        </Tile>
        <Tile
          icon={Clock}
          label={t('stats.tiles.time')}
          value={number(time.value, time.unit === 'h' && time.value < 10 ? 1 : 0)}
          unit={t(time.unit === 'h' ? 'stats.hoursShort' : 'stats.minutesShort')}
        >
          {t('stats.tiles.perDay', { minutes: perDay })}
        </Tile>
        <Tile icon={LibraryBig} label={t('stats.tiles.library')} value={number(data.library.total)}>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-ctp-green" aria-hidden />
            {t('stats.tiles.watching', { count: data.library.watching })}
          </span>
        </Tile>
        <Tile
          icon={Flame}
          label={t('stats.tiles.streak')}
          value={number(data.streak.current)}
          unit={t('stats.days', { count: data.streak.current })}
        >
          <span className="flex items-center gap-1.5">
            <Trophy className="size-3.5" aria-hidden />
            {t('stats.tiles.best', { count: data.streak.best })}
          </span>
        </Tile>
      </div>

      <ActivityCard data={data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('stats.genres.title')} description={t('stats.genres.description')}>
          {data.genres.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.noneInRange')}</p>
          ) : (
            <GenreBars data={data} />
          )}
        </Card>
        <Card title={t('stats.top.title')} description={t('stats.top.description')}>
          {data.topAnime.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('stats.noneInRange')}</p>
          ) : (
            <ol className="flex flex-col divide-y" data-testid="stats-top">
              {data.topAnime.map((anime, i) => (
                <li key={anime.animeId}>
                  <Link
                    to="/anime/$animeId"
                    params={{ animeId: String(anime.animeId) }}
                    className="flex items-center gap-3 rounded-md py-2.5 hover:bg-accent/50"
                  >
                    <span className="w-6 text-right font-mono text-sm text-muted-foreground">
                      {t('stats.top.rank', { rank: i + 1 })}
                    </span>
                    <Cover
                      sourceId={anime.sourceId}
                      url={anime.thumbnailUrl}
                      localAnimeId={anime.hasLocalCover ? anime.animeId : undefined}
                      className="aspect-2/3 w-9 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{anime.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[anime.studio, anime.genres.join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold text-foreground">
                        {t('stats.episodesShort', { count: anime.episodes })}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">{formatDuration(anime.ms)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {data.sources.length > 0 && <SourcesCard data={data} />}
    </>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  unit,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card/40 p-4">
      <p className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        <Icon className="size-4 text-primary-text" aria-hidden />
      </p>
      <p className="text-3xl leading-9 font-bold tracking-tight text-foreground">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </p>
      <p className="text-xs leading-4 text-muted-foreground">{children}</p>
    </section>
  );
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card/40 p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs leading-4 text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Episodes watched or watch time over the period: one measure at a time on one axis, with a table view. */
function ActivityCard({ data }: { data: StatsOverview }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<'episodes' | 'time'>('episodes');
  const [table, setTable] = useState(false);
  const label = (start: number, long = false): string =>
    new Date(start).toLocaleDateString(
      i18n.language,
      data.unit === 'day'
        ? { day: 'numeric', month: 'short' }
        : { month: long ? 'long' : 'short', ...(long || data.series.length > 12 ? { year: 'numeric' } : {}) },
    );
  // Minutes while even the busiest bucket is under an hour, hours otherwise (a short session is never "0.1 h").
  const scale = timeScale(Math.max(0, ...data.series.map((bucket) => bucket.ms)));
  const unitLabel = t(scale.unit === 'h' ? 'stats.hoursShort' : 'stats.minutesShort');
  const timeValue = (ms: number): string =>
    (ms / scale.perUnitMs).toLocaleString(i18n.language, { maximumFractionDigits: scale.unit === 'h' ? 1 : 0 });
  const valueOf = (bucket: StatsOverview['series'][number]): number =>
    metric === 'episodes' ? bucket.episodes : bucket.ms / scale.perUnitMs;
  const format = (value: number): string =>
    metric === 'episodes'
      ? t('stats.episodesShort', { count: value })
      : `${value.toLocaleString(i18n.language, { maximumFractionDigits: scale.unit === 'h' ? 1 : 0 })} ${unitLabel}`;
  const tooltips = data.series.map((bucket) => `${label(bucket.start, true)} · ${format(valueOf(bucket))}`);

  return (
    <Card
      title={t(`stats.activity.${metric}.${data.unit}`)}
      description={t(`stats.tiles.in.${data.range}`)}
      action={
        <div className="flex items-center gap-2">
          <Segmented
            label={t('stats.activity.metric')}
            options={['episodes', 'time'] as const}
            value={metric}
            onChange={setMetric}
            format={(value) => t(`stats.activity.metrics.${value}`)}
          />
          <Button
            variant={table ? 'secondary' : 'ghost'}
            size="icon"
            aria-pressed={table}
            aria-label={t('stats.activity.table')}
            title={t('stats.activity.table')}
            onClick={() => setTable(!table)}
          >
            <Table2 className="size-4" aria-hidden />
          </Button>
        </div>
      }
    >
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm" data-testid="stats-table">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">{t(`stats.activity.period.${data.unit}`)}</th>
                <th className="py-1.5 text-right font-medium">{t('stats.activity.metrics.episodes')}</th>
                <th className="py-1.5 text-right font-medium">
                  {t('stats.activity.metrics.time')} ({unitLabel})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.series.map((bucket) => (
                <tr key={bucket.start}>
                  <td className="py-1.5">{label(bucket.start, true)}</td>
                  <td className="py-1.5 text-right font-mono">{bucket.episodes}</td>
                  <td className="py-1.5 text-right font-mono">{timeValue(bucket.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ColumnChart
          values={data.series.map(valueOf)}
          labels={data.series.map((bucket) => label(bucket.start))}
          tooltips={tooltips}
          ariaLabel={tooltips.join(', ')}
          format={(value) => value.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}
          integer={metric === 'episodes' || scale.unit === 'min'}
        />
      )}
    </Card>
  );
}

function GenreBars({ data }: { data: StatsOverview }) {
  const { t } = useTranslation();
  // Share of the episodes watched (an episode of an anime with three genres counts for each of them).
  const max = data.genres[0]?.episodes ?? 1;
  return (
    <div className="flex flex-col gap-3" data-testid="stats-genres">
      {data.genres.map((genre) => (
        <div key={genre.name}>
          <p className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-foreground">{genre.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {`${percentOf(genre.episodes, data.episodesWatched)}% · ${t('stats.episodesShort', { count: genre.episodes })}`}
            </span>
          </p>
          <div className="h-1.5 rounded-full bg-ctp-surface0">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(genre.episodes / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {data.otherGenreEpisodes > 0 && (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {t('stats.genres.other', { count: data.otherGenreEpisodes })}
        </p>
      )}
    </div>
  );
}

function SourcesCard({ data }: { data: StatsOverview }) {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const total = data.sources.reduce((sum, source) => sum + source.episodes, 0);
  const rest = data.sources.slice(MAX_SOURCES).reduce((sum, source) => sum + source.episodes, 0);
  const parts = [
    ...data.sources.slice(0, MAX_SOURCES).map((source, i) => ({
      key: source.sourceId,
      name: source.name,
      episodes: source.episodes,
      color: SOURCE_COLORS[scheme][i] ?? 'var(--catppuccin-color-overlay0)',
    })),
    ...(rest > 0
      ? [{ key: 'other', name: t('stats.sources.other'), episodes: rest, color: 'var(--catppuccin-color-overlay0)' }]
      : []),
  ];
  return (
    <Card
      title={t('stats.sources.title')}
      description={t('stats.sources.description')}
      action={
        <span className="font-mono text-sm text-muted-foreground">{t('stats.episodesShort', { count: total })}</span>
      }
    >
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" data-testid="stats-sources">
        {parts.map((part) => (
          <div
            key={part.key}
            title={`${part.name} · ${t('stats.episodesShort', { count: part.episodes })}`}
            style={{ width: `${(part.episodes / total) * 100}%`, backgroundColor: part.color }}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {parts.map((part) => (
          <li key={part.key} className="flex items-start gap-2 text-sm">
            <span
              className="mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: part.color }}
              aria-hidden
            />
            <span>
              <span className={cn('font-semibold text-foreground')}>{part.name}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">{`${percentOf(part.episodes, total)}%`}</span>
              <span className="block text-xs text-muted-foreground">
                {t('stats.sources.watched', { count: part.episodes })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
