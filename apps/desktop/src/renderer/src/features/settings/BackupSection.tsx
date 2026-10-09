import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { BackupCounts, BackupPreview } from '@matane-anime/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { ConfirmDialog } from '@renderer/features/extensions/ConfirmDialog';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';

const COUNT_ROWS = ['anime', 'episodes', 'categories', 'history', 'covers', 'repositories', 'extensions'] as const;

/** Backup and restore (mockup 10f): one file of the user's data, and the way back from it. */
export function BackupSection() {
  const { t, i18n } = useTranslation();
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const create = useMutation({
    mutationFn: () => call('backup.export'),
    onSuccess: (result) => {
      if (result) notify.success(t('backup.created'), result.path);
    },
    onError: (error) => notify.error(t('backup.createFailed'), describeError(error, t)),
  });
  const peek = useMutation({
    mutationFn: () => call('backup.peek'),
    onSuccess: (result) => setPreview(result),
    onError: (error) => notify.error(t('backup.peekFailed'), describeError(error, t)),
  });
  const restore = useMutation({
    mutationFn: (token: string) => call('backup.import', { token }),
    onSuccess: () => notify.info(t('backup.restarting'), t('backup.restartingBody')),
    onError: (error) => notify.error(t('backup.restoreFailed'), describeError(error, t)),
  });
  const busy = create.isPending || peek.isPending || restore.isPending;
  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="backup-title">
      <h2 id="backup-title" className="text-[15px] leading-[22px] font-semibold">
        {t('settings.data.backup')}
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-xs leading-4">{t('backup.description')}</p>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => create.mutate()}>
            {t('backup.create')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => peek.mutate()}>
            {t('backup.restore')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={t('backup.restoreTitle')}
        description={t('backup.restoreBody')}
        confirmLabel={t('backup.restoreConfirm')}
        onConfirm={() => {
          if (preview) restore.mutate(preview.token);
        }}
      >
        {preview ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-4">
              <span className="font-mono">{preview.fileName}</span>
              {' · '}
              {t('backup.madeOn', {
                date: date(preview.manifest.createdAt),
                version: preview.manifest.appVersion,
              })}
            </p>
            <p className="font-semibold text-foreground">{t('backup.contents')}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-xs leading-4">
              {COUNT_ROWS.filter((row) => preview.manifest.counts[row as keyof BackupCounts] > 0).map((row) => (
                <div key={row} className="contents">
                  <dt>{t(`backup.${row}`)}</dt>
                  <dd className="font-mono text-foreground">
                    {new Intl.NumberFormat(i18n.language).format(preview.manifest.counts[row])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
