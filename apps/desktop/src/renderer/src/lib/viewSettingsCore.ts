import { LIBRARY_SORTS, type LibrarySettings } from '@matane-anime/shared';

// The parts of the view settings that need no React and no IPC.

/** `patch` applied over the block as it is in the cache right now, or over `fallback` when it is not there. */
export function mergeBlock<T extends object>(cached: T | undefined, fallback: T, patch: Partial<T>): T {
  return { ...(cached ?? fallback), ...patch };
}

const LEGACY_SORT = 'matane-anime.librarySort';
const LEGACY_ORDER = 'matane-anime.libraryOrder';

/**
 * The library's sort and direction used to be kept in this browser's local storage. Carries a value that is still
 * there over into the settings once, then removes it. Never throws: storage can be unavailable.
 */
export function takeLegacyLibraryView(): Partial<LibrarySettings> | null {
  try {
    const sort = localStorage.getItem(LEGACY_SORT);
    const order = localStorage.getItem(LEGACY_ORDER);
    localStorage.removeItem(LEGACY_SORT);
    localStorage.removeItem(LEGACY_ORDER);
    const patch: Partial<LibrarySettings> = {};
    const known = LIBRARY_SORTS.find((name) => name === sort);
    if (known) patch.sort = known;
    if (order === 'reversed') patch.descending = true;
    return Object.keys(patch).length > 0 ? patch : null;
  } catch {
    return null;
  }
}
