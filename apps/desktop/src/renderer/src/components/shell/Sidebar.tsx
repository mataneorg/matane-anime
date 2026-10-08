import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FlaskConical, PanelLeftClose, PanelLeftOpen, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePendingDownloads } from '@renderer/features/downloads/DownloadActivity';
import { appInfoQuery } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { useUiStore } from '@renderer/stores/ui';
import { BROWSE_NAV, DOWNLOADS_NAV, MAIN_NAV, type NavItem, SETTINGS_ICON } from './nav';

function NavLink({
  item,
  collapsed,
  badge = 0,
  badgeLabel = '',
}: {
  item: NavItem;
  collapsed: boolean;
  /** A count shown as a pill; `badgeLabel` says what it counts, for screen readers. */
  badge?: number;
  badgeLabel?: string;
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
        'relative flex h-9 items-center gap-3 rounded-lg px-3 text-muted-foreground transition-colors hover:bg-input/50',
        collapsed && 'justify-center px-0',
      )}
      activeProps={{
        className: 'bg-accent/16 font-semibold text-foreground shadow-[inset_2px_0_0_var(--color-accent)]',
        'aria-current': 'page',
      }}
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('size-4 shrink-0', isActive && 'text-accent')} strokeWidth={1.75} aria-hidden />
          {!collapsed && <span className="flex-1 truncate">{label}</span>}
          {badge > 0 && (
            <span
              className={cn(
                'rounded-full bg-input px-1.5 font-mono text-xs leading-5 font-medium text-foreground',
                collapsed && 'absolute top-1 right-1 px-1 text-[10px] leading-4',
              )}
            >
              {badge}
              <span className="sr-only"> {badgeLabel}</span>
            </span>
          )}
        </>
      )}
    </Link>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggle = useUiStore((state) => state.toggleSidebar);
  const { data: info } = useQuery(appInfoQuery);
  const pendingDownloads = usePendingDownloads();
  const SettingsIcon = SETTINGS_ICON;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col gap-0.5 border-r bg-sidebar p-3 transition-[width]',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className={cn('flex items-center gap-2.5 px-2 pt-1 pb-4', collapsed && 'justify-center px-0')}>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent">
          <Play className="size-3.5 fill-current" strokeWidth={2} aria-hidden />
        </div>
        {!collapsed && <div className="truncate text-[15px] leading-[22px] font-semibold">{t('app.name')}</div>}
      </div>

      {MAIN_NAV.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} />
      ))}

      {collapsed ? (
        <div className="my-2 border-t" />
      ) : (
        <div className="mt-2 flex h-9 items-center px-3 text-[11px] leading-3.5 font-medium tracking-[0.02em] text-muted-foreground uppercase">
          {t('nav.browse')}
        </div>
      )}
      {BROWSE_NAV.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} />
      ))}

      <div className="mt-2" />
      <NavLink
        item={DOWNLOADS_NAV}
        collapsed={collapsed}
        badge={pendingDownloads}
        badgeLabel={t('downloads.badge', { count: pendingDownloads })}
      />

      <div className="flex-1" />

      {info?.spike && (
        <Link
          to="/dev/spike"
          aria-label={collapsed ? t('nav.spike') : undefined}
          title={collapsed ? t('nav.spike') : undefined}
          className={cn(
            'flex h-9 items-center gap-3 rounded-lg px-3 text-muted-foreground transition-colors hover:bg-input/50',
            collapsed && 'justify-center px-0',
          )}
          activeProps={{ className: 'bg-accent/16 font-semibold text-foreground', 'aria-current': 'page' }}
        >
          <FlaskConical className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {!collapsed && <span className="flex-1 truncate">{t('nav.spike')}</span>}
        </Link>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
        title={collapsed ? t('nav.expand') : t('nav.collapse')}
        className={cn(
          'flex h-9 items-center gap-3 rounded-lg px-3 text-muted-foreground transition-colors hover:bg-input/50',
          collapsed && 'justify-center px-0',
        )}
      >
        <ToggleIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        {!collapsed && <span className="truncate">{t('nav.collapse')}</span>}
      </button>
      <Link
        to="/settings/$section"
        params={{ section: 'general' }}
        aria-label={collapsed ? t('nav.settings') : undefined}
        title={collapsed ? t('nav.settings') : undefined}
        className={cn(
          'flex h-9 items-center gap-3 rounded-lg px-3 text-muted-foreground transition-colors hover:bg-input/50',
          collapsed && 'justify-center px-0',
        )}
        activeProps={{
          className: 'bg-accent/16 font-semibold text-foreground shadow-[inset_2px_0_0_var(--color-accent)]',
          'aria-current': 'page',
        }}
      >
        {({ isActive }) => (
          <>
            <SettingsIcon className={cn('size-4 shrink-0', isActive && 'text-accent')} strokeWidth={1.75} aria-hidden />
            {!collapsed && <span className="flex-1 truncate">{t('nav.settings')}</span>}
          </>
        )}
      </Link>
    </aside>
  );
}
