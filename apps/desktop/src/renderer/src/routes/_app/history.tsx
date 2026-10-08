import type { HistoryEntry } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Check, History as HistoryIcon, Play, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { EmptyState } from '@renderer/components/EmptyState';
import { Button, buttonVariants } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { episodeTitle } from '@renderer/features/anime/EpisodeList';
import { call } from '@renderer/lib/api';
import { dayKey, dayLabel, formatClock } from '@renderer/lib/dates';
import { historyQuery } from '@renderer/lib/library';

export const Route = createFileRoute('/_app/history')({ component: HistoryPage });

function HistoryPage() {
  const { t, i18n } = useTranslation();
  const { data: entries = [], isPending } = useQuery(historyQuery);
  const [confirming, setConfirming] = useState(false);
  // Day headings are relative to when the page was opened.
  const [now] = useState(() => Date.now());
  const clear = useMutation({ mutationFn: () => call('history.clear') });

  // One heading per day, newest first (the list arrives in that order).
  const groups = useMemo(() => {
    const out: { key: number; label: string; entries: HistoryEntry[] }[] = [];
    for (const entry of entries) {
      const key = dayKey(entry.watchedAt);
      const last = out.at(-1);
      if (last && last.key === key) last.entries.push(entry);
      else out.push({ key, label: dayLabel(entry.watchedAt, now, i18n.language), entries: [entry] });
    }
    return out;
  }, [entries, i18n.language, now]);

  if (!isPending && entries.length === 0) {
    return (
      <EmptyState icon={HistoryIcon} title={t('empty.history.title')} description={t('empty.history.description')} />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('nav.history')}</h1>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          {t('history.clearAll')}
        </Button>
      </header>
      <p className="text-xs leading-4">{t('history.explainer')}</p>

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2" aria-label={group.label}>
          <h2 className="pt-2 text-[15px] leading-[22px] font-semibold text-foreground">{group.label}</h2>
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <HistoryRow key={entry.animeId} entry={entry} />
            ))}
          </ul>
        </section>
      ))}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={t('history.clearTitle')}
          description={t('history.clearBody')}
          closeLabel={t('common.close')}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clear.mutate();
                setConfirming(false);
              }}
            >
              {t('history.clearAll')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { t, i18n } = useTranslation();
  const remove = useMutation({ mutationFn: () => call('history.delete', { animeId: entry.animeId }) });
  const share = entry.watched ? 100 : entry.durationMs ? Math.min(100, (entry.positionMs / entry.durationMs) * 100) : 0;
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(entry.watchedAt);
  const title = episodeTitle(
    {
      id: entry.episodeId,
      animeId: entry.animeId,
      url: '',
      name: entry.episodeName,
      number: entry.episodeNumber,
      variant: null,
      uploadedAt: null,
      sourceOrder: 0,
      watched: entry.watched,
      positionMs: entry.positionMs,
      durationMs: entry.durationMs,
      sourceMissing: false,
    },
    (number) => t('anime.episodeNumber', { number }),
  );
  const next = entry.next;

  return (
    <li className="flex items-center gap-4 rounded-xl bg-card p-2 pr-3">
      <Link
        to="/anime/$animeId"
        params={{ animeId: String(entry.animeId) }}
        className="shrink-0"
        aria-label={entry.title}
      >
        <Cover
          sourceId={entry.sourceId}
          url={entry.thumbnailUrl}
          localAnimeId={entry.hasLocalCover ? entry.animeId : undefined}
          className="h-16 w-28 rounded-lg"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          to="/anime/$animeId"
          params={{ animeId: String(entry.animeId) }}
          className="truncate font-semibold text-foreground"
        >
          {entry.title}
        </Link>
        <span className="truncate text-xs leading-4">{[title, entry.sourceName].filter(Boolean).join(' · ')}</span>
        <div className="h-1 overflow-hidden rounded-full bg-input" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${share}%` }} />
        </div>
      </div>
      <div className="flex w-32 shrink-0 flex-col items-end text-xs leading-4">
        {entry.watched ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="size-3.5" strokeWidth={2} aria-hidden />
            {t('anime.watched')}
          </span>
        ) : entry.durationMs ? (
          <span className="font-mono text-foreground">
            {t('history.position', {
              position: formatClock(entry.positionMs),
              duration: formatClock(entry.durationMs),
            })}
          </span>
        ) : null}
        <span>{time}</span>
      </div>
      {next ? (
        <Link
          to="/watch/$episodeId"
          params={{ episodeId: String(next.episodeId) }}
          className={buttonVariants({ size: 'md' })}
        >
          <Play className="size-4" strokeWidth={2} aria-hidden />
          {next.reason === 'resume'
            ? t('library.continue')
            : next.number !== null
              ? t('history.playEpisode', { number: next.number })
              : t('history.playNext')}
        </Link>
      ) : (
        <Link
          to="/anime/$animeId"
          params={{ animeId: String(entry.animeId) }}
          className={buttonVariants({ size: 'md', variant: 'secondary' })}
        >
          {t('history.open')}
        </Link>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('history.remove', { title: entry.title })}
        onClick={() => remove.mutate()}
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </li>
  );
}
