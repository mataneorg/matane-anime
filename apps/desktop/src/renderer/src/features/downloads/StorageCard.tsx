import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { downloadStorageQuery } from '@renderer/lib/downloads';
import { cn } from '@renderer/lib/utils';
import { ChangeFolderButton } from './ChangeFolderButton';
import { formatBytes, usageShare } from './format';

/** Used against the limit, free space on the drive and where episodes go (mockup 08). */
export function StorageCard() {
  const { t, i18n } = useTranslation();
  const { data: storage } = useQuery(downloadStorageQuery);
  if (!storage) return <div className="h-[92px] animate-pulse rounded-xl bg-muted" aria-hidden />;
  const { percent, over } = usageShare(storage.usedBytes, storage.limitBytes);
  const size = (bytes: number): string => formatBytes(bytes, i18n.language);

  return (
    <section
      aria-label={t('downloads.storage.title')}
      className="flex items-stretch gap-6 rounded-xl border bg-card/40 px-4 py-3.5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-semibold text-foreground">{t('downloads.storage.title')}</h2>
          <span className="text-xs text-foreground tabular-nums">
            {t('downloads.storage.usage', { used: size(storage.usedBytes), limit: size(storage.limitBytes) })}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t('downloads.storage.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn('h-full', over ? 'bg-ctp-peach' : 'bg-primary')} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{t('downloads.storage.note')}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
        {storage.freeBytes !== null ? (
          <span>
            <span className="font-medium text-foreground tabular-nums">{size(storage.freeBytes)}</span>{' '}
            {t('downloads.storage.free')}
          </span>
        ) : null}
        <span className="max-w-72 truncate font-medium text-foreground" title={storage.folder}>
          {storage.folder}
        </span>
        <ChangeFolderButton
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-0.5 text-xs font-normal text-primary-text hover:bg-transparent hover:underline"
        />
      </div>
    </section>
  );
}
