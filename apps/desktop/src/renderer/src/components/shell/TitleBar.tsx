import { useQuery } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const crumbs = crumbsFor(pathname);
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
        {crumbs.map((key, index) => (
          <span key={key}>
            <span className="px-1">/</span>
            <span className={index === crumbs.length - 1 ? 'text-foreground' : undefined}>{t(key)}</span>
          </span>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          className="no-drag flex h-7 w-80 max-w-full items-center gap-2 rounded-lg border border-border-strong bg-input pr-2 pl-2.5 text-xs leading-4 text-foreground"
        >
          <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate text-left">{t('titleBar.searchHint')}</span>
          <kbd className="rounded-sm bg-card px-1.5 py-px font-mono text-[11px] leading-3.5 font-medium">
            {PALETTE_SHORTCUT}
          </kbd>
        </button>
      </div>
      <WindowControls />
    </header>
  );
}
