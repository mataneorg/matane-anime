import type { Category, LibraryQuery } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Check, Download, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { MigrateDialog } from '@renderer/features/anime/MigrateDialog';
import { pickEpisodes } from '@renderer/features/downloads/pick';
import { CategoryDialog } from '@renderer/features/library/CategoryDialog';
import { GridSkeleton } from '@renderer/features/library/GridSkeleton';
import { LibraryEmpty } from '@renderer/features/library/LibraryEmpty';
import { LibraryGrid } from '@renderer/features/library/LibraryGrid';
import { LibraryToolbar } from '@renderer/features/library/LibraryToolbar';
import { NewCategoryDialog } from '@renderer/features/library/NewCategoryDialog';
import { RenameCategoryDialog } from '@renderer/features/library/RenameCategoryDialog';
import { TabButton } from '@renderer/features/library/TabButton';
import { NO_FILTERS, filterCount, filtersOf, filtersQueryPart, pruneSources } from '@renderer/features/library/filters';
import {
  EMPTY_SELECTION,
  type PickEvent,
  type Selection,
  select,
  selectAll,
  visibleSelection,
} from '@renderer/features/library/selection';
import {
  type CardMenuAction,
  type TabMenuAction,
  menuTargetIds,
  movedCategoryIds,
  toggledAutoDownload,
} from '@renderer/features/library/menu';
import { useSelectionKeys } from '@renderer/features/library/useSelectionKeys';
import { call } from '@renderer/lib/api';
import { useScrollRestoration } from '@renderer/lib/scroll';
import { animeQuery, episodesQuery, sourcesQuery } from '@renderer/lib/catalog';
import { enqueueEpisodes, useDownloadMap } from '@renderer/lib/downloads';
import { categoriesQuery, libraryCountQuery, libraryQuery, uncategorizedCountQuery } from '@renderer/lib/library';
import { notify } from '@renderer/lib/toast';
import { useDebounced } from '@renderer/lib/useDebounced';
import { takeLegacyLibraryView, useLibrarySettings } from '@renderer/lib/viewSettings';

export const Route = createFileRoute('/_app/library')({
  // `?tab=` keeps the category in the address, so going back from an anime brings the same tab back.
  validateSearch: (search: Record<string, unknown>): { tab?: 'default' | number } => {
    const tab = search['tab'];
    if (tab === 'default') return { tab };
    const id = typeof tab === 'number' ? tab : typeof tab === 'string' ? Number(tab) : NaN;
    return Number.isInteger(id) ? { tab: id } : {};
  },
  component: LibraryPage,
});

type Tab = 'all' | 'default' | number;

function LibraryPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const requestedTab = Route.useSearch().tab;
  const downloads = useDownloadMap();
  const { data: count } = useQuery(libraryCountQuery);
  const { data: categories = [], isSuccess: categoriesLoaded } = useQuery(categoriesQuery);
  const { data: sourceList } = useQuery(sourcesQuery);
  const sources = useMemo(() => sourceList ?? [], [sourceList]);

  const [settings, updateSettings] = useLibrarySettings();
  // The sort used to be kept in local storage; a value left there moves into the settings once.
  useEffect(() => {
    const legacy = takeLegacyLibraryView();
    if (legacy) updateSettings(legacy);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A deleted category's tab falls back to "All"; "Default" only exists next to categories.
  const tab: Tab =
    requestedTab === undefined
      ? 'all'
      : !categoriesLoaded
        ? requestedTab
        : requestedTab === 'default'
          ? categories.length > 0
            ? 'default'
            : 'all'
          : categories.some((category) => category.id === requestedTab)
            ? requestedTab
            : 'all';
  const setTab = (next: Tab): void =>
    void navigate({ to: '/library', search: next === 'all' ? {} : { tab: next }, replace: true });

  const [draft, setDraft] = useState('');
  const search = useDebounced(draft.trim(), 200);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  // The anime the open dialog acts on: the selection (from the bar, or a menu on a selected card) or one card.
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [migrating, setMigrating] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [downloadPlan, setDownloadPlan] = useState<{ ids: number[]; animeIds: number[] } | null>(null);
  const [creating, setCreating] = useState(false);

  // Sources that are gone from a saved filter are left out (they would match nothing and could not be unticked).
  const filters = useMemo(
    () => pruneSources(filtersOf(settings), sourceList ? new Set(sourceList.map((source) => source.id)) : null),
    [settings, sourceList],
  );
  // Only what the user switched on is sent: the query is also the cache key.
  const query = useMemo<LibraryQuery>(
    () => ({
      sort: settings.sort,
      ...(settings.descending && { descending: true }),
      ...(typeof tab === 'number' && { category: tab }),
      ...(tab === 'default' && { uncategorized: true }),
      ...(search && { search }),
      ...filtersQueryPart(filters),
    }),
    [settings.sort, settings.descending, filters, tab, search],
  );
  const list = useQuery(libraryQuery(query));
  useScrollRestoration(list.isSuccess);
  const items = useMemo(() => list.data ?? [], [list.data]);
  const filtered = search !== '' || filterCount(filters) > 0;
  const { data: defaultCount = 0 } = useQuery({ ...uncategorizedCountQuery, enabled: categories.length > 0 });

  const ids = useMemo(() => items.map((item) => item.animeId), [items]);
  const selected = useMemo(() => new Set(visibleSelection(selection, ids)), [selection, ids]);
  const selectedIds = [...selected];
  const selecting = selectMode || selected.size > 0;
  const stopSelecting = useCallback((): void => {
    setSelectMode(false);
    setSelection(EMPTY_SELECTION);
  }, []);

  useSelectionKeys(ids, setSelection, stopSelecting);

  // A plain click opens the anime; with Ctrl/Shift, or while selecting, it changes the selection instead.
  const pick = (event: PickEvent, animeId: number): void => {
    const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey || selecting ? 'toggle' : null;
    if (!mode) return;
    event.preventDefault();
    setSelection((current) => select(current, ids, animeId, mode));
  };

  // Every action takes the anime it acts on, so the bar (the selection) and a card menu (see `menuTargetIds`) share it.
  const markWatched = useMutation({
    mutationFn: (animeIds: number[]) => call('library.markWatched', { animeIds, watched: true }),
  });
  const move = useMutation({
    mutationFn: (categoryIds: number[]) => call('library.setCategories', { animeIds: targetIds, categoryIds }),
  });
  // The unwatched episodes of these anime that are not downloaded yet; the user confirms the number (LIB-5).
  const prepareDownload = useMutation({
    mutationFn: async (animeIds: number[]) => {
      const episodeIds: number[] = [];
      for (const animeId of animeIds) {
        const episodes = await queryClient.fetchQuery(episodesQuery(animeId));
        episodeIds.push(...pickEpisodes(episodes, 'unwatched', downloads));
      }
      return episodeIds;
    },
    onSuccess: (episodeIds, animeIds) => {
      if (episodeIds.length === 0) notify.info(t('downloads.library.none'));
      else setDownloadPlan({ ids: episodeIds, animeIds });
    },
  });
  const remove = useMutation({
    mutationFn: async (animeIds: number[]) => {
      for (const animeId of animeIds) await call('library.remove', { animeId });
    },
  });
  // The anime the migration dialog is about; it needs the full details, which are local for a library anime.
  const { data: migrateAnime } = useQuery({ ...animeQuery(migrating ?? 0), enabled: migrating !== null });

  const openMove = (animeIds: number[]): void => {
    setTargetIds(animeIds);
    setMoving(true);
  };
  const openRemove = (animeIds: number[]): void => {
    setTargetIds(animeIds);
    setRemoving(true);
  };
  // Without select mode: the card's own actions leave the selection as it is, unless the card was part of it.
  const menuAction = (action: CardMenuAction, animeId: number): void => {
    const animeIds = menuTargetIds(selected, animeId);
    if (action === 'markWatched') markWatched.mutate(animeIds);
    else if (action === 'move') openMove(animeIds);
    else if (action === 'download') prepareDownload.mutate(animeIds);
    else if (action === 'migrate') setMigrating(animeId);
    else if (action === 'remove') openRemove(animeIds);
    else setSelection((current) => select(current, ids, animeId, 'toggle'));
  };

  const reorder = useMutation({ mutationFn: (order: number[]) => call('categories.reorder', { ids: order }) });
  const markAutoDownload = useMutation({
    mutationFn: (category: Category) =>
      call('categories.setAutoDownload', { id: category.id, mode: toggledAutoDownload(category.autoDownload) }),
  });
  const removeCategory = useMutation({ mutationFn: (id: number) => call('categories.delete', { id }) });
  const tabAction = (action: TabMenuAction, category: Category): void => {
    const order = categories.map((entry) => entry.id);
    if (action === 'rename') setRenaming(category);
    else if (action === 'autoDownload') markAutoDownload.mutate(category);
    else if (action === 'moveLeft') reorder.mutate(movedCategoryIds(order, category.id, -1));
    else if (action === 'moveRight') reorder.mutate(movedCategoryIds(order, category.id, 1));
    else setDeleting(category);
  };

  const clearFilters = (): void => {
    setDraft('');
    updateSettings(NO_FILTERS);
  };

  // Filters kept from before do not hide the first-run help of a library that has nothing in it.
  if (count === 0 && search === '' && tab === 'all') return <LibraryEmpty />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pt-5">
        <h1 className="flex items-center gap-3 text-xl font-semibold">
          {t('nav.library')}
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {t('empty.library.count', { count: count ?? 0 })}
          </span>
        </h1>
        <div className="ml-auto">
          <LibraryToolbar
            query={draft}
            onQuery={setDraft}
            settings={settings}
            filters={filters}
            onChange={updateSettings}
            sources={sources}
            selecting={selecting}
            onToggleSelecting={() => (selecting ? stopSelecting() : setSelectMode(true))}
          />
        </div>
      </header>

      <div className="mt-3 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b px-6">
        <div role="tablist" aria-label={t('nav.library')} className="flex items-center gap-1">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} label={t('library.all')} count={count ?? 0} />
          {categories.map((category, index) => (
            <TabButton
              key={category.id}
              active={tab === category.id}
              onClick={() => setTab(category.id)}
              label={category.name}
              count={category.count}
              menu={{
                category,
                first: index === 0,
                last: index === categories.length - 1,
                onAction: (action) => tabAction(action, category),
              }}
            />
          ))}
          {categories.length > 0 ? (
            <TabButton
              active={tab === 'default'}
              onClick={() => setTab('default')}
              label={t('library.default')}
              count={defaultCount}
            />
          ) : null}
        </div>
        <button
          type="button"
          aria-label={t('library.addCategory')}
          title={t('library.addCategory')}
          onClick={() => setCreating(true)}
          className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-offset-[-2px]"
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <GridSkeleton display={settings.display} coverSize={settings.coverSize} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Search}
            title={t(filtered ? 'library.noResults.title' : 'library.emptyCategory.title')}
            description={t(filtered ? 'library.noResults.description' : 'library.emptyCategory.description')}
            action={
              filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  {t('library.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <LibraryGrid
            items={items}
            display={settings.display}
            coverSize={settings.coverSize}
            selecting={selecting}
            selected={selected}
            onPick={pick}
            onMenuAction={menuAction}
          />
        )}

        {selecting ? (
          <div
            role="toolbar"
            aria-label={t('library.selection')}
            className="sticky bottom-5 z-20 mt-auto flex flex-wrap items-center gap-2 self-center rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-xl"
          >
            <span className="mr-2 font-semibold text-foreground">
              {t('library.selected', { count: selected.size })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={selected.size === ids.length}
              onClick={() => setSelection(selectAll(ids))}
            >
              {t('library.selectAll')}
            </Button>
            <Button variant="secondary" size="sm" disabled={selected.size === 0} onClick={() => openMove(selectedIds)}>
              {t('library.moveToCategory')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.size === 0 || markWatched.isPending}
              onClick={() => markWatched.mutate(selectedIds)}
            >
              <Check className="size-4" strokeWidth={1.75} aria-hidden />
              {t('library.markWatched')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.size === 0 || prepareDownload.isPending}
              onClick={() => prepareDownload.mutate(selectedIds)}
            >
              <Download className="size-4" strokeWidth={1.75} aria-hidden />
              {t('anime.download')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => openRemove(selectedIds)}
            >
              <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
              {t('library.removeFromLibrary')}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onClick={stopSelecting}>
              <X className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <CategoryDialog
        open={moving}
        onOpenChange={setMoving}
        title={t('library.moveToCategory')}
        confirmLabel={t('common.save')}
        initial={[]}
        onConfirm={(categoryIds) => move.mutate(categoryIds)}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('library.removeTitle', { count: targetIds.length })}
        description={t('library.removeBody')}
        confirmLabel={t('library.removeFromLibrary')}
        onConfirm={() => {
          remove.mutate(targetIds);
          if (targetIds.some((id) => selected.has(id))) stopSelecting();
        }}
      />
      <Dialog open={downloadPlan !== null} onOpenChange={(open) => !open && setDownloadPlan(null)}>
        <DialogContent
          title={t('downloads.library.title', { count: downloadPlan?.ids.length ?? 0 })}
          description={t('downloads.library.body', { count: downloadPlan?.animeIds.length ?? 0 })}
          closeLabel={t('common.close')}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDownloadPlan(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (downloadPlan) void enqueueEpisodes(downloadPlan.ids);
                if (downloadPlan?.animeIds.some((id) => selected.has(id))) stopSelecting();
                setDownloadPlan(null);
              }}
            >
              {t('anime.download')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <NewCategoryDialog open={creating} onOpenChange={setCreating} />
      <RenameCategoryDialog category={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('settings.library.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.library.deleteBody')}
        confirmLabel={t('settings.library.delete', { name: deleting?.name ?? '' })}
        onConfirm={() => {
          if (deleting) removeCategory.mutate(deleting.id);
        }}
      />
      {migrateAnime && migrating !== null ? (
        <MigrateDialog anime={migrateAnime} open onOpenChange={(open) => !open && setMigrating(null)} />
      ) : null}
    </div>
  );
}
