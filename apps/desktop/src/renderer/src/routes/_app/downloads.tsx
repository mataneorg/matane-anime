import type { DownloadItem } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Download, Pause, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { useDownloadActions } from '@renderer/features/downloads/actions';
import {
  ActiveRow,
  DoneRow,
  FailedRow,
  PausedRow,
  QueuedRow,
  type RowDrag,
} from '@renderer/features/downloads/DownloadRow';
import { applyReorder, groupDownloads, moveId } from '@renderer/features/downloads/progress';
import { StorageCard } from '@renderer/features/downloads/StorageCard';
import { call } from '@renderer/lib/api';
import { downloadsQuery } from '@renderer/lib/downloads';
import { describeError } from '@renderer/lib/errors';
import { useDownloadsStore } from '@renderer/stores/downloads';

export const Route = createFileRoute('/_app/downloads')({ component: DownloadsPage });

function DownloadsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery(downloadsQuery);
  const progress = useDownloadsStore((state) => state.progress);
  const actions = useDownloadActions();
  const [dragging, setDragging] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [deleting, setDeleting] = useState<DownloadItem | null>(null);

  const groups = useMemo(() => groupDownloads(list.data ?? [], progress), [list.data, progress]);

  const reorder = useMutation({
    mutationFn: (ids: number[]) => call('downloads.reorder', { ids }),
    // The row moves at once; main's answer (a `downloads` change) replaces this with the real order.
    onMutate: (ids) => {
      queryClient.setQueryData(downloadsQuery.queryKey, (items) => items && applyReorder(items, ids));
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: downloadsQuery.queryKey }),
  });
  const queuedIds = groups.queued.map((item) => item.id);
  const drag: RowDrag = {
    dragging,
    onDragStart: setDragging,
    onEnd: () => setDragging(null),
    onDropOn: (targetId) => {
      const from = queuedIds.indexOf(dragging ?? -1);
      const to = queuedIds.indexOf(targetId);
      setDragging(null);
      if (from >= 0 && to >= 0 && from !== to) reorder.mutate(moveId(queuedIds, from, to));
    },
    onMove: (id, direction) => {
      const from = queuedIds.indexOf(id);
      const next = moveId(queuedIds, from, from + direction);
      if (next.join() !== queuedIds.join()) reorder.mutate(next);
    },
  };

  if (list.isError) {
    return (
      <ErrorState
        title={t('downloads.loadFailed')}
        description={describeError(list.error, t)}
        action={
          <Button variant="secondary" onClick={() => void list.refetch()}>
            {t('browse.retry')}
          </Button>
        }
      />
    );
  }
  if (list.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-5" aria-busy>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[74px] rounded-xl" />
        ))}
      </div>
    );
  }
  if (list.data.length === 0) {
    return (
      <EmptyState icon={Download} title={t('empty.downloads.title')} description={t('empty.downloads.description')} />
    );
  }

  const counts = [
    ['downloading', groups.active.length],
    ['queued', groups.queued.length],
    ['paused', groups.paused.length],
    ['failed', groups.failed.length],
  ] as const;
  const running = groups.active.length + groups.queued.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold">{t('nav.downloads')}</h1>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {counts
              .filter(([, count]) => count > 0)
              .map(([name, count]) => t(`downloads.counts.${name}`, { count }))
              .join(' · ')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {groups.paused.length > 0 ? (
            <Button variant="secondary" onClick={() => actions.resumeAll.mutate()}>
              <Play className="size-4" strokeWidth={1.75} aria-hidden />
              {t('downloads.resumeAll')}
            </Button>
          ) : null}
          {running ? (
            <Button variant="secondary" onClick={() => actions.pauseAll.mutate()}>
              <Pause className="size-4" strokeWidth={1.75} aria-hidden />
              {t('downloads.pauseAll')}
            </Button>
          ) : null}
          {/* The mockup says "Clear finished", but a finished download is an episode kept offline. */}
          <Button
            variant="secondary"
            disabled={groups.failed.length === 0}
            onClick={() => actions.clearFailed.mutate()}
          >
            {t('downloads.clearFailed')}
          </Button>
        </div>
      </header>

      <StorageCard />

      <ul className="flex flex-col gap-2" aria-label={t('downloads.queueLabel')}>
        {groups.active.map((item) => (
          <ActiveRow key={item.id} item={item} actions={actions} />
        ))}
        {groups.queued.map((item) => (
          <QueuedRow key={item.id} item={item} actions={actions} drag={drag} />
        ))}
        {groups.paused.map((item) => (
          <PausedRow key={item.id} item={item} actions={actions} />
        ))}
        {groups.failed.map((item) => (
          <FailedRow key={item.id} item={item} actions={actions} />
        ))}
      </ul>

      {groups.done.length > 0 ? (
        <section aria-label={t('downloads.completed.title')} className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showDone}
            aria-controls="completed-downloads"
            onClick={() => setShowDone((open) => !open)}
            className="flex h-8 w-fit items-center gap-2 rounded-lg px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            {showDone ? (
              <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
            )}
            {t('downloads.completed.heading', { count: groups.done.length })}
          </button>
          {showDone ? (
            <ul id="completed-downloads" className="flex flex-col gap-2">
              {groups.done.map((item) => (
                <DoneRow key={item.id} item={item} onDelete={setDeleting} />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent
          title={t('downloads.completed.deleteTitle')}
          description={t('downloads.completed.deleteBody', { title: deleting?.animeTitle ?? '' })}
          closeLabel={t('common.close')}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) actions.remove.mutate(deleting.id);
                setDeleting(null);
              }}
            >
              {t('downloads.completed.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
