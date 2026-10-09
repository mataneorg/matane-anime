import type { DownloadStatus, UpdateEntry } from '@matane-anime/shared';
import { Link } from '@tanstack/react-router';
import { Check, CircleAlert, Clock, Download, LoaderCircle, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { Button, buttonVariants } from '@renderer/components/ui/button';
import { entryTitle, foundAt } from './helpers';

/** One new episode (mockup 07): select, cover, what it is, Play, Download and "mark watched". */
export function UpdateRow({
  entry,
  now,
  selected,
  onSelect,
  onDownload,
  onWatched,
  busy,
}: {
  entry: UpdateEntry;
  now: number;
  selected: boolean;
  /** `range` when Shift was held: select from the last box clicked. */
  onSelect: (range: boolean) => void;
  onDownload: () => void;
  onWatched: () => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const title = entryTitle(entry, (number) => t('anime.episodeNumber', { number }));
  const meta = [entry.sourceName, foundAt(entry.fetchedAt, now, i18n.language)].filter(Boolean).join(' · ');

  return (
    <div
      role="listitem"
      className="flex items-center gap-4 rounded-xl border bg-card/40 p-2 pr-3 transition-colors hover:border-input hover:bg-card/70"
    >
      <input
        type="checkbox"
        className="ml-1 size-4 shrink-0 accent-primary"
        checked={selected}
        onChange={(event) => onSelect((event.nativeEvent as MouseEvent).shiftKey)}
        aria-label={t('updates.select', { title: entry.animeTitle, episode: title })}
      />
      <Link
        to="/anime/$animeId"
        params={{ animeId: String(entry.animeId) }}
        className="shrink-0"
        aria-label={entry.animeTitle}
        tabIndex={-1}
      >
        <Cover
          sourceId={entry.sourceId}
          url={entry.thumbnailUrl}
          localAnimeId={entry.hasLocalCover ? entry.animeId : undefined}
          className="h-16 w-28 rounded-lg"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          to="/anime/$animeId"
          params={{ animeId: String(entry.animeId) }}
          className="truncate font-medium text-foreground hover:underline"
        >
          {entry.animeTitle}
        </Link>
        <span className="truncate">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{meta}</span>
      </div>
      <DownloadState status={entry.download?.status ?? null} />
      <Link
        to="/watch/$episodeId"
        params={{ episodeId: String(entry.episodeId) }}
        className={buttonVariants({ size: 'sm' })}
        aria-label={t('updates.playLabel', { title: entry.animeTitle, episode: title })}
      >
        <Play className="size-4 fill-current" strokeWidth={2} aria-hidden />
        {t('updates.play')}
      </Link>
      {entry.download === null || entry.download.status === 'error' ? (
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={t('updates.downloadLabel', { title: entry.animeTitle, episode: title })}
          title={t('updates.download')}
          onClick={onDownload}
        >
          <Download className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      ) : (
        <span className="size-8 shrink-0" aria-hidden />
      )}
      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label={t('updates.watchedLabel', { title: entry.animeTitle, episode: title })}
        title={t('updates.markWatched')}
        onClick={onWatched}
      >
        <Check className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
}

/** The state of the episode's download, always with a word (never color alone). */
function DownloadState({ status }: { status: DownloadStatus | null }) {
  const { t } = useTranslation();
  if (status === null) return null;
  const view =
    status === 'done'
      ? { Icon: Check, text: t('updates.state.done'), className: 'text-success-text' }
      : status === 'queued'
        ? { Icon: Clock, text: t('updates.state.queued'), className: 'text-info-text' }
        : status === 'downloading'
          ? { Icon: LoaderCircle, text: t('updates.state.downloading'), className: 'text-info-text' }
          : status === 'paused'
            ? { Icon: Pause, text: t('updates.state.paused'), className: 'text-muted-foreground' }
            : { Icon: CircleAlert, text: t('updates.state.error'), className: 'text-warning-text' };
  return (
    <span className={`flex shrink-0 items-center gap-1 text-xs ${view.className}`}>
      <view.Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      {view.text}
    </span>
  );
}
