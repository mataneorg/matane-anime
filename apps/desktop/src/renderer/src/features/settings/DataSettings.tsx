import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { formatBytes, usageShare } from '@renderer/features/downloads/format';
import { call } from '@renderer/lib/api';
import { downloadStorageQuery } from '@renderer/lib/downloads';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';
import { BackupSection } from './BackupSection';

/**
 * Settings → Data and storage (mockup 10f): backup and restore, and the Storage part. The cover cache, automatic
 * backups and clearing data are not here yet.
 */
export function DataSettings() {
  const { t, i18n } = useTranslation();
  const { data: storage } = useQuery(downloadStorageQuery);
  const open = useMutation({
    mutationFn: () => call('downloads.openFolder'),
    onError: (error) => notify.error(t('settings.data.openFailed'), describeError(error, t)),
  });
  if (!storage) return null;
  const { percent, over } = usageShare(storage.usedBytes, storage.limitBytes);

  return (
    <div className="flex max-w-190 flex-col gap-6">
      <BackupSection />
      <section className="flex flex-col gap-4" aria-labelledby="storage-title">
        <h2 id="storage-title" className="text-[15px] leading-[22px] font-semibold">
          {t('settings.data.storage')}
        </h2>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold text-foreground">{t('settings.data.downloaded')}</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs leading-4 text-foreground">
                {formatBytes(storage.usedBytes, i18n.language)}
              </span>
              <Button variant="secondary" size="sm" disabled={open.isPending} onClick={() => open.mutate()}>
                {t('settings.data.openFolder')}
              </Button>
            </div>
          </div>
          <div
            role="progressbar"
            aria-label={t('settings.data.downloaded')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-1.5 overflow-hidden rounded-full bg-input"
          >
            <div className={cn('h-full', over ? 'bg-warning' : 'bg-accent')} style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs leading-4">
            {t('settings.data.ofLimit', {
              percent: Math.round(percent),
              limit: formatBytes(storage.limitBytes, i18n.language),
            })}
          </p>
        </div>
      </section>
    </div>
  );
}
