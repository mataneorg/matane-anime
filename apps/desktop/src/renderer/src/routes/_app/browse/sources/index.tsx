import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Globe, Pin, PinOff } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { Badge } from '@renderer/components/ui/badge';
import { Button, buttonVariants } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { call } from '@renderer/lib/api';
import { sourcesQuery } from '@renderer/lib/catalog';
import { settingsQuery } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import type { SourceInfo } from '@matane-anime/shared';

export const Route = createFileRoute('/_app/browse/sources/')({ component: SourcesPage });

const hue = (text: string): number => [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;

function SourcesPage() {
  const { t } = useTranslation();
  const { data: sources = [], isPending } = useQuery(sourcesQuery);
  const { data: settings } = useQuery(settingsQuery);
  const [language, setLanguage] = useState('all');

  const visible = useMemo(() => sources.filter((source) => settings?.showNsfw || !source.nsfw), [sources, settings]);
  const hiddenCount = sources.length - visible.length;
  const languages = useMemo(() => [...new Set(visible.map((source) => source.lang))].sort(), [visible]);
  const shown = visible
    .filter((source) => language === 'all' || source.lang === language)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));

  if (!isPending && sources.length === 0) {
    return (
      <EmptyState
        icon={Globe}
        title={t('empty.sources.title')}
        description={t('empty.sources.description')}
        action={
          <Link to="/browse/extensions" className={buttonVariants({ size: 'lg' })}>
            {t('extensions.loadFolder')}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('browse.sources.title')}</h1>
        <OpenFromUrl sources={visible.filter((source) => source.available)} />
      </header>

      {languages.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('browse.sources.allLanguages')}>
          {['all', ...languages].map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={language === code}
              onClick={() => setLanguage(code)}
              className={cn(
                'h-8 rounded-full border border-border-strong px-3 text-[13px] transition-colors',
                language === code && 'border-accent bg-accent/16 font-semibold text-foreground',
              )}
            >
              {code === 'all' ? t('browse.sources.allLanguages') : code.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {shown.map((source) => (
          <SourceRow key={source.id} source={source} />
        ))}
      </ul>
      {hiddenCount > 0 ? <p className="text-xs leading-4">{t('browse.sources.nsfwHidden')}</p> : null}
    </div>
  );
}

function SourceRow({ source }: { source: SourceInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pin = useMutation({
    mutationFn: () => call('sources.setPinned', { sourceId: source.id, pinned: !source.pinned }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sourcesQuery.queryKey }),
  });
  return (
    <li className="flex items-center gap-4 rounded-xl bg-card p-3">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-black"
        style={{ background: `hsl(${hue(source.extensionId)} 65% 75%)` }}
      >
        {source.name.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-foreground">{source.name}</span>
        <span className="truncate text-xs leading-4">{source.extensionName}</span>
      </div>
      <Badge>{source.lang.toUpperCase()}</Badge>
      {source.nsfw ? <Badge tone="warning">18+</Badge> : null}
      {!source.available ? <Badge tone="danger">{t('browse.sources.notInstalled')}</Badge> : null}
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={source.pinned}
        aria-label={source.pinned ? t('browse.sources.unpin') : t('browse.sources.pin')}
        title={source.pinned ? t('browse.sources.unpin') : t('browse.sources.pin')}
        onClick={() => pin.mutate()}
      >
        {source.pinned ? (
          <PinOff className="size-4" strokeWidth={1.75} aria-hidden />
        ) : (
          <Pin className="size-4" strokeWidth={1.75} aria-hidden />
        )}
      </Button>
      {source.available ? (
        <Link
          to="/browse/sources/$sourceId"
          params={{ sourceId: source.id }}
          className={buttonVariants({ variant: 'secondary', size: 'md' })}
        >
          {t('browse.sources.browse')}
        </Link>
      ) : (
        <Button variant="secondary" disabled>
          {t('browse.sources.browse')}
        </Button>
      )}
    </li>
  );
}

/** Paste a link to an anime page; the first source that recognizes it opens it (docs/PRD.md BRW-3). */
function OpenFromUrl({ sources }: { sources: SourceInfo[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const open = useMutation({
    mutationFn: async (address: string) => {
      for (const source of sources) {
        const found = await call('sources.resolveUrl', { sourceId: source.id, url: address });
        if (found) return found;
      }
      return null;
    },
    onSuccess: (found) => {
      if (found) void navigate({ to: '/anime/$animeId', params: { animeId: String(found.animeId) } });
    },
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (url.trim()) open.mutate(url.trim());
  };
  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('browse.sources.urlPlaceholder')}
          aria-label={t('browse.sources.openFromUrl')}
        />
        <Button type="submit" variant="secondary" disabled={open.isPending || sources.length === 0}>
          {t('browse.sources.open')}
        </Button>
      </div>
      {open.isSuccess && open.data === null ? (
        <p role="status" className="text-xs leading-4 text-warning">
          {t('browse.sources.notRecognized')}
        </p>
      ) : null}
    </form>
  );
}
