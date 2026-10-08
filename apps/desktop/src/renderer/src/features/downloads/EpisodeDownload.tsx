import type { DownloadItem } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, CircleAlert, Clock, Download, Pause, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { call } from '@renderer/lib/api';
import { enqueueEpisodes } from '@renderer/lib/downloads';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { useDownloadsStore } from '@renderer/stores/downloads';
import { describeDownloadError } from './errors';
import { percentDone } from './format';

const button =
  'flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-input/60 hover:text-foreground';

/** "✓ Downloaded", next to "Watched" in an episode row. */
export function DownloadedChip() {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1 text-xs leading-4 text-success">
      <Check className="size-3.5" strokeWidth={2} aria-hidden />
      {t('anime.downloaded')}
    </span>
  );
}

/** The live share of a running download, 0 to 100. */
export function useDownloadPercent(download: DownloadItem | undefined): number | null {
  const tick = useDownloadsStore((state) => (download ? state.progress[download.id] : undefined));
  if (!download || !tick) return null;
  return percentDone(tick);
}

/**
 * What an episode row offers for its download: the button to start one, or where it stands (queued,
 * downloading with its percentage, paused, failed with a retry). A finished download shows as a chip instead.
 */
export function EpisodeDownloadControl({
  episodeId,
  download,
}: {
  episodeId: number;
  download: DownloadItem | undefined;
}) {
  const { t } = useTranslation();
  const percent = useDownloadPercent(download);
  const retry = useMutation({
    mutationFn: (id: number) => call('downloads.retry', { id }),
    onError: (error) => notify.error(t('downloads.actionFailed'), describeError(error, t)),
  });

  if (!download) {
    return (
      <button
        type="button"
        className={button}
        aria-label={t('downloads.episode.download')}
        title={t('downloads.episode.download')}
        onClick={() => void enqueueEpisodes([episodeId])}
      >
        <Download className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }
  if (download.status === 'done') return null;
  if (download.status === 'error') {
    const text = describeDownloadError(download.error);
    const reason = 'raw' in text ? text.raw : t(text.key, text.values);
    return (
      <button
        type="button"
        className={`${button} text-danger`}
        aria-label={t('downloads.episode.retry')}
        title={`${reason}. ${t('downloads.episode.retry')}`}
        onClick={() => retry.mutate(download.id)}
      >
        <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }

  // Ticks arrive before the list says "downloading".
  const status = percent !== null ? 'downloading' : download.status;
  const Icon = status === 'paused' ? Pause : status === 'queued' ? Clock : CircleAlert;
  const label = t(`downloads.status.${status}`);
  return (
    <Link
      to="/downloads"
      className={`${button} px-0 font-medium text-[11px] leading-4`}
      aria-label={t('downloads.episode.status', { status: label })}
      title={label}
    >
      {status === 'downloading' ? (
        <span className="font-mono text-foreground">{Math.round(percent ?? percentDone(download) ?? 0)}%</span>
      ) : (
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </Link>
  );
}
