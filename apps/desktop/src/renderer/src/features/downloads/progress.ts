import type { DownloadItem, DownloadProgress, DownloadStatus } from '@matane-anime/shared';

/**
 * Keeps the ticks of what is running. A tick that says anything else than `downloading` is the last word
 * about that download (done, paused, failed, back in the queue): its entry goes, and the list takes over
 * once `db.changed` refreshes it.
 */
export function mergeProgress(
  current: Record<number, DownloadProgress>,
  batch: readonly DownloadProgress[],
): Record<number, DownloadProgress> {
  if (batch.length === 0) return current;
  const next = { ...current };
  for (const tick of batch) {
    if (tick.status === 'downloading') next[tick.id] = tick;
    else delete next[tick.id];
  }
  return next;
}

/** An item with the live numbers over the stored ones, and `downloading` as soon as ticks arrive. */
export function withProgress(item: DownloadItem, progress: DownloadProgress | undefined): DownloadItem {
  if (!progress || item.status === 'done' || item.status === 'error' || item.status === 'paused') return item;
  return {
    ...item,
    status: 'downloading',
    segmentsDone: progress.segmentsDone,
    segmentsTotal: progress.segmentsTotal ?? item.segmentsTotal,
    bytesDone: progress.bytesDone,
    sizeBytes: progress.sizeBytes ?? item.sizeBytes,
  };
}

export interface DownloadGroups {
  active: DownloadItem[];
  queued: DownloadItem[];
  paused: DownloadItem[];
  failed: DownloadItem[];
  done: DownloadItem[];
}

/** The page's sections. The list comes sorted by queue order, so each group keeps it. */
export function groupDownloads(
  items: readonly DownloadItem[],
  progress: Record<number, DownloadProgress>,
): DownloadGroups {
  const groups: DownloadGroups = { active: [], queued: [], paused: [], failed: [], done: [] };
  const section: Record<DownloadStatus, keyof DownloadGroups> = {
    downloading: 'active',
    queued: 'queued',
    paused: 'paused',
    error: 'failed',
    done: 'done',
  };
  for (const stored of items) {
    const item = withProgress(stored, progress[stored.id]);
    groups[section[item.status]].push(item);
  }
  return groups;
}

/** What the sidebar badge counts: running and waiting downloads. */
export const pendingCount = (items: readonly DownloadItem[]): number =>
  items.filter((item) => item.status === 'downloading' || item.status === 'queued').length;

export const totalSpeed = (progress: Record<number, DownloadProgress>): number =>
  Object.values(progress).reduce((sum, tick) => sum + tick.bytesPerSecond, 0);

/** `ids` with the one at `from` moved to `to`. Out-of-range moves leave it as it was. */
export function moveId(ids: readonly number[], from: number, to: number): number[] {
  const next = [...ids];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as number);
  return next;
}

/**
 * The queue after `id` was moved to where `targetId` stands, or null when that is not a move the page shows:
 * the page lists the queue per anime, so a row only trades places with rows of its own anime (the other
 * anime's rows in between keep their places).
 */
export function moveWithinAnime(queued: readonly DownloadItem[], id: number, targetId: number): number[] | null {
  const from = queued.findIndex((row) => row.id === id);
  const to = queued.findIndex((row) => row.id === targetId);
  if (from < 0 || to < 0 || from === to || queued[from]?.animeId !== queued[to]?.animeId) return null;
  return moveId(
    queued.map((row) => row.id),
    from,
    to,
  );
}

/** The queue after `id` moved one step up (-1) or down (1) among the queued rows of its own anime, or null. */
export function stepWithinAnime(queued: readonly DownloadItem[], id: number, direction: -1 | 1): number[] | null {
  const from = queued.findIndex((row) => row.id === id);
  if (from < 0) return null;
  const animeId = queued[from]?.animeId;
  for (let index = from + direction; index >= 0 && index < queued.length; index += direction) {
    if (queued[index]?.animeId === animeId) return moveWithinAnime(queued, id, (queued[index] as DownloadItem).id);
  }
  return null;
}

/**
 * The list as main will hold it after `downloads.reorder(ids)`: the listed downloads take, in that order,
 * the places the listed ones held. Used to move a row at once, before main answers.
 */
export function applyReorder(items: readonly DownloadItem[], ids: readonly number[]): DownloadItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const listed = ids.filter((id) => byId.has(id));
  const wanted = new Set(listed);
  const slots = items.flatMap((item, index) => (wanted.has(item.id) ? [index] : []));
  const next = [...items];
  listed.forEach((id, order) => {
    const slot = slots[order] as number;
    next[slot] = { ...(byId.get(id) as DownloadItem), queueOrder: (items[slot] as DownloadItem).queueOrder };
  });
  return next;
}

export interface AnimeDownloads {
  animeId: number;
  title: string;
  items: DownloadItem[];
}

/** One group per anime, in the order each anime first appears, each keeping its downloads' order. */
export function groupByAnime(items: readonly DownloadItem[]): AnimeDownloads[] {
  const groups = new Map<number, AnimeDownloads>();
  for (const item of items) {
    const group = groups.get(item.animeId);
    if (group) group.items.push(item);
    else groups.set(item.animeId, { animeId: item.animeId, title: item.animeTitle, items: [item] });
  }
  return [...groups.values()];
}
