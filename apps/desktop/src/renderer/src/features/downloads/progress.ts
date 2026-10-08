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
