import type { DownloadItem } from '@matane-anime/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import i18n from '@renderer/i18n';
import { summarizeEnqueue } from '@renderer/features/downloads/enqueue';
import { useDownloadsStore } from '@renderer/stores/downloads';
import { call } from './api';
import { describeError } from './errors';
import { localQueryDefaults } from './query';
import { notify } from './toast';

// Downloads the main process keeps; `db.changed` with the `downloads` tag invalidates `['downloads']`.
// The numbers that change many times a second are in `stores/downloads.ts`.

export const downloadsQuery = queryOptions({
  queryKey: ['downloads', 'list'],
  queryFn: () => call('downloads.list'),
  ...localQueryDefaults,
});

export const downloadStorageQuery = queryOptions({
  queryKey: ['downloads', 'storage'],
  queryFn: () => call('downloads.storage'),
  ...localQueryDefaults,
});

/**
 * Queues episodes and tells the user how it went (DL-1). Episodes that would pass the size limit are not
 * queued: the user is asked first (`DownloadsHost`), and a yes comes back here with `force` (DL-10).
 */
export async function enqueueEpisodes(episodeIds: number[], options: { force?: boolean } = {}): Promise<void> {
  const t = i18n.t.bind(i18n);
  if (episodeIds.length === 0) return;
  try {
    const result = await call('downloads.enqueue', { episodeIds, ...(options.force && { force: true }) });
    const feedback = summarizeEnqueue(result);
    if (feedback.queued > 0) {
      notify.success(t('downloads.enqueue.queued', { count: feedback.queued }));
    } else if (feedback.existing > 0 && feedback.overLimit.length === 0 && feedback.refused.length === 0) {
      notify.info(t('downloads.enqueue.existing', { count: feedback.existing }));
    }
    for (const { reason, count } of feedback.refused) {
      notify.error(t('downloads.enqueue.refused', { count }), t(`downloads.refusals.${reason}`));
    }
    if (feedback.overLimit.length > 0) useDownloadsStore.getState().askLimit(feedback.overLimit);
  } catch (error) {
    notify.error(t('downloads.enqueue.failed'), describeError(error, t));
  }
}

/** The downloads by episode, for the rows that show a download's state. */
export function useDownloadMap(): ReadonlyMap<number, DownloadItem> {
  const { data } = useQuery(downloadsQuery);
  return useMemo(() => new Map((data ?? []).map((item) => [item.episodeId, item])), [data]);
}
