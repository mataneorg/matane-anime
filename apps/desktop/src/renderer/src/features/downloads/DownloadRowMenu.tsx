import type { DownloadItem } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUp, FolderOpen, Pause, Play, RefreshCw, SquareArrowOutUpRight, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import type { useDownloadActions } from './actions';
import { type DownloadMenuAction, type DownloadMenuEntry, downloadMenu } from './rowMenu';

type Actions = ReturnType<typeof useDownloadActions>;

const ICONS = {
  pause: Pause,
  resume: Play,
  retry: RefreshCw,
  play: Play,
  moveUp: ArrowUp,
  openAnime: SquareArrowOutUpRight,
  openFolder: FolderOpen,
  cancel: X,
  remove: Trash2,
  delete: Trash2,
} satisfies Record<DownloadMenuAction, unknown>;

// The row's own labels where it has a short one ("Retry", "Play").
const LABELS = {
  pause: 'contextMenu.lists.pause',
  resume: 'contextMenu.lists.resume',
  retry: 'downloads.row.retryLabel',
  play: 'downloads.row.playLabel',
  moveUp: 'contextMenu.lists.moveUp',
  openAnime: 'contextMenu.lists.openAnime',
  openFolder: 'contextMenu.lists.openDownloads',
  cancel: 'contextMenu.lists.cancel',
  remove: 'contextMenu.lists.removeFromList',
  delete: 'contextMenu.lists.deleteFile',
} as const satisfies Record<DownloadMenuAction, string>;

/**
 * The right-click menu of a download row; `children` is the row's `<li>`. It runs the row's own actions, so
 * the buttons and the menu do the same. Deleting a finished download goes through `onDelete`, which opens the
 * page's confirmation (a dialog opened from inside a menu item would leave the page unclickable).
 */
export function DownloadRowMenu({
  item,
  actions,
  onDelete,
  onMoveUp,
  children,
}: {
  item: DownloadItem;
  actions: Actions;
  onDelete?: (item: DownloadItem) => void;
  /** Moves a queued row one step up; undefined when it cannot move. */
  onMoveUp?: (() => void) | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openFolder = useMutation({
    mutationFn: () => call('downloads.openFolder'),
    onError: (error) => notify.error(t('settings.data.openFailed'), describeError(error, t)),
  });
  const menu = downloadMenu(item.status, onMoveUp !== undefined);

  const run: Record<DownloadMenuAction, () => void> = {
    pause: () => actions.pause.mutate(item.id),
    resume: () => actions.resume.mutate(item.id),
    retry: () => actions.retry.mutate(item.id),
    play: () => void navigate({ to: '/watch/$episodeId', params: { episodeId: String(item.episodeId) } }),
    moveUp: () => onMoveUp?.(),
    openAnime: () => void navigate({ to: '/anime/$animeId', params: { animeId: String(item.animeId) } }),
    openFolder: () => openFolder.mutate(),
    cancel: () => actions.cancel.mutate(item.id),
    remove: () => actions.remove.mutate(item.id),
    delete: () => onDelete?.(item),
  };
  const entry = ({ action, disabled }: DownloadMenuEntry, destructive = false) => {
    const Icon = ICONS[action];
    return (
      <ContextMenuItem key={action} disabled={disabled === true} destructive={destructive} onSelect={run[action]}>
        <Icon aria-hidden />
        {t(LABELS[action])}
      </ContextMenuItem>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {menu.main.map((main) => entry(main))}
        <ContextMenuSeparator />
        {menu.destructive.map((last) => entry(last, true))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
