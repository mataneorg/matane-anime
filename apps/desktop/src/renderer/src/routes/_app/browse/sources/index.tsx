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
import { languageName } from '@renderer/features/extensions/helpers';
import { ExtensionIcon } from '@renderer/features/extensions/parts';

export const Route = createFileRoute('/_app/browse/sources/')({ component: SourcesPage });

function SourcesPage() {
  const { t, i18n } = useTranslation();
  const { data: sources = [], isPending } = useQuery(sourcesQuery);
  const [language, setLanguage] = useState('all');

  // Main already leaves out 18+ sources and languages the user did not choose (EXT-15).
  const languages = useMemo(() => [...new Set(sources.map((source) => source.lang))].sort(), [sources]);
  const shown = sources
    .filter((source) => language === 'all' || source.lang === language)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pinned = shown.filter((source) => source.pinned);
  const groups = groupByLanguage(
    shown.filter((source) => !source.pinned),
    i18n.language,
  );

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
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{t('browse.sources.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('browse.sources.subtitle', { count: sources.length })}</p>
        </div>
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

        {pinned.length > 0 ? <SourceGroup title={t('browse.sources.pinned')} sources={pinned} /> : null}
        {groups.map(([lang, list]) => (
          <SourceGroup key={lang} title={languageName(lang, i18n.language)} sources={list} />
        ))}
      </div>
    </div>
  );
}

/** UI language first, then English, then the rest alphabetically. */
function groupByLanguage(sources: SourceInfo[], uiLanguage: string): [string, SourceInfo[]][] {
  const groups = new Map<string, SourceInfo[]>();
  for (const source of sources) groups.set(source.lang, [...(groups.get(source.lang) ?? []), source]);
  const rank = (lang: string): number => (lang === uiLanguage ? 0 : lang === 'en' ? 1 : 2);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function SourceGroup({ title, sources }: { title: string; sources: SourceInfo[] }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
        <span className="rounded bg-muted px-1.5 font-normal text-foreground">{sources.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} />
        ))}
      </ul>
    </section>
  );
}

function SourceRow({ source }: { source: SourceInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pin = useMutation({
    mutationFn: () => call('sources.setPinned', { sourceId: source.id, pinned: !source.pinned }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sourcesQuery.queryKey }),
  });
  const title = (
    <>
      <span className="truncate font-semibold text-foreground">{source.name}</span>
      <span className="truncate text-xs text-muted-foreground">{source.extensionName}</span>
    </>
  );
  return (
    <li
      className={cn(
        'relative flex items-center gap-4 rounded-xl border bg-card/40 p-3 transition-colors',
        source.available && 'hover:border-input hover:bg-card/70',
      )}
    >
      <ExtensionIcon id={source.extensionId} name={source.name} className="size-10" />
      {source.available ? (
        // The whole card opens the source: the link stretches over it, and the buttons sit above it.
        <Link
          to="/browse/sources/$sourceId"
          params={{ sourceId: source.id }}
          className="flex min-w-0 flex-1 flex-col rounded-md outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {title}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">{title}</div>
      )}
      <Badge>{source.lang.toUpperCase()}</Badge>
      {source.nsfw ? <Badge tone="warning">18+</Badge> : null}
      {!source.available ? <Badge tone="danger">{t('browse.sources.notInstalled')}</Badge> : null}
      {source.available ? (
        <Link
          to="/browse/sources/$sourceId"
          params={{ sourceId: source.id }}
          search={{ tab: 'latest' }}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'relative')}
        >
          {t('browse.sources.latest')}
        </Link>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative', source.pinned && 'text-primary-text')}
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
