import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { downloadsQuery } from '@renderer/lib/downloads';
import { useDownloadsStore } from '@renderer/stores/downloads';
import { formatSpeed } from './format';
import { pendingCount, totalSpeed } from './progress';

/** The count for the sidebar badge: downloads running or waiting. */
export function usePendingDownloads(): number {
  const { data } = useQuery(downloadsQuery);
  return pendingCount(data ?? []);
}

/** Shown in the title bar while something downloads (UI-1); a link to the Downloads page. */
export function DownloadActivity() {
  const { t, i18n } = useTranslation();
  const running = useDownloadsStore((state) => Object.keys(state.progress).length);
  const speed = useDownloadsStore((state) => totalSpeed(state.progress));
  if (running === 0) return null;
  return (
    <Link
      to="/downloads"
      className="no-drag flex h-6 items-center gap-1.5 rounded-full bg-accent/16 px-2.5 text-xs leading-4 font-medium text-foreground"
    >
      <Download className="size-3.5 text-accent motion-safe:animate-pulse" strokeWidth={1.75} aria-hidden />
      {t('downloads.activity', { count: running })}
      {speed > 0 ? <span className="font-mono">{formatSpeed(speed, i18n.language)}</span> : null}
    </Link>
  );
}
