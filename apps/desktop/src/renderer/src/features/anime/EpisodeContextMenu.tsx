import type { DownloadItem, EpisodeRow } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  Circle,
  CircleCheck,
  Download,
  EyeOff,
  ListChecks,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@renderer/components/ui/context-menu';
import { episodeMenu, menuTargetIds } from '@renderer/features/anime/episodeMenu';
import { useDownloadActions } from '@renderer/features/downloads/actions';
import { call } from '@renderer/lib/api';
import { enqueueEpisodes } from '@renderer/lib/downloads';

/** Finished downloads waiting for the user to confirm that their files go. */
interface Deletion {
  downloadIds: number[];
  animeTitle: string;
  fromSelection: boolean;
}

/**
 * What the menu of an episode row does. The deletion is asked about here, outside the menu: a dialog opened from
 * a menu item leaves the page unclickable when the menu closes over it.
 */
export function useEpisodeMenuActions({
  onToggle,
  onActed,
}: {
  /** The select toggle of a row. */
  onToggle: (event: { shiftKey: boolean }, episodeId: number) => void;
  /** An action was applied to the selection, which has done its job. */
  onActed: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const downloads = useDownloadActions();
  const [deleting, setDeleting] = useState<Deletion | null>(null);
  const mark = useMutation({
    mutationFn: ({ ids, watched }: { ids: number[]; watched: boolean }) =>
      call('episodes.markWatched', { episodeIds: ids, watched }),
  });
  const previous = useMutation({ mutationFn: (id: number) => call('episodes.markPrevious', { episodeId: id }) });
  const reset = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => call('episodes.resetProgress', { episodeId: id }))),
  });

  const actions = {
    play: (episodeId: number) => void navigate({ to: '/watch/$episodeId', params: { episodeId: String(episodeId) } }),
    mark: (ids: number[], watched: boolean) => mark.mutate({ ids, watched }),
    markPrevious: (episodeId: number) => previous.mutate(episodeId),
    reset: (ids: number[]) => reset.mutate(ids),
    download: (episodeIds: number[]) => void enqueueEpisodes(episodeIds),
    retry: (ids: number[]) => ids.forEach((id) => downloads.retry.mutate(id)),
    cancel: (ids: number[]) => ids.forEach((id) => downloads.cancel.mutate(id)),
    askDelete: (deletion: Deletion) => setDeleting(deletion),
    toggle: onToggle,
    acted: onActed,
  };

  const count = deleting?.downloadIds.length ?? 0;
  const dialog = (
    <ConfirmDialog
      open={deleting !== null}
      onOpenChange={(open) => !open && setDeleting(null)}
      title={count > 1 ? t('contextMenu.episodes.deleteManyTitle', { count }) : t('downloads.completed.deleteTitle')}
      description={
        count > 1
          ? t('contextMenu.episodes.deleteManyBody', { title: deleting?.animeTitle ?? '' })
          : t('downloads.completed.deleteBody', { title: deleting?.animeTitle ?? '' })
      }
      confirmLabel={t('downloads.completed.delete')}
      onConfirm={() => {
        if (!deleting) return;
        for (const id of deleting.downloadIds) downloads.remove.mutate(id);
        if (deleting.fromSelection) onActed();
      }}
    />
  );
  return { actions, dialog };
}

export type EpisodeMenuActions = ReturnType<typeof useEpisodeMenuActions>['actions'];

/**
 * The right-click menu of one episode row. Its items are built once it opens, so a list of hundreds of rows
 * does not work out a menu for each. On a row inside the selection the actions apply to the whole selection.
 */
export function EpisodeMenu({
  episode,
  episodes,
  selected,
  downloads,
  actions,
}: {
  episode: EpisodeRow;
  episodes: readonly EpisodeRow[];
  selected: ReadonlySet<number>;
  downloads: ReadonlyMap<number, DownloadItem>;
  actions: EpisodeMenuActions;
}) {
  return (
    <ContextMenuContent>
      <EpisodeMenuItems
        episode={episode}
        episodes={episodes}
        selected={selected}
        downloads={downloads}
        actions={actions}
      />
    </ContextMenuContent>
  );
}

function EpisodeMenuItems({
  episode,
  episodes,
  selected,
  downloads,
  actions,
}: {
  episode: EpisodeRow;
  episodes: readonly EpisodeRow[];
  selected: ReadonlySet<number>;
  downloads: ReadonlyMap<number, DownloadItem>;
  actions: EpisodeMenuActions;
}) {
  const { t } = useTranslation();
  const inSelection = selected.has(episode.id);
  const ids = new Set(
    menuTargetIds(
      selected,
      episodes.map(({ id }) => id),
      episode.id,
    ),
  );
  const menu = episodeMenu(
    episodes.filter(({ id }) => ids.has(id)),
    downloads,
    inSelection,
  );
  const targetIds = [...ids];
  // What the selection was for is done once an action has been applied to it.
  const apply = (run: () => void) => () => {
    run();
    if (inSelection) actions.acted();
  };
  const item = (key: string, icon: ReactNode, label: string, onSelect: () => void, disabled = false) => (
    <ContextMenuItem key={key} disabled={disabled} onSelect={onSelect}>
      {icon}
      {label}
    </ContextMenuItem>
  );
  const icon = { 'aria-hidden': true, strokeWidth: 1.75 } as const;

  const groups: ReactNode[][] = [
    [menu.play ? item('play', <Play {...icon} />, t('player.play'), () => actions.play(episode.id)) : null],
    [
      menu.markWatched
        ? item(
            'watched',
            <Check {...icon} />,
            t('anime.markWatched'),
            apply(() => actions.mark(targetIds, true)),
          )
        : null,
      menu.markUnwatched
        ? item(
            'unwatched',
            <EyeOff {...icon} />,
            t('anime.markUnwatched'),
            apply(() => actions.mark(targetIds, false)),
          )
        : null,
      menu.markPrevious
        ? item('previous', <ListChecks {...icon} />, t('anime.markPrevious'), () => actions.markPrevious(episode.id))
        : null,
      item(
        'reset',
        <RotateCcw {...icon} />,
        t('anime.resetProgress'),
        apply(() => actions.reset(menu.reset)),
        menu.reset.length === 0,
      ),
    ],
    [
      menu.download.length > 0
        ? item(
            'download',
            <Download {...icon} />,
            t('anime.download'),
            apply(() => actions.download(menu.download)),
          )
        : null,
      menu.retry.length > 0
        ? item(
            'retry',
            <RefreshCw {...icon} />,
            t('downloads.episode.retry'),
            apply(() => actions.retry(menu.retry)),
          )
        : null,
      menu.cancel.length > 0
        ? item(
            'cancel',
            <X {...icon} />,
            t('contextMenu.episodes.cancelDownload'),
            apply(() => actions.cancel(menu.cancel)),
          )
        : null,
    ],
    [
      item(
        'select',
        menu.select === 'select' ? <CircleCheck {...icon} /> : <Circle {...icon} />,
        menu.select === 'select' ? t('anime.selectEpisode') : t('anime.deselectEpisode'),
        () => actions.toggle({ shiftKey: false }, episode.id),
      ),
    ],
    [
      menu.remove.length > 0 ? (
        <ContextMenuItem
          key="delete"
          destructive
          onSelect={() =>
            actions.askDelete({
              downloadIds: menu.remove,
              animeTitle: targetIds.map((id) => downloads.get(id)?.animeTitle).find(Boolean) ?? '',
              fromSelection: inSelection,
            })
          }
        >
          <Trash2 {...icon} />
          {t('contextMenu.episodes.deleteDownload')}
        </ContextMenuItem>
      ) : null,
    ],
  ].map((group) => group.filter(Boolean));

  return groups
    .filter((group) => group.length > 0)
    .map((group, index) => (
      <Fragment key={index}>
        {index > 0 ? <ContextMenuSeparator /> : null}
        {group}
      </Fragment>
    ));
}
