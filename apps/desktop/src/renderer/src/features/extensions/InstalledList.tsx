import type { AvailableExtension, ExtensionInfo } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { ConfirmDialog } from './ConfirmDialog';
import type { InstallTarget } from './InstallDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { TrustBadge } from './TrustBadge';
import { alsoOfferedBy, hue, languageCodes, sortInstalled } from './helpers';

/** The Installed tab: what runs now, with its updates, preferences and removal (mockup 06). */
export function InstalledList({
  extensions,
  available,
  onReinstall,
}: {
  extensions: ExtensionInfo[];
  available: AvailableExtension[];
  onReinstall: (target: InstallTarget) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {sortInstalled(extensions).map((extension) => (
        <InstalledRow key={extension.key} extension={extension} available={available} onReinstall={onReinstall} />
      ))}
    </ul>
  );
}

function InstalledRow({
  extension,
  available,
  onReinstall,
}: {
  extension: ExtensionInfo;
  available: AvailableExtension[];
  onReinstall: (target: InstallTarget) => void;
}) {
  const { t } = useTranslation();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dev = extension.origin === 'dev';
  const failed = extension.status === 'error';
  const { shadowed } = extension;
  const alsoFrom = alsoOfferedBy(extension, available);

  const reload = useMutation({ mutationFn: () => call('extensions.reload', { folder: extension.folder ?? '' }) });
  const removeFolder = useMutation({
    mutationFn: () => call('extensions.removeDevFolder', { folder: extension.folder ?? '' }),
  });
  const update = useMutation({
    mutationFn: () => call('extensions.update', { extensionId: extension.id }),
    onSuccess: () => notify.success(t('extensions.toast.updated', { name: extension.name })),
    onError: (error) =>
      notify.error(t('extensions.toast.updateFailed', { name: extension.name }), describeError(error, t)),
  });
  const uninstall = useMutation({
    mutationFn: () => call('extensions.uninstall', { extensionId: extension.id }),
    onSuccess: () => notify.success(t('extensions.toast.uninstalled', { name: extension.name })),
    onError: (error) =>
      notify.error(t('extensions.toast.uninstallFailed', { name: extension.name }), describeError(error, t)),
  });

  const meta = [failed ? null : languageCodes(extension.sources), dev ? null : extension.repoName].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 rounded-xl bg-card p-4" data-testid={`extension-${extension.id}`}>
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-black"
          style={{ background: `hsl(${hue(extension.id)} 65% 75%)` }}
        >
          {extension.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-foreground">{extension.name}</span>
            {extension.version ? <span className="font-mono text-xs leading-4">{extension.version}</span> : null}
            {extension.updateAvailable && !shadowed ? (
              <Badge tone="accent">{t('extensions.updateTo', { version: extension.updateAvailable })}</Badge>
            ) : null}
            {extension.nsfw ? <Badge tone="warning">18+</Badge> : null}
            {failed ? <Badge tone="danger">{t('extensions.failed')}</Badge> : null}
          </div>
          {dev ? (
            <span className="truncate font-mono text-xs leading-4" title={extension.folder ?? undefined}>
              {extension.folder}
            </span>
          ) : null}
          {meta.length > 0 ? <span className="truncate text-xs leading-4">{meta.join(' · ')}</span> : null}
          {alsoFrom.length > 0 ? (
            <span className="text-xs leading-4">{t('extensions.alsoOffered', { repos: alsoFrom.join(', ') })}</span>
          ) : null}
        </div>
        <TrustBadge trust={extension.trust} />
        {extension.updateAvailable && !shadowed ? (
          <Button variant="secondary" size="sm" disabled={update.isPending} onClick={() => update.mutate()}>
            {update.isPending ? t('extensions.updating') : t('extensions.update')}
          </Button>
        ) : null}
        {failed && !dev && extension.repoId !== null ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onReinstall({ repoId: extension.repoId as number, extensionId: extension.id, name: extension.name })
            }
          >
            {t('extensions.reinstall')}
          </Button>
        ) : null}
        {extension.hasPreferences && !failed ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('extensions.preferencesOf', { name: extension.name })}
            title={t('extensions.preferences')}
            onClick={() => setPrefsOpen(true)}
          >
            <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        ) : null}
        {dev ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('extensions.reload')}
              title={t('extensions.reload')}
              disabled={reload.isPending}
              onClick={() => reload.mutate()}
            >
              <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('extensions.remove')}
              title={t('extensions.remove')}
              onClick={() => removeFolder.mutate()}
            >
              <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('extensions.uninstallOf', { name: extension.name })}
            title={t('extensions.uninstall')}
            disabled={uninstall.isPending}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        )}
      </div>
      {shadowed ? (
        <p className="rounded-lg bg-info/12 px-3 py-2 text-xs leading-4 text-foreground">{t('extensions.shadowed')}</p>
      ) : null}
      {failed && extension.error ? (
        <p role="alert" className="rounded-lg bg-danger/12 px-3 py-2 font-mono text-xs leading-4 text-foreground">
          {extension.error}
        </p>
      ) : null}
      {failed && !dev ? <p className="text-xs leading-4">{t('extensions.reinstallHint')}</p> : null}
      <PreferencesDialog extension={extension} open={prefsOpen} onOpenChange={setPrefsOpen} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('extensions.uninstallTitle', { name: extension.name })}
        description={t('extensions.uninstallBody')}
        confirmLabel={t('extensions.uninstall')}
        onConfirm={() => uninstall.mutate()}
      />
    </li>
  );
}
