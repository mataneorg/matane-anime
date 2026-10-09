import { useQuery } from '@tanstack/react-query';
import { useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search, WifiOff } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { animeQuery, networkStatusQuery } from '@renderer/lib/catalog';
import { appInfoQuery } from '@renderer/lib/ipc';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { usePaletteStore } from '@renderer/stores/palette';
import { IncognitoToggle } from '@renderer/components/IncognitoToggle';
import { useCrumbStore } from '@renderer/stores/crumbs';
import { ActivityIndicator } from './ActivityIndicator';
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
    case 'statistics':
    case 'downloads':
      return [`nav.${first}`];
    default:
      return [];
  }
}

export function TitleBar() {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: info } = useQuery(appInfoQuery);
  const { data: network } = useQuery(networkStatusQuery);
  // A page may add its own labels after the route's (a source's name, an anime's title) with `usePageCrumbs`.
  const pageLabels = useCrumbStore((state) => state.labels);
  // Until an anime page says its own title, the title bar looks it up so the crumb is never missing (mockup 02).
  const animeId = /^\/anime\/(\d+)/.exec(pathname)?.[1];
  const { data: anime } = useQuery({
    ...animeQuery(Number(animeId)),
    enabled: animeId !== undefined && pageLabels.length === 0,
  });
  const crumbs = [
    ...crumbsFor(pathname).map((key) => t(key)),
    ...(pageLabels.length > 0 ? pageLabels : animeId !== undefined && anime ? [anime.title] : []),
  ];
  const isMac = info?.platform === 'darwin';
  const paletteShortcut = isMac ? PALETTE_SHORTCUT.darwin : PALETTE_SHORTCUT.default;

  return (
    <header
      className={cn(
        'drag-region relative flex h-10 shrink-0 items-center border-b bg-sidebar',
        // macOS draws its traffic lights over the top-left corner of the frameless window.
        isMac ? 'pl-20' : 'pl-3',
      )}
    >
      <div className="no-drag flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('titleBar.back')}
          disabled={!canGoBack}
          onClick={() => router.history.back()}
        >
          <ChevronLeft strokeWidth={1.75} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('titleBar.forward')}
          onClick={() => router.history.forward()}
        >
          <ChevronRight strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      {/* Stops before the centred search box (w-80), whatever the window width. */}
      <nav
        aria-label="Breadcrumb"
        className="ml-3 flex max-w-[calc(50%-14rem)] min-w-0 items-center gap-1.5 text-xs leading-4 whitespace-nowrap text-muted-foreground"
      >
        <span className="shrink-0">{t('app.name')}</span>
        {crumbs.map((text, index) => (
          <Fragment key={`${index}-${text}`}>
            <span>/</span>
            <span className={cn('truncate', index === crumbs.length - 1 && 'text-foreground')}>{text}</span>
          </Fragment>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => usePaletteStore.getState().setOpen(true)}
        className="no-drag absolute left-1/2 flex h-7 w-80 max-w-[calc(100%-32rem)] min-w-48 -translate-x-1/2 items-center gap-2 rounded-lg border bg-background pr-2 pl-2.5 text-xs leading-4 text-muted-foreground transition-colors hover:border-input"
      >
        <Search className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="flex-1 truncate text-left">{t('titleBar.searchHint')}</span>
        <kbd className="rounded border bg-muted px-1.5 py-px font-mono text-[10px] leading-3.5 font-medium whitespace-nowrap">
          {paletteShortcut}
        </kbd>
      </button>

      <div className="ml-auto flex h-full items-center gap-1">
        <ActivityIndicator />
        {network?.online === false ? (
          <span className="flex h-6 items-center gap-1.5 rounded-md border border-ctp-peach/40 bg-ctp-peach/10 px-2 text-xs leading-4 font-medium text-warning-text">
            <WifiOff className="size-3.5" strokeWidth={1.75} aria-hidden />
            {t('network.offline')}
          </span>
        ) : null}
        <IncognitoToggle className="mr-1" />
        <WindowControls />
      </div>
    </header>
  );
}
