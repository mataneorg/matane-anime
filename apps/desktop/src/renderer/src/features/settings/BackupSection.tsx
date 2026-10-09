import {
  type BackupCounts,
  type BackupFile,
  type BackupPreview,
  BACKUP_AUTO_MODES,
  KEEP_AUTO_BACKUPS,
} from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { Segmented } from '@renderer/components/ui/segmented';
import { formatBytes } from '@renderer/features/downloads/format';
import { call } from '@renderer/lib/api';
import { relativeTime } from '@renderer/lib/dates';
import { describeError } from '@renderer/lib/errors';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';
import { useNow } from '@renderer/lib/useNow';
import { SettingRow, SettingsCard } from './parts';

const COUNT_ROWS = ['anime', 'episodes', 'categories', 'history', 'covers', 'repositories', 'extensions'] as const;
const SHOWN_FILES = 10;

const backupFilesQuery = {
  queryKey: ['backup', 'files'] as const,
  queryFn: () => call('backup.list'),
  staleTime: 0,
};
const backupFolderQuery = {
  queryKey: ['backup', 'folder'] as const,
  queryFn: () => call('backup.folder'),
  staleTime: 0,
};

/**
 * Backup and restore (mockup 10f): back up now into the backup folder, save a copy anywhere, automatic backups on a
 * schedule, the backups in the folder with a restore for each, and restoring from any file.
 */
export function BackupSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const { data: files = [] } = useQuery(backupFilesQuery);
  const { data: folder } = useQuery(backupFolderQuery);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const refreshList = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['backup'] });
  };
  const now = useMutation({
    mutationFn: () => call('backup.create'),
    onSuccess: (file) => {
      refreshList();
      notify.success(t('backup.created'), file.path);
    },
    onError: (error) => notify.error(t('backup.createFailed'), describeError(error, t)),
  });
  const saveAs = useMutation({
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
  const peekFile = useMutation({
    mutationFn: (path: string) => call('backup.peekFile', { path }),
    onSuccess: (result) => setPreview(result),
    onError: (error) => notify.error(t('backup.peekFailed'), describeError(error, t)),
  });
  const restore = useMutation({
    mutationFn: (token: string) => call('backup.import', { token }),
    onSuccess: () => notify.info(t('backup.restarting'), t('backup.restartingBody')),
    onError: (error) => notify.error(t('backup.restoreFailed'), describeError(error, t)),
  });
  const chooseFolder = useMutation({
    mutationFn: () => call('dialog.pickFolder'),
    onSuccess: (picked) => {
      if (picked) update.mutate({ backupFolder: picked }, { onSuccess: refreshList });
    },
  });
  const openFolder = useMutation({
    mutationFn: () => call('backup.openFolder'),
    onError: (error) => notify.error(t('backup.openFailed'), describeError(error, t)),
  });
  const busy = now.isPending || saveAs.isPending || peek.isPending || peekFile.isPending || restore.isPending;
  const date = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));
  if (!settings) return null;

  return (
    <SettingsCard id="backup-title" title={t('settings.data.backup')} description={t('backup.description')}>
      <div className="flex flex-wrap gap-2 pb-4">
        <Button disabled={busy} onClick={() => now.mutate()}>
          {t('backup.now')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => saveAs.mutate()}>
          {t('backup.create')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => peek.mutate()}>
          {t('backup.restore')}
        </Button>
      </div>

      <SettingRow label={t('backup.auto.label')} hint={t('backup.auto.hint', { count: KEEP_AUTO_BACKUPS })}>
        <Segmented
          label={t('backup.auto.label')}
          options={BACKUP_AUTO_MODES}
          value={settings.backupAuto}
          onChange={(backupAuto) => update.mutate({ backupAuto })}
          format={(mode) => t(`backup.auto.${mode}`)}
        />
      </SettingRow>

      <SettingRow
        label={t('backup.folder')}
        hint={
          <span className="block truncate font-mono" title={folder?.path}>
            {folder?.path ?? ''}
            {folder?.isDefault ? ` (${t('backup.defaultFolder')})` : ''}
          </span>
        }
      >
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={chooseFolder.isPending} onClick={() => chooseFolder.mutate()}>
            {t('backup.changeFolder')}
          </Button>
          {folder && !folder.isDefault ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => update.mutate({ backupFolder: null }, { onSuccess: refreshList })}
            >
              {t('backup.resetFolder')}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" disabled={openFolder.isPending} onClick={() => openFolder.mutate()}>
            {t('backup.openFolderButton')}
          </Button>
        </div>
      </SettingRow>

      <div className="flex flex-col gap-2 pt-4">
        <h3 className="font-medium">{t('backup.recent')}</h3>
        {files.length === 0 ? (
          <p className="text-xs leading-4 text-muted-foreground">{t('backup.noneYet')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" data-testid="backup-files">
            {files.slice(0, SHOWN_FILES).map((file) => (
              <BackupRow
                key={file.path}
                file={file}
                language={i18n.language}
                disabled={busy}
                onRestore={() => peekFile.mutate(file.path)}
              />
            ))}
          </ul>
        )}
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
            <p className="text-xs leading-4 text-muted-foreground">
              <span className="font-mono">{preview.fileName}</span>
              {' · '}
              {t('backup.madeOn', {
                date: date(preview.manifest.createdAt),
                version: preview.manifest.appVersion,
              })}
            </p>
            <p className="font-medium">{t('backup.contents')}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-xs leading-4 text-muted-foreground">
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
    </SettingsCard>
  );
}

function BackupRow({
  file,
  language,
  disabled,
  onRestore,
}: {
  file: BackupFile;
  language: string;
  disabled: boolean;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const now = useNow();
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs leading-4">{file.name}</span>
        <span className="block text-xs leading-4 text-muted-foreground">
          {relativeTime(file.modifiedAt, now, language)}
          {' · '}
          {formatBytes(file.sizeBytes, language)}
          {file.auto ? ` · ${t('backup.automatic')}` : ''}
        </span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        aria-label={t('backup.restoreFile', { name: file.name })}
        onClick={onRestore}
      >
        {t('backup.restoreThis')}
      </Button>
    </li>
  );
}
