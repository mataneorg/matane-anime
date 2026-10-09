import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import {
  type LucideIcon,
  EyeOff,
  LibraryBig,
  Pause,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  Settings2,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { BROWSE_NAV, DOWNLOADS_NAV, MAIN_NAV } from '@renderer/components/shell/nav';
import { Dialog, DialogBareContent } from '@renderer/components/ui/dialog';
import { call } from '@renderer/lib/api';
import { formatClock } from '@renderer/lib/dates';
import { describeError } from '@renderer/lib/errors';
import { useIncognito, useSetIncognito } from '@renderer/lib/incognito';
import { historyQuery, libraryQuery } from '@renderer/lib/library';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';
import { usePaletteStore } from '@renderer/stores/palette';
import { type PaletteEntry, type PaletteGroup, buildSections, flattenSections, moveActive } from './rank';

/** What an entry does and how it is drawn; `rank.ts` does not look inside. */
interface Payload {
  run: () => void | Promise<void>;
  icon?: LucideIcon;
  /** The second line of a row. */
  hint?: string;
  /** Shown at the right edge, before the key hint. */
  trailing?: string;
  cover?: { sourceId: string; url: string | null; localAnimeId: number | undefined };
}

type Entry = PaletteEntry<Payload>;

/** Wait this long after the last keystroke before asking main for library matches. */
const SEARCH_DELAY_MS = 120;
const SETTINGS_SECTION = 'general';

const KEY_ESC = 'Esc';
const KEY_ENTER = 'Enter';
const KEY_TAB = 'Tab';
const KEY_UP = '↑';
const KEY_DOWN = '↓';

const kbd =
  'rounded border bg-muted px-1.5 py-px font-mono text-[10px] leading-3.5 font-medium whitespace-nowrap text-foreground';

/** The palette, mounted once in the app shell. Ctrl+K and the title bar's search button open it (UI-8). */
export function CommandPalette() {
  const open = usePaletteStore((state) => state.open);
  const setOpen = usePaletteStore((state) => state.setOpen);
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      // Another modal (a confirmation, say) is up: do not stack the palette on top of it. Our own may close itself.
      if (document.querySelector('[role="dialog"]:not([data-palette])')) return;
      event.preventDefault();
      const { open: isOpen, setOpen: set } = usePaletteStore.getState();
      set(!isOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogBareContent
        title={t('palette.title')}
        data-palette=""
        onOpenAutoFocus={(event) => {
          // Straight to the search field.
          event.preventDefault();
          document.getElementById('palette-input')?.focus();
        }}
      >
        <PaletteBody close={() => setOpen(false)} />
      </DialogBareContent>
    </Dialog>
  );
}

const GROUP_ICON: Record<PaletteGroup, LucideIcon> = {
  continue: Play,
  library: LibraryBig,
  navigate: Settings2,
  actions: RefreshCw,
  sources: ScanSearch,
};

function PaletteBody({ close }: { close: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searchText, setSearchText] = useState('');
  const [active, setActive] = useState(0);
  const incognito = useIncognito();
  const setIncognito = useSetIncognito();
  const { data: history = [] } = useQuery(historyQuery);

  // The library search runs in main (titles and alternative titles), so wait for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchText(query.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const { data: found = [] } = useQuery({
    ...libraryQuery({ sort: 'title', search: searchText }),
    enabled: searchText !== '',
  });

  const sections = useMemo(() => {
    const top = history[0];
    const next = top?.next;
    let continueWatching: Entry | null = null;
    if (top && next) {
      const left =
        next.reason === 'resume' && next.episodeId === top.episodeId && top.durationMs
          ? formatClock(Math.max(0, top.durationMs - top.positionMs))
          : null;
      let hint: string;
      if (next.reason === 'resume') {
        if (next.number === null) hint = t('library.continue');
        else if (left) hint = t('palette.continueWithTime', { number: next.number, left });
        else hint = t('palette.continueEpisode', { number: next.number });
      } else {
        hint = next.number !== null ? t('history.playEpisode', { number: next.number }) : t('history.playNext');
      }
      continueWatching = {
        id: 'continue',
        group: 'continue',
        label: top.title,
        action: {
          run: () => void router.navigate({ to: '/watch/$episodeId', params: { episodeId: String(next.episodeId) } }),
          hint,
          cover: {
            sourceId: top.sourceId,
            url: top.thumbnailUrl,
            localAnimeId: top.hasLocalCover ? top.animeId : undefined,
          },
        },
      };
    }

    const library: Entry[] = found.map((item) => ({
      id: `library:${item.animeId}`,
      group: 'library',
      label: item.title,
      action: {
        run: () => void router.navigate({ to: '/anime/$animeId', params: { animeId: String(item.animeId) } }),
        icon: LibraryBig,
        trailing: t('palette.openDetails'),
      },
    }));

    const navigate: Entry[] = [...MAIN_NAV, ...BROWSE_NAV, DOWNLOADS_NAV].map((item) => ({
      id: `nav:${item.to}`,
      group: 'navigate',
      label: t(`nav.${item.label}`),
      action: { run: () => void router.navigate({ to: item.to }), icon: item.icon },
    }));
    navigate.push({
      id: 'nav:settings',
      group: 'navigate',
      label: t('nav.settings'),
      action: {
        run: () => void router.navigate({ to: '/settings/$section', params: { section: SETTINGS_SECTION } }),
        icon: Settings2,
      },
    });

    const failed = (title: string) => (error: unknown) => notify.error(title, describeError(error, t));
    const actions: Entry[] = [
      {
        id: 'action:check-updates',
        group: 'actions',
        label: t('palette.checkUpdates'),
        keywords: t('palette.checkUpdatesKeywords'),
        action: {
          icon: RefreshCw,
          run: async () => {
            notify.info(t('palette.checking'));
            try {
              const result = await call('updates.check', { scope: { kind: 'all' } });
              if (result.newEpisodes > 0) notify.success(t('palette.checkedNew', { count: result.newEpisodes }));
              else notify.success(t('palette.checkedNone'));
            } catch (error) {
              failed(t('palette.checkFailed'))(error);
            }
          },
        },
      },
      {
        id: 'action:pause-downloads',
        group: 'actions',
        label: t('palette.pauseDownloads'),
        keywords: t('palette.pauseDownloadsKeywords'),
        action: {
          icon: Pause,
          run: () =>
            call('downloads.pauseAll').then(
              () => notify.success(t('palette.paused')),
              failed(t('palette.downloadsFailed')),
            ),
        },
      },
      {
        id: 'action:resume-downloads',
        group: 'actions',
        label: t('palette.resumeDownloads'),
        keywords: t('palette.resumeDownloadsKeywords'),
        action: {
          icon: Play,
          run: () =>
            call('downloads.resumeAll').then(
              () => notify.success(t('palette.resumed')),
              failed(t('palette.downloadsFailed')),
            ),
        },
      },
      {
        id: 'action:incognito',
        group: 'actions',
        label: t('incognito.toggle'),
        keywords: t('palette.incognitoKeywords'),
        action: {
          icon: EyeOff,
          hint: incognito ? t('palette.incognitoOn') : t('palette.incognitoOff'),
          run: () => setIncognito.mutate(!incognito),
        },
      },
    ];

    return buildSections<Payload>({
      query,
      continueWatching,
      library,
      navigate,
      actions,
      searchSources: (text) => ({
        id: 'sources',
        group: 'sources',
        label: t('palette.searchSources', { query: text }),
        action: {
          run: () => void router.navigate({ to: '/browse/global-search', search: { q: text } }),
          icon: ScanSearch,
        },
      }),
    });
  }, [found, history, incognito, query, router, setIncognito, t]);

  const flat = useMemo(() => flattenSections(sections), [sections]);
  const activeIndex = Math.min(active, flat.length - 1);
  const optionId = (index: number): string => `palette-option-${index}`;

  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = (entry: Entry | undefined): void => {
    if (!entry) return;
    close();
    void entry.action.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(moveActive(activeIndex, event.key === 'ArrowDown' ? 1 : -1, flat.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(flat[activeIndex]);
    } else if (event.key === 'Tab' && !event.shiftKey && query.trim() !== '') {
      // The shortcut for the last row: search every source for what was typed.
      event.preventDefault();
      choose(flat.find((entry) => entry.group === 'sources'));
    }
  };

  // Where each group starts in the flat list, for the option ids and the highlighted row.
  const starts = sections.map((_, at) => sections.slice(0, at).reduce((count, item) => count + item.entries.length, 0));
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Search className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <input
          id="palette-input"
          type="text"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={t('palette.label')}
          placeholder={t('palette.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd aria-hidden className={kbd}>
          {KEY_ESC}
        </kbd>
      </div>

      <div
        id="palette-list"
        role="listbox"
        aria-label={t('palette.label')}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {sections.map((section, sectionAt) => {
          const headingId = `palette-group-${section.group}`;
          return (
            <div key={section.group} role="group" aria-labelledby={headingId} className="pb-1">
              <div
                id={headingId}
                className="px-2 pt-2 pb-1 text-[11px] leading-4 font-semibold tracking-wider text-muted-foreground uppercase"
              >
                {t(`palette.groups.${section.group}`)}
              </div>
              {section.entries.map((entry, entryAt) => {
                const position = (starts[sectionAt] ?? 0) + entryAt;
                const isActive = position === activeIndex;
                const { icon, cover, hint, trailing } = entry.action;
                const Icon = icon ?? GROUP_ICON[entry.group];
                return (
                  <div
                    key={entry.id}
                    id={optionId(position)}
                    role="option"
                    aria-selected={isActive}
                    // Keep the focus in the search field.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => position !== activeIndex && setActive(position)}
                    onClick={() => choose(entry)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-foreground',
                      isActive && 'bg-accent',
                    )}
                  >
                    {cover ? (
                      <Cover
                        sourceId={cover.sourceId}
                        url={cover.url}
                        localAnimeId={cover.localAnimeId}
                        className="h-8 w-14 shrink-0 rounded-md"
                      />
                    ) : (
                      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('truncate', cover && 'font-semibold')}>{entry.label}</span>
                      {hint ? <span className="truncate text-xs leading-4 text-muted-foreground">{hint}</span> : null}
                    </span>
                    {trailing ? (
                      <span className="shrink-0 text-xs leading-4 text-muted-foreground">{trailing}</span>
                    ) : null}
                    {entry.group === 'sources' ? (
                      <kbd aria-hidden className={kbd}>
                        {KEY_TAB}
                      </kbd>
                    ) : isActive ? (
                      <kbd aria-hidden className={kbd}>
                        {KEY_ENTER}
                      </kbd>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div role="status" className="sr-only">
        {t('palette.results', { count: flat.length })}
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t px-4 py-2.5 text-xs leading-4 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <kbd aria-hidden className={kbd}>
            {KEY_UP}
          </kbd>
          <kbd aria-hidden className={kbd}>
            {KEY_DOWN}
          </kbd>
          {t('palette.hintMove')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd aria-hidden className={kbd}>
            {KEY_ENTER}
          </kbd>
          {t('palette.hintOpen')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd aria-hidden className={kbd}>
            {KEY_TAB}
          </kbd>
          {t('palette.hintSources')}
        </span>
      </div>
    </>
  );
}
