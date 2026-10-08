import { useQuery } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DownloadActivity } from '@renderer/features/downloads/DownloadActivity';
import { animeQuery, networkStatusQuery } from '@renderer/lib/catalog';
import { appInfoQuery } from '@renderer/lib/ipc';
import { WindowControls } from './WindowControls';

/** The command palette arrives in phase 5; the hint is shown from the start (mockup 01). */
const PALETTE_SHORTCUT = 'Ctrl K';

/** The breadcrumb for a path, as translation keys. */
function crumbsFor(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  const [first, second] = parts;
  switch (first) {
    case 'browse':
      return ['nav.browse', second === 'global-search' ? 'nav.globalSearch' : `nav.${second ?? 'sources'}`];
    case 'settings':
      return ['nav.settings', `settings.sections.${second ?? 'general'}`];
    case 'anime':
      return ['nav.library'];
    case 'library':
    case 'updates':
    case 'history':
    case 'downloads':
      return [`nav.${first}`];
    default:
      return [];
  }
}

export function TitleBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: info } = useQuery(appInfoQuery);
  const { data: network } = useQuery(networkStatusQuery);
  // An anime page ends in the anime's own title (mockup 02); the others are fixed translation keys.
  const animeId = /^\/anime\/(\d+)/.exec(pathname)?.[1];
  const { data: anime } = useQuery({ ...animeQuery(Number(animeId)), enabled: animeId !== undefined });
  const crumbs: { text: string }[] = [
    ...crumbsFor(pathname).map((key) => ({ text: t(key) })),
    ...(animeId !== undefined && anime ? [{ text: anime.title }] : []),
  ];
  // macOS draws its traffic lights over the top-left corner of the frameless window.
  const leftPadding = info?.platform === 'darwin' ? 'pl-20' : 'pl-3';

  const iconButton =
    'no-drag flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-input/50';
  return (
    <header className={`drag-region flex h-10 shrink-0 items-center gap-3 border-b bg-sidebar ${leftPadding}`}>
      <div className="flex gap-1">
        <button
          type="button"
          className={iconButton}
          aria-label={t('titleBar.back')}
          onClick={() => router.history.back()}
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={t('titleBar.forward')}
          onClick={() => router.history.forward()}
        >
          <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <nav aria-label="Breadcrumb" className="text-xs leading-4 whitespace-nowrap text-muted-foreground">
        {t('app.name')}
        {crumbs.map(({ text }, index) => (
          <span key={`${index}-${text}`}>
            <span className="px-1">/</span>
            <span className={index === crumbs.length - 1 ? 'text-foreground' : undefined}>{text}</span>
          </span>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={() => void router.navigate({ to: '/browse/global-search' })}
          className="no-drag flex h-7 w-80 max-w-full items-center gap-2 rounded-lg border border-border-strong bg-input pr-2 pl-2.5 text-xs leading-4 text-foreground"
        >
          <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate text-left">{t('titleBar.searchHint')}</span>
          <kbd className="rounded-sm bg-card px-1.5 py-px font-mono text-[11px] leading-3.5 font-medium">
            {PALETTE_SHORTCUT}
          </kbd>
        </button>
      </div>
      <DownloadActivity />
      {network?.online === false ? (
        <span className="flex h-6 items-center gap-1.5 rounded-full bg-warning/16 px-2.5 text-xs leading-4 font-medium text-foreground">
          <WifiOff className="size-3.5" strokeWidth={1.75} aria-hidden />
          {t('network.offline')}
        </span>
      ) : null}
      <WindowControls />
    </header>
  );
}
