import type { EpisodeRow } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DownloadItem } from '@matane-anime/shared';
import { Check, Circle, CircleCheck, EllipsisVertical, Play } from 'lucide-react';
import { type MouseEvent, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { Badge } from '@renderer/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import {
  DownloadedChip,
  EpisodeDownloadControl,
  useDownloadPercent,
} from '@renderer/features/downloads/EpisodeDownload';
import { call } from '@renderer/lib/api';
import { useDownloadMap } from '@renderer/lib/downloads';
import { useScroller } from '@renderer/lib/useScroller';
import { cn } from '@renderer/lib/utils';

const ROW = 72; // 64 px row + 8 px gap

/** "Ep 12 · Name", unless the name already says which episode it is. */
export function episodeTitle(episode: EpisodeRow, label: (number: number) => string): string {
  if (episode.number === null || /^\s*(ep(isode)?\b|#?\d)/i.test(episode.name)) return episode.name;
  return `${label(episode.number)} · ${episode.name}`;
}

/**
 * The episodes of one anime. A series can have hundreds, so only the rows in view exist: the page itself
 * (`<main>`) is the scroll container, and the list tells the virtualizer where it starts inside it.
 */
export function EpisodeList({
  episodes,
  sourceId,
  thumbnailUrl,
  localCoverId,
  selected,
  onPick,
  onToggle,
  jump,
}: {
  episodes: EpisodeRow[];
  sourceId: string;
  thumbnailUrl: string | null;
  localCoverId?: number | undefined;
  selected: ReadonlySet<number>;
  /** A click on a row: the page decides whether it opens the episode or changes the selection. */
  onPick: (event: MouseEvent, episodeId: number) => void;
  /** The round select button of a row; Shift extends the selection from the last row clicked. */
  onToggle: (event: MouseEvent, episodeId: number) => void;
  /** Scrolls to a row; a new `token` scrolls again to the same one. */
  jump: { index: number; token: number } | null;
}) {
  const { t, i18n } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const { scroller, margin } = useScroller(listRef);

  // The compiler skips memoizing this component, which is fine: it only renders the rows in view.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: episodes.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW,
    overscan: 8,
    scrollMargin: margin,
    // The sticky toolbar covers the top of the page.
    scrollPaddingStart: 56,
  });
  useEffect(() => {
    if (jump) virtualizer.scrollToIndex(jump.index, { align: 'start' });
    // Only a new jump scrolls; the virtualizer object is the same for the life of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.token]);
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const downloads = useDownloadMap();

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }} role="list">
      {virtualizer.getVirtualItems().map((item) => {
        const episode = episodes[item.index];
        if (!episode) return null;
        return (
          <div
            key={episode.id}
            role="listitem"
            className="absolute top-0 left-0 w-full pb-2"
            style={{ height: item.size, transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            <EpisodeRowView
              episode={episode}
              sourceId={sourceId}
              thumbnailUrl={thumbnailUrl}
              localCoverId={localCoverId}
              download={downloads.get(episode.id)}
              selected={selected.has(episode.id)}
              onPick={(event) => onPick(event, episode.id)}
              onToggle={(event) => onToggle(event, episode.id)}
              date={episode.uploadedAt ? dates.format(episode.uploadedAt) : t('anime.episodeFallback')}
            />
          </div>
        );
      })}
    </div>
  );
}

function EpisodeRowView({
  episode,
  sourceId,
  thumbnailUrl,
  localCoverId,
  download,
  selected,
  onPick,
  onToggle,
  date,
}: {
  episode: EpisodeRow;
  sourceId: string;
  thumbnailUrl: string | null;
  localCoverId: number | undefined;
  download: DownloadItem | undefined;
  selected: boolean;
  onPick: (event: MouseEvent) => void;
  onToggle: (event: MouseEvent) => void;
  date: string;
}) {
  const { t } = useTranslation();
  const progress =
    !episode.watched && episode.positionMs > 0 && episode.durationMs
      ? Math.min(100, (episode.positionMs / episode.durationMs) * 100)
      : 0;
  const downloadPercent = useDownloadPercent(download);
  const mark = useMutation({
    mutationFn: (watched: boolean) => call('episodes.markWatched', { episodeIds: [episode.id], watched }),
  });
  const previous = useMutation({ mutationFn: () => call('episodes.markPrevious', { episodeId: episode.id }) });
  const reset = useMutation({ mutationFn: () => call('episodes.resetProgress', { episodeId: episode.id }) });

  return (
    <div
      className={cn(
        'group relative flex h-16 items-center rounded-xl border bg-card/40 transition-colors hover:border-input hover:bg-card/70',
        selected && 'border-primary bg-primary/10 hover:border-primary hover:bg-primary/15',
      )}
    >
      <button
        type="button"
        aria-label={selected ? t('anime.deselectEpisode') : t('anime.selectEpisode')}
        aria-pressed={selected}
        onClick={onToggle}
        className={cn(
          'absolute top-1.5 left-1.5 z-10 flex size-6 items-center justify-center rounded-full bg-ctp-crust/70 text-ctp-text opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
          selected && 'bg-primary text-primary-foreground opacity-100',
        )}
      >
        {selected ? <CircleCheck className="size-4" aria-hidden /> : <Circle className="size-4" aria-hidden />}
      </button>
      {downloadPercent !== null ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-xl" aria-hidden>
          <div className="h-full bg-primary" style={{ width: `${downloadPercent}%` }} />
        </div>
      ) : null}
      <Link
        to="/watch/$episodeId"
        params={{ episodeId: String(episode.id) }}
        onClick={onPick}
        className="flex h-full min-w-0 flex-1 items-center gap-4 pr-2"
      >
        <div className="relative shrink-0">
          <Cover
            sourceId={sourceId}
            url={thumbnailUrl}
            localAnimeId={localCoverId}
            className={cn('h-[62px] w-28 rounded-l-xl', episode.watched && 'opacity-60')}
          />
          {progress > 0 ? (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-ctp-crust/60" aria-hidden>
              <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
        <div className={cn('flex min-w-0 flex-1 flex-col', episode.watched && 'opacity-70')}>
          <span className={cn('truncate text-foreground', !episode.watched && 'font-semibold')}>
            {episodeTitle(episode, (number) => t('anime.episodeNumber', { number }))}
          </span>
          <span className="truncate text-xs text-muted-foreground">{date}</span>
        </div>
        {episode.variant ? <Badge>{episode.variant}</Badge> : null}
        {episode.sourceMissing ? <Badge tone="warning">{t('anime.missing')}</Badge> : null}
        {download?.status === 'done' ? <DownloadedChip /> : null}
        {episode.watched ? (
          <span className="flex items-center gap-1 text-xs text-success-text">
            <Check className="size-3.5" strokeWidth={2} aria-hidden />
            {t('anime.watched')}
          </span>
        ) : (
          <Play className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        )}
      </Link>
      {episode.sourceMissing && !download ? null : (
        <EpisodeDownloadControl episodeId={episode.id} download={download} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('anime.episodeActions')}
          className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <EllipsisVertical className="size-4" strokeWidth={1.75} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {episode.watched ? (
            <DropdownMenuItem onSelect={() => mark.mutate(false)}>{t('anime.markUnwatched')}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => mark.mutate(true)}>{t('anime.markWatched')}</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => previous.mutate()}>{t('anime.markPrevious')}</DropdownMenuItem>
          <DropdownMenuItem disabled={episode.positionMs === 0 && !episode.watched} onSelect={() => reset.mutate()}>
            {t('anime.resetProgress')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
