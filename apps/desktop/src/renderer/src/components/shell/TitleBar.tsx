import { useQuery } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DownloadActivity } from '@renderer/features/downloads/DownloadActivity';
import { animeQuery, networkStatusQuery } from '@renderer/lib/catalog';
import { appInfoQuery } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/button';
import { usePaletteStore } from '@renderer/stores/palette';
import { IncognitoPill } from './IncognitoPill';
import { WindowControls } from './WindowControls';

/** The key hint on the search button (mockup 01); the palette itself listens for both Ctrl and Cmd. */
const PALETTE_SHORTCUT = { default: 'Ctrl K', darwin: '\u2318 K' } as const;

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

  return (
    <header className={`drag-region flex h-10 shrink-0 items-center gap-3 border-b bg-sidebar ${leftPadding}`}>
      <div className="flex gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag"
          aria-label={t('titleBar.back')}
          onClick={() => router.history.back()}
        >
          <ChevronLeft strokeWidth={1.75} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="no-drag"
          aria-label={t('titleBar.forward')}
          onClick={() => router.history.forward()}
        >
          <ChevronRight strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      <nav aria-label="Breadcrumb" className="text-xs leading-4 whitespace-nowrap text-muted-foreground">
        {t('app.name')}
        {crumbs.map(({ text }, index) => (
          <span key={`${index}-${text}`}>
            <span className="px-1.5">/</span>
            <span className={index === crumbs.length - 1 ? 'text-foreground' : undefined}>{text}</span>
          </span>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={() => usePaletteStore.getState().setOpen(true)}
          className="no-drag flex h-7 w-80 max-w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-2.5 text-xs leading-4 text-muted-foreground transition-colors hover:border-input"
        >
          <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate text-left">{t('titleBar.searchHint')}</span>
          <kbd className="rounded border bg-muted px-1.5 py-px font-mono text-[10px] leading-3.5 font-medium whitespace-nowrap">
            {info?.platform === 'darwin' ? PALETTE_SHORTCUT.darwin : PALETTE_SHORTCUT.default}
          </kbd>
        </button>
      </div>
      <DownloadActivity />
      {network?.online === false ? (
        <span className="flex h-6 items-center gap-1.5 rounded-md border border-ctp-peach/40 bg-ctp-peach/10 px-2 text-xs leading-4 font-medium text-warning-text">
          <WifiOff className="size-3.5" strokeWidth={1.75} aria-hidden />
          {t('network.offline')}
        </span>
      ) : null}
      <IncognitoPill />
      <WindowControls />
    </header>
  );
}
