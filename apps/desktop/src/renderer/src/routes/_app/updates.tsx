import { AppError, type UpdateCheckResult, type UpdateEntry } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Download, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { EMPTY_SELECTION, type Selection, select } from '@renderer/features/library/selection';
import { UpdateRow } from '@renderer/features/updates/UpdateRow';
import { checkedAt, groupByDay } from '@renderer/features/updates/helpers';
import { call } from '@renderer/lib/api';
import { enqueueEpisodes } from '@renderer/lib/downloads';
import { describeError } from '@renderer/lib/errors';
import { updatesQuery } from '@renderer/lib/updates';
import { useScrollRestoration } from '@renderer/lib/scroll';
import { useNow } from '@renderer/lib/useNow';
import { useScroller } from '@renderer/lib/useScroller';
import { useUpdatesStore } from '@renderer/stores/updates';

export const Route = createFileRoute('/_app/updates')({ component: UpdatesPage });

const HEADING_HEIGHT = 44;
const ENTRY_HEIGHT = 90; // an 82 px row and 8 px gap

type Row =
  { kind: 'heading'; key: number; label: string; entries: UpdateEntry[] } | { kind: 'entry'; entry: UpdateEntry };

function UpdatesPage() {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, error, refetch } = useQuery(updatesQuery);
  const status = useUpdatesStore((state) => state.status);
  const now = useNow();
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [showingFailures, setShowingFailures] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const failed = data?.failed ?? [];
  const groups = useMemo(() => groupByDay(entries, now, i18n.language), [entries, now, i18n.language]);
  // What was marked or removed in the meantime is no longer selected.
  const chosen = useMemo(() => entries.filter((entry) => selection.ids.has(entry.episodeId)), [entries, selection]);
  const order = useMemo(() => entries.map((entry) => entry.episodeId), [entries]);
  // Shift adds the range from the last box clicked, in the order shown.
  const toggle = (episodeId: number, range: boolean): void =>
    setSelection((current) => select(current, order, episodeId, range ? 'range' : 'toggle'));
  const clearSelection = (): void => setSelection(EMPTY_SELECTION);

  // One flat list of day headings and episodes, so only the rows in view are in the DOM.
  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap((group): Row[] => [
        { kind: 'heading', key: group.key, label: group.label, entries: group.entries },
        ...group.entries.map((entry): Row => ({ kind: 'entry', entry })),
      ]),
    [groups],
  );
  useScrollRestoration(!isPending);

  const check = useMutation({
    mutationFn: async () => {
      const id = crypto.randomUUID();
      setRequestId(id);
      try {
        return await call('updates.check', { scope: { kind: 'all' }, requestId: id });
      } finally {
        setRequestId(null);
      }
    },
    onMutate: () => {
      setResult(null);
      setProblem(null);
    },
    onSuccess: setResult,
    onError: (failure) => {
      if (!isCancelled(failure)) setProblem(describeError(failure, t));
    },
  });
  const retry = useMutation({
    mutationFn: () =>
      Promise.allSettled(
        failed.map((item) => call('updates.check', { scope: { kind: 'anime', animeId: item.animeId } })),
      ),
  });
  const markWatched = useMutation({
    mutationFn: (episodeIds: number[]) => call('episodes.markWatched', { episodeIds, watched: true }),
    onMutate: () => setProblem(null),
    onSuccess: (_void, episodeIds) =>
      setSelection((current) => ({
        ids: new Set([...current.ids].filter((id) => !episodeIds.includes(id))),
        anchor: current.anchor,
      })),
    onError: (failure) => setProblem(describeError(failure, t)),
  });
  const download = useMutation({
    // Toasts, the size-limit question and the error texts are shared with the other download buttons.
    mutationFn: (episodeIds: number[]) => enqueueEpisodes(episodeIds),
    onSuccess: clearSelection,
  });

  const checking = status.checking || check.isPending;
  const lastChecked = data?.lastCheckedAt ?? null;
  const when =
    lastChecked === null
      ? t('updates.neverChecked')
      : t('updates.lastChecked', {
          when: checkedAt(lastChecked, now, i18n.language, (day, time) => t('updates.dayAt', { day, time })),
        });

  const statusLine = checking
    ? status.total > 0
      ? t('updates.checkingProgress', { done: status.done, total: status.total })
      : t('updates.checking')
    : result && result.skipped > 0
      ? `${when} · ${t('updates.skipped', { count: result.skipped })}`
      : when;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-6 py-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('nav.updates')}</h1>
          {entries.length > 0 ? <Badge>{t('updates.count', { count: entries.length })}</Badge> : null}
        </div>
        <div className="flex-1" />
        <p role="status" className="text-xs text-muted-foreground">
          {statusLine}
        </p>
        {checking && requestId !== null ? (
          <Button variant="secondary" onClick={() => void call('requests.cancel', requestId)}>
            <X className="size-4" strokeWidth={1.75} aria-hidden />
            {t('common.cancel')}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={checking} onClick={() => check.mutate()}>
          <RefreshCw className={checking ? 'size-4 animate-spin' : 'size-4'} strokeWidth={1.75} aria-hidden />
          {t('updates.checkNow')}
        </Button>
        <Button variant="secondary" disabled={entries.length === 0} onClick={() => setConfirmingAll(true)}>
          <Check className="size-4" strokeWidth={1.75} aria-hidden />
          {t('updates.markAll')}
        </Button>
      </header>

      {failed.length > 0 ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-ctp-peach/40 bg-ctp-peach/10 px-4 py-3 text-foreground"
        >
          <TriangleAlert className="size-5 shrink-0 text-ctp-peach" strokeWidth={1.75} aria-hidden />
          <p className="min-w-0 flex-1">
            <strong className="font-semibold">{t('updates.failed', { count: failed.length })}</strong>{' '}
            <span className="text-muted-foreground">
              {failed
                .slice(0, 3)
                .map((item) => `${item.title}: ${item.error}`)
                .join(' · ')}
              {failed.length > 3 ? ` ${t('updates.failedMore', { count: failed.length - 3 })}` : ''}
            </span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setShowingFailures(true)}>
            {t('updates.details')}
          </Button>
          <Button variant="secondary" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {t('updates.retry')}
          </Button>
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-warning-text">
          {problem}
        </p>
      ) : null}

      {chosen.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/40 px-4 py-2"
          aria-label={t('updates.selection')}
        >
          <span className="mr-auto font-semibold text-foreground">
            {t('updates.selected', { count: chosen.length })}
          </span>
          <Button size="sm" variant="secondary" onClick={() => download.mutate(chosen.map((entry) => entry.episodeId))}>
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
            {t('updates.downloadSelected')}
          </Button>
          <Button size="sm" onClick={() => markWatched.mutate(chosen.map((entry) => entry.episodeId))}>
            <Check className="size-4" strokeWidth={1.75} aria-hidden />
            {t('updates.markSelected')}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            {t('updates.clearSelection')}
          </Button>
        </div>
      ) : null}

      {isError ? (
        <ErrorState title={t('updates.loadFailed')} error={error} onRetry={() => void refetch()} />
      ) : !isPending && entries.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t('empty.updates.title')}
          description={`${t('empty.updates.description')} ${when}`}
        />
      ) : (
        <UpdatesList
          rows={rows}
          now={now}
          selection={selection}
          onSelect={toggle}
          onDownload={(episodeIds) => download.mutate(episodeIds)}
          onWatched={(episodeIds) => markWatched.mutate(episodeIds)}
          busy={markWatched.isPending || download.isPending}
        />
      )}

      <ConfirmDialog
        open={confirmingAll}
        onOpenChange={setConfirmingAll}
        title={t('updates.markAllTitle')}
        description={t('updates.markAllBody', { count: entries.length })}
        confirmLabel={t('updates.markAll')}
        destructive={false}
        onConfirm={() => markWatched.mutate(entries.map((entry) => entry.episodeId))}
      />
      <Dialog open={showingFailures} onOpenChange={setShowingFailures}>
        <DialogContent
          title={t('updates.failed', { count: failed.length })}
          description={t('updates.failedDetails')}
          closeLabel={t('common.close')}
        >
          <ul className="flex flex-col gap-2">
            {failed.map((item) => (
              <li key={item.animeId} className="rounded-lg border bg-card/40 px-3 py-2">
                <div className="font-medium text-foreground">{item.title}</div>
                {item.sourceName ? <div className="text-xs text-muted-foreground">{item.sourceName}</div> : null}
                <div className="mt-1 text-xs text-warning-text select-text">{item.error}</div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function isCancelled(error: unknown): boolean {
  return error instanceof AppError && error.code === 'cancelled';
}

/**
 * The day headings and episodes as one flat list: only the rows in view are in the DOM. It is its own component
 * because the virtualizer needs the list element to exist when it mounts.
 */
function UpdatesList({
  rows,
  now,
  selection,
  onSelect,
  onDownload,
  onWatched,
  busy,
}: {
  rows: Row[];
  now: number;
  selection: Selection;
  onSelect: (episodeId: number, range: boolean) => void;
  onDownload: (episodeIds: number[]) => void;
  onWatched: (episodeIds: number[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const { scroller, margin } = useScroller(listRef);
  // The compiler skips memoizing this component, which is fine: it only renders the rows in view.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (index) => (rows[index]?.kind === 'heading' ? HEADING_HEIGHT : ENTRY_HEIGHT),
    overscan: 8,
    scrollMargin: margin,
  });
  return (
    <div ref={listRef} role="list" className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        const position = {
          height: item.size,
          transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
        };
        if (row.kind === 'heading') {
          const downloadable = row.entries.filter(
            (entry) => entry.download === null || entry.download.status === 'error',
          );
          return (
            <div
              key={`day-${row.key}`}
              role="presentation"
              className="absolute top-0 left-0 flex w-full items-end justify-between gap-3 pb-2"
              style={position}
            >
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{row.label}</h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={downloadable.length === 0}
                aria-label={t('updates.downloadAllOf', { day: row.label })}
                onClick={() => void enqueueEpisodes(downloadable.map((entry) => entry.episodeId))}
              >
                <Download aria-hidden />
                {t('updates.downloadAll')}
              </Button>
            </div>
          );
        }
        const { entry } = row;
        return (
          <div key={entry.episodeId} className="absolute top-0 left-0 w-full pb-2" style={position}>
            <UpdateRow
              entry={entry}
              now={now}
              selected={selection.ids.has(entry.episodeId)}
              onSelect={(range) => onSelect(entry.episodeId, range)}
              onDownload={() => onDownload([entry.episodeId])}
              onWatched={() => onWatched([entry.episodeId])}
              busy={busy}
            />
          </div>
        );
      })}
    </div>
  );
}
