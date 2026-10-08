import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileSize, finalizeFolder, removeParts, removePath, writeFileAtomic } from './atomic';
import { DownloadAborted, type FetchSettings, fetchResumable, fetchToFile } from './fetch';
import type { HlsPlan, Mp4Plan } from './plan';

// Putting a plan on disk (docs/PRD.md DL-3…5): a pool of workers fetches what is missing into `<episode>.tmp/`,
// each file through `.part`; the playlists are written last and the folder takes its final name only then.
// What is already there stays, so pausing, failing and quitting cost nothing but the file in flight.

export const MARKER_FILE = '.matane-download.json';

export interface TransferProgress {
  /** Every byte that lands on disk, or goes away again, including what a resumed run found there. */
  onBytes(delta: number): void;
  /** A media segment completed (keys and init segments are not counted). */
  onSegment(): void;
  /** Bytes that crossed the network, for the speed. */
  onNetwork(delta: number): void;
}

/**
 * What a `.tmp` folder was started for. Files are named by position, so if a resume would pick another quality or
 * another encode, the files from before would be glued into the wrong episode: they are dropped instead.
 */
interface Marker {
  quality: number | null;
  files: number;
  segments: number;
  durationMs: number;
}

const markerOf = (plan: HlsPlan): Marker => ({
  quality: plan.quality,
  files: plan.resources.length,
  segments: plan.segmentCount,
  durationMs: Math.round(plan.durationSeconds * 1000),
});

async function readMarker(dir: string): Promise<Marker | null> {
  try {
    return JSON.parse(await readFile(join(dir, MARKER_FILE), 'utf8')) as Marker;
  } catch {
    return null;
  }
}

/** Runs `worker` over `items` with at most `width` at a time; the first failure stops the others and is thrown. */
async function pool<T>(
  items: T[],
  width: number,
  signal: AbortSignal,
  worker: (item: T, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const relay = (): void => controller.abort();
  signal.addEventListener('abort', relay, { once: true });
  let next = 0;
  let failure: { error: unknown } | null = null;
  const run = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const item = items[next++];
      if (item === undefined) return;
      try {
        await worker(item, controller.signal);
      } catch (error) {
        // The first failure is the cause; the others only stopped because of it.
        failure ??= { error };
        controller.abort();
        return;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(width, items.length) }, run));
  } finally {
    signal.removeEventListener('abort', relay);
  }
  if (failure !== null) throw (failure as { error: unknown }).error;
  if (signal.aborted) throw new DownloadAborted();
}

export interface HlsTransfer {
  plan: HlsPlan;
  tmp: string;
  final: string;
  fetch: FetchSettings;
  parallel: number;
  progress: TransferProgress;
}

/** Fetches every file of an HLS plan that is not on disk yet, then makes the folder final. */
export async function downloadHls(transfer: HlsTransfer): Promise<void> {
  const { plan, tmp, fetch, progress } = transfer;
  await mkdir(tmp, { recursive: true });
  const marker = markerOf(plan);
  const previous = await readMarker(tmp);
  if (previous && JSON.stringify(previous) !== JSON.stringify(marker)) {
    await removePath(tmp);
    await mkdir(tmp, { recursive: true });
  }
  await removeParts(tmp);
  await writeFileAtomic(join(tmp, MARKER_FILE), JSON.stringify(marker));

  // Keys and init segments first: without them nothing plays, and an expired link shows up early.
  const order = [
    ...plan.resources.filter((r) => r.kind !== 'segment'),
    ...plan.resources.filter((r) => r.kind === 'segment'),
  ];
  const missing = [];
  for (const resource of order) {
    const size = await fileSize(join(tmp, resource.file));
    if (size !== null && size > 0) {
      progress.onBytes(size);
      if (resource.kind === 'segment') progress.onSegment();
    } else missing.push(resource);
  }

  await pool(missing, transfer.parallel, fetch.signal, async (resource, signal) => {
    await fetchToFile({ ...fetch, signal }, resource.url, join(tmp, resource.file), {
      range: resource.byteRange,
      onBytes: (delta) => {
        progress.onBytes(delta);
        progress.onNetwork(Math.max(delta, 0));
      },
    });
    if (resource.kind === 'segment') progress.onSegment();
  });

  for (const playlist of plan.playlists) await writeFileAtomic(join(tmp, playlist.file), playlist.text);
  await removePath(join(tmp, MARKER_FILE));
  await finalizeFolder(tmp, transfer.final);
}

export interface Mp4Transfer {
  plan: Mp4Plan;
  final: string;
  fetch: FetchSettings;
  progress: TransferProgress;
}

/** Saves an MP4, continuing a `.part` left by an earlier run. */
export async function downloadMp4(transfer: Mp4Transfer): Promise<void> {
  const { plan, final, fetch, progress } = transfer;
  const have = await fileSize(`${final}.part`);
  if (have) progress.onBytes(have);
  await fetchResumable(fetch, plan.url, final, {
    onBytes: (delta) => {
      progress.onBytes(delta);
      progress.onNetwork(Math.max(delta, 0));
    },
  });
}
