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
  if (!storage) return <div className="h-[92px] animate-pulse rounded-xl bg-card" aria-hidden />;
  const { percent, over } = usageShare(storage.usedBytes, storage.limitBytes);
  const size = (bytes: number): string => formatBytes(bytes, i18n.language);

  return (
    <section aria-label={t('downloads.storage.title')} className="flex items-stretch gap-6 rounded-xl bg-card p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-semibold text-foreground">{t('downloads.storage.title')}</h2>
          <span className="font-mono text-xs leading-4 text-foreground">
            {t('downloads.storage.usage', { used: size(storage.usedBytes), limit: size(storage.limitBytes) })}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t('downloads.storage.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 overflow-hidden rounded-full bg-input"
        >
          <div className={cn('h-full', over ? 'bg-warning' : 'bg-accent')} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs leading-4">{t('downloads.storage.note')}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs leading-4">
        {storage.freeBytes !== null ? (
          <span>
            <span className="font-mono font-medium text-foreground">{size(storage.freeBytes)}</span>{' '}
            {t('downloads.storage.free')}
          </span>
        ) : null}
        <span className="max-w-72 truncate font-mono font-medium text-foreground" title={storage.folder}>
          {storage.folder}
        </span>
        <ChangeFolderButton
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-0.5 text-xs font-normal text-accent hover:bg-transparent hover:underline"
        />
      </div>
    </section>
  );
}
