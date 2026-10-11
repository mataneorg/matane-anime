import type { AvailableExtension, ExtensionInfo, RepoInfo } from '@matane-anime/shared';
import { availableState } from './helpers';

/** Which rows the right-click menu of an installed extension has; the buttons of the row follow the same rules. */
export interface InstalledMenu {
  preferences: boolean;
  /** The version the Update row offers, or `null` when there is nothing to update to. */
  update: string | null;
  reinstall: boolean;
  reload: boolean;
  /** The last row: a dev folder is taken out of the list, anything else is uninstalled. */
  removal: 'removeFolder' | 'uninstall';
}

export function installedMenu(extension: ExtensionInfo): InstalledMenu {
  const dev = extension.origin === 'dev';
  const failed = extension.status === 'error';
  return {
    preferences: extension.hasPreferences && !failed,
    update: extension.shadowed ? null : extension.updateAvailable,
    reinstall: failed && !dev && extension.repoId !== null,
    reload: dev,
    removal: dev ? 'removeFolder' : 'uninstall',
  };
}

/** What the first row of an offered extension does; `null` when it cannot be installed or updated from here. */
export function availableMenu(entry: AvailableExtension): 'install' | 'update' | null {
  const state = availableState(entry);
  return state.kind === 'install' || state.kind === 'update' ? state.kind : null;
}

/** The trust row of a repository: only a key that is not trusted yet can be trusted, only a trusted one doubted. */
export function repoTrustAction(repo: RepoInfo): 'trust' | 'stop' | null {
  return repo.trust === 'unverified' ? 'trust' : repo.trust === 'trusted' ? 'stop' : null;
}
