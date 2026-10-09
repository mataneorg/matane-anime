import { Link } from '@tanstack/react-router';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatSpeed } from '@renderer/features/downloads/format';
import { totalSpeed } from '@renderer/features/downloads/progress';
import { useDownloadsStore } from '@renderer/stores/downloads';
import { useUpdatesStore } from '@renderer/stores/updates';

const chip =
  'no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary-text transition-colors hover:bg-accent';

/**
 * One title bar indicator for background work: a running check for new episodes, or else the running downloads
 * (the check wins when both run: it is shorter and says more). A link to the page that shows the details.
 */
export function ActivityIndicator() {
  const { t, i18n } = useTranslation();
  const status = useUpdatesStore((state) => state.status);
  const running = useDownloadsStore((state) => Object.keys(state.progress).length);
  const speed = useDownloadsStore((state) => totalSpeed(state.progress));

  if (status.checking) {
    return (
      <Link to="/updates" className={chip}>
        <RefreshCw className="size-3.5 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
        {t('updates.checkingProgress', { done: status.done, total: status.total })}
      </Link>
    );
  }
  if (running === 0) return null;
  return (
    <Link to="/downloads" className={chip}>
      <Download className="size-3.5 motion-safe:animate-pulse" strokeWidth={1.75} aria-hidden />
      {t('downloads.activity', { count: running })}
      {speed > 0 ? <span className="font-mono">{formatSpeed(speed, i18n.language)}</span> : null}
    </Link>
  );
}
