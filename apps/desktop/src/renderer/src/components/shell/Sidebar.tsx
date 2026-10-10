import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronDown, Compass, FlaskConical, PanelLeftClose, PanelLeftOpen, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePendingDownloads } from '@renderer/features/downloads/usePendingDownloads';
import { badgeText } from '@renderer/features/updates/helpers';
import { availableQuery } from '@renderer/lib/catalog';
import { appInfoQuery, settingsQuery } from '@renderer/lib/ipc';
import { libraryCountQuery } from '@renderer/lib/library';
import { updatesCountQuery } from '@renderer/lib/updates';
import { cn } from '@renderer/lib/utils';
import { useUiStore } from '@renderer/stores/ui';
import { BROWSE_NAV, DOWNLOADS_NAV, MAIN_NAV, type NavItem, SETTINGS_ICON } from './nav';

/** A sidebar row. The router marks the active link with `data-status="active"`, which the `data-[status=active]` classes read. */
const itemClass =
  'relative flex h-9 items-center gap-3 rounded-lg border-l-2 border-transparent px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
const activeClass =
  'border-primary bg-primary/15 font-semibold text-primary-text hover:bg-primary/15 hover:text-primary-text';
const routerActiveClass =
  'data-[status=active]:border-primary data-[status=active]:bg-primary/15 data-[status=active]:font-semibold data-[status=active]:text-primary-text data-[status=active]:hover:bg-primary/15 data-[status=active]:hover:text-primary-text';

function NavLink({
  item,
  collapsed,
  nested = false,
  badge = 0,
  badgeLabel = '',
  dotLabel,
}: {
  item: NavItem;
  collapsed: boolean;
  /** A child of the Browse group: smaller and indented. */
  nested?: boolean;
  /** A count shown as a pill; `badgeLabel` says what it counts, for screen readers. */
  badge?: number;
  badgeLabel?: string;
  /** Something waits there (extension updates): a dot, named for screen readers. */
  dotLabel?: string | undefined;
}) {
  const { t } = useTranslation();
  const label = t(`nav.${item.label}`);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        itemClass,
        routerActiveClass,
        nested && !collapsed && 'h-8 pl-3 text-[13px]',
        collapsed && 'justify-center px-0',
      )}
      activeProps={{ 'aria-current': 'page' }}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {badge > 0 && (
        <span
          className={cn(
            'rounded-md bg-primary/20 px-1.5 text-[11px] leading-5 font-semibold text-primary-text',
            collapsed && 'absolute top-1 right-1 px-1 text-[10px] leading-4',
          )}
        >
          {badgeText(badge)}
          <span className="sr-only"> {badgeLabel}</span>
        </span>
      )}
      {dotLabel ? (
        <span
          role="img"
          aria-label={dotLabel}
          title={dotLabel}
          className={cn('size-1.5 shrink-0 rounded-full bg-primary', collapsed && 'absolute top-1.5 right-2.5')}
        />
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggle = useUiStore((state) => state.toggleSidebar);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: info } = useQuery(appInfoQuery);
  const { data: settings } = useQuery(settingsQuery);
  const pendingDownloads = usePendingDownloads();
  const { data: updatesCount = 0 } = useQuery(updatesCountQuery);
  const { data: libraryCount = 0 } = useQuery(libraryCountQuery);
  const { data: available } = useQuery(availableQuery);
  const extensionUpdates = available?.filter((entry) => entry.updateAvailable).length ?? 0;
  const [browseOpen, setBrowseOpen] = useState(true);
  const SettingsIcon = SETTINGS_ICON;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const browseActive = BROWSE_NAV.some((item) => pathname.startsWith(item.to));
  // Every settings section highlights the link, not just the one it points at.
  const settingsActive = pathname.startsWith('/settings');

  const dotFor = (item: NavItem): string | undefined =>
    item.to === '/browse/extensions' && extensionUpdates > 0
      ? t('extensions.updatesAvailable', { count: extensionUpdates })
      : undefined;

  return (
    <aside
      className={cn('flex shrink-0 flex-col border-r bg-sidebar p-3 transition-[width]', collapsed ? 'w-16' : 'w-56')}
    >
      <div className={cn('mb-3 flex items-center gap-2.5 border-b pb-3', collapsed ? 'justify-center' : 'px-1')}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Play className="size-4 fill-current" strokeWidth={2} aria-hidden />
        </div>
        {!collapsed && <div className="truncate text-base font-semibold tracking-tight">{t('app.name')}</div>}
      </div>

      {/* The negative margin and matching padding keep the focus outlines of the links from being clipped by the scroll area. */}
      <nav className="-mx-1.5 -my-1.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-1.5">
        {MAIN_NAV.map((item) => (
          <NavLink
            key={item.to}
            item={item}
            collapsed={collapsed}
            badge={item.to === '/updates' ? updatesCount : item.to === '/library' ? libraryCount : 0}
            badgeLabel={
              item.to === '/updates'
                ? t('updates.badge', { count: updatesCount })
                : item.to === '/library'
                  ? t('library.badge', { count: libraryCount })
                  : ''
            }
          />
        ))}

        {collapsed ? (
          <>
            <div className="my-1 border-t" />
            {BROWSE_NAV.map((item) => (
              <NavLink key={item.to} item={item} collapsed dotLabel={dotFor(item)} />
            ))}
            <div className="my-1 border-t" />
          </>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => setBrowseOpen((open) => !open)}
              aria-expanded={browseOpen}
              className={cn(itemClass, browseActive && 'text-foreground')}
            >
              <Compass className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="flex-1 truncate text-left">{t('nav.browse')}</span>
              <ChevronDown
                className={cn('size-4 transition-transform', !browseOpen && '-rotate-90')}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
            {browseOpen && (
              <div className="ml-5 flex flex-col gap-0.5 border-l pl-2">
                {BROWSE_NAV.map((item) => (
                  <NavLink key={item.to} item={item} collapsed={false} nested dotLabel={dotFor(item)} />
                ))}
              </div>
            )}
          </div>
        )}

        <NavLink
          item={DOWNLOADS_NAV}
          collapsed={collapsed}
          badge={pendingDownloads}
          badgeLabel={t('downloads.badge', { count: pendingDownloads })}
        />
      </nav>

      <div className="mt-2 flex flex-col gap-0.5 border-t pt-2">
        {/* Settings → Advanced → Developer mode shows it; the spike itself only exists in development or with MATANE_SPIKE=1. */}
        {settings?.devMode && info?.spike && (
          <Link
            to="/dev/spike"
            aria-label={collapsed ? t('nav.spike') : undefined}
            title={collapsed ? t('nav.spike') : undefined}
            className={cn(itemClass, routerActiveClass, collapsed && 'justify-center px-0')}
            activeProps={{ 'aria-current': 'page' }}
          >
            <FlaskConical className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            {!collapsed && <span className="flex-1 truncate">{t('nav.spike')}</span>}
          </Link>
        )}
        <Link
          to="/settings/$section"
          params={{ section: 'general' }}
          aria-label={collapsed ? t('nav.settings') : undefined}
          aria-current={settingsActive ? 'page' : undefined}
          title={collapsed ? t('nav.settings') : undefined}
          className={cn(itemClass, collapsed && 'justify-center px-0', settingsActive && activeClass)}
        >
          <SettingsIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {!collapsed && <span className="flex-1 truncate">{t('nav.settings')}</span>}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className={cn(itemClass, collapsed && 'justify-center px-0')}
        >
          <ToggleIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {!collapsed && <span className="truncate">{t('nav.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}
