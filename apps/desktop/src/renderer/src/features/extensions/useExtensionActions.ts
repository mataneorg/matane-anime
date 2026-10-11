import type { ExtensionInfo } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import type { InstallTarget } from './InstallDialog';

/**
 * What an installed row can do, in one place: the buttons, the "more" dropdown and the right-click menu all call
 * these, so a mutation exists once. The dialogs they open are controlled here but rendered by the row, outside
 * the menus, so closing a menu never leaves one half open.
 */
export function useExtensionActions(extension: ExtensionInfo, onReinstall: (target: InstallTarget) => void) {
  const { t } = useTranslation();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

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

  /** Only meaningful for a failed copy that came from a repository; the callers check `installedMenu`. */
  const reinstall = () => {
    if (extension.repoId === null) return;
    onReinstall({ repoId: extension.repoId, extensionId: extension.id, name: extension.name });
  };

  return {
    reload,
    removeFolder,
    update,
    uninstall,
    reinstall,
    prefsOpen,
    setPrefsOpen,
    confirming,
    setConfirming,
    logsOpen,
    setLogsOpen,
  };
}
