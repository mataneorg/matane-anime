import { AppError, type UpdateCheckResult } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Download, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { UpdateRow } from '@renderer/features/updates/UpdateRow';
import { checkedAt, groupByDay } from '@renderer/features/updates/helpers';
import { call } from '@renderer/lib/api';
import { enqueueEpisodes } from '@renderer/lib/downloads';
import { describeError } from '@renderer/lib/errors';
import { updatesQuery } from '@renderer/lib/updates';
import { useUpdatesStore } from '@renderer/stores/updates';

export const Route = createFileRoute('/_app/updates')({ component: UpdatesPage });

/** How long "12 minutes ago" may be stale before the page looks again. */
const CLOCK_MS = 60_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function UpdatesPage() {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, error, refetch } = useQuery(updatesQuery);
  const status = useUpdatesStore((state) => state.status);
  const now = useNow();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const failed = data?.failed ?? [];
  const groups = useMemo(() => groupByDay(entries, now, i18n.language), [entries, now, i18n.language]);
  // What was marked or removed in the meantime is no longer selected.
  const chosen = useMemo(() => entries.filter((entry) => selected.has(entry.episodeId)), [entries, selected]);

  const toggle = (episodeId: number): void =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(episodeId)) next.add(episodeId);
      return next;
    });

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
      setSelected((previous) => new Set([...previous].filter((id) => !episodeIds.includes(id)))),
    onError: (failure) => setProblem(describeError(failure, t)),
  });
  const download = useMutation({
    // Toasts, the size-limit question and the error texts are shared with the other download buttons.
    mutationFn: (episodeIds: number[]) => enqueueEpisodes(episodeIds),
    onSuccess: () => setSelected(new Set()),
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
    <div className="flex min-h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('nav.updates')}</h1>
          {entries.length > 0 ? <Badge>{t('updates.count', { count: entries.length })}</Badge> : null}
        </div>
        <div className="flex-1" />
        <p role="status" className="text-xs leading-4">
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
          className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-foreground"
        >
          <TriangleAlert className="size-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
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
          <Button variant="secondary" size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {t('updates.retry')}
          </Button>
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-warning">
          {problem}
        </p>
      ) : null}

      {chosen.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl bg-card px-4 py-2"
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
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('updates.clearSelection')}
          </Button>
        </div>
      ) : null}

      {isError ? (
        <ErrorState
          title={t('updates.loadFailed')}
          description={describeError(error, t)}
          action={<Button onClick={() => void refetch()}>{t('updates.retry')}</Button>}
        />
      ) : !isPending && entries.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t('empty.updates.title')}
          description={`${t('empty.updates.description')} ${when}`}
        />
      ) : (
        groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2" aria-label={group.label}>
            <h2 className="pt-2 text-[15px] leading-[22px] font-semibold text-foreground">{group.label}</h2>
            <ul className="flex flex-col gap-2">
              {group.entries.map((entry) => (
                <UpdateRow
                  key={entry.episodeId}
                  entry={entry}
                  now={now}
                  selected={selected.has(entry.episodeId)}
                  onSelect={() => toggle(entry.episodeId)}
                  onDownload={() => download.mutate([entry.episodeId])}
                  onWatched={() => markWatched.mutate([entry.episodeId])}
                  busy={markWatched.isPending || download.isPending}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <Dialog open={confirmingAll} onOpenChange={setConfirmingAll}>
        <DialogContent
          title={t('updates.markAllTitle')}
          description={t('updates.markAllBody', { count: entries.length })}
          closeLabel={t('common.close')}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingAll(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                markWatched.mutate(entries.map((entry) => entry.episodeId));
                setConfirmingAll(false);
              }}
            >
              {t('updates.markAll')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isCancelled(error: unknown): boolean {
  return error instanceof AppError && error.code === 'cancelled';
}
