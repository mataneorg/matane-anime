import type { DownloadStatus } from '@matane-anime/shared';

/** What a download row's right-click menu can do. */
export type DownloadMenuAction =
  'pause' | 'resume' | 'retry' | 'play' | 'moveUp' | 'openAnime' | 'openFolder' | 'cancel' | 'remove' | 'delete';

export interface DownloadMenuEntry {
  action: DownloadMenuAction;
  disabled?: true;
}

export interface DownloadMenu {
  /** The usual actions: what the status allows, then "Open anime" and "Open downloads folder". */
  main: DownloadMenuEntry[];
  /** Cancel, remove and delete: shown last, after a separator. */
  destructive: DownloadMenuEntry[];
}

/**
 * The entries of a row's menu, which follow its status the way the row's own buttons do. `canMoveUp` says
 * whether the row can still move up among the queued rows of its anime (the entry is disabled when not).
 */
export function downloadMenu(status: DownloadStatus, canMoveUp: boolean): DownloadMenu {
  const main: DownloadMenuEntry[] = [];
  const destructive: DownloadMenuEntry[] = [];
  switch (status) {
    case 'downloading':
      main.push({ action: 'pause' });
      destructive.push({ action: 'cancel' });
      break;
    case 'paused':
      main.push({ action: 'resume' });
      destructive.push({ action: 'cancel' });
      break;
    case 'queued':
      main.push(canMoveUp ? { action: 'moveUp' } : { action: 'moveUp', disabled: true });
      destructive.push({ action: 'cancel' });
      break;
    case 'error':
      main.push({ action: 'retry' });
      destructive.push({ action: 'remove' });
      break;
    case 'done':
      main.push({ action: 'play' });
      destructive.push({ action: 'delete' });
      break;
  }
  main.push({ action: 'openAnime' }, { action: 'openFolder' });
  return { main, destructive };
}
