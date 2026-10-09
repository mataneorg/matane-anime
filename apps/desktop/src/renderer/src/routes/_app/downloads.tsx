import type { DownloadItem } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Download, Pause, Play, RotateCcw } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Button } from '@renderer/components/ui/button';
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
import { formatSpeed } from '@renderer/features/downloads/format';
import {
  applyReorder,
  groupByAnime,
  groupDownloads,
  moveWithinAnime,
  stepWithinAnime,
  totalSpeed,
} from '@renderer/features/downloads/progress';
import { StorageCard } from '@renderer/features/downloads/StorageCard';
import { call } from '@renderer/lib/api';
import { downloadsQuery } from '@renderer/lib/downloads';
import { useScrollRestoration } from '@renderer/lib/scroll';
import { cn } from '@renderer/lib/utils';
import { useDownloadsStore } from '@renderer/stores/downloads';

export const Route = createFileRoute('/_app/downloads')({ component: DownloadsPage });

type Tab = 'queue' | 'completed' | 'errors';
const TABS: Tab[] = ['queue', 'completed', 'errors'];

function DownloadsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery(downloadsQuery);
  const progress = useDownloadsStore((state) => state.progress);
  const speed = totalSpeed(progress);
  useScrollRestoration(list.isSuccess);
  const actions = useDownloadActions();
  const [dragging, setDragging] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
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
  // The page lists the queue per anime, so a row only moves among the queued rows of its own anime.
  const drag: RowDrag = {
    dragging,
    onDragStart: setDragging,
    onEnd: () => setDragging(null),
    onDropOn: (targetId) => {
      const next = dragging === null ? null : moveWithinAnime(groups.queued, dragging, targetId);
      setDragging(null);
      if (next) reorder.mutate(next);
    },
    onMove: (id, direction) => {
      const next = stepWithinAnime(groups.queued, id, direction);
      if (next) reorder.mutate(next);
    },
  };

  if (list.isError) {
    return <ErrorState title={t('downloads.loadFailed')} error={list.error} onRetry={() => void list.refetch()} />;
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
  // The queue holds everything that is not finished (failed ones too, so they can be retried in place); the
  // Errors tab is the failed subset.
  const byTab: Record<Tab, DownloadItem[]> = {
    queue: [...groups.active, ...groups.queued, ...groups.paused, ...groups.failed],
    completed: groups.done,
    errors: groups.failed,
  };

  const renderRow = (item: DownloadItem): React.ReactNode => {
    switch (item.status) {
      case 'downloading':
        return <ActiveRow key={item.id} item={item} actions={actions} />;
      case 'queued':
        return <QueuedRow key={item.id} item={item} actions={actions} drag={drag} />;
      case 'paused':
        return <PausedRow key={item.id} item={item} actions={actions} />;
      case 'error':
        return <FailedRow key={item.id} item={item} actions={actions} />;
      case 'done':
        return <DoneRow key={item.id} item={item} onDelete={setDeleting} />;
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-6 py-5">
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
              <Button variant="secondary" size="sm" onClick={() => actions.resumeAll.mutate()}>
                <Play aria-hidden />
                {t('downloads.resumeAll')}
              </Button>
            ) : null}
            {running ? (
              <Button variant="secondary" size="sm" onClick={() => actions.pauseAll.mutate()}>
                <Pause aria-hidden />
                {t('downloads.pauseAll')}
              </Button>
            ) : null}
            {/* The mockup says "Clear finished", but a finished download is an episode kept offline. */}
            <Button
              variant="secondary"
              size="sm"
              disabled={groups.failed.length === 0}
              onClick={() => actions.clearFailed.mutate()}
            >
              {t('downloads.clearFailed')}
            </Button>
          </div>
        </header>

        <StorageCard />

        <div role="tablist" aria-label={t('nav.downloads')} className="flex items-end gap-6 border-b">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={cn(
                '-mb-px flex h-9 items-center gap-2 border-b-2 border-transparent px-1 text-muted-foreground transition-colors hover:text-foreground',
                tab === name && 'border-primary font-semibold text-foreground',
              )}
            >
              {t(`downloads.tabs.${name}`)}
              <span
                className={cn(
                  'rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground',
                  name === 'errors' && byTab.errors.length > 0 && 'bg-ctp-red/15 text-danger-text',
                  tab === name && name !== 'errors' && 'bg-primary/20 text-primary-text',
                )}
              >
                {byTab[name].length}
              </span>
            </button>
          ))}
          {tab === 'errors' && byTab.errors.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="mb-1 ml-auto"
              disabled={actions.retryAll.isPending}
              onClick={() => actions.retryAll.mutate(byTab.errors.map((item) => item.id))}
            >
              <RotateCcw aria-hidden />
              {t('downloads.retryAll')}
            </Button>
          ) : null}
        </div>

        {byTab[tab].length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={tab === 'queue' ? Download : tab === 'completed' ? CircleCheck : CircleAlert}
              title={t(`downloads.empty.${tab}.title`)}
              description={t(`downloads.empty.${tab}.description`)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groupByAnime(byTab[tab]).map((group) => (
              <AnimeGroup
                key={group.animeId}
                animeId={group.animeId}
                title={group.title}
                count={group.items.length}
                label={tab === 'queue' ? t('downloads.queueLabel') : t(`downloads.tabs.${tab}`)}
              >
                {group.items.map(renderRow)}
              </AnimeGroup>
            ))}
          </div>
        )}
      </div>

      <footer className="sticky bottom-0 border-t bg-background/95 px-6 py-2 text-xs text-muted-foreground backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <span>{t('downloads.footer.summary', { active: groups.active.length, waiting: groups.queued.length })}</span>
          {speed > 0 ? (
            <span className="ml-auto tabular-nums text-foreground">{formatSpeed(speed, i18n.language)}</span>
          ) : (
            <span className="ml-auto">{t('downloads.footer.idle')}</span>
          )}
        </div>
      </footer>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('downloads.completed.deleteTitle')}
        description={t('downloads.completed.deleteBody', { title: deleting?.animeTitle ?? '' })}
        confirmLabel={t('downloads.completed.delete')}
        onConfirm={() => {
          if (deleting) actions.remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

/** The downloads of one anime: its title (a link) with a count, and a button that folds the rows away. */
function AnimeGroup({
  animeId,
  title,
  count,
  label,
  children,
}: {
  animeId: number;
  title: string;
  count: number;
  label: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const list = `downloads-${animeId}`;
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={open}
          aria-controls={open ? list : undefined}
          aria-label={open ? t('downloads.fold', { title }) : t('downloads.unfold', { title })}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        </Button>
        <Link
          to="/anime/$animeId"
          params={{ animeId: String(animeId) }}
          className="truncate text-sm font-semibold text-foreground hover:underline"
        >
          {title}
        </Link>
        <span className="rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground">{count}</span>
      </div>
      {open ? (
        <ul id={list} className="flex flex-col gap-2" aria-label={label}>
          {children}
        </ul>
      ) : null}
    </div>
  );
}
