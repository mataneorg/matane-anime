import {
  type BrowseSettings,
  DEFAULT_BROWSE_SETTINGS,
  DEFAULT_GLOBAL_SEARCH_SETTINGS,
  DEFAULT_LIBRARY_SETTINGS,
  type GlobalSearchSettings,
  type LibrarySettings,
} from '@matane-anime/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsQuery, useUpdateSettings } from './ipc';
import { notify } from './toast';
import { mergeBlock } from './viewSettingsCore';

export { takeLegacyLibraryView } from './viewSettingsCore';

/** The settings blocks that remember how a list looks. */
interface ViewBlocks {
  library: LibrarySettings;
  browse: BrowseSettings;
  globalSearch: GlobalSearchSettings;
}

const DEFAULTS: ViewBlocks = {
  library: DEFAULT_LIBRARY_SETTINGS,
  browse: DEFAULT_BROWSE_SETTINGS,
  globalSearch: DEFAULT_GLOBAL_SEARCH_SETTINGS,
};

/**
 * One view block of the app settings and a way to change part of it. A change is merged into the block as it
 * is in the cache right now (not as of this render), so quick successive changes build on each other.
 */
function useViewBlock<K extends keyof ViewBlocks>(key: K): [ViewBlocks[K], (patch: Partial<ViewBlocks[K]>) => void] {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery(settingsQuery);
  const { mutateAsync } = useUpdateSettings();
  // What was just chosen, shown in the very render after the click: the settings cache is updated a moment later
  // (the save is optimistic, but not synchronous), and a toggle must not look unchanged in between.
  const [chosen, setChosen] = useState<ViewBlocks[K] | null>(null);
  // The same, readable in the middle of a burst of changes; and how many saves are still on their way.
  const latest = useRef<ViewBlocks[K] | null>(null);
  const saving = useRef(0);
  const block = chosen ?? ((data?.[key] ?? DEFAULTS[key]) as ViewBlocks[K]);
  const update = (patch: Partial<ViewBlocks[K]>): void => {
    const cached = queryClient.getQueryData(settingsQuery.queryKey)?.[key] as ViewBlocks[K] | undefined;
    const next = mergeBlock(latest.current ?? cached, block, patch);
    latest.current = next;
    setChosen(next);
    saving.current += 1;
    // `useUpdateSettings` puts the old settings back when a save fails; the toast says so.
    // (Not `mutate` with callbacks: those only run for the latest of several overlapping saves.)
    mutateAsync({ [key]: next })
      .catch(() => notify.error(t('library.viewSaveFailed')))
      .finally(() => {
        saving.current -= 1;
        if (saving.current === 0) {
          latest.current = null;
          setChosen(null);
        }
      });
  };
  return [block, update];
}

/** The library page's display, sort and filters (kept across restarts). */
export const useLibrarySettings = () => useViewBlock('library');
/** How a source's list in Browse looks. */
export const useBrowseView = () => useViewBlock('browse');
/** Global search: the sources asked and whether empty ones are hidden. */
export const useGlobalSearchSettings = () => useViewBlock('globalSearch');
