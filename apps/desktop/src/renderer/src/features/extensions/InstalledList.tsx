import type { AvailableExtension, ExtensionInfo } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowUpCircle,
  EllipsisVertical,
  FolderX,
  RotateCw,
  ScrollText,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';
import type { InstallTarget } from './InstallDialog';
import { LogDialog } from './LogDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { TrustBadge } from './TrustBadge';
import { ExtensionIcon, LangBadges, TrustLine } from './parts';
import { alsoOfferedBy, sortInstalled } from './helpers';

/** The Installed tab (and the Updates tab): what runs now, with its updates, preferences and removal (mockup 06). */
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
  const [logsOpen, setLogsOpen] = useState(false);
  const dev = extension.origin === 'dev';
  const failed = extension.status === 'error';
  const { shadowed } = extension;
  const updatable = extension.updateAvailable !== null && !shadowed;
  const alsoFrom = alsoOfferedBy(extension, available);

  const reload = useMutation({
    mutationFn: () => call('extensions.reload', { folder: extension.folder ?? '' }),
    onError: (error) =>
      notify.error(t('extensions.toast.reloadFailed', { name: extension.name }), describeError(error, t)),
  });
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

  return (
    <li
      className={cn('rounded-xl border bg-card/40 px-4 py-3.5', failed && 'border-ctp-red/40')}
      data-testid={`extension-${extension.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ExtensionIcon id={extension.id} name={extension.name} className="size-11" />
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{extension.name}</span>
            {extension.version ? (
              <span className="font-mono text-xs text-muted-foreground">{extension.version}</span>
            ) : null}
            {failed ? null : <LangBadges langs={extension.sources.map((source) => source.lang)} />}
            {extension.nsfw ? <Badge variant="danger">18+</Badge> : null}
            {updatable ? (
              <Badge variant="primary">{t('extensions.updateTo', { version: extension.updateAvailable })}</Badge>
            ) : null}
            {failed ? <Badge variant="danger">{t('extensions.failed')}</Badge> : null}
            {!dev && !failed && !updatable && !shadowed ? (
              <Badge variant="success">{t('extensions.upToDate')}</Badge>
            ) : null}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            {dev ? (
              <>
                <TrustBadge trust={null} />
                <span className="truncate font-mono text-muted-foreground" title={extension.folder ?? undefined}>
                  {extension.folder}
                </span>
              </>
            ) : extension.trust ? (
              <TrustLine trust={extension.trust} repoName={extension.repoName} />
            ) : (
              <span className="text-muted-foreground">{t('extensions.repoRemoved')}</span>
            )}
            {!failed && extension.sources.length > 0 ? (
              <>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {t('extensions.sources', { count: extension.sources.length })}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {updatable ? (
            <Button size="sm" disabled={update.isPending} onClick={() => update.mutate()}>
              <ArrowUpCircle aria-hidden />
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
          {dev ? (
            <Button variant="secondary" size="sm" disabled={reload.isPending} onClick={() => reload.mutate()}>
              <RotateCw className={cn(reload.isPending && 'animate-spin')} aria-hidden />
              {t('extensions.reload')}
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
              <SlidersHorizontal aria-hidden />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('extensions.moreOf', { name: extension.name })}
                title={t('extensions.more')}
              >
                <EllipsisVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setLogsOpen(true)}>
                <ScrollText className="size-4" aria-hidden />
                {t('extensions.logs.open')}
              </DropdownMenuItem>
              {dev ? (
                <DropdownMenuItem onSelect={() => removeFolder.mutate()}>
                  <FolderX className="size-4" aria-hidden />
                  {t('extensions.removeFolder')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-danger-text"
                  aria-label={t('extensions.uninstallOf', { name: extension.name })}
                  disabled={uninstall.isPending}
                  onSelect={() => setConfirming(true)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t('extensions.uninstall')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {shadowed ? (
        <p className="mt-3 rounded-lg border border-ctp-blue/40 bg-ctp-blue/10 px-3 py-2 text-xs text-info-text">
          {t('extensions.shadowed')}
        </p>
      ) : null}
      {alsoFrom.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('extensions.alsoOffered', { repos: alsoFrom.join(', ') })}
        </p>
      ) : null}
      {failed && extension.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-ctp-red/40 bg-ctp-red/10 px-3 py-2 font-mono text-xs text-danger-text select-text"
        >
          {extension.error}
        </p>
      ) : null}
      {failed && !dev ? <p className="mt-2 text-xs text-muted-foreground">{t('extensions.reinstallHint')}</p> : null}
      <LogDialog extensionId={extension.id} name={extension.name} open={logsOpen} onOpenChange={setLogsOpen} />
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
