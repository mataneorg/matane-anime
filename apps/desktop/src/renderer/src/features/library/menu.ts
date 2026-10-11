import type { AutoDownloadMode } from '@matane-anime/shared';

/** What a right-click on a library card can ask the page to do. Opening and continuing navigate on their own. */
export type CardMenuAction = 'markWatched' | 'move' | 'download' | 'migrate' | 'remove' | 'select';

/** What a right-click on a category tab can ask the page to do. */
export type TabMenuAction = 'rename' | 'autoDownload' | 'moveLeft' | 'moveRight' | 'delete';

/**
 * The anime a card menu acts on: the whole selection when the card is part of it, otherwise only that card (the
 * selection is left alone, and select mode is not entered).
 */
export function menuTargetIds(selection: ReadonlySet<number>, animeId: number): number[] {
  return selection.has(animeId) ? [...selection] : [animeId];
}

/** Which rows a card menu shows. Opening, continuing and migrating are about one anime, so they leave with a bulk. */
export function cardMenuRows(card: { canContinue: boolean; selected: boolean; targetCount: number }) {
  const single = card.targetCount === 1;
  return {
    continue: single && card.canContinue,
    open: single,
    migrate: single,
    select: !card.selected,
  };
}

/** The category ids with `id` moved one place left (-1) or right (1); unchanged when it is already at that end. */
export function movedCategoryIds(order: readonly number[], id: number, delta: -1 | 1): number[] {
  const from = order.indexOf(id);
  const to = from + delta;
  const ids = [...order];
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  [ids[from], ids[to]] = [ids[to] as number, ids[from] as number];
  return ids;
}

/** The menu's checkbox switches the mark between included and none; an excluded category becomes included. */
export function toggledAutoDownload(mode: AutoDownloadMode | null): AutoDownloadMode | null {
  return mode === 'include' ? null : 'include';
}
