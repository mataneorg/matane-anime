import type { CatalogAnime } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ExternalLink, FolderInput, Library, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { CategoryDialog } from '@renderer/features/library/CategoryDialog';
import { call } from '@renderer/lib/api';
import { animeQuery } from '@renderer/lib/catalog';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { setInLibraryInCache } from './inLibraryCache';

/**
 * The right-click menu of a card in a source's list: open, add to or remove from the library, pick categories.
 * `children` is the card itself (a link), which stays the trigger. Both dialogs are controlled here, outside the
 * menu: one opened from a menu item would leave `pointer-events: none` on the page.
 */
export function AnimeCardMenu({ anime, children }: { anime: CatalogAnime; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { animeId, inLibrary } = anime;

  // The categories of an anime already in the library, for the dialog (a list item does not carry them).
  const { data: detail } = useQuery({ ...animeQuery(animeId), enabled: choosing && inLibrary });

  const fail = (error: unknown): void => notify.error(describeError(error, t));
  const add = useMutation({
    mutationFn: (categoryIds: number[]) => call('library.add', { animeId, categoryIds }),
    onSuccess: () => setInLibraryInCache(queryClient, animeId, true),
    onError: fail,
  });
  const setCategories = useMutation({
    mutationFn: (categoryIds: number[]) => call('library.setCategories', { animeIds: [animeId], categoryIds }),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => call('library.remove', { animeId }),
    onSuccess: () => setInLibraryInCache(queryClient, animeId, false),
    onError: fail,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => void navigate({ to: '/anime/$animeId', params: { animeId: String(animeId) } })}
          >
            <ExternalLink aria-hidden />
            {t('contextMenu.browse.open')}
          </ContextMenuItem>
          {inLibrary ? null : (
            <ContextMenuItem onSelect={() => add.mutate([])}>
              <Library aria-hidden />
              {t('anime.addToLibrary')}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => setChoosing(true)}>
            <FolderInput aria-hidden />
            {inLibrary ? t('library.moveToCategory') : t('contextMenu.browse.addToCategory')}
          </ContextMenuItem>
          {inLibrary ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem destructive onSelect={() => setRemoving(true)}>
                <Trash2 aria-hidden />
                {t('library.removeFromLibrary')}
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
      <CategoryDialog
        // The form reads `initial` once, so it opens when the current categories have arrived.
        open={choosing && (!inLibrary || detail !== undefined)}
        onOpenChange={setChoosing}
        title={inLibrary ? t('library.moveToCategory') : t('anime.addToLibrary')}
        confirmLabel={inLibrary ? t('common.save') : t('anime.addToLibrary')}
        initial={inLibrary ? (detail?.categoryIds ?? []) : []}
        onConfirm={(categoryIds) => (inLibrary ? setCategories.mutate(categoryIds) : add.mutate(categoryIds))}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('library.removeTitle', { count: 1 })}
        description={t('library.removeBody')}
        confirmLabel={t('library.removeFromLibrary')}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
