import type { DownloadItem, DownloadProgress } from '@matane-anime/shared';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { CircleAlert, Clock, GripVertical, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react';
import type { DragEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { Button, buttonVariants } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useDownloadsStore } from '@renderer/stores/downloads';
import type { useDownloadActions } from './actions';
import { describeDownloadError } from './errors';
import { formatBytes, formatEta, formatSpeed, percentDone } from './format';

type Actions = ReturnType<typeof useDownloadActions>;

export interface RowDrag {
  /** Called with the id of the row the dragged one was dropped on, or moved past with the keyboard. */
  onDragStart: (id: number) => void;
  onDropOn: (id: number) => void;
  onEnd: () => void;
  onMove: (id: number, direction: -1 | 1) => void;
  dragging: number | null;
}

/** "Ep 13 · Night Train", unless the name already says which episode it is. */
function episodeLabel(item: DownloadItem, numberLabel: (number: number) => string): string {
  if (item.episodeNumber === null || /^\s*(ep(isode)?\b|#?\d)/i.test(item.episodeName)) return item.episodeName;
  return `${numberLabel(item.episodeNumber)} · ${item.episodeName}`;
}

/** "Server A · 1080p · HLS": what was picked for this download, once known. */
function rowName(item: DownloadItem, t: TFunction): string {
  return `${item.animeTitle} · ${episodeLabel(item, (number) => t('anime.episodeNumber', { number }))}`;
}

function streamFacts(item: DownloadItem): string {
  return [
    item.server,
    item.quality ? `${item.quality}p` : null,
    item.server || item.quality ? item.kind.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Thumb({ item, className }: { item: DownloadItem; className?: string }) {
  return (
    <Link
      to="/anime/$animeId"
      params={{ animeId: String(item.animeId) }}
      tabIndex={-1}
      aria-hidden
      className="shrink-0"
    >
      <Cover
        sourceId={item.sourceId}
        url={item.thumbnailUrl}
        localAnimeId={item.hasLocalCover ? item.animeId : undefined}
        className={cn('h-[54px] w-24 rounded-lg', className)}
      />
    </Link>
  );
}

function Title({ item, facts }: { item: DownloadItem; facts?: boolean }) {
  const { t } = useTranslation();
  const label = episodeLabel(item, (number) => t('anime.episodeNumber', { number }));
  const detail = streamFacts(item);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        to="/anime/$animeId"
        params={{ animeId: String(item.animeId) }}
        className="truncate font-semibold text-foreground"
      >
        {item.animeTitle} · {label}
      </Link>
      {facts && detail ? (
        <span className="shrink-0 rounded-full border border-border-strong px-2 text-xs leading-5 text-foreground">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

function Bar({ item, label, paused }: { item: DownloadItem; label: string; paused?: boolean }) {
  const percent = percentDone(item);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { 'aria-valuenow': Math.round(percent) })}
      className="h-1.5 overflow-hidden rounded-full bg-input"
    >
      <div
        className={cn('h-full', paused ? 'bg-muted-foreground' : 'bg-accent')}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  );
}

/** Segments (or bytes for one file) saved so far, and how fast it goes while it runs. */
function Stats({ item, tick }: { item: DownloadItem; tick?: DownloadProgress | undefined }) {
  const { t, i18n } = useTranslation();
  const size = (bytes: number): string => formatBytes(bytes, i18n.language);
  const parts: string[] = [];
  if (item.segmentsTotal)
    parts.push(t('downloads.row.segments', { done: item.segmentsDone, total: item.segmentsTotal }));
  if (item.status === 'downloading') {
    parts.push(
      item.segmentsTotal || item.sizeBytes === null
        ? size(item.bytesDone)
        : t('downloads.row.bytesOf', { done: size(item.bytesDone), total: size(item.sizeBytes) }),
    );
    if (tick && tick.bytesPerSecond > 0) parts.push(formatSpeed(tick.bytesPerSecond, i18n.language));
    if (tick?.etaSeconds != null) parts.push(t('downloads.row.left', { time: formatEta(tick.etaSeconds) }));
  } else {
    parts.push(t('downloads.row.saved', { size: size(item.bytesDone) }));
  }
  return <div className="truncate font-mono text-xs leading-4">{parts.join(' · ')}</div>;
}

const shell = 'flex items-center gap-4 rounded-xl p-2 pr-3';

export function ActiveRow({ item, actions }: { item: DownloadItem; actions: Actions }) {
  const { t } = useTranslation();
  const tick = useDownloadsStore((state) => state.progress[item.id]);
  const name = rowName(item, t);
  return (
    <li className={cn(shell, 'bg-card')} data-status="downloading">
      <Thumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Title item={item} facts />
        <Bar item={item} label={name} />
        <Stats item={item} tick={tick} />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('downloads.row.pause', { name })}
        onClick={() => actions.pause.mutate(item.id)}
      >
        <Pause className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
      <CancelButton item={item} name={name} actions={actions} />
    </li>
  );
}

function CancelButton({ item, name, actions }: { item: DownloadItem; name: string; actions: Actions }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('downloads.row.cancel', { name })}
      onClick={() => actions.cancel.mutate(item.id)}
    >
      <X className="size-4" strokeWidth={1.75} aria-hidden />
    </Button>
  );
}

export function QueuedRow({ item, actions, drag }: { item: DownloadItem; actions: Actions; drag: RowDrag }) {
  const { t } = useTranslation();
  const name = rowName(item, t);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    drag.onMove(item.id, event.key === 'ArrowUp' ? -1 : 1);
  };
  const onDragOver = (event: DragEvent): void => {
    if (drag.dragging !== null) event.preventDefault();
  };
  return (
    <li
      className={cn(shell, 'bg-card', drag.dragging === item.id && 'opacity-50')}
      data-status="queued"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        drag.onDragStart(item.id);
      }}
      onDragOver={onDragOver}
      onDrop={(event) => {
        event.preventDefault();
        drag.onDropOn(item.id);
      }}
      onDragEnd={drag.onEnd}
    >
      <button
        type="button"
        aria-label={t('downloads.row.reorder', { name })}
        title={t('downloads.row.reorderHint')}
        onKeyDown={onKeyDown}
        className="-mr-2 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-input/50"
      >
        <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
      <Thumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Title item={item} />
        <div className="text-xs leading-4">{t('downloads.row.waiting')}</div>
      </div>
      <span className="flex items-center gap-1.5 text-xs leading-4 text-foreground">
        <Clock className="size-4 text-info" strokeWidth={1.75} aria-hidden />
        {t('downloads.status.queued')}
      </span>
      <CancelButton item={item} name={name} actions={actions} />
    </li>
  );
}

export function PausedRow({ item, actions }: { item: DownloadItem; actions: Actions }) {
  const { t } = useTranslation();
  const name = rowName(item, t);
  return (
    <li className={cn(shell, 'bg-card')} data-status="paused">
      <Thumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Title item={item} />
        <Bar item={item} label={name} paused />
        <Stats item={item} />
      </div>
      <span className="flex items-center gap-1.5 text-xs leading-4 text-foreground">
        <Pause className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t('downloads.status.paused')}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('downloads.row.resume', { name })}
        onClick={() => actions.resume.mutate(item.id)}
      >
        <Play className="size-4 fill-current" strokeWidth={1.75} aria-hidden />
      </Button>
      <CancelButton item={item} name={name} actions={actions} />
    </li>
  );
}

export function FailedRow({ item, actions }: { item: DownloadItem; actions: Actions }) {
  const { t } = useTranslation();
  const name = rowName(item, t);
  const text = describeDownloadError(item.error);
  const message = 'raw' in text ? t('downloads.errors.raw', { message: text.raw }) : t(text.key, text.values);
  return (
    <li className={cn(shell, 'bg-danger/16')} data-status="error">
      <Thumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Title item={item} />
        <div className="text-xs leading-4 text-foreground" title={message}>
          {message}
          {item.bytesDone > 0 ? ` ${t('downloads.errors.reused')}` : ''}
        </div>
      </div>
      <span className="flex items-center gap-1.5 text-xs leading-4 text-foreground">
        <CircleAlert className="size-4 text-danger" strokeWidth={1.75} aria-hidden />
        {t('downloads.status.failed')}
      </span>
      <Button aria-label={t('downloads.row.retry', { name })} onClick={() => actions.retry.mutate(item.id)}>
        <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
        {t('downloads.row.retryLabel')}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('downloads.row.remove', { name })}
        onClick={() => actions.remove.mutate(item.id)}
      >
        <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </li>
  );
}

export function DoneRow({ item, onDelete }: { item: DownloadItem; onDelete: (item: DownloadItem) => void }) {
  const { t, i18n } = useTranslation();
  const name = rowName(item, t);
  const detail = [streamFacts(item), formatBytes(item.bytesDone, i18n.language)].filter(Boolean).join(' · ');
  return (
    <li className={cn(shell, 'bg-card')} data-status="done">
      <Thumb item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Title item={item} />
        <div className="truncate font-mono text-xs leading-4">{detail}</div>
      </div>
      <Link
        to="/watch/$episodeId"
        params={{ episodeId: String(item.episodeId) }}
        aria-label={t('downloads.row.play', { name })}
        className={buttonVariants({ size: 'md' })}
      >
        <Play className="size-4" strokeWidth={2} aria-hidden />
        {t('downloads.row.playLabel')}
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('downloads.row.delete', { name })}
        onClick={() => onDelete(item)}
      >
        <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </li>
  );
}
