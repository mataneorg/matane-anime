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
import { cn } from '@renderer/lib/utils';
import type { SourceInfo } from '@matane-anime/shared';

export const Route = createFileRoute('/_app/browse/sources/')({ component: SourcesPage });

const hue = (text: string): number => [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;

function SourcesPage() {
  const { t } = useTranslation();
  const { data: sources = [], isPending } = useQuery(sourcesQuery);
  const [language, setLanguage] = useState('all');

  // Main already leaves out 18+ sources and languages the user did not choose (EXT-15).
  const languages = useMemo(() => [...new Set(sources.map((source) => source.lang))].sort(), [sources]);
  const shown = sources
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
    <div className="flex min-h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b px-6 py-4">
        <h1 className="mr-auto text-xl font-semibold">{t('browse.sources.title')}</h1>
        <OpenFromUrl sources={sources.filter((source) => source.available)} />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        {languages.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('browse.sources.allLanguages')}>
            {['all', ...languages].map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={language === code}
                onClick={() => setLanguage(code)}
                className={cn(
                  'inline-flex h-8 items-center rounded-lg border border-input px-3 text-xs transition-colors hover:border-foreground/40',
                  language === code && 'border-primary bg-primary/15 text-primary-text',
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
      </div>
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
    <li className="flex items-center gap-4 rounded-xl border bg-card/40 p-3 transition-colors hover:border-input hover:bg-card/70">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-black"
        style={{ background: `hsl(${hue(source.extensionId)} 65% 75%)` }}
      >
        {source.name.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-foreground">{source.name}</span>
        <span className="truncate text-xs text-muted-foreground">{source.extensionName}</span>
      </div>
      <Badge>{source.lang.toUpperCase()}</Badge>
      {source.nsfw ? <Badge tone="warning">18+</Badge> : null}
      {!source.available ? <Badge tone="danger">{t('browse.sources.notInstalled')}</Badge> : null}
      <Button
        variant="ghost"
        size="icon"
        className={cn(source.pinned && 'text-primary-text')}
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
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          {t('browse.sources.browse')}
        </Link>
      ) : (
        <Button variant="secondary" size="sm" disabled>
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
        <p role="status" className="text-xs text-warning-text">
          {t('browse.sources.notRecognized')}
        </p>
      ) : null}
    </form>
  );
}
